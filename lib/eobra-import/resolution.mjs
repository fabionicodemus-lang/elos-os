const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const digits = (value) => text(value).replace(/\D/g, "");

export function isUuid(value) { return UUID.test(text(value)); }

/** Identifies a source instance only. No request is made to this host. */
export function normalizeSourceHost(value) {
  let host = text(value).toLowerCase();
  if (host.startsWith("https://")) {
    const url = new URL(host);
    if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Informe somente o endereço do ambiente eObra, sem senha, caminho ou parâmetros.");
    }
    host = url.hostname;
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.eobra\.com\.br$/.test(host)) {
    throw new Error("Informe o ambiente de origem, como empresa.eobra.com.br.");
  }
  return host;
}

export function validateReferenceDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Informe a data de referência da exportação.");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("A data de referência é inválida.");
  }
  return date;
}

export function buildProjectBinding(rows, projectId, confirmed, sourceProjectMapped) {
  if (!isUuid(projectId) || confirmed !== true) {
    throw new Error("Selecione a obra e confirme que o arquivo contém somente os dados dessa obra.");
  }
  const references = new Map();
  for (const row of rows) {
    const reference = text(row.normalized_data.source_project);
    if (reference) references.set(reference.toLocaleLowerCase("pt-BR").replace(/\s+/g, " "), reference);
    else if (sourceProjectMapped) {
      row.errors.push("A obra de origem está vazia nesta linha. Preencha ou exporte o relatório filtrado por obra.");
    }
  }
  if (references.size > 1) {
    throw new Error("O arquivo contém mais de uma obra de origem. Exporte um arquivo por obra para conferir os vínculos e os totais separadamente.");
  }
  return { source_reference: [...references.values()][0] ?? null, project_id: projectId, confirmed: true };
}

function add(map, key, value) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), value]);
}

/** Only exact identities are used; names never decide the owner of a financial title. */
export function resolveFinancialRows(rows, options) {
  const { companyId, projectId, sourceHost, entityKind } = options;
  const suppliers = (options.suppliers ?? []).filter((row) => row.company_id === companyId);
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const supplierByTax = new Map();
  suppliers.forEach((row) => add(supplierByTax, digits(row.tax_id), row));
  const supplierByExternal = new Map();
  for (const link of options.supplierLinks ?? []) {
    if (link.company_id !== companyId || link.source_host !== sourceHost || link.scope_id !== companyId || link.entity_kind !== "supplier") continue;
    const supplier = supplierById.get(link.target_id);
    if (supplier) add(supplierByExternal, text(link.external_id), supplier);
  }
  const salesByReference = new Map();
  for (const sale of options.sales ?? []) {
    if (sale.company_id !== companyId || sale.project_id !== projectId) continue;
    const references = new Set([sale.id, sale.number, sale.contract_number, sale.source_code].map(text).filter(Boolean));
    if (sale.source_system === "eobra") {
      const sourceId = text(sale.source_id);
      if (sourceId.startsWith(`${sourceHost}|${projectId}|`)) references.add(sourceId.slice(`${sourceHost}|${projectId}|`.length));
      references.add(sourceId);
    }
    for (const reference of references) add(salesByReference, reference, sale);
  }
  const clientsById = new Map((options.clients ?? []).filter((row) => row.company_id === companyId).map((row) => [row.id, row]));
  const unitsById = new Map((options.units ?? []).filter((row) => row.company_id === companyId && row.project_id === projectId).map((row) => [row.id, row]));

  return rows.map((source) => {
    const row = { ...source, normalized_data: { ...source.normalized_data }, errors: [...source.errors], warnings: [...source.warnings] };
    const data = row.normalized_data;
    // IDs supplied in a workbook are never trusted as canonical relationships.
    for (const key of ["supplier_id", "sale_id", "client_id", "unit_id", "resolved_counterparty_name", "resolved_sale_number"]) delete data[key];
    if (entityKind === "payable") {
      const externalId = text(data.counterparty_external_id);
      const taxId = digits(data.counterparty_tax_id);
      const byExternal = supplierByExternal.get(externalId) ?? [];
      const byTax = supplierByTax.get(taxId) ?? [];
      const candidates = new Map([...byExternal, ...byTax].map((candidate) => [candidate.id, candidate]));
      if (byExternal.length > 1 || byTax.length > 1 || candidates.size > 1) {
        row.errors.push("O fornecedor é ambíguo ou o ID e o documento apontam para cadastros diferentes.");
      } else if (candidates.size === 1) {
        const supplier = [...candidates.values()][0];
        if (taxId && digits(supplier.tax_id) && digits(supplier.tax_id) !== taxId) {
          row.errors.push("O documento do fornecedor difere do vínculo já importado. Revise antes de continuar.");
        } else {
          data.supplier_id = supplier.id;
          data.resolved_counterparty_name = supplier.legal_name;
        }
      } else if (text(data.counterparty_name)) {
        row.warnings.push("O beneficiário será preservado pelo nome/documento informado; ainda não há vínculo com um fornecedor cadastrado.");
      } else {
        row.errors.push("Informe o beneficiário ou importe o fornecedor antes deste título.");
      }
    } else if (entityKind === "receivable") {
      const reference = text(data.sale_reference);
      const candidates = new Map((salesByReference.get(reference) ?? []).map((sale) => [sale.id, sale]));
      if (!reference || candidates.size === 0) {
        row.errors.push("A venda não foi localizada nesta obra. Cadastre ou associe a venda e a unidade antes de importar o recebível.");
      } else if (candidates.size !== 1) {
        row.errors.push("A referência da venda corresponde a mais de um contrato. Informe uma referência única.");
      } else {
        const sale = [...candidates.values()][0];
        const client = clientsById.get(sale.client_id);
        const unit = unitsById.get(sale.unit_id);
        const taxId = digits(data.counterparty_tax_id);
        if (!client || !unit || sale.status === "cancelled") {
          row.errors.push("A venda não possui cliente e unidade válidos nesta empresa/obra, ou está cancelada.");
        } else if (taxId && digits(client.tax_id) !== taxId) {
          row.errors.push("O documento do cliente da exportação não corresponde ao cliente da venda.");
        } else {
          data.sale_id = sale.id;
          data.client_id = client.id;
          data.unit_id = unit.id;
          data.resolved_sale_number = sale.number;
          data.resolved_counterparty_name = client.name;
        }
      }
    }
    row.errors = [...new Set(row.errors)];
    row.warnings = [...new Set(row.warnings)];
    return row;
  });
}
