import {
  canonicalEobraJson, hashEobraValue, inspectEobraSnapshot,
  EOBRA_SNAPSHOT_FORMAT, EOBRA_PRIORITY_ENTITIES,
} from "./snapshot.mjs";

export const EOBRA_CHECKPOINT_SCHEMA = "eobra.ui-checkpoint.v1";
export const EOBRA_CHECKPOINT_REPORT_FORMAT = "elos.eobra.checkpoint-review.v1";
const FRAGMENT = "ui_capture_fragment";
const MANIFEST = "ui_checkpoint_manifest";
const PROJECT_ENTITIES = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
const DETAIL_ENTITIES = { saleDetails: "sale", personDetails: "person", unitDetails: "unit", accountDetails: "bank_account", indexDetails: "correction_index", settlementDetails: "settlement", projectDetails: "project", bankTransactions: "bank_transaction", indexValues: "index_value" };
const CAPTURE_KINDS = { project: "projectDetails", person: "personDetails", unit: "unitDetails", sale: "saleDetails", receivable: "installmentDetails", payable: "installmentDetails", settlement: "settlementDetails", bank_account: "accountDetails", bank_transaction: "bankTransactions", correction_index: "indexDetails", index_value: "indexValues" };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const keyOf = value => JSON.stringify([value.entity, value.entity === "raw_archive" ? value.archiveType : null, value.sourceId]);
const coverageKey = value => JSON.stringify([value.entity, value.sourceProjectId ?? null, value.entity === "raw_archive" ? value.archiveType : null]);
const normalizeLabel = value => typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim() : "";
const sourceId = value => typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const pointer = path => `/${path.map(part => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
const noDuplicates = values => [...new Map(values.map(value => [canonicalEobraJson(value), value])).values()];

function civilDate(value) {
  if (typeof value !== "string") return null;
  let iso = value;
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (brazilian) iso = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  // A display-only two-digit year is intentionally not assigned a century.
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function timestamp(value) {
  return typeof value === "string" && /^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) && civilDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function exactMoney(value, direction = null) {
  if (typeof value !== "string" || value.length > 36) return { error: "valor monetário precisa permanecer string decimal" };
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3] ?? "").slice(2).replace(/0/g, "") !== "") return { error: "precisão monetária não representável em centavos sem perda" };
  const signed = (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0").slice(0, 2))) * (match[1] === "-" ? -1n : 1n);
  if (signed > 9999999999999999n || signed < -9999999999999999n) return { error: "valor monetário excede a precisão permitida" };
  if ((direction === "receivable" && signed < 0n) || (direction === "payable" && signed > 0n)) return { error: "sinal de data-value diverge do tipo explícito da linha" };
  const cents = direction === "payable" ? -signed : signed;
  return { value: decimal(cents), cents };
}

function decimal(cents) {
  const n = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}

function cellValue(cell) {
  if (!object(cell)) return typeof cell === "string" ? cell : null;
  if (cell.value !== undefined && cell.value !== null) return cell.value;
  if (cell.exportValue !== undefined && cell.exportValue !== null) return cell.exportValue;
  return typeof cell.text === "string" ? cell.text : null;
}

function monetaryCell(cell) {
  if (!object(cell)) return null;
  if (cell.value !== undefined && cell.value !== null) return cell.value;
  if (cell.exportValue !== undefined && cell.exportValue !== null) return cell.exportValue;
  return null;
}

function routes(value) {
  if (!object(value)) return [];
  return unique([
    value.route, value.link, value.href, value.attrs?.lnksli, value.attrs?.["data-lnksli"],
    ...(Array.isArray(value.links) ? value.links.map(link => typeof link === "string" ? link : link?.route ?? link?.href ?? link?.link) : []),
  ].filter(item => typeof item === "string" && item.includes("/")));
}

function routeMatch(route, pattern) {
  if (typeof route !== "string" || !pattern) return null;
  let path = route;
  if (/^https?:\/\//i.test(path)) { try { path = new URL(path).pathname; } catch { return null; } }
  return pattern.exec(path.replace(/^\//, "").split(/[?#]/)[0]);
}

const ROUTES = {
  sale: /^Construction\/Deals\/GetSale\/([^/]+)\/?$/i,
  unit: /^Construction\/Manager\/([^/]+)\/Units\/([^/]+)\/?$/i,
  person: /^Person\/Details\/([^/]+)\/?$/i,
  project: /^Construction\/(?:Progress|Manager)\/([^/]+)\/?$/i,
  installment: /^Finance\/Bills\/showDetails\/payment\/([^/]+)(?:\/([^/]+))?\/?$/i,
  account: /^Finance\/Accounts\/(?:Settings|setSelectedAccount)\/([^/]+)\/?$/i,
  availableUnit: /^Construction\/Sales\/Available\/c\/([^/]+)\/?$/i,
};

function rowId(row, entity, problems) {
  const attr = sourceId(row?.id ?? row?.sourceId ?? row?.attrs?.["data-cod"]);
  const found = [];
  for (const route of routes(row)) {
    const m = routeMatch(route, entity === "receivable" || entity === "payable" || entity === "settlement" ? ROUTES.installment : ROUTES[entity]);
    if (m) found.push(entity === "settlement" ? m[2] : entity === "unit" ? m[2] : m[1]);
  }
  const ids = unique(found.filter(sourceId));
  if (ids.length > 1 || (attr && ids.length && attr !== ids[0])) problems.push("sourceId: ID da rota e atributo divergem; detalhe precisa ser conferido.");
  return ids[0] ?? attr;
}

function labelledCells(headers, row) {
  const result = new Map();
  if (Array.isArray(headers) && headers.length === 1 && Array.isArray(headers[0])) headers = headers[0];
  if (!Array.isArray(headers) || !Array.isArray(row?.cells) || headers.length !== row.cells.length) return result;
  for (let i = 0; i < headers.length; i++) {
    const label = normalizeLabel(headers[i]);
    if (label && result.has(label)) return new Map();
    if (label) result.set(label, row.cells[i]);
  }
  return result;
}

function findCell(cells, ...names) {
  for (const name of names) if (cells.has(normalizeLabel(name))) return cells.get(normalizeLabel(name));
  return null;
}

function parseJson(value) { try { return typeof value === "string" ? JSON.parse(value) : null; } catch { return null; } }

function frames(value, evidence) {
  if (object(value) && Array.isArray(value.content)) {
    if (value.isError === true) return [];
    const result = [];
    value.content.forEach((block, i) => {
      if (block?.type !== "text") return;
      const decoded = parseJson(block.text);
      if (decoded !== null) result.push({ value: decoded, evidence: path => ({ ...evidence(["content", i, "text"]), jsonPointer: path.length ? pointer(path) : "" }) });
    });
    if (!result.length && object(value.structuredContent)) result.push({ value: value.structuredContent, evidence: path => evidence(["structuredContent", ...path]) });
    return result;
  }
  return [{ value, evidence }];
}

function captureFrames(capture) {
  return frames(capture.value, capture.evidence).map(frame => {
    if (!object(frame.value) || !own(frame.value, "capture")) return frame;
    return { value: frame.value.capture, evidence: path => frame.evidence(["capture", ...path]), constructionId: sourceId(frame.value.constructionId), section: frame.value.section };
  });
}

function flatHeaders(headers) {
  if (Array.isArray(headers) && headers.length === 1 && Array.isArray(headers[0])) headers = headers[0];
  return Array.isArray(headers) && headers.every(value => typeof value === "string") ? headers : null;
}

function archiveRecord(type, id, raw, normalized = {}, links = []) {
  return { entity: "raw_archive", archiveType: type, sourceId: id, sourceProjectId: null, parentSourceId: null, links, raw, normalized };
}

function preserveInput(input) {
  const docs = Array.isArray(input) ? input : [input];
  const template = clone(input);
  const templateDocs = Array.isArray(template) ? template : [template];
  const fragments = new Map();
  const captures = [];
  const descriptors = [];
  docs.forEach((doc, docIndex) => {
    if (!object(doc?.captures)) return;
    for (const [name, value] of Object.entries(doc.captures)) {
      const array = Array.isArray(value);
      const pageArray = array && value.some(entry => object(entry) && Array.isArray(entry.rows));
      const size = pageArray ? 1 : 200;
      const initialChunks = array ? Array.from({ length: Math.ceil(value.length / size) }, (_, i) => ({ start: i * size, value: value.slice(i * size, (i + 1) * size) })) : [{ start: 0, value }];
      // Large detail collections can exceed multipart's 2 MiB even below 200
      // entries. Split only at array boundaries, retaining existing pointers
      // and reconstruction format. Indivisible oversized entries still fail
      // in the package writer rather than losing evidence.
      const chunks = [];
      const split = chunk => {
        if (array && chunk.value.length > 1 && Buffer.byteLength(JSON.stringify({ capture: name, value: chunk.value }), "utf8") > 1024 * 1024) {
          const middle = Math.floor(chunk.value.length / 2);
          split({ start: chunk.start, value: chunk.value.slice(0, middle) });
          split({ start: chunk.start + middle, value: chunk.value.slice(middle) });
        } else chunks.push(chunk);
      };
      initialChunks.forEach(split);
      const parts = chunks.map(chunk => {
        const raw = { capture: name, value: chunk.value };
        const id = hashEobraValue(raw);
        fragments.set(id, archiveRecord(FRAGMENT, id, raw, { description: `Captura da interface: ${name}` }));
        return { sourceId: id, start: chunk.start, count: array ? chunk.value.length : 1 };
      });
      descriptors.push({ document: docIndex, capture: name, array, parts });
      templateDocs[docIndex].captures[name] = null;
      const evidence = path => {
        const index = array && typeof path[0] === "number" ? path[0] : 0;
        const part = parts.find(part => index >= part.start && index < part.start + part.count) ?? parts[0];
        if (!part) throw new Error("Captura vazia não contém registro para referenciar.");
        const relative = array && typeof path[0] === "number" ? [index - part.start, ...path.slice(1)] : path;
        return { sourceId: part.sourceId, pointer: pointer(["value", ...relative]) };
      };
      captures.push({ document: docIndex, name, value, evidence });
    }
  });
  const sourceHash = hashEobraValue(input);
  const manifest = archiveRecord(MANIFEST, sourceHash, { schema: EOBRA_CHECKPOINT_SCHEMA, sourceHash, template, captures: descriptors }, { description: "Estrutura integral e reconstruível dos checkpoints recebidos; não comprova cobertura da origem." });
  return { docs, captures, fragments: [...fragments.values()], manifest, sourceHash };
}

/** Reconstruct source JSON, including original text blocks and repeated observations. */
export function reconstructEobraCheckpoint(snapshot) {
  const manifests = snapshot?.records?.filter(record => record.entity === "raw_archive" && record.archiveType === MANIFEST) ?? [];
  if (manifests.length !== 1) throw new Error("Pacote precisa conter exatamente um manifesto de checkpoint.");
  const m = manifests[0].raw;
  const result = clone(m.template);
  const docs = Array.isArray(result) ? result : [result];
  const fragments = new Map();
  for (const record of snapshot.records) if (record.entity === "raw_archive" && record.archiveType === FRAGMENT) {
    if (hashEobraValue(record.raw) !== record.sourceId) throw new Error("Fragmento de captura foi alterado ou perdeu sua identidade.");
    if (fragments.has(record.sourceId)) throw new Error("Fragmento de captura repetido no pacote.");
    fragments.set(record.sourceId, record.raw);
  }
  for (const entry of m.captures) {
    if (!object(docs[entry.document]?.captures)) throw new Error("Manifesto refere documento ausente.");
    const values = entry.parts.map(part => {
      const fragment = fragments.get(part.sourceId);
      if (!fragment || fragment.capture !== entry.capture) throw new Error("Manifesto refere fragmento ausente ou de outra captura.");
      return clone(fragment.value);
    });
    docs[entry.document].captures[entry.capture] = entry.array ? values.flat(1) : values[0];
  }
  if (hashEobraValue(result) !== m.sourceHash || m.sourceHash !== manifests[0].sourceId) throw new Error("A reconstrução do checkpoint não confere com seu hash.");
  return result;
}

function makeContext(preserved) {
  const candidates = new Map();
  const special = new Map();
  const warnings = [];
  const errors = [];
  const inventories = new Map();
  const coverage = [];
  const headers = new Map();
  const archiveTypes = new Map([[FRAGMENT, "Fragmentos integrais da captura da interface; não equivalem à promoção de entidades."], [MANIFEST, "Manifesto para reconstruir os valores JSON originais dos checkpoints."]]);
  function add(entity, id, data = {}, evidence = null) {
    if (!sourceId(id)) { errors.push(`${entity}: observação sem ID textual estável; permanece somente na captura integral.`); return null; }
    const key = keyOf({ entity, sourceId: id });
    let record = candidates.get(key);
    if (!record) {
      record = { entity, sourceId: id, sourceProjectId: null, parentSourceId: null, links: [], raw: { evidence: [] }, normalized: {}, issues: [], detailed: false };
      candidates.set(key, record);
    }
    if (evidence && !record.raw.evidence.some(item => canonicalEobraJson(item) === canonicalEobraJson(evidence))) record.raw.evidence.push(evidence);
    if (data.sourceProjectId != null) {
      if (!sourceId(data.sourceProjectId)) record.issues.push("sourceProjectId: ID explícito inválido.");
      else if (record.sourceProjectId !== null && record.sourceProjectId !== data.sourceProjectId) record.issues.push("sourceProjectId: observações vinculam o mesmo ID a obras diferentes.");
      else record.sourceProjectId = data.sourceProjectId;
    }
    function merge(target, incoming, prefix = "") {
      for (const [field, value] of Object.entries(incoming)) {
        if (value === undefined) continue;
        const path = prefix ? `${prefix}.${field}` : field;
        if (!own(target, field)) Object.defineProperty(target, field, { value: clone(value), enumerable: true, writable: true, configurable: true });
        else if (["roles", "source_labels"].includes(field) && Array.isArray(target[field]) && Array.isArray(value)) target[field] = unique([...target[field], ...value]).sort(compare);
        else if (object(target[field]) && object(value)) merge(target[field], value, path);
        else if (canonicalEobraJson(target[field]) !== canonicalEobraJson(value)) record.issues.push(`${path}: observações conflitantes; nenhuma versão foi escolhida automaticamente.`);
      }
    }
    if (object(data.normalized)) merge(record.normalized, data.normalized);
    for (const link of data.links ?? []) {
      const existing = record.links.find(item => keyOf(item) === keyOf(link) && item.role === link.role);
      if (!existing) record.links.push(clone(link));
      else merge(existing, link, `links.${link.role}`);
    }
    if (data.issues) record.issues.push(...data.issues);
    if (data.detailed) record.detailed = true;
    return record;
  }
  function archive(type, id, evidence, normalized, links = []) {
    archiveTypes.set(type, `Dados da origem preservados sem promoção automática: ${type}.`);
    const record = archiveRecord(type, id, { evidence: evidence ? [evidence] : [] }, normalized, links);
    const key = keyOf(record);
    const old = special.get(key);
    if (old && canonicalEobraJson(old) !== canonicalEobraJson(record)) errors.push(`${type}/${id}: arquivo complementar conflitante.`);
    else special.set(key, record);
    return record;
  }
  function inventory(name) {
    if (!inventories.has(name)) inventories.set(name, { capture: name, observations: 0, ids: new Set(), counts: new Set(), expectedPageCounts: new Set(), pages: new Map(), filters: [], issues: [] });
    return inventories.get(name);
  }
  return { ...preserved, candidates, special, warnings, errors, inventories, coverage, headers, archiveTypes, supplements: new Map(), managerRelations: [], knownSales: new Set(), add, archive, inventory };
}

function rememberPage(context, name, page, ids) {
  const inventory = context.inventory(name);
  inventory.observations += ids.length;
  for (const id of ids.filter(Boolean)) inventory.ids.add(id);
  const footer = Array.isArray(page.footer) ? page.footer.join("\n") : typeof page.footer === "string" ? page.footer : "";
  const count = /\bde\s+(\d+)\s+itens\b/i.exec(footer);
  if (count) inventory.counts.add(Number(count[1]));
  const pageCount = /\bpor\s+p[aá]gina\s+de\s+(\d+)/i.exec(footer);
  if (pageCount) inventory.expectedPageCounts.add(Number(pageCount[1]));
  const range = /Exibindo\s+1-(\d+)\s+de\s+(\d+)\s+itens/i.exec(footer);
  if (range && Number(range[1]) > 0) inventory.expectedPageCounts.add(Math.ceil(Number(range[2]) / Number(range[1])));
  const observedPage = Number.isSafeInteger(page.page) && page.page > 0 ? page.page : range ? 1 : null;
  if (observedPage !== null) {
    const digest = hashEobraValue({ ids, rows: page.rows });
    if (inventory.pages.has(observedPage) && inventory.pages.get(observedPage) !== digest) inventory.issues.push(`Página ${observedPage} possui observações conflitantes.`);
    else inventory.pages.set(observedPage, digest);
  }
  if (object(page.filters)) inventory.filters.push(clone(page.filters));
}

function peopleFromCell(context, cell, role, evidence) {
  const ids = routes(cell).map(route => routeMatch(route, ROUTES.person)?.[1]).filter(sourceId);
  const json = parseJson(cellValue(cell));
  const values = Array.isArray(json) ? json : object(json) ? [json] : [];
  const declared = values.filter(value => sourceId(value?.id));
  const mismatched = ids.length && declared.length && declared.some(value => !ids.includes(value.id));
  for (const value of declared) if (!ids.includes(value.id) && !ids.length) ids.push(value.id);
  return unique(ids).map(id => {
    const value = declared.find(item => item.id === id);
    const normalized = { roles: [role] };
    if (typeof value?.title === "string" && value.title) normalized.source_labels = [value.title];
    context.add("person", id, { normalized, issues: mismatched ? ["sourceId: ID de pessoa no JSON e na rota divergem."] : [] }, evidence);
    return { entity: "person", sourceId: id, role: role === "client" ? "buyer" : role === "supplier" ? "supplier" : role };
  });
}

function parseProjects(context, value, evidence) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
  const ids = [];
  list.forEach((row, i) => {
    const problems = [];
    const id = rowId(row, "project", problems);
    if (!id || typeof row?.name !== "string") return;
    ids.push(id);
    const normalized = { name: row.name };
    if (typeof row.code === "string") normalized.code = row.code;
    if (typeof row.status === "string") normalized.source_status = row.status;
    context.add("project", id, { normalized, issues: problems }, evidence(Array.isArray(value) ? [i] : ["rows", i]));
  });
  rememberPage(context, "projects", object(value) ? value : {}, ids);
}

function financialDirection(row) {
  const tokens = new Set(String(row?.class ?? row?.attrs?.class ?? "").split(/\s+/));
  if (tokens.has("receive") === tokens.has("pay")) return null;
  return tokens.has("receive") ? "receivable" : "payable";
}

function financialStatus(row, cell) {
  const tokens = new Set(String(row?.class ?? row?.attrs?.class ?? "").split(/\s+/));
  const labels = [cellValue(cell), ...(cell?.tips ?? [])].map(normalizeLabel);
  if (tokens.has("reversed") || labels.some(value => ["estornado", "cancelado", "reversed", "cancelled"].includes(value))) return "cancelled";
  if (tokens.has("paid") || labels.some(value => ["pago", "quitado", "paid"].includes(value))) return "paid";
  if (labels.some(value => ["atrasado", "a vencer", "vence hoje", "em aberto", "open", "overdue", "pending", "late", "rear", "today"].includes(value))) return "open";
  if (labels.some(value => ["parcial", "pago parcialmente", "partial"].includes(value))) return "partial";
  return null;
}

function parseBills(context, value, evidence, defaultHeaders, inventoryName = "bills") {
  const pages = Array.isArray(value) ? value : [value];
  pages.forEach((page, pageIndex) => {
    if (!Array.isArray(page?.rows)) return;
    const headers = page.headers ?? defaultHeaders;
    const ids = [];
    page.rows.forEach((row, rowIndex) => {
      const ev = evidence([...(Array.isArray(value) ? [pageIndex] : []), "rows", rowIndex]);
      const direction = financialDirection(row);
      if (!direction) { context.warnings.push("Parcela sem direção explícita de receber/pagar preservada somente na captura."); return; }
      const issues = [];
      const id = rowId(row, direction, issues);
      if (!id) { context.errors.push("Listagem financeira contém parcela sem ID estável."); return; }
      ids.push(id);
      const cells = labelledCells(headers, row);
      if (!cells.size) issues.push("headers: cabeçalhos da listagem financeira ausentes ou incompatíveis.");
      const normalized = { correction_locked: true, correction_lock_reason: "migration_snapshot_preservation" };
      const moneyValues = {};
      for (const [field, header] of [["original_amount", "Valor original"], ["current_amount", "Valor"], ["paid_amount", "Valor pago"]]) {
        const raw = monetaryCell(findCell(cells, header));
        if (raw === null) continue;
        const parsed = exactMoney(raw, direction);
        if (parsed.error) issues.push(`${field}: ${parsed.error}.`);
        else { normalized[field] = parsed.value; moneyValues[field] = parsed.cents; }
      }
      if (moneyValues.current_amount !== undefined && moneyValues.paid_amount !== undefined) {
        const balance = moneyValues.current_amount - moneyValues.paid_amount;
        if (balance < 0n) issues.push("balance_amount: pagamento excede o atualizado observado.");
        else { normalized.balance_amount = decimal(balance); normalized.balance_provenance = "current_amount_minus_paid_amount"; }
      }
      const dueValue = cellValue(findCell(cells, "Vencimento"));
      if (dueValue !== null) {
        const due = civilDate(dueValue);
        if (due) normalized.due_date = due; else issues.push("due_date: data ausente ou inválida; ano de dois dígitos não define século.");
      }
      if (inventoryName.startsWith("billsSupplemental:")) {
        const inventory = context.inventory(inventoryName);
        inventory.dueDates ??= [];
        inventory.dueDates.push(normalized.due_date ?? null);
      }
      const state = financialStatus(row, findCell(cells, "Status"));
      if (state) normalized.status = state === "open" && moneyValues.paid_amount > 0n && moneyValues.current_amount > moneyValues.paid_amount ? "partial" : state;
      const titleCell = findCell(cells, "Título");
      const titleNumber = titleCell?.value;
      if (typeof titleNumber === "string" && titleNumber) normalized.title_number = titleNumber;
      const sequence = /^(\d+)\s+de\s+(\d+)$/.exec(String(titleCell?.installment?.text ?? "").trim());
      if (sequence && sequence.slice(1).every(value => Number.isSafeInteger(Number(value)))) { normalized.sequence_number = Number(sequence[1]); normalized.sequence_total = Number(sequence[2]); }
      const description = cellValue(findCell(cells, "Descrição"));
      if (typeof description === "string" && description.trim()) normalized.description = description;
      else if (typeof titleNumber === "string" && titleNumber) { normalized.description = `Título ${titleNumber}${titleCell?.installment?.text ? ` / ${titleCell.installment.text}` : ""}`; normalized.description_provenance = "source_title_label"; }
      for (const [field, label] of [["document", "Documento"], ["source_category", "Categoria"], ["source_cost_center_label", "Centro de custo"], ["source_correction_label", "Correção"], ["expected_account_label", "Conta Prevista"], ["expected_payment_method", "Forma Prevista"]]) {
        const value = cellValue(findCell(cells, label)); if (typeof value === "string" && value) normalized[field] = value;
      }
      const links = [];
      const counterpart = findCell(cells, "Receber de/Pagar para");
      for (const link of peopleFromCell(context, counterpart, direction === "payable" ? "supplier" : "client", ev)) links.push({ ...link, role: direction === "payable" ? "supplier" : "counterparty" });
      const counterpartyName = counterpart?.text;
      if (typeof counterpartyName === "string" && counterpartyName.trim()) normalized.counterparty_name = counterpartyName;
      for (const route of routes(findCell(cells, "Vínculos"))) {
        const sale = routeMatch(route, ROUTES.sale);
        if (sale) { context.add("sale", sale[1], {}, ev); links.push({ entity: "sale", sourceId: sale[1], role: "sale" }); }
      }
      context.add(direction, id, { normalized, links, issues }, ev);
    });
    rememberPage(context, inventoryName, page, ids);
  });
}

function parsePayments(context, value, evidence, defaultHeaders) {
  const pages = Array.isArray(value) ? value : [value];
  pages.forEach((page, pageIndex) => {
    if (!Array.isArray(page?.rows)) return;
    const ids = [];
    page.rows.forEach((row, rowIndex) => {
      const ev = evidence([...(Array.isArray(value) ? [pageIndex] : []), "rows", rowIndex]);
      const issues = [];
      const id = rowId(row, "settlement", issues);
      if (!id) { context.errors.push("Baixa sem ID técnico estável na rota."); return; }
      ids.push(id);
      const direction = financialDirection(row);
      const cells = labelledCells(page.headers ?? defaultHeaders, row);
      if (!cells.size) issues.push("headers: cabeçalhos da listagem de baixas ausentes ou incompatíveis.");
      const normalized = {};
      const reversed = String(row.class ?? "").split(/\s+/).includes("reversed");
      if (reversed) normalized.source_reversed = true; else normalized.kind = "payment";
      const amount = monetaryCell(findCell(cells, "Valor"));
      if (amount !== null) {
        const money = exactMoney(amount, direction);
        if (money.error) issues.push(`amount: ${money.error}.`); else normalized.amount = money.value;
      }
      const occurred = cellValue(findCell(cells, "Data"));
      if (occurred !== null) {
        const date = civilDate(occurred);
        if (date) normalized.occurred_on = date; else issues.push("occurred_on: data da baixa inválida; não substituir por outra data.");
      }
      const form = cellValue(findCell(cells, "Forma"));
      const label = normalizeLabel(form);
      if (label === "dinheiro") normalized.medium = "cash";
      else if (["transacao bancaria", "boleto", "pix", "cheque", "deposito"].includes(label)) normalized.medium = "bank";
      else if (label === "imobilizado") normalized.medium = "non_cash";
      if (typeof form === "string") normalized.source_payment_method = form;
      const account = findCell(cells, "Conta");
      if (typeof cellValue(account) === "string") normalized.source_account_label = cellValue(account);
      const links = [];
      for (const route of routes(account)) {
        const m = routeMatch(route, ROUTES.account);
        if (m) { context.add("bank_account", m[1], {}, ev); links.push({ entity: "bank_account", sourceId: m[1], role: "account" }); }
      }
      for (const route of routes(row)) {
        const m = routeMatch(route, ROUTES.installment);
        if (m?.[2] && direction) { context.add(direction, m[1], {}, ev); links.push({ entity: direction, sourceId: m[1], role: "installment" }); }
      }
      context.add("settlement", id, { normalized, links, issues }, ev);
    });
    rememberPage(context, "payments", page, ids);
  });
}

function parseSaleList(context, value, evidence, defaultHeaders) {
  const rows = Array.isArray(value) ? value : value?.rows;
  if (!Array.isArray(rows)) return;
  const ids = [];
  rows.forEach((row, i) => {
    const issues = [];
    const id = rowId(row, "sale", issues);
    if (!id) return;
    ids.push(id);
    context.knownSales.add(id);
    const ev = evidence(Array.isArray(value) ? [i] : ["rows", i]);
    const cells = labelledCells(value?.headers ?? defaultHeaders, row);
    const normalized = {};
    const labels = (row.cells ?? []).flatMap(cell => cell.tips ?? []).map(normalizeLabel);
    if (labels.includes("concluido")) normalized.status = "active";
    else if (labels.some(label => ["estorno", "estornado", "distrato"].includes(label))) normalized.status = "cancelled";
    else if (labels.includes("rascunho")) normalized.status = "draft";
    if (!cells.size) context.warnings.push("Cabeçalhos da lista de vendas ausentes; posições de colunas não definem campos contratuais.");
    const number = cellValue(findCell(cells, "Número", "Nº", "N°", "Negócio", "Nº negócio"));
    if (typeof number === "string" && number) normalized.number = number;
    const dateValue = cellValue(findCell(cells, "Data", "Data do negócio"));
    if (dateValue !== null) {
      const date = civilDate(dateValue);
      if (date) normalized.sale_date = date; else issues.push("sale_date: data inválida na origem; rascunho permanece arquivo identificado.");
    }
    const totalValue = monetaryCell(findCell(cells, "Valor original", "Valor do negócio", "Valor da venda", "Valor contrato"));
    if (totalValue !== null) {
      const money = exactMoney(totalValue);
      if (money.error) issues.push(`total_amount: ${money.error}.`); else normalized.total_amount = money.value;
    }
    const links = peopleFromCell(context, findCell(cells, "Compradores", "Comprador", "Clientes", "Comp./Vend."), "client", ev);
    for (const link of peopleFromCell(context, findCell(cells, "Comissionados", "Corretor", "Vendedores"), "broker", ev)) links.push(link);
    context.add("sale", id, { normalized, links, issues }, ev);
  });
  rememberPage(context, "sales", object(value) ? value : {}, ids);
}

function parseSaleDetail(context, id, detail, evidence) {
  if (!object(detail)) return;
  context.knownSales.add(id);
  const normalized = {};
  const issues = [];
  const number = /^Neg[oó]cio\s+N[º°o]?\s*(.+)$/i.exec(String(detail.title ?? "").trim());
  if (number) normalized.number = number[1].trim();
  const state = normalizeLabel(detail.status);
  if (state.endsWith("concluido")) normalized.status = "active";
  else if (/estornad[oa]|distrat[oa]|cancelad[oa]/.test(state)) normalized.status = "cancelled";
  else if (state.includes("rascunho")) normalized.status = "draft";
  for (const field of detail.fields ?? []) if (field.name === "construction.sale.date") {
    const date = civilDate(field.value);
    if (date) normalized.sale_date = date; else issues.push("sale_date: data inválida na origem; rascunho permanece arquivo identificado.");
  }
  const links = [];
  const projects = new Set();
  (detail.tables ?? []).forEach((table, tableIndex) => {
    const labels = (table.headers ?? []).map(normalizeLabel);
    const isUnits = labels.includes("unidades");
    const isBuyers = labels.includes("compradores");
    if (!isUnits && !isBuyers) return;
    (table.rows ?? []).forEach((row, rowIndex) => {
      const ev = evidence(["tables", tableIndex, "rows", rowIndex]);
      const cells = labelledCells(table.headers, row);
      const cell = findCell(cells, isUnits ? "Unidades" : "Compradores");
      if (isBuyers) {
        for (const link of peopleFromCell(context, cell, "client", ev)) {
          if (String(row.class ?? "").split(/\s+/).includes("principal")) link.primary = true;
          if (sourceId(row.id)) link.source_relation_id = row.id;
          links.push(link);
        }
      } else for (const route of routes(cell)) {
        const match = routeMatch(route, ROUTES.unit);
        if (!match) continue;
        projects.add(match[1]);
        const unitNormalized = {};
        if (typeof cellValue(cell) === "string" && cellValue(cell)) unitNormalized.code = cellValue(cell);
        context.add("unit", match[2], { sourceProjectId: match[1], normalized: unitNormalized, links: [{ entity: "project", sourceId: match[1], role: "project" }] }, ev);
        const link = { entity: "unit", sourceId: match[2], role: "unit" };
        if (String(row.class ?? "").split(/\s+/).includes("principal")) link.primary = true;
        if (sourceId(row.id)) link.source_relation_id = row.id;
        const value = monetaryCell(findCell(cells, "Valor"));
        if (value !== null) { const money = exactMoney(value); if (money.error) issues.push(`units.allocated_amount: ${money.error}.`); else link.allocated_amount = money.value; }
        links.push(link);
      }
    });
  });
  if (projects.size > 1) issues.push("sourceProjectId: unidades da mesma venda pertencem a construções diferentes; preservar relações para revisão.");
  context.add("sale", id, { normalized, links, issues, ...(projects.size === 1 ? { sourceProjectId: [...projects][0] } : {}), detailed: true }, evidence([]));
}

function parseUnits(context, value, evidence, projectId, defaultHeaders) {
  if (Array.isArray(value) && value.some(page => object(page) && Array.isArray(page.rows))) {
    const firstFooter = value.map(page => Array.isArray(page?.footer) ? page.footer.join("\n") : page?.footer ?? "").map(footer => /Exibindo\s+1-(\d+)\s+de\s+(\d+)/i.exec(footer)).find(Boolean);
    const pageSize = firstFooter ? Number(firstFooter[1]) : null;
    value.forEach((page, index) => {
      if (!Array.isArray(page?.rows)) return;
      const footer = Array.isArray(page.footer) ? page.footer.join("\n") : page.footer ?? "";
      const start = Number(/Exibindo\s+(\d+)-/i.exec(footer)?.[1]);
      const inferredPage = pageSize && start > 1 ? start % pageSize === 0 ? start / pageSize + 1 : (start - 1) % pageSize === 0 ? (start - 1) / pageSize + 1 : null : null;
      parseUnits(context, { ...page, ...(page.page === undefined && inferredPage ? { page: inferredPage } : {}) }, path => evidence([index, ...path]), projectId, defaultHeaders);
    });
    return;
  }
  const rows = Array.isArray(value) ? value : value?.rows;
  if (!Array.isArray(rows)) return;
  const ids = [];
  rows.forEach((row, i) => {
    const issues = [];
    const cells = labelledCells(value?.headers ?? defaultHeaders, row);
    const route = routes(row).map(route => routeMatch(route, ROUTES.unit)).find(Boolean);
    // Known group rows have no unit route and a different width; keep them only in raw capture.
    if (!route && !cells.size && row?.cells?.length !== 7) return;
    const id = rowId(row, "unit", issues);
    if (!id) return;
    ids.push(id);
    const normalized = {};
    const code = cellValue(findCell(cells, "Unidade", "Identificação", "Nome", "Código"));
    if (typeof code === "string" && code) normalized.code = code;
    const status = normalizeLabel(cellValue(findCell(cells, "Status", "Situação")));
    const statusMap = { disponivel: "available", reservado: "reserved", reservada: "reserved", vendido: "sold", vendida: "sold", inativo: "inactive", inativa: "inactive" };
    if (statusMap[status]) normalized.status = statusMap[status];
    const project = route?.[1] ?? projectId;
    const ev = evidence(Array.isArray(value) ? [i] : ["rows", i]);
    const managedSale = row.attrs?.["data-lnksli"];
    if (String(row.class ?? row.attrs?.class ?? "").split(/\s+/).includes("linked") && typeof managedSale === "string") {
      const saleId = routeMatch(managedSale, ROUTES.sale)?.[1] ?? (!managedSale.includes("/") ? sourceId(managedSale) : null);
      if (saleId) context.managerRelations.push({ unitId: id, saleId, projectId: project ?? null, evidence: ev });
    }
    context.add("unit", id, { normalized, issues, ...(project ? { sourceProjectId: project, links: [{ entity: "project", sourceId: project, role: "project" }] } : {}) }, ev);
  });
  rememberPage(context, `units:${projectId ?? "unknown"}`, object(value) ? value : {}, ids);
}

function parsePeople(context, value, evidence, defaultHeaders) {
  const pages = Array.isArray(value) ? value : [value];
  pages.forEach((page, pageIndex) => {
    if (!Array.isArray(page?.rows)) return;
    const ids = [];
    page.rows.forEach((row, rowIndex) => {
      const issues = [];
      const id = rowId(row, "person", issues);
      if (!id) { context.errors.push("Pessoa da listagem sem ID técnico estável."); return; }
      ids.push(id);
      const ev = evidence([...(Array.isArray(value) ? [pageIndex] : []), "rows", rowIndex]);
      const cells = labelledCells(page.headers ?? defaultHeaders, row);
      if (!cells.size) issues.push("headers: cabeçalhos da lista de pessoas ausentes ou incompatíveis.");
      const normalized = {};
      const name = cellValue(findCell(cells, "Nome"));
      if (typeof name === "string" && name.trim()) normalized.name = name;
      const classes = new Set(String(row.class ?? row.attrs?.class ?? "").split(/\s+/));
      if (classes.has("person") && !classes.has("business")) normalized.person_type = "PF";
      else if (classes.has("business") && !classes.has("person")) normalized.person_type = "PJ";
      const state = normalizeLabel(cellValue(findCell(cells, "Status", "Situação")));
      if (["ativo", "ativa", "active"].includes(state)) normalized.status = "active";
      else if (["inativo", "inativa", "inactive"].includes(state)) normalized.status = "inactive";
      for (const [field, header] of [["phone", "Telefone"], ["email", "E-mail"]]) {
        const cell = findCell(cells, header);
        const parsed = parseJson(cellValue(cell));
        const documents = Array.isArray(parsed) ? parsed : object(parsed) ? [parsed] : [];
        const values = unique(documents.map(item => item?.title).filter(value => typeof value === "string" && value.trim()));
        if (documents.length) normalized[field === "phone" ? "source_phones" : "source_emails"] = documents;
        // Boundary whitespace is presentation noise; preserve the untouched
        // contact in source_emails and the lossless capture. Never repair the
        // address itself or choose among multiple contacts.
        if (values.length === 1) normalized[field] = field === "email" ? values[0].trim() : values[0];
        else if (values.length > 1) normalized[`${field}_selection_required`] = true;
      }
      const documentCell = findCell(cells, "Documento");
      const documents = parseJson(cellValue(documentCell));
      if (Array.isArray(documents)) normalized.source_documents = documents;
      const visible = typeof documentCell?.text === "string" ? documentCell.text : "";
      const labels = [...visible.matchAll(/\b(CPF|CNPJ)\s*:?\s*([\d.\-/\s]+)/gi)].map(match => ({ type: match[1].toUpperCase(), digits: match[2].replace(/\D/g, "") }));
      const declared = Array.isArray(documents) ? documents.map(item => typeof item?.title === "string" ? item.title.replace(/\D/g, "") : "") : [];
      const taxIds = unique(labels.filter(item => (item.type === "CPF" && item.digits.length === 11 || item.type === "CNPJ" && item.digits.length === 14) && declared.includes(item.digits)).map(item => item.digits));
      if (taxIds.length === 1) normalized.tax_id = taxIds[0];
      else if (taxIds.length > 1) issues.push("tax_id: múltiplos documentos fiscais observados; não escolher pela ordem.");
      const notes = cellValue(findCell(cells, "Obs.", "Observação"));
      if (typeof notes === "string" && notes.trim()) normalized.notes = notes;
      const birthday = cellValue(findCell(cells, "Data de nascimento"));
      if (birthday && civilDate(birthday)) normalized.birth_date = civilDate(birthday);
      context.add("person", id, { normalized, issues, detailed: true }, ev);
    });
    rememberPage(context, "people", page, ids);
  });
}

function parseStock(context, value, evidence) {
  if (!Array.isArray(value?.rows)) return;
  value.rows.forEach((row, index) => {
    const matches = routes(row).map(route => routeMatch(route, ROUTES.availableUnit)).filter(Boolean);
    if (matches.length !== 1) return;
    const id = matches[0][1];
    const attribute = row.id ?? row.attrs?.["data-cod"];
    const issues = attribute && attribute !== id ? ["sourceId: estoque e atributo da unidade divergem."] : [];
    context.add("unit", id, { normalized: { status: "available", status_provenance: "source_available_unit_route" }, issues }, evidence(["rows", index]));
  });
}

function decodeHtmlText(value) {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function parseAccounts(context, value, evidence) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
  const ids = [];
  rows.forEach((row, i) => {
    const html = typeof row?.html === "string" ? row.html : "";
    const accountIds = unique([...html.matchAll(/(?:lnksli|lnkact)=["']Finance\/Accounts\/(?:Settings|setSelectedAccount)\/([^/"']+)["']/g)].map(match => match[1]));
    const problems = [];
    const explicit = rowId(row, "bank_account", problems);
    if (explicit) accountIds.push(explicit);
    const distinct = unique(accountIds);
    if (distinct.length !== 1) { if (distinct.length) context.errors.push("Conta da interface possui identificadores conflitantes."); return; }
    const id = distinct[0]; ids.push(id);
    const normalized = {};
    const label = /<span\b[^>]*class=["'][^"']*\btextSize18\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
    if (label) normalized.name = decodeHtmlText(label[1]);
    if (typeof row.name === "string") normalized.name = row.name;
    context.add("bank_account", id, { normalized, issues: problems }, evidence(Array.isArray(value) ? [i] : ["rows", i]));
  });
  rememberPage(context, "accounts", object(value) ? value : {}, ids);
}

function parseStructuredDetails(context, entity, value, evidence) {
  const entries = Array.isArray(value) ? value.map((value, index) => ({ value, key: null, path: [index] })) : object(value) && (value.sourceId || value.normalized || value.fields || value.tables) ? [{ value, key: null, path: [] }] : object(value) ? Object.entries(value).map(([key, value]) => ({ value, key, path: [key] })) : [];
  for (const entry of entries) {
    if (!object(entry.value)) continue;
    const row = entry.value;
    const kind = entity ?? row.entity;
    if (!EOBRA_PRIORITY_ENTITIES.includes(kind)) { context.errors.push("Detalhe financeiro precisa indicar receivable ou payable explicitamente."); continue; }
    const problems = [];
    const observedId = rowId(row, kind, problems);
    const id = sourceId(row.sourceId) ?? observedId ?? sourceId(entry.key);
    if (sourceId(row.sourceId) && observedId && observedId !== row.sourceId) problems.push("sourceId: sourceId explícito diverge da rota do detalhe.");
    if (!id) { context.errors.push(`${kind}: detalhe sem ID textual de origem.`); continue; }
    if (entry.key && row.sourceId && entry.key !== row.sourceId) problems.push("sourceId: chave do detalhe e sourceId divergem.");
    const ev = path => evidence([...entry.path, ...path]);
    if (kind === "sale" && (row.fields || row.tables || row.title)) parseSaleDetail(context, id, row, ev);
    const normalized = object(row.normalized) ? clone(row.normalized) : {};
    if (kind === "sale" && typeof normalized.status === "string") context.knownSales.add(id);
    if (["receivable", "payable"].includes(kind)) {
      normalized.correction_locked = true;
      normalized.correction_lock_reason = "migration_snapshot_preservation";
      // Deriving a residual never attributes it to correction or invents any component.
      if (!own(normalized, "balance_amount") && own(normalized, "current_amount") && own(normalized, "paid_amount")) {
        const current = exactMoney(normalized.current_amount);
        const paid = exactMoney(normalized.paid_amount);
        if (!current.error && !paid.error && current.cents >= paid.cents) { normalized.balance_amount = decimal(current.cents - paid.cents); normalized.balance_provenance = "current_amount_minus_paid_amount"; }
      }
    }
    context.add(kind, id, { sourceProjectId: row.sourceProjectId, normalized, links: Array.isArray(row.links) ? row.links : [], issues: problems, detailed: true }, ev([]));
  }
}

function parseReversalDetail(context, originalId, value, evidence) {
  const panels = Array.isArray(value) ? value : [value];
  panels.forEach((panel, panelIndex) => {
    (panel?.tables ?? []).forEach((table, tableIndex) => {
      const rows = table.rows ?? [];
      const originals = rows.filter(row => (row.id ?? row.attrs?.["data-cod"]) === originalId && /\b(?:rev|reversed)\b/.test(row.class ?? row.attrs?.class ?? ""));
      const reversals = rows.filter(row => normalizeLabel(cellValue(findCell(labelledCells(table.headers, row), "Tipo"))) === "estornado" || normalizeLabel(findCell(labelledCells(table.headers, row), "Tipo")?.text) === "estornado");
      if (originals.length !== 1 || reversals.length !== 1) return;
      const reversal = reversals[0];
      const reversalId = sourceId(reversal.id ?? reversal.attrs?.["data-cod"]);
      const cells = labelledCells(table.headers, reversal);
      const dateRaw = cellValue(findCell(cells, "Data"));
      if (!reversalId || civilDate(dateRaw)) return;
      const path = [...(Array.isArray(value) ? [panelIndex] : []), "tables", tableIndex, "rows", rows.indexOf(reversal)];
      context.archive("undated_reversal", reversalId, evidence(path), { description: "Estorno explicitamente observado sem data civil válida.", occurred_on_raw: dateRaw, original_payment_source_id: originalId, history_dates_complete: false });
      context.add("settlement", originalId, { normalized: { kind: "voided_payment", voided_by_source_id: reversalId, voided_date_unknown: true }, links: [{ entity: "raw_archive", archiveType: "undated_reversal", sourceId: reversalId, role: "voided_by" }] }, evidence(path));
    });
  });
}

function parseIndexValues(context, value, evidence, parentId) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
  const ids = [];
  rows.forEach((row, i) => {
    if (!sourceId(row?.id ?? row?.sourceId)) return;
    const id = row.id ?? row.sourceId; ids.push(id);
    const normalized = {};
    if (typeof row.value === "string") normalized.value = row.value;
    const reference = row.reference_month ?? civilDate(row.effective_date)?.slice(0, 7);
    if (typeof reference === "string") normalized.reference_month = reference;
    const index = sourceId(row.sourceIndexId) ?? parentId;
    context.add("index_value", id, { normalized, ...(index ? { links: [{ entity: "correction_index", sourceId: index, role: "index" }] } : {}) }, evidence(Array.isArray(value) ? [i] : ["rows", i]));
  });
  rememberPage(context, "index_values", object(value) ? value : {}, ids);
}

function parseIndexSeries(context, value, evidence) {
  if (!Array.isArray(value)) return;
  value.forEach((series, seriesIndex) => {
    if (!object(series) || !Array.isArray(series.rows)) return;
    const grid = sourceId(series.gridHash);
    const parent = sourceId(series.sourceIndexId);
    if (grid) context.archive("source_index_series", grid, evidence([seriesIndex]), { description: "Série mensal capturada; o rótulo não substitui o ID técnico do índice pai.", source_label: typeof series.name === "string" ? series.name : "", ...(parent ? { source_index_id: parent } : {}), captured_rows: series.rows.length });
    const ids = [];
    series.rows.forEach((row, rowIndex) => {
      const id = sourceId(row.id ?? row.attrs?.["data-cod"]);
      if (!id) return;
      ids.push(id);
      const cells = labelledCells(series.headers, row);
      const normalized = {};
      const amount = monetaryCell(findCell(cells, "Valor"));
      if (typeof amount === "string") normalized.value = amount;
      const rawDate = cellValue(findCell(cells, "Usar a partir"));
      const date = civilDate(rawDate);
      if (date) normalized.reference_month = date.slice(0, 7);
      if (typeof rawDate === "string") normalized.source_reference_date = rawDate;
      if (grid) normalized.source_series_hash = grid;
      context.add("index_value", id, { normalized, ...(parent ? { links: [{ entity: "correction_index", sourceId: parent, role: "index" }] } : {}) }, evidence([seriesIndex, "rows", rowIndex]));
    });
    rememberPage(context, "index_values", {}, ids);
  });
}

function parseConstructionArchive(context, value, evidence, projectId, section) {
  if (Array.isArray(value) && value.some(page => Array.isArray(page?.rows))) {
    value.forEach((page, i) => parseConstructionArchive(context, page, path => evidence([i, ...path]), projectId, section));
    return;
  }
  const rows = Array.isArray(value) ? value : value?.rows;
  if (!Array.isArray(rows)) return;
  const types = { blocks: "construction_block", types: "construction_unit_type", floors: "construction_floor" };
  const ids = [];
  rows.forEach((row, i) => {
    const id = sourceId(row.id ?? row.attrs?.["data-cod"]);
    if (!id) return;
    ids.push(id);
    context.archive(types[section], `${projectId}|${id}`, evidence(Array.isArray(value) ? [i] : ["rows", i]), { description: `Estrutura da construção preservada: ${section}.`, source_project_id: projectId, source_id: id });
  });
  rememberPage(context, `${section}:${projectId}`, object(value) ? value : {}, ids);
}

function collect(context) {
  // Read all explicit headers before visiting pages, including appended checkpoint files.
  for (const capture of context.captures) for (const frame of captureFrames(capture)) {
    if (/HeaderCapture$/.test(capture.name) && Array.isArray(frame.value?.headers)) {
      const kind = capture.name.replace(/HeaderCapture$/, "");
      const old = context.headers.get(kind);
      if (old && canonicalEobraJson(old) !== canonicalEobraJson(frame.value.headers)) context.errors.push(`${capture.name}: cabeçalhos conflitantes.`);
      else context.headers.set(kind, frame.value.headers);
    }
    if (/Headers$/.test(capture.name) && Array.isArray(frame.value) && frame.value.every(value => typeof value === "string")) {
      const kind = capture.name.replace(/Headers$/, "");
      const old = context.headers.get(kind);
      if (old && canonicalEobraJson(old) !== canonicalEobraJson(frame.value)) context.errors.push(`${capture.name}: cabeçalhos conflitantes.`);
      else context.headers.set(kind, frame.value);
    }
    if (/Headers$/.test(capture.name) && flatHeaders(frame.value?.headers)) context.headers.set(capture.name.replace(/Headers$/, ""), flatHeaders(frame.value.headers));
    const pages = Array.isArray(frame.value) ? frame.value : [frame.value];
    for (const page of pages) if (flatHeaders(page?.headers) && (["bills", "payments", "sales", "people"].includes(capture.name) || /^units\d+$/.test(capture.name))) {
      const kind = /^units\d+$/.test(capture.name) ? "units" : capture.name;
      const capturedHeaders = flatHeaders(page.headers);
      const old = context.headers.get(kind);
      if (old && canonicalEobraJson(old) !== canonicalEobraJson(capturedHeaders)) context.errors.push(`${capture.name}: cabeçalhos mudaram entre páginas.`);
      else context.headers.set(kind, capturedHeaders);
    }
  }
  for (const capture of context.captures) {
    if (object(capture.value) && capture.value.isError === true) context.errors.push(`${capture.name}: a ferramenta registrou erro; nenhum dado foi presumido.`);
    for (const frame of captureFrames(capture)) {
      const { value, evidence } = frame;
      if (capture.name === "projects") parseProjects(context, value, evidence);
      else if (capture.name === "bills") parseBills(context, value, evidence, context.headers.get("bills"));
      else if (capture.name === "billsSupplemental") {
        const pages = Array.isArray(value) ? value : [value];
        pages.forEach((page, index) => {
          if (!object(page) || !Array.isArray(page.rows)) return;
          const filters = object(page.filters) ? page.filters : {};
          const name = `billsSupplemental:${hashEobraValue(filters)}`;
          const prior = context.supplements.get(name);
          context.supplements.set(name, { baseCapture: page.baseCapture, filters, conflictingBinding: prior?.conflictingBinding === true || prior !== undefined && prior.baseCapture !== page.baseCapture });
          parseBills(context, page, path => evidence([...(Array.isArray(value) ? [index] : []), ...path]), context.headers.get("bills"), name);
        });
      }
      else if (capture.name === "payments") parsePayments(context, value, evidence, context.headers.get("payments"));
      else if (capture.name === "sales") parseSaleList(context, value, evidence, context.headers.get("sales"));
      else if (capture.name === "people") parsePeople(context, value, evidence, context.headers.get("people") ?? context.headers.get("person"));
      else if (capture.name === "stock") parseStock(context, value, evidence);
      else if (capture.name === "accounts") parseAccounts(context, value, evidence);
      else if (/^sale\d+$/.test(capture.name)) parseSaleDetail(context, capture.name.slice(4), value, evidence);
      else if (/^units(.+)$/.test(capture.name) && capture.name !== "unitsHeaders") {
        if (frame.constructionId && frame.constructionId !== capture.name.slice(5)) context.errors.push(`${capture.name}: construção do wrapper diverge do nome do contexto.`);
        parseUnits(context, value, evidence, frame.constructionId ?? capture.name.slice(5), context.headers.get("units"));
      }
      else if (capture.name === "units") parseStructuredDetails(context, "unit", value, evidence);
      else if (DETAIL_ENTITIES[capture.name]) parseStructuredDetails(context, DETAIL_ENTITIES[capture.name], value, evidence);
      else if (capture.name === "installmentDetails") parseStructuredDetails(context, null, value, evidence);
      else if (capture.name === "records") {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) parseStructuredDetails(context, value[i]?.entity, value[i], path => evidence([i, ...path]));
      } else if (capture.name === "coverage") {
        if (Array.isArray(value)) context.coverage.push(...clone(value)); else context.errors.push("coverage: manifesto deve ser uma lista.");
      } else if (/^reversedPayment(.+)$/.test(capture.name)) parseReversalDetail(context, capture.name.slice("reversedPayment".length), value, evidence);
      else if (capture.name === "cub") parseIndexValues(context, value, evidence, sourceId(value?.sourceIndexId));
      else if (capture.name === "allIndexSeries") parseIndexSeries(context, value, evidence);
      else if (/^(blocks|types|floors)\d+$/.test(capture.name)) {
        const match = /^(blocks|types|floors)(\d+)$/.exec(capture.name);
        parseConstructionArchive(context, value, evidence, frame.constructionId ?? match[2], match[1]);
      }
      else if (capture.name === "correctionRules" && Array.isArray(value?.rows)) value.rows.forEach((row, i) => {
        const id = sourceId(row.id ?? row.attrs?.["data-cod"]);
        if (!id) return;
        const indexCell = findCell(labelledCells(value.headers, row), "Índice de correção");
        const indexId = sourceId(indexCell?.value);
        const label = typeof indexCell?.text === "string" ? indexCell.text.trim() : null;
        const normalized = { description: "Regra da origem preservada; rótulo não identifica índice nem vínculo de parcela." };
        if (indexId && label && normalizeLabel(label) !== "sem indice") {
          normalized.source_index_reference = { source_id: indexId, label };
          context.add("correction_index", indexId, { normalized: { name: label } }, evidence(["rows", i]));
        }
        context.archive("source_correction_rule", id, evidence(["rows", i]), normalized);
      });
    }
  }
}

function resolveProjects(context) {
  // Only ID-based graph relationships transfer a project; cost-center labels never do.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const record of context.candidates.values()) {
      if (!PROJECT_ENTITIES.has(record.entity)) continue;
      const projects = new Set(record.sourceProjectId ? [record.sourceProjectId] : []);
      for (const link of record.links) {
        if (link.entity === "project" && link.role === "project") projects.add(link.sourceId);
        else if ((record.entity === "sale" && link.entity === "unit" && link.role === "unit") || (["receivable", "payable"].includes(record.entity) && link.entity === "sale" && link.role === "sale") || (record.entity === "settlement" && link.role === "installment")) {
          const target = context.candidates.get(keyOf(link));
          if (target?.sourceProjectId) projects.add(target.sourceProjectId);
        }
      }
      if (projects.size > 1) record.issues.push("sourceProjectId: relações por ID apontam a obras diferentes.");
      else if (projects.size === 1 && record.sourceProjectId === null) { record.sourceProjectId = [...projects][0]; changed = true; }
    }
    if (!changed) break;
  }
}

function resolveManagerRelations(context) {
  const byUnit = new Map();
  const inventory = new Map(finalizeInventories(context).map(entry => [entry.capture, entry]));
  for (const relation of context.managerRelations) {
    if (!byUnit.has(relation.unitId)) byUnit.set(relation.unitId, new Set());
    byUnit.get(relation.unitId).add(relation.saleId);
    context.add("sale", relation.saleId, { links: [{ entity: "unit", sourceId: relation.unitId, role: "unit", source_relationship_basis: "manager_data_lnksli_sale_id" }], issues: context.knownSales.has(relation.saleId) ? [] : ["sale_reference: ID vinculado no manager ainda não consta do catálogo/detalhe de vendas capturado."] }, relation.evidence);
    context.add("unit", relation.unitId, { normalized: { source_sale_id: relation.saleId, source_sale_relationship_basis: "manager_data_lnksli_sale_id" } }, relation.evidence);
  }
  for (const [unitId, sales] of byUnit) {
    const unit = context.candidates.get(keyOf({ entity: "unit", sourceId: unitId }));
    if (sales.size !== 1) { unit.issues.push("sale_reference: observações do manager vinculam a unidade a mais de uma venda; conferir a relação vigente."); continue; }
    const sale = context.candidates.get(keyOf({ entity: "sale", sourceId: [...sales][0] }));
    const units = sale.links.filter(link => link.entity === "unit" && link.role === "unit");
    if (!context.knownSales.has(sale.sourceId) || sale.normalized.status !== "active" || sale.issues.length || unit.issues.length || units.length !== 1 || !unit.sourceProjectId || sale.sourceProjectId !== null && sale.sourceProjectId !== unit.sourceProjectId || !inventory.get(`units:${unit.sourceProjectId}`)?.rowsComplete) continue;
    context.add("sale", sale.sourceId, { normalized: { primary_unit_basis: "sole_unit" } });
    if (unit.normalized.status === undefined) context.add("unit", unitId, { normalized: { status: "sold", status_provenance: "sole_unit_completed_sale_relation" } });
    else if (unit.normalized.status !== "sold") unit.issues.push("status: disponibilidade observada conflita com vínculo exclusivo a uma venda concluída; conferir antes de promover.");
  }
}

function normalizedRecord(record) {
  return { entity: record.entity, sourceId: record.sourceId, sourceProjectId: record.sourceProjectId, parentSourceId: record.parentSourceId, links: clone(record.links), raw: clone(record.raw), normalized: clone(record.normalized) };
}

function nativeCoverage(context, records, projectIds, downgrade = false) {
  const map = new Map();
  for (const declaration of context.coverage) {
    if (!object(declaration) || !EOBRA_PRIORITY_ENTITIES.includes(declaration.entity)) { context.errors.push("Cobertura complementar deve referir uma entidade nativa conhecida."); continue; }
    const key = coverageKey(declaration);
    if (map.has(key) && canonicalEobraJson(map.get(key)) !== canonicalEobraJson(declaration)) context.errors.push(`${declaration.entity}: declarações de cobertura conflitantes.`);
    else map.set(key, clone(declaration));
  }
  for (const entity of EOBRA_PRIORITY_ENTITIES) for (const project of PROJECT_ENTITIES.has(entity) ? projectIds : [null]) {
    const key = coverageKey({ entity, sourceProjectId: project });
    if (!map.has(key)) map.set(key, { entity, sourceProjectId: project, expectedCount: null, expectedPages: null, collectedPages: [], detailsExpected: null, detailsCollected: [], complete: false, filters: { evidence: "not_yet_verified" } });
  }
  for (const record of records.filter(record => record.entity !== "raw_archive")) {
    const key = coverageKey(record);
    if (!map.has(key) && (!PROJECT_ENTITIES.has(record.entity) || record.sourceProjectId !== null)) map.set(key, { entity: record.entity, sourceProjectId: record.sourceProjectId, expectedCount: null, expectedPages: null, collectedPages: [], detailsExpected: null, detailsCollected: [], complete: false, filters: { evidence: "not_yet_verified" } });
  }
  if (downgrade) for (const [key, entry] of map) {
    const ids = new Set(records.filter(record => record.entity !== "raw_archive" && coverageKey(record) === key).map(record => record.sourceId));
    const details = Array.isArray(entry.detailsCollected) ? entry.detailsCollected : [];
    if ((Number.isSafeInteger(entry.expectedCount) && ids.size !== entry.expectedCount) || details.some(id => !ids.has(id))) entry.complete = false;
    entry.detailsCollected = details.filter(id => ids.has(id));
    delete entry.collectedCount;
  }
  // A collector assertion cannot overrule contrary evidence already in the source list.
  for (const entry of map.values()) if (context.incompleteEntities?.has(entry.entity)) entry.complete = false;
  return [...map.values()];
}

function archiveCoverage(records) {
  const groups = new Map();
  for (const record of records.filter(record => record.entity === "raw_archive")) {
    const key = coverageKey(record);
    if (!groups.has(key)) groups.set(key, { entity: "raw_archive", archiveType: record.archiveType, sourceProjectId: record.sourceProjectId, expectedCount: 0, expectedPages: 1, collectedPages: [1], detailsExpected: 0, detailsCollected: [], complete: true, filters: { meaning: "only_the_captured_archive_not_the_source_inventory" } });
    groups.get(key).expectedCount++;
  }
  return [...groups.values()];
}

function finalizeInventories(context) {
  return [...context.inventories.values()].map(entry => {
    const counts = [...entry.counts];
    const pageCounts = [...entry.expectedPageCounts];
    if (counts.length > 1) entry.issues.push("A quantidade total mudou entre observações.");
    if (pageCounts.length > 1) entry.issues.push("A quantidade esperada de páginas mudou entre observações.");
    const filters = noDuplicates(entry.filters);
    if (filters.length > 1) entry.issues.push("Filtros diferentes não comprovam uma única consulta completa.");
    const expectedCount = counts.length === 1 ? counts[0] : null;
    const expectedPages = pageCounts.length === 1 ? pageCounts[0] : null;
    const collectedPages = [...entry.pages.keys()].sort((a, b) => a - b);
    const rowsComplete = expectedCount !== null && expectedCount === entry.ids.size && expectedPages !== null && expectedPages === collectedPages.length && collectedPages.every((page, index) => page === index + 1) && entry.issues.length === 0;
    return { capture: entry.capture, observations: entry.observations, uniqueIds: entry.ids.size, expectedCount, expectedPages, collectedPages, rowsComplete, filters, issues: unique(entry.issues), ...(entry.supplementalCaptures ? { baseUniqueIds: entry.baseUniqueIds, supplementalUniqueIds: entry.ids.size - entry.baseUniqueIds, supplementalCaptures: entry.supplementalCaptures } : {}) };
  });
}

function incorporateSupplements(context) {
  if (!context.supplements.size) return;
  const base = context.inventories.get("bills");
  if (!base) { context.warnings.push("Coleta suplementar sem consulta principal: IDs foram preservados, sem comprovar cobertura global."); return; }
  const baseFilters = noDuplicates(base.filters);
  const status = new Map(finalizeInventories(context).map(entry => [entry.capture, entry]));
  for (const [name, binding] of context.supplements) {
    const supplement = context.inventories.get(name);
    const filters = binding.filters;
    let allowed = !binding.conflictingBinding && binding.baseCapture === "bills" && baseFilters.length === 1 && status.get(name)?.rowsComplete === true;
    const original = baseFilters[0] ?? {};
    const start = civilDate(filters.startDate); const end = civilDate(filters.endDate);
    const baseStart = civilDate(original.startDate); const baseEnd = civilDate(original.endDate);
    const remainder = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["startDate", "endDate"].includes(key)));
    allowed = allowed && original.datetype === "1" && filters.datetype === "1" && !!start && !!end && !!baseStart && !!baseEnd && start <= end && baseStart <= start && end <= baseEnd && canonicalEobraJson(remainder(original)) === canonicalEobraJson(remainder(filters));
    allowed = allowed && supplement.dueDates?.length === supplement.observations && supplement.dueDates.every(date => date !== null && start <= date && date <= end);
    if (!allowed) { context.warnings.push(`${name}: suplemento não comprova subconjunto completo da consulta principal; não foi usado para fechar sua cobertura.`); continue; }
    if (!base.supplementalCaptures) { base.baseUniqueIds = base.ids.size; base.supplementalCaptures = []; }
    base.supplementalCaptures.push(name);
    for (const id of supplement.ids) base.ids.add(id);
    base.observations += supplement.observations;
  }
}

/** Convert read-only UI evidence into a reviewable snapshot; no network or database work. */
export function convertEobraCheckpoint(input, options = {}) {
  if (typeof input === "string" || input instanceof Uint8Array) input = JSON.parse(typeof input === "string" ? input : Buffer.from(input).toString("utf8"));
  canonicalEobraJson(input);
  const preserved = preserveInput(input);
  const context = makeContext(preserved);
  for (const doc of context.docs) {
    if (!object(doc) || doc.schema !== EOBRA_CHECKPOINT_SCHEMA || !object(doc.captures)) context.errors.push("Entrada precisa declarar eobra.ui-checkpoint.v1 e captures como objeto.");
  }
  const hosts = unique(context.docs.map(doc => doc?.sourceHost).filter(value => typeof value === "string" && value));
  if (hosts.length !== 1) context.errors.push("Os checkpoints precisam pertencer à mesma instância de origem.");
  const host = hosts.length === 1 ? hosts[0] : "";
  const times = context.docs.map(doc => doc?.capturedAt ?? doc?.lastCheckpointAt).filter(timestamp).sort((a, b) => Date.parse(a) - Date.parse(b));
  const capturedAt = options.capturedAt ?? times.at(-1) ?? "";
  if (!timestamp(capturedAt)) context.errors.push("capturedAt: falta timestamp real da captura; capturedOn não define hora.");
  const dates = unique(context.docs.map(doc => doc?.referenceDate ?? doc?.capturedOn).filter(civilDate));
  const referenceDate = options.referenceDate ?? (dates.length === 1 ? dates[0] : "");
  if (!civilDate(referenceDate)) context.errors.push("referenceDate: corte civil precisa ser explícito e coerente entre checkpoints.");
  collect(context);
  resolveManagerRelations(context);
  resolveProjects(context);
  incorporateSupplements(context);
  const inventory = finalizeInventories(context);
  context.incompleteEntities = new Set();
  const inventoryEntities = { bills: ["receivable", "payable"], payments: ["settlement"], sales: ["sale"], projects: ["project"], people: ["person"], accounts: ["bank_account"], index_values: ["index_value"] };
  for (const entry of inventory) {
    const countConflict = entry.expectedCount !== null && entry.expectedCount !== entry.uniqueIds;
    const pageConflict = entry.expectedPages !== null && (entry.collectedPages.length !== entry.expectedPages || entry.collectedPages.some((page, index) => page !== index + 1));
    if (!countConflict && !pageConflict && !entry.issues.length) continue;
    for (const entity of entry.capture.startsWith("units:") ? ["unit"] : inventoryEntities[entry.capture] ?? []) context.incompleteEntities.add(entity);
  }
  const projects = [...context.candidates.values()].filter(record => record.entity === "project" && typeof record.normalized.name === "string" && record.normalized.name.trim());
  const projectIds = projects.map(record => record.sourceId).sort(compare);
  const allProjects = options.allProjects === true || (options.allProjects === undefined && context.docs.some(doc => doc?.scope?.allProjects === true));
  const baseRecords = [...context.fragments, context.manifest, ...context.special.values()];
  const candidates = [...context.candidates.values()];
  const preliminary = [...baseRecords, ...candidates.map(normalizedRecord)];
  const makeSnapshot = records => ({
    format: EOBRA_SNAPSHOT_FORMAT,
    source: { host, capturedAt, referenceDate, checkpointHash: context.sourceHash },
    scope: { projectIds, allProjects },
    archiveTypes: [...context.archiveTypes].map(([key, description]) => ({ key, description })),
    coverage: [...nativeCoverage(context, records, projectIds), ...archiveCoverage(records)], records,
  });
  const initial = inspectEobraSnapshot(makeSnapshot(preliminary));
  const inspected = new Map(initial.records.map(record => [keyOf(record), record]));
  const blocked = new Map();
  for (const record of candidates) {
    const reasons = unique([...record.issues, ...(inspected.get(keyOf(record))?.errors ?? [])]);
    if (record.normalized.status === "draft" && (!record.normalized.sale_date || reasons.some(reason => reason.startsWith("sale_date:")))) reasons.push("sale_date: rascunho sem data válida permanece em arquivo identificado.");
    if (reasons.length) blocked.set(keyOf(record), reasons);
  }
  // Invalid dependencies must not become apparently valid native parents/children.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of candidates) {
      if (blocked.has(keyOf(record))) continue;
      const dependency = record.links.find(link => blocked.has(keyOf(link)));
      const projectBlocked = record.sourceProjectId && blocked.has(keyOf({ entity: "project", sourceId: record.sourceProjectId }));
      if (dependency || projectBlocked) { blocked.set(keyOf(record), [`references: ${dependency ? `${dependency.entity}/${dependency.sourceId}` : `project/${record.sourceProjectId}`} ainda tem pendências de detalhe.`]); changed = true; }
    }
  }
  const records = [...baseRecords];
  const pendingDetails = [];
  const reasonList = unique([...blocked.values()].flat()).sort(compare);
  const reasonCodes = new Map(reasonList.map((reason, i) => [reason, `p${i.toString(36)}`]));
  if (reasonList.length) {
    const entries = reasonList.map(reason => ({ code: reasonCodes.get(reason), message: reason }));
    const type = "ui_pending_reason_dictionary";
    context.archiveTypes.set(type, "Mensagens das pendências referidas por códigos, preservadas uma vez para evitar repetição no pacote.");
    records.push(archiveRecord(type, hashEobraValue(entries), { entries }, { description: "Dicionário das pendências de detalhe; códigos são locais a este pacote." }));
  }
  for (const record of candidates) {
    const reasons = blocked.get(keyOf(record));
    if (!reasons) { records.push(normalizedRecord(record)); continue; }
    const archiveType = record.entity === "sale" && record.normalized.status === "draft" ? "sale_draft" : `ui_pending_${record.entity}`;
    context.archiveTypes.set(archiveType, `Observação de ${record.entity} com detalhe ou vínculo ainda pendente; não promovida.`);
    records.push(archiveRecord(archiveType, record.sourceId, clone(record.raw), {
      source_entity: record.entity,
      candidate: { sourceProjectId: record.sourceProjectId, normalized: clone(record.normalized), links: clone(record.links) },
      pending: reasons.map(reason => reasonCodes.get(reason)),
      ...(record.entity === "settlement" && (record.normalized.source_reversed === true || record.normalized.voided_date_unknown === true) ? { history_dates_complete: false } : {}),
    }));
    pendingDetails.push({ entity: record.entity, sourceId: record.sourceId, sourceProjectId: record.sourceProjectId, captureKind: CAPTURE_KINDS[record.entity], reasons, fields: unique(reasons.map(reason => reason.split(":")[0]).filter(field => /^[a-z_][a-zA-Z0-9_.\/]*$/.test(field))) });
  }
  const snapshot = makeSnapshot(records);
  snapshot.coverage = [...nativeCoverage(context, records, projectIds, true), ...archiveCoverage(records)];
  const inspection = inspectEobraSnapshot(snapshot);
  const gapCounts = new Map();
  for (const item of pendingDetails) for (const field of item.fields) {
    const code = `${item.entity}.${field}`;
    gapCounts.set(code, (gapCounts.get(code) ?? 0) + 1);
  }
  for (const item of inventory) if (!item.rowsComplete) gapCounts.set(`inventory.${item.capture}`, item.expectedCount === null ? 1 : Math.max(0, item.expectedCount - item.uniqueIds));
  const lossless = hashEobraValue(reconstructEobraCheckpoint(snapshot)) === context.sourceHash;
  const errors = unique(context.errors);
  const warnings = unique([...context.warnings, ...inventory.flatMap(entry => entry.issues)]);
  const report = {
    format: EOBRA_CHECKPOINT_REPORT_FORMAT, sourceHash: context.sourceHash, sourceHost: host,
    capturedAt: capturedAt || null, referenceDate: referenceDate || null,
    preserved: { documents: context.docs.length, fragments: context.fragments.length, sourceHash: context.sourceHash, lossless },
    inventory, candidates: candidates.length, nativeRecords: records.filter(record => record.entity !== "raw_archive").length,
    pendingRecords: pendingDetails.length, pendingDetails,
    gaps: [...gapCounts].map(([code, count]) => ({ code, message: code.startsWith("inventory.") ? "Cobertura da consulta ainda não comprovada." : "Campo ou relação precisa ser completado por evidência da origem.", count })).sort((a, b) => b.count - a.count || compare(a.code, b.code)),
    errors, warnings,
    inspection: { ok: inspection.ok, complete: inspection.complete, allProjectsComplete: inspection.allProjectsComplete, errors: inspection.errors, warnings: inspection.warnings },
    readyForReview: inspection.ok && errors.length === 0,
    complete: inspection.complete && errors.length === 0 && pendingDetails.length === 0,
    history_dates_complete: inspection.summary.history_dates_complete && !records.some(record => record.normalized?.history_dates_complete === false),
  };
  return { snapshot, inspection, report };
}

export function formatEobraCheckpointReview(report) {
  const safe = value => String(value).replace(/[|\r\n]/g, " ");
  const lines = ["# Revisão da captura do eObra", "", `Origem: ${safe(report.sourceHost)}`, `Corte: ${safe(report.referenceDate ?? "pendente")}`, `Fechamento da captura: ${safe(report.capturedAt ?? "pendente")}`, "",
    `**Situação: ${report.complete ? "escopo capturado e validado" : "coleta incompleta; revisão e detalhes pendentes"}.** Nenhum dado foi gravado no Elos por este conversor.`, "",
    `A reconstrução integral dos ${report.preserved.documents} checkpoint(s) ${report.preserved.lossless ? "foi conferida" : "não foi confirmada"}. Hash: ${report.sourceHash}.`, "",
    `Candidatos identificados: ${report.candidates}. Entidades nativas válidas no pacote: ${report.nativeRecords}. Registros preservados com pendência: ${report.pendingRecords}.`, "",
    "## Cobertura das consultas", "", "| Captura | IDs distintos | Esperados | Páginas coletadas / esperadas | Lista completa |", "| --- | ---: | ---: | --- | --- |",
    ...report.inventory.map(entry => `| ${safe(entry.capture)} | ${entry.uniqueIds} | ${entry.expectedCount ?? "desconhecido"} | ${entry.collectedPages.length} / ${entry.expectedPages ?? "desconhecido"} | ${entry.rowsComplete ? "sim, apenas esta consulta" : "não comprovada"} |`), "",
    "Lista completa não comprova os detalhes, o escopo por obra, a composição financeira ou a promoção canônica.", "", "## Pendências mais frequentes", "",
    ...report.gaps.slice(0, 40).map(gap => `- ${safe(gap.code)}: ${gap.count}. ${safe(gap.message)}`), "", "## Conferência", "",
    `- Pacote estruturalmente válido: ${report.inspection.ok ? "sim" : "não"}.`,
    `- Escopo completo: ${report.complete ? "sim" : "não"}.`,
    `- Histórico temporal completo: ${report.history_dates_complete ? "sim" : "não"}.`,
    "- Valores ausentes não foram preenchidos com zero. Diferenças não foram atribuídas automaticamente ao CUB.",
    "- Relações usam IDs de origem; nomes de pessoas, contas, obras e índices não produzem vínculos.",
    "- Cancelamentos conservam os valores históricos observados; o estado não fabrica abatimento.", "",
  ];
  if (report.errors.length || report.inspection.errors.length) lines.push("## Impedimentos do pacote", "", ...unique([...report.errors, ...report.inspection.errors]).slice(0, 40).map(error => `- ${safe(error)}`), "");
  if (report.warnings.length) lines.push("## Observações", "", ...report.warnings.slice(0, 30).map(warning => `- ${safe(warning)}`), "");
  lines.push("A relação completa de IDs, campos e tipos de detalhe solicitados está no relatório JSON privado. Os dados brutos permanecem no pacote, com manifesto de reconstrução.", "");
  return lines.join("\n");
}
