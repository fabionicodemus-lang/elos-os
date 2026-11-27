import { createHash } from "node:crypto";
import { reconcileInstallmentFinancials } from "./financial.mjs";

/** A source snapshot is evidence to review, never an instruction to post money. */
export const EOBRA_SNAPSHOT_FORMAT = "elos.eobra.snapshot.v1";
export const EOBRA_PRIORITY_ENTITIES = Object.freeze([
  "project", "person", "unit", "sale", "receivable", "payable", "settlement",
  "bank_account", "bank_transaction", "correction_index", "index_value",
]);
export const EOBRA_SNAPSHOT_ENTITIES = Object.freeze([...EOBRA_PRIORITY_ENTITIES, "raw_archive"]);
export const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;
export const MAX_SNAPSHOT_RECORDS = 100000;
export const MAX_SNAPSHOT_DEPTH = 40;
const MAX_JSON_NODES = 10000000;
const MAX_OBJECT_KEYS = 10000;
const MAX_LINKS = 2000;
const MONEY_LIMIT = 9999999999999999n;
const PROJECT_ENTITIES = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
const AUDIT_ENTITIES = new Set(["settlement", "bank_account", "bank_transaction", "correction_index", "index_value", "raw_archive"]);
const MONEY_FIELDS = ["original_amount", "current_amount", "paid_amount", "balance_amount", "interest_amount", "penalty_amount", "correction_amount", "other_accrual_amount", "discount_amount"];
const TOTAL_FIELDS = ["original_amount", "current_amount", "paid_amount", "balance_amount"];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = values => [...new Set(values)];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Stable, bounded JSON; rejects accessors, cycles and values JSON would erase. */
export function canonicalEobraJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  let stringBytes = 0;
  function visit(entry, depth) {
    if (++nodes > MAX_JSON_NODES) throw new Error("JSON excede o limite de elementos permitido.");
    if (depth > MAX_SNAPSHOT_DEPTH) throw new Error(`JSON excede a profundidade máxima de ${MAX_SNAPSHOT_DEPTH}.`);
    if (entry === null) return "null";
    if (typeof entry === "string") {
      const result = JSON.stringify(entry);
      stringBytes += Buffer.byteLength(result, "utf8");
      if (stringBytes > MAX_SNAPSHOT_BYTES) throw new Error("Pacote excede o limite de 200 MiB.");
      return result;
    }
    if (typeof entry === "boolean") return entry ? "true" : "false";
    if (typeof entry === "number") {
      if (!Number.isFinite(entry) || (Number.isInteger(entry) && !Number.isSafeInteger(entry))) throw new Error("JSON contém número não finito ou inteiro sem precisão; preserve o valor como string.");
      return JSON.stringify(entry);
    }
    if (typeof entry !== "object") throw new Error("JSON contém valor não serializável; não use undefined, funções, símbolos ou BigInt.");
    if (ancestors.has(entry)) throw new Error("JSON contém referência circular.");
    const isArray = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (!isArray && prototype !== Object.prototype && prototype !== null) throw new Error("JSON aceita somente objetos simples, arrays e valores primitivos.");
    if (Object.getOwnPropertySymbols(entry).length) throw new Error("JSON não aceita propriedades Symbol.");
    const keys = Object.keys(entry);
    if (keys.length > (isArray ? MAX_SNAPSHOT_RECORDS : MAX_OBJECT_KEYS)) throw new Error("JSON excede o limite de itens de um objeto ou array.");
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    for (const key of keys) {
      if (!own(descriptors[key], "value")) throw new Error("JSON não aceita getters ou setters.");
    }
    ancestors.add(entry);
    let result;
    if (isArray) {
      if (entry.length > MAX_SNAPSHOT_RECORDS || keys.length !== entry.length || keys.some((key, i) => key !== String(i))) throw new Error("JSON contém array esparso, propriedades extras ou itens demais.");
      result = `[${keys.map(key => visit(descriptors[key].value, depth + 1)).join(",")}]`;
    } else {
      result = `{${keys.sort(compare).map(key => `${visit(key, depth + 1)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
    }
    ancestors.delete(entry);
    return result;
  }
  const result = visit(value, 0);
  if (Buffer.byteLength(result, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("Pacote excede o limite de 200 MiB.");
  return result;
}

export function hashEobraValue(value) {
  return createHash("sha256").update(canonicalEobraJson(value), "utf8").digest("hex");
}

function id(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function identity(value) {
  return EOBRA_SNAPSHOT_ENTITIES.includes(value.entity) && id(value.sourceId)
    ? JSON.stringify([value.entity, value.entity === "raw_archive" ? value.archiveType ?? null : null, value.sourceId]) : null;
}

function coverageIdentity(value) {
  return JSON.stringify([value.entity, value.sourceProjectId ?? null, value.entity === "raw_archive" ? value.archiveType ?? null : null]);
}

function date(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function month(value) { return typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value); }

function timestamp(value) {
  return typeof value === "string" && /^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
    && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function money(value, { signed = false, positive = false } = {}) {
  if (typeof value !== "string" || value.length > 32 || !(signed ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^(?:0|[1-9]\d*)\.\d{2}$/).test(value)) return null;
  const negative = value.startsWith("-");
  const [integer, fraction] = (negative ? value.slice(1) : value).split(".");
  const cents = (BigInt(integer) * 100n + BigInt(fraction)) * (negative ? -1n : 1n);
  return (positive && cents <= 0n) || cents > MONEY_LIMIT || cents < -MONEY_LIMIT || (negative && cents === 0n) ? null : cents;
}

function decimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function scaled(value, scale = 6, signed = false) {
  if (typeof value !== "string" || value.length > 40) return null;
  const pattern = new RegExp(`^${signed ? "(-?)" : "()"}(0|[1-9]\\d*)(?:\\.(\\d{1,${scale}}))?$`);
  const match = pattern.exec(value);
  if (!match) return null;
  const amount = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((match[3] ?? "").padEnd(scale, "0"));
  return amount * (match[1] === "-" ? -1n : 1n);
}

function validTaxId(value) {
  const digits = typeof value === "string" ? value.replace(/[.\-/\s]/g, "") : "";
  if (!/^\d{11}$|^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const check = values => { const rest = values.reduce((total, item, index) => total + Number(item) * (values.length === 9 || values.length === 10 ? values.length + 1 - index : ((values.length - 1 - index) % 8) + 2), 0) % 11; return rest < 2 ? 0 : 11 - rest; };
  const base = digits.length - 2;
  return check([...digits.slice(0, base)]) === Number(digits[base]) && check([...digits.slice(0, base + 1)]) === Number(digits[base + 1]);
}

function requiredText(record, key) {
  const value = record.normalized[key];
  if (typeof value !== "string" || !value.trim()) record.errors.push(`${key}: informe o texto observado na origem.`);
}

function requiredDate(record, key, optional = false) {
  const value = record.normalized[key];
  if (optional && (value === null || value === undefined)) return;
  if (!date(value)) record.errors.push(`${key}: data civil inválida; use AAAA-MM-DD e preserve o texto original em raw.`);
}

function enumField(record, key, values, optional = false) {
  const value = record.normalized[key];
  if (optional && (value === null || value === undefined)) return;
  if (!values.includes(value)) record.errors.push(`${key}: valor desconhecido; opções aceitas: ${values.join(", ")}.`);
}

function moneyField(record, key, options, optional = false) {
  const value = record.normalized[key];
  if (optional && (value === null || value === undefined)) return null;
  const amount = money(value, options);
  if (amount === null) record.errors.push(`${key}: informe uma string monetária exata com duas casas, dentro da precisão permitida.`);
  return amount;
}

function sortedLinks(links) {
  return links.map(link => ({ link, key: canonicalEobraJson(link) })).sort((a, b) => compare(a.key, b.key)).map(entry => entry.link);
}

function recordContent(record) {
  return {
    entity: record.entity, sourceId: record.sourceId, sourceProjectId: record.sourceProjectId,
    parentSourceId: record.parentSourceId, ...(record.entity === "raw_archive" ? { archiveType: record.archiveType } : {}),
    links: sortedLinks(record.links), raw: record.raw, normalized: record.normalized,
  };
}

function prepareRecord(value, position, context) {
  const source = object(value) ? value : {};
  const record = {
    ...source,
    entity: source.entity ?? null, sourceId: source.sourceId ?? null,
    sourceProjectId: source.sourceProjectId ?? null, parentSourceId: source.parentSourceId ?? null,
    links: Array.isArray(source.links) ? source.links : [],
    raw: object(source.raw) ? source.raw : {}, normalized: object(source.normalized) ? source.normalized : {},
    identity: null, recordHash: null, errors: [], warnings: [], promotionBlockers: [], disposition: "candidate",
  };
  if (!object(value)) record.errors.push(`records[${position}]: registro deve ser um objeto.`);
  if (!EOBRA_SNAPSHOT_ENTITIES.includes(record.entity)) record.errors.push("entity: entidade desconhecida; documente tipos adicionais como raw_archive.");
  if (!id(record.sourceId)) record.errors.push("sourceId: informe o ID estável como string, sem espaços nas extremidades; nunca use o número exibido no lugar do ID técnico.");
  if (record.sourceProjectId !== null && !id(record.sourceProjectId)) record.errors.push("sourceProjectId: ID de obra inválido.");
  if (PROJECT_ENTITIES.has(record.entity) && record.sourceProjectId === null) record.errors.push("sourceProjectId: esta entidade exige uma obra explícita; preserve registros corporativos em raw_archive tipado.");
  if (record.sourceProjectId !== null && !context.projectIds.has(record.sourceProjectId)) record.errors.push("sourceProjectId: obra fora do escopo declarado.");
  if (record.entity === "project") {
    if (record.sourceProjectId !== null) record.errors.push("project: o catálogo de obras deve ter sourceProjectId=null.");
    if (!context.projectIds.has(record.sourceId)) record.errors.push("project: obra não incluída em scope.projectIds.");
  }
  if (record.parentSourceId !== null && !id(record.parentSourceId)) record.errors.push("parentSourceId: ID inválido.");
  if (record.entity === "raw_archive") {
    if (!id(record.archiveType) || !context.archiveTypes.has(record.archiveType)) record.errors.push("archiveType: declare o tipo complementar e sua descrição em archiveTypes.");
    record.promotionBlockers.push("Entidade complementar preservada para auditoria; nenhuma promoção canônica implementada.");
  } else if (source.archiveType !== undefined && source.archiveType !== null) record.errors.push("archiveType: somente raw_archive pode informar esse campo.");
  if (!object(source.raw)) record.errors.push("raw: informe o objeto bruto, inclusive quando vazio.");
  if (!object(source.normalized)) record.errors.push("normalized: informe um objeto, sem substituir dados ausentes por valores inventados.");
  if (!Array.isArray(source.links)) record.errors.push("links: informe a lista explícita, inclusive quando vazia.");
  if (record.links.length > MAX_LINKS) record.errors.push(`links: limite de ${MAX_LINKS} relações por registro excedido.`);
  const linkKeys = new Set();
  for (const link of record.links.slice(0, MAX_LINKS)) {
    if (!object(link)) { record.errors.push("links: relação deve ser um objeto."); continue; }
    if (!EOBRA_SNAPSHOT_ENTITIES.includes(link.entity) || !id(link.sourceId) || !id(link.role)) record.errors.push("links: entidade, ID textual e role são obrigatórios.");
    if (link.entity === "raw_archive" && (!id(link.archiveType) || !context.archiveTypes.has(link.archiveType))) record.errors.push("links: raw_archive exige archiveType declarado.");
    if (link.entity !== "raw_archive" && link.archiveType != null) record.errors.push("links: archiveType é exclusivo de raw_archive.");
    const linkKey = JSON.stringify([identity(link), link.role]);
    if (linkKeys.has(linkKey)) record.errors.push("links: relação repetida para a mesma entidade, ID e role.");
    linkKeys.add(linkKey);
    if (link.primary !== undefined && typeof link.primary !== "boolean") record.errors.push("links.primary: informe booleano observado ou omita; não inferir principal.");
    if (link.allocated_amount != null && money(link.allocated_amount) === null) record.errors.push("links.allocated_amount: valor de alocação inválido.");
    if (link.ownership_percent != null) {
      const percentage = scaled(link.ownership_percent, 4);
      if (percentage === null || percentage < 0n || percentage > 1000000n) record.errors.push("links.ownership_percent: percentual decimal deve estar entre 0 e 100, com até quatro casas.");
    }
    if (link.source_relation_id != null && !id(link.source_relation_id)) record.errors.push("links.source_relation_id: ID textual inválido.");
  }
  record.identity = identity(record);
  if (record.identity !== null) record.recordHash = hashEobraValue(recordContent(record));
  validateNormalized(record);
  return record;
}

function validateNormalized(record) {
  const n = record.normalized;
  switch (record.entity) {
    case "project": requiredText(record, "name"); break;
    case "person": {
      requiredText(record, "name");
      enumField(record, "person_type", ["PF", "PJ", "OTHER"]);
      enumField(record, "status", ["active", "inactive"]);
      if (!Array.isArray(n.roles) || !n.roles.length || n.roles.some(role => !["client", "supplier", "broker", "other"].includes(role)) || new Set(n.roles).size !== n.roles.length) record.errors.push("roles: informe papéis distintos da pessoa entre client, supplier, broker e other.");
      if (n.tax_id !== undefined && n.tax_id !== null && n.tax_id !== "") {
        if (!validTaxId(n.tax_id)) record.errors.push("tax_id: CPF/CNPJ inválido, inclusive dígitos verificadores.");
        else {
          const expected = n.tax_id.replace(/\D/g, "").length === 11 ? "PF" : "PJ";
          if (n.person_type !== expected) record.errors.push("person_type: tipo não corresponde ao CPF/CNPJ informado.");
        }
      }
      if (n.email != null && n.email !== "" && (typeof n.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email))) record.errors.push("email: endereço inválido.");
      break;
    }
    case "unit":
      requiredText(record, "code");
      enumField(record, "status", ["available", "reserved", "sold", "inactive"]);
      break;
    case "sale": {
      requiredText(record, "number");
      enumField(record, "status", ["active", "cancelled", "draft"]);
      const draft = n.status === "draft";
      requiredDate(record, "sale_date", draft);
      moneyField(record, "total_amount", {}, draft);
      if (draft) record.promotionBlockers.push("Rascunho preservado; não promover como venda ativa. Datas sem interpretação devem permanecer em raw_archive sale_draft.");
      break;
    }
    case "receivable":
    case "payable": {
      if (![n.description, n.document].some(value => typeof value === "string" && value.trim())) record.errors.push("description/document: ao menos uma identificação textual é obrigatória.");
      requiredDate(record, "due_date");
      enumField(record, "status", ["open", "paid", "partial", "cancelled"]);
      for (const key of MONEY_FIELDS) moneyField(record, key, { signed: key === "correction_amount" });
      if (typeof n.correction_locked !== "boolean") record.errors.push("correction_locked: informe booleano explícito.");
      if (n.correction == null) {
        if (n.correction_locked === true || n.status === "paid" || n.status === "cancelled") record.warnings.push("Política de correção desconhecida no histórico preservado; não habilitar reajustes futuros.");
        else record.errors.push("correction: política explícita obrigatória para uma parcela não travada.");
      } else if (!object(n.correction)) {
        record.errors.push("correction: política deve ser um objeto explícito, inclusive quando o modo ainda não é suportado.");
      } else if (!["none", "index_number"].includes(n.correction.mode)) {
        if (n.correction_locked === true || n.status === "paid" || n.status === "cancelled") {
          record.warnings.push("Política de correção sem motor disponível preservada no histórico travado; não foi reinterpretada como none.");
          record.promotionBlockers.push("Política de correção ainda não suportada para atualização futura; exige revisão explícita antes da promoção.");
        } else record.errors.push("correction.mode: informe none ou index_number; política desconhecida não é ausência de correção.");
      }
      if (n.correction?.mode === "index_number") {
        for (const key of ["base_month", "reference_month"]) if (!month(n.correction[key])) record.errors.push(`correction.${key}: competência explícita inválida.`);
        for (const key of ["base_value", "reference_value"]) {
          const value = scaled(n.correction[key]);
          if (value === null || value <= 0n) record.errors.push(`correction.${key}: índice positivo explícito obrigatório.`);
        }
      }
      const sequenceRequired = record.entity === "receivable";
      for (const key of ["sequence_number", "sequence_total"]) {
        if (sequenceRequired || n[key] != null) if (!Number.isSafeInteger(n[key]) || n[key] < 1) record.errors.push(`${key}: inteiro positivo obrigatório, sem assumir parcela única.`);
      }
      if ((n.sequence_number == null) !== (n.sequence_total == null)) record.errors.push("sequence_number/sequence_total: informe ambos quando a sequência for conhecida.");
      if (Number.isSafeInteger(n.sequence_number) && Number.isSafeInteger(n.sequence_total) && n.sequence_number > n.sequence_total) record.errors.push("sequence_number: número superior ao total da série.");
      if (n.status === "partial") record.promotionBlockers.push("Baixa parcial preservada; o destino deve suportar seus eventos e saldo antes da promoção.");
      if (record.entity === "payable" && money(n.current_amount) !== null && money(n.original_amount) !== null && n.current_amount !== n.original_amount) record.promotionBlockers.push("Contas a pagar com valor atualizado diferente do original exigem suporte aos componentes no destino.");
      break;
    }
    case "settlement":
      enumField(record, "kind", ["payment", "reversal", "voided_payment"]);
      moneyField(record, "amount", { positive: true });
      requiredDate(record, "occurred_on");
      enumField(record, "medium", ["bank", "cash", "non_cash"]);
      if (n.kind === "voided_payment") {
        if (!id(n.voided_by_source_id)) record.errors.push("voided_by_source_id: informe o ID observado do estorno preservado em raw_archive.");
        if (n.voided_date_unknown !== true) record.errors.push("voided_date_unknown: o pagamento anulado sem data de estorno exige indicação explícita true.");
        record.warnings.push("Pagamento explicitamente estornado preservado com efeito líquido zero; a data inválida ou ausente do estorno permanece no arquivo de origem. O histórico por data está incompleto.");
      } else if (n.voided_by_source_id != null || n.voided_date_unknown != null) record.errors.push("Dados de anulação sem data só podem ser usados em kind=voided_payment.");
      break;
    case "bank_account":
      requiredText(record, "name");
      enumField(record, "status", ["active", "inactive", "unknown"]);
      if (n.status === "unknown" && n.status_provenance !== "not_exposed_by_source") record.errors.push("status_provenance: conta histórica sem situação exige indicação explícita de que a origem não expõe esse dado.");
      if (n.status === "unknown") record.warnings.push("Situação cadastral da conta desconhecida na origem; a conta fica somente no histórico, sem habilitar uma conta bancária operacional.");
      enumField(record, "currency", ["BRL"]);
      moneyField(record, "opening_balance", { signed: true }, true);
      requiredDate(record, "opening_balance_date", true);
      if ((n.opening_balance == null) !== (n.opening_balance_date == null)) record.errors.push("opening_balance/opening_balance_date: saldo inicial e data devem ser informados juntos.");
      break;
    case "bank_transaction":
      requiredDate(record, "occurred_on");
      enumField(record, "direction", ["credit", "debit"]);
      enumField(record, "status", ["posted", "cancelled"]);
      moneyField(record, "amount", { positive: true });
      break;
    case "correction_index":
      requiredText(record, "code"); requiredText(record, "name");
      enumField(record, "value_type", ["index_number", "percentage"]);
      break;
    case "index_value":
      if (!month(n.reference_month)) record.errors.push("reference_month: competência inválida; use AAAA-MM.");
      if (scaled(n.value, 6, true) === null) record.errors.push("value: índice deve ser string decimal exata com até seis casas.");
      break;
    default: break;
  }
  if (AUDIT_ENTITIES.has(record.entity) && record.entity !== "raw_archive") record.promotionBlockers.push("Entidade preservada em auditoria de origem; não criar lançamento nem movimentar saldo bancário automaticamente.");
}

function matchingLinks(record, entity, role) { return record.links.filter(link => object(link) && link.entity === entity && link.role === role); }

function relation(record, entity, role, context, { min = 1, max = 1 } = {}) {
  const links = matchingLinks(record, entity, role);
  if (links.length < min || links.length > max) record.errors.push(`links.${role}: esperado ${min === max ? min : `de ${min} a ${max}`} vínculo(s) com ${entity}; encontrados ${links.length}.`);
  return links.map(link => context.byIdentity.get(identity(link))).filter(Boolean);
}

function roleTargets(record, role, entities, context, { min = 1, max = 1 } = {}) {
  const links = record.links.filter(link => object(link) && link.role === role && entities.includes(link.entity));
  if (links.length < min || links.length > max) record.errors.push(`links.${role}: relação obrigatória ou cardinalidade inválida (${entities.join("/")}).`);
  return links.map(link => context.byIdentity.get(identity(link))).filter(Boolean);
}

function checkSaleAllocation(record, links, role) {
  if (links.filter(link => link.primary === true).length > 1) record.errors.push(`links.${role}: há mais de uma relação marcada como principal.`);
  if (links.length > 1 && links.filter(link => link.primary === true).length !== 1) record.promotionBlockers.push(`Múltiplos ${role === "unit" ? "imóveis" : "compradores"}: a origem precisa identificar exatamente um principal; nenhum vínculo é escolhido pela ordem.`);
  const allocated = links.filter(link => link.allocated_amount != null);
  if (allocated.length && allocated.length !== links.length) record.promotionBlockers.push(`links.${role}: alocação monetária parcial; valores faltantes não serão divididos automaticamente.`);
  const amounts = allocated.map(link => money(link.allocated_amount));
  if (allocated.length === links.length && links.length && amounts.every(amount => amount !== null) && money(record.normalized.total_amount) !== null && amounts.reduce((sum, amount) => sum + amount, 0n) !== money(record.normalized.total_amount)) record.errors.push(`links.${role}: soma das alocações difere de total_amount da venda.`);
  const percentages = links.filter(link => link.ownership_percent != null);
  if (percentages.length && percentages.length !== links.length) record.promotionBlockers.push(`links.${role}: percentuais de participação incompletos.`);
  const percentValues = percentages.map(link => scaled(link.ownership_percent, 4));
  if (percentages.length === links.length && links.length && percentValues.every(value => value !== null) && percentValues.reduce((sum, value) => sum + value, 0n) !== 1000000n) record.errors.push(`links.${role}: participação total deve corresponder a 100%.`);
}

function validateRelations(record, context) {
  for (const link of record.links.slice(0, MAX_LINKS)) {
    if (!object(link)) continue;
    const targetIdentity = identity(link);
    const target = context.byIdentity.get(targetIdentity);
    if (targetIdentity === null || !target) { record.errors.push(`Referência ausente: ${link.entity ?? "?"}/${link.sourceId ?? "?"} (role ${link.role ?? "?"}).`); continue; }
    if (targetIdentity === record.identity) record.errors.push("Relação não pode apontar para o próprio registro.");
    if (record.sourceProjectId !== null && target.sourceProjectId !== null && record.sourceProjectId !== target.sourceProjectId) record.errors.push(`Relação ${link.role}: registros pertencem a obras diferentes.`);
    if (record.sourceProjectId !== null && target.entity === "project" && target.sourceId !== record.sourceProjectId) record.errors.push(`Relação ${link.role}: obra não corresponde a sourceProjectId.`);
    if (context.duplicateIdentities.has(targetIdentity)) record.errors.push(`Relação ${link.role}: alvo tem identidade duplicada ou conflitante.`);
  }
  if (record.sourceProjectId !== null && !context.byIdentity.has(identity({ entity: "project", sourceId: record.sourceProjectId }))) record.errors.push("sourceProjectId: obra declarada não foi capturada no pacote.");
  const parents = record.links.filter(link => object(link) && link.role === "parent");
  if (record.parentSourceId !== null && (parents.length !== 1 || parents[0].sourceId !== record.parentSourceId)) record.errors.push("parentSourceId: deve corresponder a exatamente um link de role parent.");
  if (record.parentSourceId === null && parents.length) record.errors.push("links.parent: informe parentSourceId explícito para a relação hierárquica.");
  switch (record.entity) {
    case "unit": relation(record, "project", "project", context); break;
    case "sale": {
      const draft = record.normalized.status === "draft";
      relation(record, "unit", "unit", context, { min: draft ? 0 : 1, max: MAX_LINKS });
      const buyers = relation(record, "person", "buyer", context, { min: draft ? 0 : 1, max: MAX_LINKS });
      for (const buyer of buyers) if (!Array.isArray(buyer.normalized.roles) || !buyer.normalized.roles.includes("client")) record.errors.push("links.buyer: pessoa vinculada não possui papel client explícito.");
      const units = matchingLinks(record, "unit", "unit");
      checkSaleAllocation(record, units, "unit");
      checkSaleAllocation(record, matchingLinks(record, "person", "buyer"), "buyer");
      if (record.normalized.units !== undefined) {
        const mirror = record.normalized.units;
        if (!Array.isArray(mirror) || mirror.length !== units.length || mirror.some(item => !object(item) || !id(item.source_id))) record.errors.push("units: espelho normalizado deve conter exatamente os vínculos de unidades.");
        else {
          const actual = units.map(link => ({ source_id: link.sourceId, primary: link.primary ?? null, allocated_amount: link.allocated_amount ?? null })).sort((a, b) => compare(a.source_id, b.source_id));
          const declared = mirror.map(item => ({ source_id: item.source_id, primary: item.primary ?? null, allocated_amount: item.allocated_amount ?? null })).sort((a, b) => compare(a.source_id, b.source_id));
          if (canonicalEobraJson(actual) !== canonicalEobraJson(declared)) record.errors.push("units: espelho diverge de links; não há duas autoridades para as relações de venda.");
        }
      }
      break;
    }
    case "receivable": {
      const [sale] = relation(record, "sale", "sale", context);
      if (sale?.normalized.status === "draft") record.promotionBlockers.push("Recebível vinculado a rascunho; venda não pode ser criada como ativa implicitamente.");
      break;
    }
    case "payable": {
      const namedCounterparty = typeof record.normalized.counterparty_name === "string" && record.normalized.counterparty_name.trim();
      const suppliers = relation(record, "person", "supplier", context, { min: namedCounterparty ? 0 : 1, max: 1 });
      for (const supplier of suppliers) if (!Array.isArray(supplier.normalized.roles) || !supplier.normalized.roles.includes("supplier")) record.errors.push("links.supplier: pessoa vinculada não possui papel supplier explícito.");
      break;
    }
    case "settlement": {
      roleTargets(record, "installment", ["receivable", "payable"], context);
      relation(record, "bank_account", "account", context, { min: ["bank", "cash"].includes(record.normalized.medium) ? 1 : 0, max: 1 });
      if (record.normalized.kind === "reversal") {
        const [payment] = relation(record, "settlement", "reverses", context);
        const original = payment?.links.find(link => object(link) && link.role === "installment");
        const target = record.links.find(link => object(link) && link.role === "installment");
        if (payment && payment.normalized.kind !== "payment") record.errors.push("links.reverses: estorno deve apontar para pagamento original.");
        if (payment && identity(original ?? {}) !== identity(target ?? {})) record.errors.push("links.reverses: estorno e pagamento pertencem a parcelas diferentes.");
      } else if (record.links.some(link => object(link) && link.role === "reverses")) record.errors.push("links.reverses: apenas um estorno pode referenciar pagamento revertido.");
      if (record.normalized.kind === "voided_payment") {
        const [archive] = relation(record, "raw_archive", "voided_by", context);
        const voidedLinks = record.links.filter(link => object(link) && link.role === "voided_by");
        if (voidedLinks.length !== 1 || voidedLinks[0].entity !== "raw_archive" || voidedLinks[0].sourceId !== record.normalized.voided_by_source_id) record.errors.push("links.voided_by: informe exatamente um arquivo de estorno tipado com ID igual a voided_by_source_id.");
        const originals = archive?.links.filter(link => object(link) && link.role === "original_payment") ?? [];
        if (originals.length && (originals.length !== 1 || originals[0].entity !== "settlement" || originals[0].sourceId !== record.sourceId)) record.errors.push("links.voided_by: o arquivo de estorno aponta para outro pagamento original.");
      } else if (record.links.some(link => object(link) && link.role === "voided_by")) record.errors.push("links.voided_by: apenas um pagamento explicitamente anulado pode referenciar estorno sem data.");
      break;
    }
    case "bank_transaction": {
      const [account] = relation(record, "bank_account", "account", context);
      const settlements = relation(record, "settlement", "settlement", context, { min: 0, max: MAX_LINKS });
      for (const settlement of settlements) {
        const eventAccount = settlement.links.find(link => object(link) && link.entity === "bank_account" && link.role === "account");
        if (account && eventAccount && account.sourceId !== eventAccount.sourceId) record.errors.push("links.settlement: movimento e baixa referem contas diferentes.");
      }
      break;
    }
    case "index_value": {
      const [index] = relation(record, "correction_index", "index", context);
      const value = scaled(record.normalized.value, 6, true);
      if (index?.normalized.value_type === "index_number" && value !== null && value <= 0n) record.errors.push("value: índice numérico deve ser positivo.");
      if (index?.normalized.value_type === "percentage" && value !== null && value <= -100000000n) record.errors.push("value: taxa percentual deve ser superior a -100%.");
      break;
    }
    default: break;
  }
}

function inspectCoverage(input, context) {
  const entries = [];
  const keys = new Set();
  const recordGroups = new Map();
  for (const record of context.records) {
    const key = coverageIdentity(record);
    if (!recordGroups.has(key)) recordGroups.set(key, new Map());
    if (record.identity !== null) recordGroups.get(key).set(record.identity, record);
  }
  for (const [position, item] of input.entries()) {
    const value = object(item) ? item : {};
    const result = { ...value, entity: value.entity ?? null, sourceProjectId: value.sourceProjectId ?? null, collectedCount: 0, complete: false, errors: [], warnings: [] };
    if (!object(item)) result.errors.push(`coverage[${position}]: cobertura deve ser objeto.`);
    const key = coverageIdentity(result);
    if (keys.has(key)) result.errors.push("Cobertura repetida para entidade, obra e tipo de arquivo.");
    keys.add(key);
    if (!EOBRA_SNAPSHOT_ENTITIES.includes(value.entity)) result.errors.push("entity: entidade de cobertura desconhecida.");
    if (value.entity === "raw_archive" && !context.archiveTypes.has(value.archiveType)) result.errors.push("archiveType: tipo de arquivo não declarado.");
    if (value.entity !== "raw_archive" && value.archiveType != null) result.errors.push("archiveType: campo exclusivo de raw_archive.");
    if (result.sourceProjectId !== null && !context.projectIds.has(result.sourceProjectId)) result.errors.push("sourceProjectId: cobertura refere obra fora do escopo.");
    if (PROJECT_ENTITIES.has(value.entity) && result.sourceProjectId === null) result.errors.push("Cobertura desta entidade deve indicar uma obra explícita.");
    if (value.entity === "project" && result.sourceProjectId !== null) result.errors.push("Cobertura de project deve ser global, com sourceProjectId=null.");
    if (!object(value.filters)) result.errors.push("filters: preserve objeto com filtros reais, inclusive quando vazio.");
    if (typeof value.complete !== "boolean") result.errors.push("complete: declaração do coletor deve ser booleana.");
    const records = recordGroups.get(key) ?? new Map();
    result.collectedCount = records.size;
    if (value.collectedCount !== undefined && value.collectedCount !== records.size) result.errors.push("collectedCount: alegação não corresponde à quantidade de identidades distintas capturadas.");
    let matches = true;
    const incomplete = message => { matches = false; (value.complete === true ? result.errors : result.warnings).push(message); };
    for (const field of ["expectedCount", "expectedPages", "detailsExpected"]) {
      if (value[field] === null) incomplete(`${field}: expectativa desconhecida; cobertura não comprovada.`);
      else if (!Number.isSafeInteger(value[field]) || value[field] < 0) { result.errors.push(`${field}: informe inteiro não negativo ou null quando desconhecido.`); matches = false; }
    }
    if (Number.isSafeInteger(value.expectedCount) && value.expectedCount >= 0 && value.expectedCount !== records.size) {
      if (records.size > value.expectedCount) result.errors.push("expectedCount: mais registros coletados que o total declarado pela origem.");
      else incomplete("expectedCount: faltam registros para alcançar a contagem esperada.");
      matches = false;
    }
    const pages = Array.isArray(value.collectedPages) ? value.collectedPages : [];
    if (!Array.isArray(value.collectedPages) || pages.some(page => !Number.isSafeInteger(page) || page < 1) || new Set(pages).size !== pages.length) result.errors.push("collectedPages: páginas devem ser inteiros positivos distintos.");
    if (Number.isSafeInteger(value.expectedPages) && value.expectedPages >= 0) {
      if (pages.some(page => page > value.expectedPages)) result.errors.push("collectedPages: página além da quantidade esperada.");
      if (pages.length !== value.expectedPages || [...pages].sort((a, b) => a - b).some((page, index) => page !== index + 1)) incomplete("collectedPages: páginas faltantes ou sequência incompleta.");
      if (value.expectedPages === 0 && (records.size > 0 || value.expectedCount > 0)) result.errors.push("expectedPages: conjunto não vazio não pode declarar zero páginas.");
    }
    const details = Array.isArray(value.detailsCollected) ? value.detailsCollected : [];
    const ids = new Set([...records.values()].map(record => record.sourceId));
    if (!Array.isArray(value.detailsCollected) || details.some(detail => !id(detail)) || new Set(details).size !== details.length) result.errors.push("detailsCollected: informe IDs textuais distintos dos detalhes capturados.");
    if (details.some(detail => !ids.has(detail))) result.errors.push("detailsCollected: detalhe não pertence aos registros desta cobertura.");
    if (Number.isSafeInteger(value.detailsExpected) && value.detailsExpected >= 0) {
      if (details.length > value.detailsExpected) result.errors.push("detailsExpected: detalhes coletados excedem a expectativa declarada.");
      if (details.length !== value.detailsExpected) incomplete("detailsCollected: quantidade de detalhes não alcança a expectativa.");
      if (Number.isSafeInteger(value.expectedCount) && value.detailsExpected > value.expectedCount) result.errors.push("detailsExpected: quantidade supera o número de registros esperado.");
    }
    if (value.complete === false) result.warnings.push("Coletor declarou cobertura parcial; a inspeção não a promove automaticamente para completa.");
    result.complete = value.complete === true && matches && result.errors.length === 0;
    entries.push(result);
  }
  const missing = [];
  for (const entity of EOBRA_PRIORITY_ENTITIES) {
    if (PROJECT_ENTITIES.has(entity)) {
      for (const project of context.projectIds) if (!keys.has(coverageIdentity({ entity, sourceProjectId: project }))) missing.push(`${entity}/${project}`);
    } else if (entity === "project") {
      if (!keys.has(coverageIdentity({ entity, sourceProjectId: null }))) missing.push("project/global");
    } else if (!entries.some(entry => entry.entity === entity)) missing.push(`${entity}/inventário`);
  }
  for (const [key, group] of recordGroups) {
    if (!keys.has(key)) {
      const record = group.values().next().value;
      const label = `${record?.entity ?? "?"}/${record?.sourceProjectId ?? "global"}${record?.archiveType ? `/${record.archiveType}` : ""}`;
      missing.push(label);
      for (const record of group.values()) record.warnings.push("Registro sem cobertura correspondente; captura permanece incompleta.");
    }
  }
  for (const archiveType of context.archiveTypes) if (!entries.some(entry => entry.entity === "raw_archive" && entry.archiveType === archiveType)) missing.push(`raw_archive/${archiveType}/inventário`);
  const counts = new Map();
  for (const entry of entries) { const key = coverageIdentity(entry); counts.set(key, (counts.get(key) ?? 0) + 1); }
  for (const entry of entries) if (counts.get(coverageIdentity(entry)) > 1) { entry.complete = false; if (!entry.errors.includes("Cobertura repetida para entidade, obra e tipo de arquivo.")) entry.errors.push("Cobertura repetida para entidade, obra e tipo de arquivo."); }
  return { entries, missing: unique(missing) };
}

function validateGraph(context) {
  const parents = new Map();
  for (const record of context.records) {
    const link = record.links.find(link => object(link) && link.role === "parent");
    if (record.identity && link && context.byIdentity.has(identity(link))) parents.set(record.identity, identity(link));
  }
  const checked = new Set();
  for (const start of parents.keys()) {
    const path = [];
    const positions = new Map();
    let current = start;
    while (current && !checked.has(current)) {
      if (positions.has(current)) {
        for (const key of path.slice(positions.get(current))) context.byIdentity.get(key)?.errors.push("Hierarquia parent contém ciclo; origem precisa explicitar relações sem dependência circular.");
        break;
      }
      positions.set(current, path.length); path.push(current); current = parents.get(current);
    }
    for (const key of path) checked.add(key);
  }
}

function validateFinancial(context, coverage) {
  const eventsByTitle = new Map();
  const monthlyIndices = new Map();
  const seriesByIndex = new Map();
  const periodCache = new Map();
  const completeSettlements = new Set(coverage.filter(entry => entry.entity === "settlement" && entry.complete).map(entry => entry.sourceProjectId));
  for (const record of context.records) {
    if (record.entity === "settlement") {
      const target = record.links.find(link => object(link) && link.role === "installment" && ["receivable", "payable"].includes(link.entity));
      if (target) {
        const key = identity(target);
        if (!eventsByTitle.has(key)) eventsByTitle.set(key, []);
        eventsByTitle.get(key).push(record);
      }
    }
    if (record.entity === "index_value") {
      const link = record.links.find(link => object(link) && link.entity === "correction_index" && link.role === "index");
      if (link && month(record.normalized.reference_month)) {
        if (!seriesByIndex.has(link.sourceId)) seriesByIndex.set(link.sourceId, []);
        seriesByIndex.get(link.sourceId).push(record);
        const key = JSON.stringify([link.sourceId, record.normalized.reference_month]);
        if (monthlyIndices.has(key)) {
          record.errors.push("Competência de índice repetida; um índice não pode ter duas versões mensais no mesmo pacote.");
          monthlyIndices.get(key).errors.push("Competência de índice repetida; um índice não pode ter duas versões mensais no mesmo pacote.");
        } else monthlyIndices.set(key, record);
      }
    }
  }
  for (const record of context.records) {
    if (!["receivable", "payable"].includes(record.entity)) continue;
    const n = record.normalized;
    const sourceEvents = eventsByTitle.get(record.identity) ?? [];
    const events = sourceEvents.map(event => {
      const reverse = event.links.find(link => object(link) && link.entity === "settlement" && link.role === "reverses");
      const account = event.links.find(link => object(link) && link.entity === "bank_account" && link.role === "account");
      return { source_id: event.sourceId, kind: event.normalized.kind, amount: event.normalized.amount, occurred_on: event.normalized.occurred_on, medium: event.normalized.medium, ...(reverse ? { reverses_source_id: reverse.sourceId } : {}), ...(account ? { account_source_id: account.sourceId } : {}), ...(event.normalized.kind === "voided_payment" ? { voided_by_source_id: event.normalized.voided_by_source_id, voided_date_unknown: event.normalized.voided_date_unknown } : {}) };
    });
    let correction = n.correction;
    if (correction?.mode === "index_number" && correction.negative_variation_policy === "maximum_of_period" && correction.index_values === undefined) {
      const links = matchingLinks(record, "correction_index", "correction_index");
      if (links.length === 1 && month(correction.base_month) && month(correction.reference_month)) {
        const cacheKey = JSON.stringify([links[0].sourceId, correction.base_month, correction.reference_month]);
        if (!periodCache.has(cacheKey)) {
          const period = (seriesByIndex.get(links[0].sourceId) ?? []).filter(point => point.normalized.reference_month >= correction.base_month && point.normalized.reference_month <= correction.reference_month);
          periodCache.set(cacheKey, {
            points: period.map(point => ({ reference_month: point.normalized.reference_month, value: point.normalized.value })),
            valid: period.every(point => point.errors.length === 0),
          });
        }
        const period = periodCache.get(cacheKey);
        if (!period.valid) record.errors.push("correction: série mensal correspondente contém registros inválidos ou competências duplicadas.");
        // Resolve explicit source links for calculation only. Do not expand or
        // rewrite the parcel's normalized/raw payload with a repeated index series.
        correction = { ...correction, index_values: period.points };
      }
    }
    const reconciled = reconcileInstallmentFinancials({ ...n, correction, events, events_complete: completeSettlements.has(record.sourceProjectId) && sourceEvents.every(event => event.errors.length === 0) });
    record.errors.push(...reconciled.errors);
    record.warnings.push(...reconciled.warnings);
    if (reconciled.requires_partial_support && !record.promotionBlockers.some(message => message.includes("parcial"))) record.promotionBlockers.push("Baixa parcial preservada; promoção depende de suporte ao histórico e saldo parcial.");
    if (n.status === "open" && money(n.paid_amount) !== null && money(n.paid_amount) > 0n) record.errors.push("status: pagamento líquido positivo com saldo deve ser explicitamente partial, sem ocultar pagamento em aberto.");
    if (n.correction?.mode === "index_number") {
      const [index] = relation(record, "correction_index", "correction_index", context);
      if (index && index.normalized.value_type !== "index_number") record.errors.push("correction_index: política index_number exige índice do tipo index_number.");
      if (index) for (const prefix of ["base", "reference"]) {
        const point = monthlyIndices.get(JSON.stringify([index.sourceId, n.correction[`${prefix}_month`]]));
        if (!point) record.errors.push(`correction.${prefix}_month: valor mensal correspondente não foi capturado.`);
        else if (point.errors.length || scaled(point.normalized.value, 6, true) !== scaled(n.correction[`${prefix}_value`])) record.errors.push(`correction.${prefix}_value: valor diverge do cadastro mensal ou cadastro mensal inválido.`);
      }
      if (index && Array.isArray(n.correction.index_values)) for (const item of n.correction.index_values) {
        if (!object(item)) { record.errors.push("correction.index_values: ponto mensal inválido."); continue; }
        const point = monthlyIndices.get(JSON.stringify([index.sourceId, item.reference_month]));
        if (!point || point.errors.length || scaled(point.normalized.value, 6, true) !== scaled(item.value)) record.errors.push(`correction.index_values: competência ${item.reference_month ?? "?"} ausente ou divergente do cadastro mensal capturado.`);
      }
    } else if (n.correction?.mode === "none" && matchingLinks(record, "correction_index", "correction_index").length) record.errors.push("correction: política none contradiz vínculo de índice aplicável à parcela.");
  }
}

function emptySummary() {
  const totals = () => ({ rows: 0, totalsComplete: true, collectible_balance_amount: "0.00", ...Object.fromEntries(TOTAL_FIELDS.map(key => [key, "0.00"])) });
  return { records: 0, uniqueRecords: 0, validRecords: 0, blockedRecords: 0, archivedRecords: 0, promotionBlockedRecords: 0, history_dates_complete: true, byEntity: {}, coverage: { declared: 0, complete: 0, incomplete: 0, missing: 0 }, financial: { receivable: totals(), payable: totals() }, settlements: { rows: 0, totalsComplete: true, history_dates_complete: true, payment_amount: "0.00", reversal_amount: "0.00", net_amount: "0.00", voided_amount: "0.00", voided_count: 0 } };
}

function summarize(records, coverage, missing) {
  const summary = emptySummary();
  summary.records = records.length;
  const seen = new Set();
  const financial = { receivable: Object.fromEntries(TOTAL_FIELDS.map(key => [key, 0n])), payable: Object.fromEntries(TOTAL_FIELDS.map(key => [key, 0n])) };
  const collectible = { receivable: 0n, payable: 0n };
  let payments = 0n;
  let reversals = 0n;
  let voided = 0n;
  for (const record of records) {
    const entity = EOBRA_SNAPSHOT_ENTITIES.includes(record.entity) ? record.entity : "invalid";
    const stats = summary.byEntity[entity] ??= { records: 0, uniqueRecords: 0, valid: 0, blocked: 0, archived: 0, promotionBlocked: 0 };
    stats.records++;
    if (record.errors.length) { summary.blockedRecords++; stats.blocked++; } else { summary.validRecords++; stats.valid++; }
    if (record.disposition === "archived") { summary.archivedRecords++; stats.archived++; }
    if (record.promotionBlockers.length) { summary.promotionBlockedRecords++; stats.promotionBlocked++; }
    const repeated = record.identity !== null && seen.has(record.identity);
    if (record.identity !== null && !repeated) { summary.uniqueRecords++; stats.uniqueRecords++; seen.add(record.identity); }
    if (entity === "receivable" || entity === "payable") {
      const result = summary.financial[entity];
      if (record.errors.length || repeated) result.totalsComplete = false;
      if (!repeated) {
        result.rows++;
        for (const key of TOTAL_FIELDS) { const amount = money(record.normalized[key]); if (amount === null) result.totalsComplete = false; else financial[entity][key] += amount; }
        const historicalBalance = money(record.normalized.balance_amount);
        if (record.normalized.status !== "cancelled" && historicalBalance !== null) collectible[entity] += historicalBalance;
      }
    }
    if (entity === "settlement") {
      const result = summary.settlements;
      if (record.errors.length || repeated) result.totalsComplete = false;
      if (!date(record.normalized.occurred_on) || record.normalized.kind === "voided_payment") result.history_dates_complete = false;
      if (!repeated) {
        result.rows++;
        const amount = money(record.normalized.amount, { positive: true });
        if (amount === null || !["payment", "reversal", "voided_payment"].includes(record.normalized.kind)) result.totalsComplete = false;
        else if (record.normalized.kind === "payment") payments += amount;
        else if (record.normalized.kind === "reversal") reversals += amount;
        else { voided += amount; result.voided_count++; }
      }
    }
  }
  for (const entity of ["receivable", "payable"]) {
    for (const key of TOTAL_FIELDS) summary.financial[entity][key] = decimal(financial[entity][key]);
    summary.financial[entity].collectible_balance_amount = decimal(collectible[entity]);
  }
  summary.settlements.payment_amount = decimal(payments); summary.settlements.reversal_amount = decimal(reversals); summary.settlements.net_amount = decimal(payments - reversals);
  summary.settlements.voided_amount = decimal(voided);
  summary.coverage = { declared: coverage.length, complete: coverage.filter(entry => entry.complete).length, incomplete: coverage.filter(entry => !entry.complete).length, missing: missing.length };
  for (const entity of ["receivable", "payable"]) if (coverage.some(entry => entry.entity === entity && !entry.complete) || missing.some(label => label.startsWith(`${entity}/`))) summary.financial[entity].totalsComplete = false;
  if (coverage.some(entry => entry.entity === "settlement" && !entry.complete) || missing.some(label => label.startsWith("settlement/"))) { summary.settlements.totalsComplete = false; summary.settlements.history_dates_complete = false; }
  summary.history_dates_complete = summary.settlements.history_dates_complete;
  return summary;
}

function inputValue(input) {
  let value = input;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Pacote excede o limite de 200 MiB.");
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("Pacote JSON deve usar UTF-8 válido."); }
  }
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("Pacote excede o limite de 200 MiB.");
    try { value = JSON.parse(value.replace(/^\uFEFF/, "")); } catch { throw new Error("JSON inválido; não foi possível ler o pacote."); }
  }
  return JSON.parse(canonicalEobraJson(value));
}

/** Inspect untrusted source evidence without touching databases, clocks or network. */
export function inspectEobraSnapshot(input) {
  const report = { format: EOBRA_SNAPSHOT_FORMAT, source: {}, scope: { projectIds: [], allProjects: false }, archiveTypes: [], records: [], coverage: [], ok: false, complete: false, allProjectsComplete: false, snapshotHash: null, summary: emptySummary(), errors: [], warnings: [] };
  let data;
  try { data = inputValue(input); } catch (error) { report.errors.push(error instanceof Error ? error.message : "Pacote inválido."); return report; }
  if (!object(data)) { report.errors.push("O envelope do pacote deve ser um objeto JSON."); return report; }
  if (data.format !== EOBRA_SNAPSHOT_FORMAT) report.errors.push(`format: versão não suportada; esperado ${EOBRA_SNAPSHOT_FORMAT}.`);
  const source = object(data.source) ? data.source : {};
  const scope = object(data.scope) ? data.scope : {};
  report.source = source;
  report.scope = { ...scope, projectIds: Array.isArray(scope.projectIds) ? scope.projectIds : [], allProjects: scope.allProjects === true };
  if (typeof source.host !== "string" || source.host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(source.host)) report.errors.push("source.host: informe hostname canônico em minúsculas, sem URL, credenciais, porta ou caminho.");
  if (!timestamp(source.capturedAt)) report.errors.push("source.capturedAt: informe timestamp ISO válido com fuso explícito.");
  if (!date(source.referenceDate)) report.errors.push("source.referenceDate: informe data civil válida em AAAA-MM-DD.");
  if (typeof scope.allProjects !== "boolean") report.errors.push("scope.allProjects: informe booleano explícito.");
  if (!Array.isArray(scope.projectIds) || scope.projectIds.some(project => !id(project)) || new Set(scope.projectIds).size !== scope.projectIds.length) report.errors.push("scope.projectIds: informe IDs textuais distintos das obras declaradas.");
  const archiveTypes = Array.isArray(data.archiveTypes) ? data.archiveTypes : [];
  if (data.archiveTypes !== undefined && !Array.isArray(data.archiveTypes)) report.errors.push("archiveTypes: informe lista de tipos complementares documentados.");
  const archiveKeys = new Set();
  for (const item of archiveTypes) {
    if (!object(item) || !id(item.key) || typeof item.description !== "string" || !item.description.trim()) report.errors.push("archiveTypes: cada tipo exige key estável e descrição textual.");
    else if (archiveKeys.has(item.key)) report.errors.push("archiveTypes: chave de tipo complementar repetida.");
    else archiveKeys.add(item.key);
  }
  report.archiveTypes = archiveTypes;
  if (!Array.isArray(data.records)) report.errors.push("records: informe lista explícita de registros.");
  if (!Array.isArray(data.coverage)) report.errors.push("coverage: informe lista explícita de evidências de cobertura.");
  const records = Array.isArray(data.records) ? data.records : [];
  if (records.length > MAX_SNAPSHOT_RECORDS) { report.errors.push(`records: limite de ${MAX_SNAPSHOT_RECORDS} registros excedido.`); return report; }
  const context = { projectIds: new Set(report.scope.projectIds.filter(id)), archiveTypes: archiveKeys, records: [], byIdentity: new Map(), duplicateIdentities: new Set() };
  try {
    context.records = records.map((record, position) => prepareRecord(record, position, context));
    report.records = context.records;
    for (const record of context.records) {
      if (record.identity === null) continue;
      const existing = context.byIdentity.get(record.identity);
      if (existing) {
        const message = existing.recordHash === record.recordHash ? "Identidade repetida com conteúdo idêntico; remova a duplicata explicitamente antes da promoção." : "Identidade conflitante: mesmo ID de origem possui conteúdos diferentes no pacote.";
        record.errors.push(message); existing.errors.push(message); context.duplicateIdentities.add(record.identity);
      } else context.byIdentity.set(record.identity, record);
    }
    for (const projectId of context.projectIds) if (!context.byIdentity.has(identity({ entity: "project", sourceId: projectId }))) report.errors.push(`scope.projectIds: obra ${projectId} não foi capturada no catálogo project.`);
    for (const record of context.records) validateRelations(record, context);
    validateGraph(context);
    const coverage = inspectCoverage(Array.isArray(data.coverage) ? data.coverage : [], context);
    report.coverage = coverage.entries;
    validateFinancial(context, coverage.entries);
    for (const record of context.records) {
      record.errors = unique(record.errors); record.warnings = unique(record.warnings); record.promotionBlockers = unique(record.promotionBlockers);
      record.disposition = record.errors.length ? "blocked" : AUDIT_ENTITIES.has(record.entity) || (record.entity === "sale" && record.normalized.status === "draft") ? "archived" : record.promotionBlockers.length ? "blocked" : "candidate";
    }
    for (const entry of coverage.entries) { entry.errors = unique(entry.errors); entry.warnings = unique(entry.warnings); }
    if (coverage.missing.length) report.warnings.push(`Coberturas ausentes: ${coverage.missing.join(", ")}.`);
    report.summary = summarize(context.records, coverage.entries, coverage.missing);
    const content = {
      format: data.format ?? null, source, scope: { ...scope, projectIds: [...report.scope.projectIds].sort(compare) },
      archiveTypes: [...archiveTypes].sort((a, b) => compare(canonicalEobraJson(a), canonicalEobraJson(b))),
      coverage: (Array.isArray(data.coverage) ? data.coverage : []).map(value => object(value) ? { ...value, ...(Array.isArray(value.collectedPages) ? { collectedPages: [...value.collectedPages].sort((a, b) => a - b) } : {}), ...(Array.isArray(value.detailsCollected) ? { detailsCollected: [...value.detailsCollected].sort(compare) } : {}) } : value).sort((a, b) => compare(canonicalEobraJson(a), canonicalEobraJson(b))),
      records: context.records.map(record => ({ content: recordContent(record), key: `${record.identity ?? ""}/${record.recordHash ?? ""}` })).sort((a, b) => compare(a.key, b.key)).map(entry => entry.content),
    };
    report.snapshotHash = hashEobraValue(content);
    const recordErrors = context.records.reduce((count, record) => count + record.errors.length, 0);
    const coverageErrors = coverage.entries.reduce((count, entry) => count + entry.errors.length, 0);
    if (recordErrors) report.errors.push(`${report.summary.blockedRecords} registro(s) com erros; consulte errors de cada registro.`);
    if (coverageErrors) report.errors.push(`${coverage.entries.filter(entry => entry.errors.length).length} cobertura(s) com erros; consulte errors de cada cobertura.`);
    report.ok = report.errors.length === 0;
    report.complete = report.ok && coverage.missing.length === 0 && coverage.entries.every(entry => entry.complete);
    report.allProjectsComplete = report.complete && scope.allProjects === true;
  } catch (error) {
    report.errors.push(error instanceof Error ? `Inspeção interrompida: ${error.message}` : "Inspeção interrompida por pacote inválido.");
    report.ok = false; report.complete = false; report.allProjectsComplete = false;
  }
  report.errors = unique(report.errors); report.warnings = unique(report.warnings);
  return report;
}
