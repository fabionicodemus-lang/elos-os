import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { removeManualInvoiceDocument, uploadManualInvoiceDocuments } from "./actions";
import { ManualInvoiceDeleteButton } from "./manual-invoice-delete-button";
import {
  ManualInvoiceDialog,
  type ManualContractItemOption,
  type ManualContractOption,
  type ManualInvoiceInitial,
  type ManualMeasurementItemOption,
  type ManualMeasurementOption,
  type ManualReceiptOption,
  type ManualServiceOption,
  type ManualSupplierOption,
} from "./manual-invoice-dialog";
import {
  ManualRetentionRuleDialog,
  type ManualRetentionRuleOption,
} from "./manual-retention-rule-dialog";
import "../../finance-manual-invoices.css";

type Project = { id: string; code: string | null; name: string; legal_entity_id: string | null };
type SupplierRelation = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type ContractRelation = { id: string; contract_number: string; title: string };
type MeasurementRelation = { id: string; measurement_number: string };
type PayableRelation = {
  id: string;
  document: string | null;
  status: "open" | "paid" | "cancelled";
  due_date: string;
  amount: number;
  paid_at: string | null;
  paid_amount: number | null;
};
type TaxTypeRelation = {
  id: string;
  code: string;
  name: string;
  authority_supplier_id: string;
  suppliers: SupplierRelation | SupplierRelation[] | null;
};
type ManualInvoice = {
  id: string; supplier_id: string; contract_id: string | null; measurement_id: string | null; material_receipt_id: string | null;
  registry_number: string; status: string; document_type: string; document_number: string; series: string | null;
  issue_date: string; competence_date: string | null; gross_amount: number; item_discount_amount: number;
  inss_amount: number; iss_amount: number; irrf_amount: number; pis_amount: number; cofins_amount: number;
  csll_amount: number; other_retention_amount: number; total_retention_amount: number; net_amount: number;
  payment_total: number; item_count: number; notes: string | null; posted_at: string | null; approved_at: string | null;
  cancellation_reason: string | null;
  suppliers: SupplierRelation | SupplierRelation[] | null;
  execution_service_contracts: ContractRelation | ContractRelation[] | null;
  execution_contract_measurements: MeasurementRelation | MeasurementRelation[] | null;
};
type ManualItem = {
  id: string; invoice_id: string; service_id: string; contract_item_id: string | null; measurement_item_id: string | null;
  line_number: number; service_code: string; service_name: string; description: string | null; unit_snapshot: string;
  quantity: number; unit_price: number; gross_amount: number; discount_amount: number; total_amount: number; notes: string | null;
};
type ManualInstallment = {
  id: string; invoice_id: string; sequence_no: number; installment_label: string; due_date: string;
  amount: number; payment_method: string | null; payable_id: string | null;
  payables: PayableRelation | PayableRelation[] | null;
};
type ManualTaxObligation = {
  id: string;
  retention_key: string | null;
  due_date: string;
  competence_date: string;
  principal_amount: number;
  total_amount: number;
  status: "scheduled" | "payable_generated" | "paid" | "cancelled";
  payable_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  finance_tax_types: TaxTypeRelation | TaxTypeRelation[] | null;
  payables: PayableRelation | PayableRelation[] | null;
};
type ManualDocument = {
  id: string; invoice_id: string; document_type: string; storage_path: string; file_name: string;
  mime_type: string | null; file_size: number | null; caption: string | null; uploaded_at: string; signed_url: string | null;
};
type Mutability = { mutable: boolean; has_payment: boolean; has_receipt: boolean; reason: string | null };
type SearchParams = { invoice?: string; q?: string; status?: string; type?: string; success?: string; error?: string };

const STATUS: Record<string, string> = {
  draft: "Rascunho legado",
  submitted: "Pendente legado",
  approved: "Lançada",
  rejected: "Devolvida legado",
  cancelled: "Cancelada",
};
const TYPES: Record<string, string> = {
  service_invoice: "Nota de serviço", transport: "Transporte / frete", rent: "Locação", reimbursement: "Reembolso",
  utility: "Concessionária / consumo", tax_document: "Guia tributária", receipt: "Recibo", other: "Outro documento",
};
const DOCUMENT_TYPES: Record<string, string> = {
  invoice: "Nota / documento", receipt: "Recibo", contract: "Contrato", measurement: "Medição", tax: "Tributo", evidence: "Evidência", other: "Outro",
};
const RETENTION_LABELS: Record<string, string> = {
  inss: "INSS", iss: "ISS", irrf: "IRRF", pis: "PIS", cofins: "COFINS", csll: "CSLL", other: "Outro imposto",
};
const TAX_STATUS: Record<string, string> = {
  scheduled: "Na agenda", payable_generated: "Conta gerada", paid: "Pago", cancelled: "Cancelado",
};

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0)); }
function number(value: number | null | undefined, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0)); }
function dateBR(value: string | null | undefined) { if (!value) return "—"; const [year, month, day] = value.slice(0, 10).split("-"); return `${day}/${month}/${year}`; }
function monthBR(value: string | null | undefined) { if (!value) return "—"; const [year, month] = value.slice(0, 7).split("-"); return `${month}/${year}`; }
function dateTimeBR(value: string | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function fileSize(value: number | null) { if (!value) return "—"; if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }

function resolveTaxRules(rows: ManualRetentionRuleOption[], projectId: string | null) {
  const resolved = new Map<string, ManualRetentionRuleOption>();
  for (const row of [...rows].sort((a, b) => Number(Boolean(b.project_id === projectId)) - Number(Boolean(a.project_id === projectId)))) {
    if (!resolved.has(row.retention_key)) resolved.set(row.retention_key, row);
  }
  return [...resolved.values()];
}

export default async function ManualInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.manual_invoices.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const projectResult = projectId
    ? await supabase.from("projects").select("id,code,name,legal_entity_id").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : { data: null, error: null };
  const project = projectResult.data as Project | null;

  const [
    invoicesResult, suppliersResult, servicesResult, contractsResult, measurementsResult,
    contractItemsResult, measurementItemsResult, receiptsResult, electronicReceiptLinksResult,
    taxRulesResult, manageResult, taxesManageResult,
  ] = await Promise.all([
    projectId ? fetchAllRows<ManualInvoice>(async (from, to) => {
      const { data, error } = await supabase.from("finance_manual_invoices")
        .select("id,supplier_id,contract_id,measurement_id,material_receipt_id,registry_number,status,document_type,document_number,series,issue_date,competence_date,gross_amount,item_discount_amount,inss_amount,iss_amount,irrf_amount,pis_amount,cofins_amount,csll_amount,other_retention_amount,total_retention_amount,net_amount,payment_total,item_count,notes,posted_at,approved_at,cancellation_reason,suppliers(id,legal_name,trade_name,tax_id),execution_service_contracts(id,contract_number,title),execution_contract_measurements(id,measurement_number)")
        .eq("company_id", companyId).eq("project_id", projectId).order("issue_date", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as unknown as ManualInvoice[], error };
    }) : Promise.resolve({ data: [] as ManualInvoice[], error: null }),
    fetchAllRows<ManualSupplierOption>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to); return { data: (data ?? []) as ManualSupplierOption[], error }; }),
    fetchAllRows<ManualServiceOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("code").range(from, to); return { data: (data ?? []) as ManualServiceOption[], error }; }),
    projectId ? fetchAllRows<ManualContractOption>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contracts").select("id,supplier_id,contract_number,title,status,current_value").eq("company_id", companyId).eq("project_id", projectId).neq("status", "cancelled").order("created_at", { ascending: false }).range(from, to); return { data: (data ?? []) as ManualContractOption[], error }; }) : Promise.resolve({ data: [] as ManualContractOption[], error: null }),
    projectId ? fetchAllRows<ManualMeasurementOption>(async (from, to) => { const { data, error } = await supabase.from("execution_contract_measurements").select("id,contract_id,supplier_id,measurement_number,period_start,period_end,status,gross_amount,net_amount,tax_withholding_amount,total_deductions").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").is("payable_id", null).order("period_end", { ascending: false }).range(from, to); return { data: (data ?? []) as ManualMeasurementOption[], error }; }) : Promise.resolve({ data: [] as ManualMeasurementOption[], error: null }),
    projectId ? fetchAllRows<ManualContractItemOption>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ManualContractItemOption[], error }; }) : Promise.resolve({ data: [] as ManualContractItemOption[], error: null }),
    projectId ? fetchAllRows<ManualMeasurementItemOption>(async (from, to) => { const { data, error } = await supabase.from("execution_contract_measurement_items").select("id,measurement_id,contract_item_id,service_code,service_name,location_name,unit_snapshot,current_quantity,unit_price,current_amount").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ManualMeasurementItemOption[], error }; }) : Promise.resolve({ data: [] as ManualMeasurementItemOption[], error: null }),
    projectId ? fetchAllRows<ManualReceiptOption>(async (from, to) => { const { data, error } = await supabase.from("procurement_material_receipts").select("id,supplier_id,receipt_number,receipt_date,invoice_number,invoice_amount,status").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").order("receipt_date", { ascending: false }).range(from, to); return { data: (data ?? []) as ManualReceiptOption[], error }; }) : Promise.resolve({ data: [] as ManualReceiptOption[], error: null }),
    projectId ? supabase.from("finance_electronic_invoices").select("receipt_id").eq("company_id", companyId).eq("project_id", projectId).neq("status", "cancelled").not("receipt_id", "is", null) : Promise.resolve({ data: [], error: null }),
    supabase.from("finance_tax_types").select("id,project_id,retention_key,code,name,authority_supplier_id,fiscal_class,payment_method,document_prefix,due_trigger,due_rule,due_day,due_month_offset,due_days_after_event,business_day_adjustment,suppliers(legal_name,trade_name)").eq("company_id", companyId).eq("status", "active").not("retention_key", "is", null).order("updated_at", { ascending: false }).limit(500),
    permission("finance.manual_invoices.manage"), permission("finance.taxes.manage"),
  ]);

  const invoices = invoicesResult.data;
  const selected = params.invoice ? invoices.find((invoice) => invoice.id === params.invoice) ?? null : null;
  const linkedReceiptIds = new Set(invoices.map((invoice) => invoice.material_receipt_id).filter(Boolean));
  for (const row of (electronicReceiptLinksResult.data ?? []) as { receipt_id: string | null }[]) if (row.receipt_id) linkedReceiptIds.add(row.receipt_id);
  const availableReceipts = receiptsResult.data.filter((receipt) => !linkedReceiptIds.has(receipt.id));
  const taxRuleRows = ((taxRulesResult.data ?? []) as unknown as Array<ManualRetentionRuleOption & { suppliers?: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null }>).map(({ suppliers, ...row }) => ({
    ...row,
    authority_name: relatedOne(suppliers)?.trade_name || relatedOne(suppliers)?.legal_name || null,
  }));
  const taxRules = resolveTaxRules(taxRuleRows, projectId);

  let items: ManualItem[] = [];
  let installments: ManualInstallment[] = [];
  let documents: ManualDocument[] = [];
  let taxObligations: ManualTaxObligation[] = [];
  let mutability: Mutability = { mutable: false, has_payment: false, has_receipt: false, reason: "Nota não selecionada." };

  if (selected && projectId) {
    const [itemsResult, installmentsResult, documentsResult, taxesResult, mutabilityResult] = await Promise.all([
      supabase.from("finance_manual_invoice_items").select("id,invoice_id,service_id,contract_item_id,measurement_item_id,line_number,service_code,service_name,description,unit_snapshot,quantity,unit_price,gross_amount,discount_amount,total_amount,notes").eq("invoice_id", selected.id).order("line_number"),
      supabase.from("finance_manual_invoice_installments").select("id,invoice_id,sequence_no,installment_label,due_date,amount,payment_method,payable_id,payables(id,document,status,due_date,amount,paid_at,paid_amount)").eq("invoice_id", selected.id).order("sequence_no"),
      supabase.from("finance_manual_invoice_documents").select("id,invoice_id,document_type,storage_path,file_name,mime_type,file_size,caption,uploaded_at").eq("invoice_id", selected.id).order("uploaded_at", { ascending: false }),
      supabase.from("finance_tax_obligations").select("id,retention_key,due_date,competence_date,principal_amount,total_amount,status,payable_id,paid_at,paid_amount,finance_tax_types(id,code,name,authority_supplier_id,suppliers(id,legal_name,trade_name,tax_id)),payables(id,document,status,due_date,amount,paid_at,paid_amount)").eq("manual_invoice_id", selected.id).order("due_date"),
      supabase.rpc("manual_invoice_mutability", { p_company_id: companyId, p_project_id: projectId, p_invoice_id: selected.id }),
    ]);
    items = (itemsResult.data ?? []) as ManualItem[];
    installments = (installmentsResult.data ?? []) as unknown as ManualInstallment[];
    taxObligations = (taxesResult.data ?? []) as unknown as ManualTaxObligation[];
    mutability = (mutabilityResult.data ?? mutability) as Mutability;
    documents = await Promise.all(((documentsResult.data ?? []) as Omit<ManualDocument, "signed_url">[]).map(async (document) => {
      const signed = await supabase.storage.from("manual-invoice-documents").createSignedUrl(document.storage_path, 3600);
      return { ...document, signed_url: signed.data?.signedUrl ?? null };
    }));
  }

  const schemaMissing = invoicesResult.error?.code === "42P01" || invoicesResult.error?.message.includes("finance_manual_invoices");
  const canManage = manageResult.data === true || privileged;
  const canManageTaxes = taxesManageResult.data === true || privileged;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = invoices
    .filter((invoice) => !params.status || invoice.status === params.status)
    .filter((invoice) => !params.type || invoice.document_type === params.type)
    .filter((invoice) => !query || [invoice.registry_number, invoice.document_number, invoice.series, relatedOne(invoice.suppliers)?.legal_name, relatedOne(invoice.suppliers)?.trade_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const activeInvoices = invoices.filter((invoice) => invoice.status !== "cancelled");
  const postedInvoices = invoices.filter((invoice) => invoice.status === "approved");
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const commonDialogProps = {
    suppliers: suppliersResult.data,
    services: servicesResult.data,
    contracts: contractsResult.data,
    measurements: measurementsResult.data,
    contractItems: contractItemsResult.data,
    measurementItems: measurementItemsResult.data,
    receipts: availableReceipts,
    taxRules,
  };

  return <AppShell
    activeGroup="finance"
    activeItem="manual-invoices"
    eyebrow="Financeiro · Documentos sem XML"
    title="Notas Manuais"
    description={`${company.name} · ${context} · lançamento direto, impostos retidos e integração automática com Contas a Pagar.`}
    actions={project && !schemaMissing ? <>
      {canManageTaxes ? <ManualRetentionRuleDialog projectId={project.id} projectLabel={context} suppliers={suppliersResult.data} rules={taxRules} /> : null}
      {canManage ? <ManualInvoiceDialog {...commonDialogProps} /> : null}
    </> : undefined}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura das Notas Manuais</h2><p>Execute as migrations do módulo financeiro até a versão 0064.</p></section> : null}
    {!projectId ? <section className="manual-empty-state">Selecione uma obra no topo para lançar e acompanhar documentos manuais.</section> : null}

    {projectId && selected ? <ManualInvoiceDetail
      invoice={selected}
      items={items}
      installments={installments}
      documents={documents}
      taxObligations={taxObligations}
      materialReceipt={receiptsResult.data.find((receipt) => receipt.id === selected.material_receipt_id) ?? null}
      mutability={mutability}
      canManage={canManage}
      dialogProps={commonDialogProps}
    /> : projectId && !schemaMissing ? <>
      <section className="manual-kpis">
        <article><span>Notas ativas</span><strong>{activeInvoices.length}</strong><small>{invoices.length} registros no histórico</small></article>
        <article><span>Lançadas</span><strong>{postedInvoices.length}</strong><small>sem etapa de aprovação</small></article>
        <article><span>Valor líquido</span><strong>{money(postedInvoices.reduce((sum, invoice) => sum + Number(invoice.net_amount), 0))}</strong><small>parcelas dos fornecedores</small></article>
        <article><span>Impostos retidos</span><strong>{money(postedInvoices.reduce((sum, invoice) => sum + Number(invoice.total_retention_amount), 0))}</strong><small>obrigações tributárias geradas</small></article>
        <article><span>Com recebimento</span><strong>{activeInvoices.filter((invoice) => invoice.material_receipt_id).length}</strong><small>edição e exclusão bloqueadas</small></article>
      </section>

      <section className="manual-toolbar">
        <form method="get">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Fornecedor, documento ou registro" />
          <select name="type" defaultValue={params.type ?? ""}><option value="">Todos os tipos</option>{Object.entries(TYPES).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
          <select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(STATUS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
          <button type="submit">Filtrar</button><Link href="/financeiro/notas-manuais">Limpar</Link>
        </form>
      </section>

      <section className="manual-list-panel">
        <div className="section-heading"><div><span>Documentos financeiros</span><h2>Notas e lançamentos manuais</h2></div><p>{filtered.length} documento(s)</p></div>
        <div className="registry-table-wrap"><table className="registry-table manual-table"><thead><tr><th>Emissão</th><th>Documento</th><th>Fornecedor</th><th>Origem</th><th>Bruto</th><th>Impostos</th><th>Líquido</th><th>Status</th></tr></thead><tbody>
          {filtered.map((invoice) => {
            const supplier = relatedOne(invoice.suppliers); const contract = relatedOne(invoice.execution_service_contracts); const measurement = relatedOne(invoice.execution_contract_measurements);
            return <tr key={invoice.id}>
              <td>{dateBR(invoice.issue_date)}<span>{invoice.registry_number}</span></td>
              <td><Link href={`?invoice=${invoice.id}`}><strong>{invoice.document_number}{invoice.series ? `/${invoice.series}` : ""}</strong><span>{TYPES[invoice.document_type] ?? invoice.document_type}</span><small>{invoice.item_count} item(ns)</small></Link></td>
              <td><strong>{supplier?.trade_name || supplier?.legal_name || "Fornecedor"}</strong><span>{supplier?.tax_id || "—"}</span></td>
              <td>{invoice.material_receipt_id ? <span className="manual-origin-pill measurement">Recebimento</span> : measurement ? <span className="manual-origin-pill measurement">{measurement.measurement_number}</span> : contract ? <span className="manual-origin-pill">{contract.contract_number}</span> : "Sem vínculo"}</td>
              <td>{money(invoice.gross_amount)}</td><td>{money(invoice.total_retention_amount)}</td><td><strong>{money(invoice.net_amount)}</strong></td>
              <td><span className={`manual-status ${invoice.status}`}>{STATUS[invoice.status] ?? invoice.status}</span></td>
            </tr>;
          })}
          {!filtered.length ? <tr><td colSpan={8} className="empty-table">Nenhum documento encontrado.</td></tr> : null}
        </tbody></table></div>
      </section>
    </> : null}
  </AppShell>;
}

function ManualInvoiceDetail({ invoice, items, installments, documents, taxObligations, materialReceipt, mutability, canManage, dialogProps }: {
  invoice: ManualInvoice;
  items: ManualItem[];
  installments: ManualInstallment[];
  documents: ManualDocument[];
  taxObligations: ManualTaxObligation[];
  materialReceipt: ManualReceiptOption | null;
  mutability: Mutability;
  canManage: boolean;
  dialogProps: {
    suppliers: ManualSupplierOption[]; services: ManualServiceOption[]; contracts: ManualContractOption[];
    measurements: ManualMeasurementOption[]; contractItems: ManualContractItemOption[]; measurementItems: ManualMeasurementItemOption[];
    receipts: ManualReceiptOption[]; taxRules: ManualRetentionRuleOption[];
  };
}) {
  const supplier = relatedOne(invoice.suppliers);
  const contract = relatedOne(invoice.execution_service_contracts);
  const measurement = relatedOne(invoice.execution_contract_measurements);
  const initial: ManualInvoiceInitial = {
    id: invoice.id, supplier_id: invoice.supplier_id, contract_id: invoice.contract_id, measurement_id: invoice.measurement_id,
    material_receipt_id: invoice.material_receipt_id, document_type: invoice.document_type, document_number: invoice.document_number,
    series: invoice.series, issue_date: invoice.issue_date, competence_date: invoice.competence_date, notes: invoice.notes,
    inss_amount: invoice.inss_amount, iss_amount: invoice.iss_amount, irrf_amount: invoice.irrf_amount, pis_amount: invoice.pis_amount,
    cofins_amount: invoice.cofins_amount, csll_amount: invoice.csll_amount, other_retention_amount: invoice.other_retention_amount,
    items: items.map((item) => ({ id: item.id, service_id: item.service_id, contract_item_id: item.contract_item_id ?? "", measurement_item_id: item.measurement_item_id ?? "", description: item.description ?? "", unit: item.unit_snapshot, quantity: Number(item.quantity), unit_price: Number(item.unit_price), discount_amount: Number(item.discount_amount), notes: item.notes ?? "" })),
    installments: installments.map((row) => ({ id: row.id, label: row.installment_label, due_date: row.due_date, amount: Number(row.amount), payment_method: row.payment_method ?? "Boleto" })),
  };
  const editable = canManage && mutability.mutable;

  return <>
    <div className="manual-back"><Link href="/financeiro/notas-manuais">← Voltar às notas</Link><span>{invoice.registry_number}</span></div>
    <section className="manual-detail-hero">
      <div><span>{TYPES[invoice.document_type] ?? invoice.document_type}</span><h2>{invoice.document_number}{invoice.series ? `/${invoice.series}` : ""} · {supplier?.trade_name || supplier?.legal_name || "Fornecedor"}</h2><p>Emissão {dateBR(invoice.issue_date)} · competência {dateBR(invoice.competence_date)} · lançada {dateTimeBR(invoice.posted_at || invoice.approved_at)}</p></div>
      <div>
        {editable ? <ManualInvoiceDialog {...dialogProps} initial={initial} label="Editar nota" /> : null}
        {editable ? <ManualInvoiceDeleteButton invoiceId={invoice.id} registryNumber={invoice.registry_number} /> : null}
        {!mutability.mutable && mutability.reason ? <span className="manual-pending-label" title={mutability.reason}>Alterações bloqueadas</span> : null}
        <span className={`manual-status ${invoice.status}`}>{STATUS[invoice.status] ?? invoice.status}</span>
      </div>
    </section>

    {!mutability.mutable && mutability.reason ? <div className="auth-message error workspace-message"><strong>Esta nota não pode ser editada nem excluída:</strong> {mutability.reason}</div> : null}
    {invoice.status !== "approved" && mutability.mutable ? <div className="auth-message success workspace-message">Este é um registro do fluxo antigo. Clique em <strong>Editar nota</strong> e salve para gerar os lançamentos sem aprovação.</div> : null}

    <section className="manual-detail-kpis">
      <article><span>Valor bruto</span><strong>{money(invoice.gross_amount)}</strong><small>{invoice.item_count} item(ns)</small></article>
      <article><span>Descontos</span><strong>{money(invoice.item_discount_amount)}</strong><small>aplicados nos itens</small></article>
      <article><span>Impostos retidos</span><strong>{money(invoice.total_retention_amount)}</strong><small>{taxObligations.length} obrigação(ões)</small></article>
      <article><span>Valor líquido</span><strong>{money(invoice.net_amount)}</strong><small>a pagar ao fornecedor</small></article>
      <article><span>Parcelas</span><strong>{installments.length}</strong><small>{money(invoice.payment_total)}</small></article>
      <article><span>Anexos</span><strong>{documents.length}</strong><small>arquivos privados</small></article>
    </section>

    <section className="manual-detail-grid">
      <article className="manual-card"><div className="manual-card-title"><div><span>Identificação</span><h3>Documento e fornecedor</h3></div></div><dl>
        <div><dt>Fornecedor</dt><dd>{supplier?.legal_name || "—"}</dd></div><div><dt>CNPJ/CPF</dt><dd>{supplier?.tax_id || "—"}</dd></div><div><dt>Registro Elos</dt><dd>{invoice.registry_number}</dd></div>
        <div><dt>Contrato</dt><dd>{contract ? `${contract.contract_number} · ${contract.title}` : "Sem vínculo"}</dd></div><div><dt>Medição</dt><dd>{measurement?.measurement_number || "Sem vínculo"}</dd></div><div><dt>Competência</dt><dd>{dateBR(invoice.competence_date)}</dd></div>
        <div><dt>Recebimento</dt><dd>{materialReceipt ? `${materialReceipt.receipt_number} · ${dateBR(materialReceipt.receipt_date)}` : "Sem vínculo"}</dd></div>
      </dl>{invoice.notes ? <p className="manual-notes">{invoice.notes}</p> : null}</article>
      <article className="manual-card"><div className="manual-card-title"><div><span>Retenções</span><h3>Composição dos impostos</h3></div><strong>{money(invoice.total_retention_amount)}</strong></div><dl className="manual-tax-list">
        <div><dt>INSS</dt><dd>{money(invoice.inss_amount)}</dd></div><div><dt>ISS</dt><dd>{money(invoice.iss_amount)}</dd></div><div><dt>IRRF</dt><dd>{money(invoice.irrf_amount)}</dd></div><div><dt>PIS</dt><dd>{money(invoice.pis_amount)}</dd></div><div><dt>COFINS</dt><dd>{money(invoice.cofins_amount)}</dd></div><div><dt>CSLL</dt><dd>{money(invoice.csll_amount)}</dd></div><div><dt>Outro imposto</dt><dd>{money(invoice.other_retention_amount)}</dd></div>
      </dl></article>
    </section>

    <section className="manual-list-panel"><div className="section-heading"><div><span>Rateio orçamentário</span><h2>Itens por serviço / centro de custo</h2></div><p>{items.length} item(ns)</p></div><div className="registry-table-wrap"><table className="registry-table manual-items-table"><thead><tr><th>Serviço</th><th>Descrição</th><th>Quantidade</th><th>Valor unitário</th><th>Bruto</th><th>Desconto</th><th>Total</th><th>Origem</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td><strong>{item.service_code}</strong><span>{item.service_name}</span></td><td>{item.description || "—"}</td><td>{number(item.quantity)} {item.unit_snapshot}</td><td>{money(item.unit_price)}</td><td>{money(item.gross_amount)}</td><td>{money(item.discount_amount)}</td><td><strong>{money(item.total_amount)}</strong></td><td>{item.measurement_item_id ? "Medição" : item.contract_item_id ? "Contrato" : "Manual"}</td></tr>)}
    </tbody></table></div></section>

    <section className="manual-detail-grid">
      <article className="manual-card"><div className="manual-card-title"><div><span>Fornecedor</span><h3>Parcelas no Contas a Pagar</h3></div><strong>{money(invoice.payment_total)}</strong></div><div className="manual-installment-detail-list">
        {installments.map((row) => { const payable = relatedOne(row.payables); return <div key={row.id}><div><strong>{row.installment_label}</strong><span>Vencimento {dateBR(row.due_date)}</span></div><div><strong>{money(row.amount)}</strong><span>{row.payment_method || "Não informado"}</span></div>{payable ? <Link href="/financeiro/contas-a-pagar">{payable.status === "paid" ? `Pago em ${dateBR(payable.paid_at)}` : payable.status === "open" ? "Em aberto" : "Cancelado"}</Link> : <span className="manual-pending-label">Título ainda não gerado</span>}</div>; })}
      </div></article>

      <article className="manual-card"><div className="manual-card-title"><div><span>Tributos</span><h3>Obrigações dos impostos retidos</h3></div><strong>{money(taxObligations.reduce((sum, row) => sum + Number(row.total_amount), 0))}</strong></div><div className="manual-installment-detail-list">
        {taxObligations.map((obligation) => {
          const type = relatedOne(obligation.finance_tax_types); const authority = relatedOne(type?.suppliers ?? null); const payable = relatedOne(obligation.payables);
          return <div key={obligation.id}><div><strong>{type?.code || RETENTION_LABELS[obligation.retention_key ?? ""] || "Imposto"}</strong><span>{type?.name || RETENTION_LABELS[obligation.retention_key ?? ""]} · competência {monthBR(obligation.competence_date)}</span><small>{authority?.trade_name || authority?.legal_name || "Órgão não informado"}</small></div><div><strong>{money(obligation.total_amount)}</strong><span>Vencimento {dateBR(obligation.due_date)}</span></div><Link href="/financeiro/impostos">{payable?.status === "paid" || obligation.status === "paid" ? "Pago" : TAX_STATUS[obligation.status] ?? obligation.status}</Link></div>;
        })}
        {!taxObligations.length ? <p className="manual-muted">A nota não possui impostos retidos.</p> : null}
      </div></article>
    </section>

    <section className="manual-detail-grid">
      <article className="manual-card"><div className="manual-card-title"><div><span>Documentos privados</span><h3>Anexos</h3></div><strong>{documents.length}</strong></div>
        {canManage && invoice.status !== "cancelled" ? <form className="manual-upload-form" action={uploadManualInvoiceDocuments} encType="multipart/form-data"><input type="hidden" name="invoice_id" value={invoice.id} /><select name="document_type" defaultValue="invoice">{Object.entries(DOCUMENT_TYPES).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><input name="caption" placeholder="Descrição do anexo" /><input name="documents" type="file" multiple required /><button type="submit">Enviar anexos</button></form> : null}
        <div className="manual-document-list">{documents.map((document) => <div key={document.id}><div><strong>{document.file_name}</strong><span>{DOCUMENT_TYPES[document.document_type] ?? document.document_type} · {fileSize(document.file_size)} · {dateTimeBR(document.uploaded_at)}</span>{document.caption ? <small>{document.caption}</small> : null}</div><div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{editable ? <form action={removeManualInvoiceDocument}><input type="hidden" name="invoice_id" value={invoice.id} /><input type="hidden" name="document_id" value={document.id} /><button type="submit">Remover</button></form> : null}</div></div>)}{!documents.length ? <p className="manual-muted">Nenhum arquivo anexado.</p> : null}</div>
      </article>
      <article className="manual-card"><div className="manual-card-title"><div><span>Proteção do lançamento</span><h3>Edição e exclusão</h3></div></div><dl>
        <div><dt>Pagamento vinculado</dt><dd>{mutability.has_payment ? "Sim · bloqueado" : "Não"}</dd></div>
        <div><dt>Recebimento vinculado</dt><dd>{mutability.has_receipt ? "Sim · bloqueado" : "Não"}</dd></div>
        <div><dt>Situação</dt><dd>{mutability.mutable ? "Pode editar e excluir" : "Protegida contra alterações"}</dd></div>
      </dl><p className="manual-notes">A nota só pode ser alterada enquanto todas as parcelas e impostos estiverem sem pagamento e não houver recebimento de material vinculado.</p></article>
    </section>
  </>;
}
