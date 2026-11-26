import { createHash } from "node:crypto";
import { canonicalEobraJson, inspectEobraSnapshot, EOBRA_SNAPSHOT_FORMAT, EOBRA_SNAPSHOT_ENTITIES } from "./snapshot.mjs";

export const EOBRA_PACKAGE_FORMAT = "elos.eobra.snapshot.parts.v1";
export const MAX_PACKAGE_PART_BYTES = 2 * 1024 * 1024;
export const MAX_PACKAGE_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_PACKAGE_PART_RECORDS = 500;
export const MAX_PACKAGE_PARTS = 1000;
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
export const MAX_PACKAGE_RECORDS = 100000;
const PROJECT_ENTITIES = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileName = ordinal => `part-${String(ordinal).padStart(6, "0")}.json`;
const unique = values => [...new Set(values)];

function bytesOf(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Arquivo deve ser texto ou bytes UTF-8.");
}

function decode(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("Arquivos do pacote devem usar UTF-8 sem BOM.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Arquivo não contém UTF-8 válido."); }
}

function descriptorErrors(descriptor, expectedOrdinal = null, expectedFirstRecord = null) {
  if (!object(descriptor)) return ["Descritor de parte deve ser um objeto."];
  const errors = [];
  if (!integer(descriptor.ordinal, 1, MAX_PACKAGE_PARTS) || (expectedOrdinal !== null && descriptor.ordinal !== expectedOrdinal)) errors.push("ordinal: partes devem ser consecutivas, começando em 1.");
  if (!integer(descriptor.firstRecord, 1, MAX_PACKAGE_RECORDS) || (expectedFirstRecord !== null && descriptor.firstRecord !== expectedFirstRecord)) errors.push("firstRecord: intervalos de registros devem ser contíguos, começando em 1.");
  if (!integer(descriptor.recordCount, 1, MAX_PACKAGE_PART_RECORDS)) errors.push("recordCount: cada parte deve conter de 1 a 500 registros.");
  if (!integer(descriptor.byteLength, 2, MAX_PACKAGE_PART_BYTES)) errors.push("byteLength: cada parte deve ter até 2 MiB.");
  if (typeof descriptor.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) errors.push("sha256: informe hash hexadecimal SHA-256 em minúsculas.");
  if (typeof descriptor.name !== "string" || descriptor.name !== fileName(descriptor.ordinal)) errors.push("name: use somente part-000001.json conforme o ordinal, sem diretórios ou URL.");
  return errors;
}

function coverageErrors(coverage, scope, archiveTypes) {
  if (!Array.isArray(coverage)) return ["coverage: informe a lista de evidências do snapshot."];
  const errors = [];
  const identities = new Set();
  const projects = new Set(Array.isArray(scope?.projectIds) ? scope.projectIds : []);
  const archives = new Set(Array.isArray(archiveTypes) ? archiveTypes.filter(object).map(value => value.key) : []);
  for (let i = 0; i < coverage.length; i++) {
    const entry = coverage[i];
    const prefix = `coverage[${i}]: `;
    if (!object(entry)) { errors.push(`${prefix}evidência deve ser objeto.`); continue; }
    if (!EOBRA_SNAPSHOT_ENTITIES.includes(entry.entity)) errors.push(`${prefix}entidade desconhecida.`);
    const project = entry.sourceProjectId ?? null;
    if (project !== null && (!validId(project) || !projects.has(project))) errors.push(`${prefix}obra ausente do escopo.`);
    if (PROJECT_ENTITIES.has(entry.entity) && project === null) errors.push(`${prefix}entidade exige cobertura por obra.`);
    if (entry.entity === "project" && project !== null) errors.push(`${prefix}catálogo project deve ser global.`);
    if (entry.entity === "raw_archive" && !archives.has(entry.archiveType)) errors.push(`${prefix}tipo complementar não foi declarado.`);
    const key = JSON.stringify([entry.entity, project, entry.entity === "raw_archive" ? entry.archiveType : null]);
    if (identities.has(key)) errors.push(`${prefix}cobertura repetida.`); identities.add(key);
    for (const field of ["expectedCount", "expectedPages", "detailsExpected"]) if (entry[field] !== null && !integer(entry[field], 0, MAX_PACKAGE_RECORDS)) errors.push(`${prefix}${field} deve ser inteiro não negativo ou null.`);
    if (entry.collectedCount !== undefined && !integer(entry.collectedCount, 0, MAX_PACKAGE_RECORDS)) errors.push(`${prefix}collectedCount inválido.`);
    const pages = entry.collectedPages;
    const details = entry.detailsCollected;
    if (!Array.isArray(pages) || pages.some(page => !integer(page, 1, MAX_PACKAGE_RECORDS)) || new Set(pages).size !== pages.length) errors.push(`${prefix}collectedPages exige páginas positivas distintas.`);
    if (!Array.isArray(details) || details.some(id => !validId(id)) || new Set(details).size !== details.length) errors.push(`${prefix}detailsCollected exige IDs textuais distintos.`);
    if (typeof entry.complete !== "boolean") errors.push(`${prefix}complete deve ser booleano explícito.`);
    if (!object(entry.filters)) errors.push(`${prefix}filters deve conservar os filtros observados.`);
    if (integer(entry.expectedCount, 0, MAX_PACKAGE_RECORDS) && integer(entry.detailsExpected, 0, MAX_PACKAGE_RECORDS) && entry.detailsExpected > entry.expectedCount) errors.push(`${prefix}detalhes esperados excedem registros esperados.`);
    if (entry.complete === true) {
      if ([entry.expectedCount, entry.expectedPages, entry.detailsExpected].some(value => value === null || value === undefined)) errors.push(`${prefix}cobertura completa não admite expectativas desconhecidas.`);
      if (Array.isArray(pages) && (pages.length !== entry.expectedPages || [...pages].sort((a, b) => a - b).some((page, index) => page !== index + 1))) errors.push(`${prefix}páginas não comprovam a alegação de coleta completa.`);
      if (Array.isArray(details) && details.length !== entry.detailsExpected) errors.push(`${prefix}detalhes não comprovam a alegação de coleta completa.`);
    }
  }
  return errors;
}

/** Metadata only: business coverage is rechecked against staged records by the database. */
export function inspectEobraPackageManifest(value) {
  const result = { ok: false, errors: [], manifest: null, byteLength: 0, totalPartBytes: 0, manifestHash: null };
  let manifest;
  try {
    if (typeof value === "string" || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = bytesOf(value); result.byteLength = bytes.length;
      if (bytes.length > MAX_PACKAGE_MANIFEST_BYTES) throw new Error("Manifesto excede o limite de 2 MiB.");
      manifest = JSON.parse(decode(bytes));
    } else manifest = value;
    const canonical = canonicalEobraJson(manifest);
    if (!result.byteLength) result.byteLength = Buffer.byteLength(canonical, "utf8");
    if (result.byteLength > MAX_PACKAGE_MANIFEST_BYTES) throw new Error("Manifesto excede o limite de 2 MiB.");
    manifest = JSON.parse(canonical);
    result.manifestHash = sha(Buffer.from(canonical, "utf8"));
  } catch (error) { result.errors.push(error instanceof Error ? error.message : "Manifesto JSON inválido."); return result; }
  if (!object(manifest)) { result.errors.push("Manifesto precisa ser um objeto JSON."); return result; }
  if (manifest.format !== EOBRA_PACKAGE_FORMAT) result.errors.push(`format: esperado ${EOBRA_PACKAGE_FORMAT}.`);
  if (!Array.isArray(manifest.archiveTypes)) result.errors.push("archiveTypes: informe lista explícita de tipos complementares, inclusive vazia.");
  if (!integer(manifest.recordCount, 1, MAX_PACKAGE_RECORDS)) result.errors.push("recordCount: pacote deve conter de 1 a 100.000 registros.");
  if (manifest.globalSnapshotHash !== undefined && (typeof manifest.globalSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(manifest.globalSnapshotHash))) result.errors.push("globalSnapshotHash inválido.");
  // Reuse the authoritative source/scope/type checks without pretending that records were loaded.
  const envelope = inspectEobraSnapshot({ format: EOBRA_SNAPSHOT_FORMAT, source: manifest.source ?? null, scope: manifest.scope ?? null, archiveTypes: manifest.archiveTypes ?? [], coverage: [], records: [] });
  result.errors.push(...envelope.errors.filter(error => !error.startsWith("scope.projectIds: obra ")));
  result.errors.push(...coverageErrors(manifest.coverage, manifest.scope, manifest.archiveTypes));
  if (!Array.isArray(manifest.parts) || !integer(manifest.parts.length, 1, MAX_PACKAGE_PARTS)) result.errors.push("parts: informe de 1 a 1.000 partes.");
  let nextRecord = 1;
  const names = new Set();
  for (const [index, part] of (Array.isArray(manifest.parts) ? manifest.parts.slice(0, MAX_PACKAGE_PARTS + 1) : []).entries()) {
    result.errors.push(...descriptorErrors(part, index + 1, nextRecord).map(error => `parts[${index}].${error}`));
    if (!object(part)) continue;
    if (names.has(part.name)) result.errors.push("parts: nome de arquivo repetido."); names.add(part.name);
    if (integer(part.recordCount, 1, MAX_PACKAGE_PART_RECORDS)) nextRecord += part.recordCount;
    if (integer(part.byteLength, 2, MAX_PACKAGE_PART_BYTES)) result.totalPartBytes += part.byteLength;
  }
  if (nextRecord - 1 !== manifest.recordCount) result.errors.push("recordCount: soma dos intervalos de partes difere do total declarado.");
  if (result.totalPartBytes > MAX_PACKAGE_BYTES) result.errors.push("Partes excedem o limite total de 200 MiB.");
  result.errors = unique(result.errors);
  result.ok = result.errors.length === 0;
  if (result.ok) result.manifest = manifest;
  return result;
}

function recordShapeErrors(records) {
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!object(record)) { errors.push(`records[${i}]: registro deve ser objeto.`); continue; }
    if (!EOBRA_SNAPSHOT_ENTITIES.includes(record.entity) || !validId(record.sourceId)) errors.push(`records[${i}]: entidade e sourceId textual são obrigatórios.`);
    if (record.sourceProjectId !== undefined && record.sourceProjectId !== null && !validId(record.sourceProjectId)) errors.push(`records[${i}]: sourceProjectId inválido.`);
    if (record.parentSourceId !== undefined && record.parentSourceId !== null && !validId(record.parentSourceId)) errors.push(`records[${i}]: parentSourceId inválido.`);
    if (!object(record.raw) || !object(record.normalized)) errors.push(`records[${i}]: raw e normalized devem ser objetos.`);
    if (!Array.isArray(record.links) || record.links.length > 2000) errors.push(`records[${i}]: links deve ser lista de até 2.000 relações.`);
    if (record.entity === "raw_archive" && !validId(record.archiveType)) errors.push(`records[${i}]: arquivo complementar exige archiveType.`);
  }
  return errors;
}

/** Verify exact bytes before JSON is allowed into the staging RPC. */
export function inspectEobraPackagePart(value, descriptor) {
  const result = { ok: false, errors: descriptorErrors(descriptor), records: null, byteLength: 0, sha256: null };
  if (result.errors.length) return result;
  try {
    const bytes = bytesOf(value);
    result.byteLength = bytes.length;
    if (bytes.length > MAX_PACKAGE_PART_BYTES) throw new Error("Parte excede o limite de 2 MiB.");
    result.sha256 = sha(bytes);
    if (bytes.length !== descriptor.byteLength) result.errors.push("byteLength: tamanho da parte difere do manifesto.");
    if (result.sha256 !== descriptor.sha256) result.errors.push("sha256: conteúdo da parte difere do manifesto.");
    if (result.errors.length) return result;
    const records = JSON.parse(decode(bytes));
    if (!Array.isArray(records) || !integer(records.length, 1, MAX_PACKAGE_PART_RECORDS)) throw new Error("Parte deve ser um array JSON de 1 a 500 registros.");
    if (records.length !== descriptor.recordCount) result.errors.push("recordCount: quantidade de registros difere do manifesto.");
    canonicalEobraJson(records);
    result.errors.push(...recordShapeErrors(records));
    result.errors = unique(result.errors);
    result.ok = result.errors.length === 0;
    if (result.ok) result.records = records;
  } catch (error) { result.errors.push(error instanceof Error ? error.message : "Parte JSON inválida."); }
  return result;
}

/** Deterministic transport writer. A valid bundle does not itself declare source completeness. */
export function createEobraPackage(snapshot, options = {}) {
  const globalSnapshotHash = sha(Buffer.from(canonicalEobraJson(snapshot), "utf8"));
  const maxBytes = options.maxPartBytes ?? MAX_PACKAGE_PART_BYTES;
  const maxRecords = options.maxPartRecords ?? MAX_PACKAGE_PART_RECORDS;
  if (!integer(maxBytes, 2, MAX_PACKAGE_PART_BYTES) || !integer(maxRecords, 1, MAX_PACKAGE_PART_RECORDS)) throw new Error("Limites de parte precisam respeitar 2 MiB e 500 registros.");
  if (!object(snapshot) || snapshot.format !== EOBRA_SNAPSHOT_FORMAT || !Array.isArray(snapshot.records) || !integer(snapshot.records.length, 1, MAX_PACKAGE_RECORDS)) throw new Error("Informe snapshot com 1 a 100.000 registros.");
  const parts = [];
  let strings = [];
  let bytes = 2;
  let firstRecord = 1;
  let totalBytes = 0;
  function flush() {
    if (!strings.length) return;
    const text = `[${strings.join(",")}]`;
    const buffer = Buffer.from(text, "utf8");
    const ordinal = parts.length + 1;
    const descriptor = { ordinal, firstRecord, recordCount: strings.length, byteLength: buffer.length, sha256: sha(buffer), name: fileName(ordinal) };
    parts.push({ descriptor, name: descriptor.name, text });
    totalBytes += buffer.length;
    if (parts.length > MAX_PACKAGE_PARTS || totalBytes > MAX_PACKAGE_BYTES) throw new Error("Pacote excede 1.000 partes ou 200 MiB; nenhuma evidência pode ser descartada.");
    firstRecord += strings.length; strings = []; bytes = 2;
  }
  for (const record of snapshot.records) {
    const recordErrors = recordShapeErrors([record]);
    if (recordErrors.length) throw new Error(recordErrors.join(" "));
    const text = canonicalEobraJson(record);
    const size = Buffer.byteLength(text, "utf8");
    if (size + 2 > maxBytes) throw new Error(`Registro ${record.entity}/${record.sourceId} excede uma parte de 2 MiB; fragmente a evidência preservando seu manifesto.`);
    if (strings.length >= maxRecords || bytes + size + (strings.length ? 1 : 0) > maxBytes) flush();
    bytes += size + (strings.length ? 1 : 0); strings.push(text);
  }
  flush();
  const manifest = {
    format: EOBRA_PACKAGE_FORMAT, source: snapshot.source, scope: snapshot.scope,
    archiveTypes: snapshot.archiveTypes ?? [], coverage: snapshot.coverage,
    recordCount: snapshot.records.length, parts: parts.map(part => part.descriptor),
    globalSnapshotHash,
  };
  const checked = inspectEobraPackageManifest(manifest);
  if (!checked.ok) throw new Error(`Manifesto inválido: ${checked.errors.join(" ")}`);
  return { manifest, manifestText: canonicalEobraJson(manifest), parts };
}
