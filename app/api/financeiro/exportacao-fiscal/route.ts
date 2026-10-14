import ExcelJS from "exceljs";
import { resolveDateRange } from "@/lib/date-range";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRow = { id: string; code: string | null; name: string };
type SupplierRow = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type ServiceRow = { id: string; code: string; description: string };
type TaxTypeRow = { id: string; code: string; name: string; category: string };

type ManualInvoiceRow = {
  id: string;
  project_id: string;
  supplier_id: string;
  registry_number: string;
  status: string;
  document_type: string;
  document_number: string;
  series: string | null;
  issue_date: string;
  competence_date: string | null;
  gross_amount: number;
  item_discount_amount: number;
  inss_amount: number;
  iss_amount: number;
  irrf_amount: number;
  pis_amount: number;
  cofins_amount: number;
  csll_amount: number;
  other_retention_amount: number;
  total_retention_amount: number;
  net_amount: number;
};

type ManualItemRow = {
  invoice_id: string;
  service_id: string | null;
  service_code: string | null;
  service_name: string | null;
  total_amount: number;
};

type ElectronicInvoiceRow = {
  id: string;
  project_id: string;
  supplier_id: string;
  registry_number: string;
  status: string;
  access_key: string;
  model: string;
  series: string | null;
  invoice_number: string;
  issue_date: string;
  issuer_tax_id: string;
  issuer_name: string;
  issuer_trade_name: string | null;
  products_amount: number;
  freight_amount: number;
  insurance_amount: number;
  discount_amount: number;
  import_tax_amount: number;
  ipi_amount: number;
  pis_amount: number;
  cofins_amount: number;
  icms_amount: number;
  other_amount: number;
  invoice_total: number;
  payment_total: number;
};

type ElectronicItemRow = {
  invoice_id: string;
  cost_center_service_id: string | null;
  description: string;
  total_amount: number;
};

type InstallmentRow = { invoice_id: string; due_date: string };

type TaxObligationRow = {
  id: string;
  project_id: string;
  tax_type_id: string;
  manual_invoice_id: string | null;
  retention_key: string | null;
  competence_date: string;
  reference: string;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
  penalty_amount: number;
  other_amount: number;
  discount_amount: number;
  total_amount: number;
  document_number: string | null;
  payment_code: string | null;
  status: string;
  paid_at: string | null;
  paid_amount: number | null;
};

type AllocationPart = {
  serviceId: string | null;
  code: string;
  name: string;
  amount: number;
  percent: number;
};

const documentTypeLabels: Record<string, string> = {
  service_invoice: "Nota de serviço",
  transport: "Transporte / frete",
  rent: "Locação",
  reimbursement: "Reembolso",
  utility: "Concessionária / consumo",
  tax_document: "Guia ou documento tributário",
  receipt: "Recibo",
  other: "Outro documento",
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  approved: "Aprovado",
  review: "Em conferência",
  rejected: "Rejeitado",
  open: "Em aberto",
  scheduled: "Programado",
  payable_generated: "Conta gerada",
  paid: "Pago",
  cancelled: "Cancelado",
};

const retentionLabels: Record<string, string> = {
  inss: "INSS",
  iss: "ISS",
  irrf: "IRRF",
  pis: "PIS",
  cofins: "COFINS",
  csll: "CSLL",
  other: "Outro",
};

function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function dateBR(value: string | null | undefined) {
  const clean = cleanDate(value);
  if (!clean) return "";
  const [year, month, day] = clean.split("-");
  return `${day}/${month}/${year}`;
}

function number(value: number | null | undefined) {
  return Number(value ?? 0);
}

function inRange(value: string, from: string, to: string) {
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function supplierName(supplier: SupplierRow | undefined) {
  return supplier?.trade_name || supplier?.legal_name || "Fornecedor não identificado";
}

function projectName(project: ProjectRow | undefined) {
  if (!project) return "Obra não identificada";
  return project.code ? `${project.code} · ${project.name}` : project.name;
}

function groupAllocation(parts: Array<{ serviceId: string | null; code: string; name: string; amount: number }>): AllocationPart[] {
  const grouped = new Map<string, { serviceId: string | null; code: string; name: string; amount: number }>();
  for (const part of parts) {
    const key = part.serviceId || `${part.code}|${part.name}`;
    const current = grouped.get(key) ?? { serviceId: part.serviceId, code: part.code, name: part.name, amount: 0 };
    current.amount += Math.max(0, number(part.amount));
    grouped.set(key, current);
  }
  const rows = [...grouped.values()];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows.map((row) => ({ ...row, percent: total > 0 ? row.amount / total : 0 }));
}

function allocationSummary(parts: AllocationPart[]) {
  if (!parts.length) return "SEM-APROPRIAÇÃO";
  return parts
    .map((part) => `${part.code} · ${part.name} — ${(part.percent * 100).toFixed(2).replace(".", ",")}%`)
    .join(" | ");
}

function dueDates(rows: InstallmentRow[]) {
  return [...new Set(rows.map((row) => cleanDate(row.due_date)).filter(Boolean))]
    .sort()
    .map(dateBR)
    .join(" | ");
}

function styleSheet(sheet: ExcelJS.Worksheet, moneyColumns: string[], percentColumns: string[] = []) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A45" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  for (const key of moneyColumns) sheet.getColumn(key).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  for (const key of percentColumns) sheet.getColumn(key).numFmt = "0.00%";
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top" };
  });
}

export async function GET(request: Request) {
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("reports.view");
  const params = new URL(request.url).searchParams;
  const dateRange = resolveDateRange(params.get("period") ?? undefined, params.get("from") ?? undefined, params.get("to") ?? undefined);
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;

  const manualInvoicesPromise = fetchAllRows<ManualInvoiceRow>(async (from, to) => {
    let query = supabase
      .from("finance_manual_invoices")
      .select("id,project_id,supplier_id,registry_number,status,document_type,document_number,series,issue_date,competence_date,gross_amount,item_discount_amount,inss_amount,iss_amount,irrf_amount,pis_amount,cofins_amount,csll_amount,other_retention_amount,total_retention_amount,net_amount")
      .eq("company_id", companyId)
      .neq("status", "cancelled");
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.order("issue_date", { ascending: true }).range(from, to);
    return { data: (data ?? []) as ManualInvoiceRow[], error };
  });

  const manualItemsPromise = fetchAllRows<ManualItemRow>(async (from, to) => {
    let query = supabase
      .from("finance_manual_invoice_items")
      .select("invoice_id,service_id,service_code,service_name,total_amount")
      .eq("company_id", companyId);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.range(from, to);
    return { data: (data ?? []) as ManualItemRow[], error };
  });

  const manualInstallmentsPromise = fetchAllRows<InstallmentRow>(async (from, to) => {
    let query = supabase
      .from("finance_manual_invoice_installments")
      .select("invoice_id,due_date")
      .eq("company_id", companyId);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.range(from, to);
    return { data: (data ?? []) as InstallmentRow[], error };
  });

  const electronicInvoicesPromise = fetchAllRows<ElectronicInvoiceRow>(async (from, to) => {
    let query = supabase
      .from("finance_electronic_invoices")
      .select("id,project_id,supplier_id,registry_number,status,access_key,model,series,invoice_number,issue_date,issuer_tax_id,issuer_name,issuer_trade_name,products_amount,freight_amount,insurance_amount,discount_amount,import_tax_amount,ipi_amount,pis_amount,cofins_amount,icms_amount,other_amount,invoice_total,payment_total")
      .eq("company_id", companyId)
      .neq("status", "cancelled");
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.order("issue_date", { ascending: true }).range(from, to);
    return { data: (data ?? []) as ElectronicInvoiceRow[], error };
  });

  const electronicItemsPromise = fetchAllRows<ElectronicItemRow>(async (from, to) => {
    let query = supabase
      .from("finance_electronic_invoice_items")
      .select("invoice_id,cost_center_service_id,description,total_amount")
      .eq("company_id", companyId);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.range(from, to);
    return { data: (data ?? []) as ElectronicItemRow[], error };
  });

  const electronicInstallmentsPromise = fetchAllRows<InstallmentRow>(async (from, to) => {
    let query = supabase
      .from("finance_electronic_invoice_installments")
      .select("invoice_id,due_date")
      .eq("company_id", companyId);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.range(from, to);
    return { data: (data ?? []) as InstallmentRow[], error };
  });

  const taxObligationsPromise = fetchAllRows<TaxObligationRow>(async (from, to) => {
    let query = supabase
      .from("finance_tax_obligations")
      .select("id,project_id,tax_type_id,manual_invoice_id,retention_key,competence_date,reference,due_date,principal_amount,interest_amount,penalty_amount,other_amount,discount_amount,total_amount,document_number,payment_code,status,paid_at,paid_amount")
      .eq("company_id", companyId)
      .neq("status", "cancelled");
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query.order("due_date", { ascending: true }).range(from, to);
    return { data: (data ?? []) as TaxObligationRow[], error };
  });

  const [
    manualInvoicesResult,
    manualItemsResult,
    manualInstallmentsResult,
    electronicInvoicesResult,
    electronicItemsResult,
    electronicInstallmentsResult,
    taxObligationsResult,
    suppliersResult,
    projectsResult,
    servicesResult,
    taxTypesResult,
  ] = await Promise.all([
    manualInvoicesPromise,
    manualItemsPromise,
    manualInstallmentsPromise,
    electronicInvoicesPromise,
    electronicItemsPromise,
    electronicInstallmentsPromise,
    taxObligationsPromise,
    fetchAllRows<SupplierRow>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).range(from, to);
      return { data: (data ?? []) as SupplierRow[], error };
    }),
    fetchAllRows<ProjectRow>(async (from, to) => {
      let query = supabase.from("projects").select("id,code,name").eq("company_id", companyId);
      if (projectId) query = query.eq("id", projectId);
      const { data, error } = await query.range(from, to);
      return { data: (data ?? []) as ProjectRow[], error };
    }),
    fetchAllRows<ServiceRow>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_services").select("id,code,description").eq("company_id", companyId).range(from, to);
      return { data: (data ?? []) as ServiceRow[], error };
    }),
    fetchAllRows<TaxTypeRow>(async (from, to) => {
      const { data, error } = await supabase.from("finance_tax_types").select("id,code,name,category").eq("company_id", companyId).range(from, to);
      return { data: (data ?? []) as TaxTypeRow[], error };
    }),
  ]);

  const errors = [
    manualInvoicesResult.error,
    manualItemsResult.error,
    manualInstallmentsResult.error,
    electronicInvoicesResult.error,
    electronicItemsResult.error,
    electronicInstallmentsResult.error,
    taxObligationsResult.error,
    suppliersResult.error,
    projectsResult.error,
    servicesResult.error,
    taxTypesResult.error,
  ].filter(Boolean);
  if (errors.length) {
    return Response.json({ error: "Não foi possível consolidar os dados fiscais para exportação." }, { status: 500 });
  }

  const suppliers = new Map(suppliersResult.data.map((row) => [row.id, row]));
  const projects = new Map(projectsResult.data.map((row) => [row.id, row]));
  const services = new Map(servicesResult.data.map((row) => [row.id, row]));
  const taxTypes = new Map(taxTypesResult.data.map((row) => [row.id, row]));
  const manualItemsByInvoice = new Map<string, ManualItemRow[]>();
  const electronicItemsByInvoice = new Map<string, ElectronicItemRow[]>();
  const manualInstallmentsByInvoice = new Map<string, InstallmentRow[]>();
  const electronicInstallmentsByInvoice = new Map<string, InstallmentRow[]>();

  for (const item of manualItemsResult.data) manualItemsByInvoice.set(item.invoice_id, [...(manualItemsByInvoice.get(item.invoice_id) ?? []), item]);
  for (const item of electronicItemsResult.data) electronicItemsByInvoice.set(item.invoice_id, [...(electronicItemsByInvoice.get(item.invoice_id) ?? []), item]);
  for (const item of manualInstallmentsResult.data) manualInstallmentsByInvoice.set(item.invoice_id, [...(manualInstallmentsByInvoice.get(item.invoice_id) ?? []), item]);
  for (const item of electronicInstallmentsResult.data) electronicInstallmentsByInvoice.set(item.invoice_id, [...(electronicInstallmentsByInvoice.get(item.invoice_id) ?? []), item]);

  const manualInvoices = manualInvoicesResult.data.filter((invoice) => inRange(cleanDate(invoice.competence_date || invoice.issue_date), dateFrom, dateTo));
  const electronicInvoices = electronicInvoicesResult.data.filter((invoice) => inRange(cleanDate(invoice.issue_date), dateFrom, dateTo));
  const manualInvoiceById = new Map(manualInvoicesResult.data.map((invoice) => [invoice.id, invoice]));
  const manualAllocationById = new Map<string, AllocationPart[]>();
  const electronicAllocationById = new Map<string, AllocationPart[]>();

  for (const invoice of manualInvoicesResult.data) {
    const parts = (manualItemsByInvoice.get(invoice.id) ?? []).map((item) => ({
      serviceId: item.service_id,
      code: item.service_code || "SEM-APROPRIAÇÃO",
      name: item.service_name || "Sem apropriação",
      amount: number(item.total_amount),
    }));
    manualAllocationById.set(invoice.id, groupAllocation(parts));
  }

  for (const invoice of electronicInvoicesResult.data) {
    const parts = (electronicItemsByInvoice.get(invoice.id) ?? []).map((item) => {
      const service = item.cost_center_service_id ? services.get(item.cost_center_service_id) : undefined;
      return {
        serviceId: item.cost_center_service_id,
        code: service?.code || "SEM-APROPRIAÇÃO",
        name: service?.description || (item.cost_center_service_id ? item.description : "Sem apropriação"),
        amount: number(item.total_amount),
      };
    });
    electronicAllocationById.set(invoice.id, groupAllocation(parts));
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Elos OS";
  workbook.company = company.name;
  workbook.subject = "Exportação fiscal e contábil com apropriação de obra";
  workbook.created = new Date();

  const documents = workbook.addWorksheet("Documentos fiscais");
  documents.columns = [
    { header: "Origem", key: "origin", width: 18 },
    { header: "Registro Elos", key: "registry", width: 18 },
    { header: "Competência", key: "competence", width: 14 },
    { header: "Emissão", key: "issue", width: 14 },
    { header: "Obra", key: "project", width: 30 },
    { header: "CNPJ/CPF fornecedor", key: "taxId", width: 21 },
    { header: "Fornecedor", key: "supplier", width: 36 },
    { header: "Tipo", key: "type", width: 22 },
    { header: "Número", key: "number", width: 18 },
    { header: "Série", key: "series", width: 10 },
    { header: "Chave de acesso", key: "accessKey", width: 48 },
    { header: "Valor bruto/produtos", key: "gross", width: 19 },
    { header: "Frete", key: "freight", width: 14 },
    { header: "Descontos", key: "discount", width: 14 },
    { header: "Valor do documento", key: "documentTotal", width: 19 },
    { header: "Líquido fornecedor", key: "net", width: 18 },
    { header: "INSS retido", key: "inss", width: 15 },
    { header: "ISS retido", key: "iss", width: 15 },
    { header: "IRRF retido", key: "irrf", width: 15 },
    { header: "PIS retido", key: "pisRet", width: 15 },
    { header: "COFINS retido", key: "cofinsRet", width: 16 },
    { header: "CSLL retido", key: "csll", width: 15 },
    { header: "Outras retenções", key: "otherRet", width: 18 },
    { header: "ICMS destacado", key: "icms", width: 17 },
    { header: "IPI destacado", key: "ipi", width: 16 },
    { header: "PIS destacado", key: "pis", width: 16 },
    { header: "COFINS destacado", key: "cofins", width: 18 },
    { header: "II destacado", key: "importTax", width: 15 },
    { header: "Apropriação obra/fiscal", key: "allocation", width: 62 },
    { header: "Vencimentos fornecedor", key: "dueDates", width: 28 },
    { header: "Situação", key: "status", width: 18 },
  ];

  for (const invoice of manualInvoices) {
    const supplier = suppliers.get(invoice.supplier_id);
    documents.addRow({
      origin: "Lançamento manual",
      registry: invoice.registry_number,
      competence: dateBR(invoice.competence_date || invoice.issue_date),
      issue: dateBR(invoice.issue_date),
      project: projectName(projects.get(invoice.project_id)),
      taxId: supplier?.tax_id || "",
      supplier: supplierName(supplier),
      type: documentTypeLabels[invoice.document_type] || invoice.document_type,
      number: invoice.document_number,
      series: invoice.series || "",
      accessKey: "",
      gross: number(invoice.gross_amount),
      freight: 0,
      discount: number(invoice.item_discount_amount),
      documentTotal: number(invoice.gross_amount) - number(invoice.item_discount_amount),
      net: number(invoice.net_amount),
      inss: number(invoice.inss_amount),
      iss: number(invoice.iss_amount),
      irrf: number(invoice.irrf_amount),
      pisRet: number(invoice.pis_amount),
      cofinsRet: number(invoice.cofins_amount),
      csll: number(invoice.csll_amount),
      otherRet: number(invoice.other_retention_amount),
      icms: 0,
      ipi: 0,
      pis: 0,
      cofins: 0,
      importTax: 0,
      allocation: allocationSummary(manualAllocationById.get(invoice.id) ?? []),
      dueDates: dueDates(manualInstallmentsByInvoice.get(invoice.id) ?? []),
      status: statusLabels[invoice.status] || invoice.status,
    });
  }

  for (const invoice of electronicInvoices) {
    documents.addRow({
      origin: "NF-e XML",
      registry: invoice.registry_number,
      competence: dateBR(invoice.issue_date),
      issue: dateBR(invoice.issue_date),
      project: projectName(projects.get(invoice.project_id)),
      taxId: invoice.issuer_tax_id,
      supplier: invoice.issuer_trade_name || invoice.issuer_name,
      type: `NF-e modelo ${invoice.model}`,
      number: invoice.invoice_number,
      series: invoice.series || "",
      accessKey: invoice.access_key,
      gross: number(invoice.products_amount),
      freight: number(invoice.freight_amount),
      discount: number(invoice.discount_amount),
      documentTotal: number(invoice.invoice_total),
      net: number(invoice.payment_total || invoice.invoice_total),
      inss: 0,
      iss: 0,
      irrf: 0,
      pisRet: 0,
      cofinsRet: 0,
      csll: 0,
      otherRet: 0,
      icms: number(invoice.icms_amount),
      ipi: number(invoice.ipi_amount),
      pis: number(invoice.pis_amount),
      cofins: number(invoice.cofins_amount),
      importTax: number(invoice.import_tax_amount),
      allocation: allocationSummary(electronicAllocationById.get(invoice.id) ?? []),
      dueDates: dueDates(electronicInstallmentsByInvoice.get(invoice.id) ?? []),
      status: statusLabels[invoice.status] || invoice.status,
    });
  }

  styleSheet(documents, ["gross", "freight", "discount", "documentTotal", "net", "inss", "iss", "irrf", "pisRet", "cofinsRet", "csll", "otherRet", "icms", "ipi", "pis", "cofins", "importTax"]);

  const allocations = workbook.addWorksheet("Rateio fiscal");
  allocations.columns = [
    { header: "Origem", key: "origin", width: 18 },
    { header: "Registro Elos", key: "registry", width: 18 },
    { header: "Competência", key: "competence", width: 14 },
    { header: "Obra", key: "project", width: 30 },
    { header: "Documento", key: "document", width: 22 },
    { header: "Fornecedor", key: "supplier", width: 36 },
    { header: "Centro de custo / serviço", key: "code", width: 24 },
    { header: "Descrição da apropriação", key: "service", width: 46 },
    { header: "Percentual", key: "percent", width: 14 },
    { header: "Base dos itens", key: "itemBase", width: 16 },
    { header: "Valor documento apropriado", key: "documentAllocated", width: 24 },
    { header: "INSS apropriado", key: "inss", width: 17 },
    { header: "ISS apropriado", key: "iss", width: 17 },
    { header: "IRRF apropriado", key: "irrf", width: 17 },
    { header: "PIS retido apropriado", key: "pisRet", width: 21 },
    { header: "COFINS retido apropriado", key: "cofinsRet", width: 24 },
    { header: "CSLL apropriado", key: "csll", width: 17 },
    { header: "Outras retenções apropriadas", key: "otherRet", width: 28 },
    { header: "ICMS destacado apropriado", key: "icms", width: 25 },
    { header: "IPI destacado apropriado", key: "ipi", width: 24 },
    { header: "PIS destacado apropriado", key: "pis", width: 24 },
    { header: "COFINS destacado apropriado", key: "cofins", width: 27 },
  ];

  for (const invoice of manualInvoices) {
    const supplier = suppliers.get(invoice.supplier_id);
    const parts = manualAllocationById.get(invoice.id) ?? [];
    const documentTotal = number(invoice.gross_amount) - number(invoice.item_discount_amount);
    for (const part of parts) {
      allocations.addRow({
        origin: "Lançamento manual",
        registry: invoice.registry_number,
        competence: dateBR(invoice.competence_date || invoice.issue_date),
        project: projectName(projects.get(invoice.project_id)),
        document: `${invoice.document_number}${invoice.series ? `/${invoice.series}` : ""}`,
        supplier: supplierName(supplier),
        code: part.code,
        service: part.name,
        percent: part.percent,
        itemBase: part.amount,
        documentAllocated: documentTotal * part.percent,
        inss: number(invoice.inss_amount) * part.percent,
        iss: number(invoice.iss_amount) * part.percent,
        irrf: number(invoice.irrf_amount) * part.percent,
        pisRet: number(invoice.pis_amount) * part.percent,
        cofinsRet: number(invoice.cofins_amount) * part.percent,
        csll: number(invoice.csll_amount) * part.percent,
        otherRet: number(invoice.other_retention_amount) * part.percent,
        icms: 0,
        ipi: 0,
        pis: 0,
        cofins: 0,
      });
    }
  }

  for (const invoice of electronicInvoices) {
    const parts = electronicAllocationById.get(invoice.id) ?? [];
    for (const part of parts) {
      allocations.addRow({
        origin: "NF-e XML",
        registry: invoice.registry_number,
        competence: dateBR(invoice.issue_date),
        project: projectName(projects.get(invoice.project_id)),
        document: `${invoice.invoice_number}${invoice.series ? `/${invoice.series}` : ""}`,
        supplier: invoice.issuer_trade_name || invoice.issuer_name,
        code: part.code,
        service: part.name,
        percent: part.percent,
        itemBase: part.amount,
        documentAllocated: number(invoice.invoice_total) * part.percent,
        inss: 0,
        iss: 0,
        irrf: 0,
        pisRet: 0,
        cofinsRet: 0,
        csll: 0,
        otherRet: 0,
        icms: number(invoice.icms_amount) * part.percent,
        ipi: number(invoice.ipi_amount) * part.percent,
        pis: number(invoice.pis_amount) * part.percent,
        cofins: number(invoice.cofins_amount) * part.percent,
      });
    }
  }

  styleSheet(allocations, ["itemBase", "documentAllocated", "inss", "iss", "irrf", "pisRet", "cofinsRet", "csll", "otherRet", "icms", "ipi", "pis", "cofins"], ["percent"]);

  const taxes = workbook.addWorksheet("Impostos e guias");
  taxes.columns = [
    { header: "Competência", key: "competence", width: 14 },
    { header: "Vencimento", key: "due", width: 14 },
    { header: "Obra", key: "project", width: 30 },
    { header: "Tributo", key: "tax", width: 26 },
    { header: "Categoria", key: "category", width: 16 },
    { header: "Documento origem", key: "sourceDocument", width: 22 },
    { header: "Fornecedor origem", key: "supplier", width: 36 },
    { header: "Referência", key: "reference", width: 42 },
    { header: "Documento/guia", key: "taxDocument", width: 22 },
    { header: "Código pagamento", key: "paymentCode", width: 20 },
    { header: "Principal", key: "principal", width: 15 },
    { header: "Juros", key: "interest", width: 13 },
    { header: "Multa", key: "penalty", width: 13 },
    { header: "Outros", key: "other", width: 13 },
    { header: "Desconto", key: "discount", width: 13 },
    { header: "Total", key: "total", width: 15 },
    { header: "Situação", key: "status", width: 18 },
    { header: "Pago em", key: "paidAt", width: 14 },
    { header: "Valor pago", key: "paidAmount", width: 15 },
    { header: "Apropriação herdada", key: "allocation", width: 62 },
  ];

  const taxObligations = taxObligationsResult.data.filter((obligation) => inRange(cleanDate(obligation.competence_date), dateFrom, dateTo));
  for (const obligation of taxObligations) {
    const taxType = taxTypes.get(obligation.tax_type_id);
    const invoice = obligation.manual_invoice_id ? manualInvoiceById.get(obligation.manual_invoice_id) : undefined;
    const supplier = invoice ? suppliers.get(invoice.supplier_id) : undefined;
    const retention = obligation.retention_key ? retentionLabels[obligation.retention_key] : null;
    taxes.addRow({
      competence: dateBR(obligation.competence_date),
      due: dateBR(obligation.due_date),
      project: projectName(projects.get(obligation.project_id)),
      tax: taxType ? `${taxType.code} · ${taxType.name}` : retention || "Tributo",
      category: taxType?.category || "",
      sourceDocument: invoice ? `${invoice.document_number}${invoice.series ? `/${invoice.series}` : ""}` : "",
      supplier: supplierName(supplier),
      reference: obligation.reference,
      taxDocument: obligation.document_number || "",
      paymentCode: obligation.payment_code || "",
      principal: number(obligation.principal_amount),
      interest: number(obligation.interest_amount),
      penalty: number(obligation.penalty_amount),
      other: number(obligation.other_amount),
      discount: number(obligation.discount_amount),
      total: number(obligation.total_amount),
      status: statusLabels[obligation.status] || obligation.status,
      paidAt: dateBR(obligation.paid_at),
      paidAmount: number(obligation.paid_amount),
      allocation: invoice ? allocationSummary(manualAllocationById.get(invoice.id) ?? []) : "",
    });
  }

  styleSheet(taxes, ["principal", "interest", "penalty", "other", "discount", "total", "paidAmount"]);

  const notes = workbook.addWorksheet("Leia-me");
  notes.columns = [{ width: 30 }, { width: 110 }];
  notes.addRow(["Exportação", "Elos OS · Fiscal / Contabilidade"]);
  notes.addRow(["Empresa", company.name]);
  notes.addRow(["Período", `${dateBR(dateFrom)} a ${dateBR(dateTo)}`]);
  notes.addRow(["Regra de apropriação", "A apropriação fiscal é derivada do mesmo serviço/centro de custo utilizado pela obra. Não existe uma segunda classificação fiscal paralela."]);
  notes.addRow(["Retenções", "INSS, ISS, IRRF, PIS, COFINS, CSLL e outras retenções dos lançamentos manuais aparecem como retenções e, quando configuradas, também constam na aba Impostos e guias."]);
  notes.addRow(["NF-e XML", "ICMS, IPI, PIS, COFINS e II provenientes do XML são exibidos como tributos destacados da nota. Eles não são tratados automaticamente como retenções do tomador."]);
  notes.addRow(["Rateio fiscal", "O percentual é calculado pela participação de cada serviço/centro de custo no total dos itens do documento; o mesmo percentual é aplicado aos valores fiscais para facilitar a entrega à contabilidade."]);
  notes.addRow(["Atenção", "Linhas SEM-APROPRIAÇÃO indicam documento ou item que precisa ter o centro de custo revisado antes do fechamento contábil."]);
  notes.getRow(1).font = { bold: true, size: 14 };
  notes.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  notes.eachRow((row) => { row.alignment = { ...row.alignment, vertical: "top" }; });

  const buffer = await workbook.xlsx.writeBuffer();
  const body = new Uint8Array(buffer as ArrayBuffer);
  const projectLabel = projectId ? (projects.get(projectId)?.code || "obra") : "todas-obras";
  const fileName = `elos-fiscal-${projectLabel}-${dateFrom || "inicio"}-${dateTo || "fim"}.xlsx`.replace(/[^a-zA-Z0-9_.-]+/g, "-");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
