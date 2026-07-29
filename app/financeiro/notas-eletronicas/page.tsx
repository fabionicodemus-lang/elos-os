import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  approveElectronicInvoice,
  cancelElectronicInvoice,
  rejectElectronicInvoice,
  resolveInvoiceDivergence,
} from "./actions";
import {
  InvoiceImportDialog,
  type InvoiceInputOption,
  type InvoiceLegalEntityOption,
  type InvoiceOrderItemOption,
  type InvoiceOrderOption,
  type InvoiceReceiptItemOption,
  type InvoiceReceiptOption,
  type InvoiceSupplierOption,
} from "./invoice-import-dialog";
import "../../finance-electronic-invoices.css";

type Project = { id: string; code: string | null; name: string; legal_entity_id: string | null };
type Invoice = {
  id: string;
  supplier_id: string;
  order_id: string | null;
  receipt_id: string | null;
  registry_number: string;
  status: string;
  validation_status: string;
  access_key: string;
  model: string;
  series: string | null;
  invoice_number: string;
  issue_date: string;
  operation_nature: string | null;
  issuer_tax_id: string;
  issuer_name: string;
  issuer_trade_name: string | null;
  recipient_tax_id: string | null;
  recipient_name: string | null;
  products_amount: number;
  freight_amount: number;
  discount_amount: number;
  icms_amount: number;
  ipi_amount: number;
  invoice_total: number;
  payment_total: number;
  item_count: number;
  mapped_item_count: number;
  divergence_count: number;
  xml_storage_path: string;
  xml_file_name: string;
  imported_at: string;
  approved_at: string | null;
  approval_notes: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  suppliers: InvoiceSupplierOption | InvoiceSupplierOption[] | null;
};
type InvoiceItem = {
  id: string;
  invoice_id: string;
  line_number: number;
  supplier_product_code: string | null;
  ean: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit_snapshot: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  input_id: string | null;
  mapping_status: string;
  order_quantity: number | null;
  order_unit_price: number | null;
  quantity_variance: number | null;
  unit_price_variance: number | null;
  engineering_inputs: { code: string; description: string; unit: string } | { code: string; description: string; unit: string }[] | null;
};
type Installment = {
  id: string;
  invoice_id: string;
  sequence_no: number;
  installment_label: string;
  due_date: string;
  amount: number;
  payment_method: string | null;
  payable_id: string | null;
};
type Divergence = {
  id: string;
  invoice_id: string;
  invoice_item_id: string | null;
  divergence_type: string;
  severity: string;
  title: string;
  description: string;
  expected_value: string | null;
  actual_value: string | null;
  status: string;
  resolution_notes: string | null;
  resolved_at: string | null;
};

type SelectedData = {
  items: InvoiceItem[];
  installments: Installment[];
  divergences: Divergence[];
  xmlUrl: string | null;
};

const statusLabels: Record<string, string> = {
  review: "Em revisão",
  approved: "Aprovada",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};
const validationLabels: Record<string, string> = { ready: "Pronta", attention: "Atenção", blocked: "Bloqueada" };
const divergenceTypeLabels: Record<string, string> = {
  recipient: "Destinatário",
  supplier: "Fornecedor",
  order: "Pedido",
  receipt: "Recebimento",
  item_mapping: "Mapeamento",
  quantity: "Quantidade",
  price: "Preço",
  total: "Total",
  payment: "Pagamento",
  duplicate: "Duplicidade",
  other: "Outro",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}
function number(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function shortKey(value: string) {
  return `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8, 12)} … ${value.slice(-8)}`;
}

export default async function ElectronicInvoicesPage({ searchParams }: {
  searchParams: Promise<{ invoice?: string; q?: string; status?: string; validation?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.invoices.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const projectResult = projectId
    ? await supabase.from("projects").select("id,code,name,legal_entity_id").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : { data: null, error: null };
  const project = projectResult.data as Project | null;

  const [entityResult, invoicesResult, suppliersResult, inputsResult, ordersResult, orderItemsResult, receiptsResult, receiptItemsResult, manageResult, approveResult, cancelResult] = await Promise.all([
    project?.legal_entity_id
      ? supabase.from("legal_entities").select("legal_name,trade_name,cnpj").eq("id", project.legal_entity_id).eq("company_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<Invoice>(async (from, to) => {
      const { data, error } = await supabase.from("finance_electronic_invoices")
        .select("id,supplier_id,order_id,receipt_id,registry_number,status,validation_status,access_key,model,series,invoice_number,issue_date,operation_nature,issuer_tax_id,issuer_name,issuer_trade_name,recipient_tax_id,recipient_name,products_amount,freight_amount,discount_amount,icms_amount,ipi_amount,invoice_total,payment_total,item_count,mapped_item_count,divergence_count,xml_storage_path,xml_file_name,imported_at,approved_at,approval_notes,rejection_reason,cancellation_reason,suppliers(id,legal_name,trade_name,tax_id)")
        .eq("company_id", companyId).eq("project_id", projectId).order("issue_date", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as unknown as Invoice[], error };
    }) : Promise.resolve({ data: [] as Invoice[], error: null }),
    fetchAllRows<InvoiceSupplierOption>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to);
      return { data: (data ?? []) as InvoiceSupplierOption[], error };
    }),
    fetchAllRows<InvoiceInputOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_inputs").select("id,code,description,unit,category").eq("company_id", companyId).eq("status", "active").order("code").range(from, to);
      return { data: (data ?? []) as InvoiceInputOption[], error };
    }),
    projectId ? fetchAllRows<InvoiceOrderOption>(async (from, to) => {
      const { data, error } = await supabase.from("procurement_purchase_orders").select("id,supplier_id,order_number,status,total_amount,issue_date,expected_delivery_date").eq("company_id", companyId).eq("project_id", projectId).not("status", "in", "(draft,cancelled)").order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as InvoiceOrderOption[], error };
    }) : Promise.resolve({ data: [] as InvoiceOrderOption[], error: null }),
    projectId ? fetchAllRows<InvoiceOrderItemOption>(async (from, to) => {
      const { data, error } = await supabase.from("procurement_purchase_order_items").select("id,order_id,input_id,cost_center_service_id,input_code,input_name,unit_snapshot,ordered_quantity,unit_price,total_amount").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as InvoiceOrderItemOption[], error };
    }) : Promise.resolve({ data: [] as InvoiceOrderItemOption[], error: null }),
    projectId ? fetchAllRows<InvoiceReceiptOption>(async (from, to) => {
      const { data, error } = await supabase.from("procurement_material_receipts").select("id,order_id,supplier_id,receipt_number,status,receipt_date,invoice_number,invoice_access_key,invoice_amount").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").order("receipt_date", { ascending: false }).range(from, to);
      return { data: (data ?? []) as InvoiceReceiptOption[], error };
    }) : Promise.resolve({ data: [] as InvoiceReceiptOption[], error: null }),
    projectId ? fetchAllRows<InvoiceReceiptItemOption>(async (from, to) => {
      const { data, error } = await supabase.from("procurement_material_receipt_items").select("id,receipt_id,order_item_id,input_id,cost_center_service_id,input_code,input_name,unit_snapshot,accepted_quantity,unit_cost,accepted_amount").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as InvoiceReceiptItemOption[], error };
    }) : Promise.resolve({ data: [] as InvoiceReceiptItemOption[], error: null }),
    permission("finance.invoices.manage"),
    permission("finance.invoices.approve"),
    permission("finance.invoices.cancel"),
  ]);

  const invoices = invoicesResult.data;
  const selected = params.invoice ? invoices.find((invoice) => invoice.id === params.invoice) ?? null : null;
  let selectedData: SelectedData = { items: [], installments: [], divergences: [], xmlUrl: null };
  if (selected) {
    const [items, installments, divergences, signed] = await Promise.all([
      supabase.from("finance_electronic_invoice_items").select("id,invoice_id,line_number,supplier_product_code,ean,description,ncm,cfop,unit_snapshot,quantity,unit_price,total_amount,input_id,mapping_status,order_quantity,order_unit_price,quantity_variance,unit_price_variance,engineering_inputs(code,description,unit)").eq("invoice_id", selected.id).order("line_number"),
      supabase.from("finance_electronic_invoice_installments").select("id,invoice_id,sequence_no,installment_label,due_date,amount,payment_method,payable_id").eq("invoice_id", selected.id).order("sequence_no"),
      supabase.from("finance_electronic_invoice_divergences").select("id,invoice_id,invoice_item_id,divergence_type,severity,title,description,expected_value,actual_value,status,resolution_notes,resolved_at").eq("invoice_id", selected.id).order("created_at"),
      supabase.storage.from("electronic-invoice-xml").createSignedUrl(selected.xml_storage_path, 3600),
    ]);
    selectedData = {
      items: (items.data ?? []) as unknown as InvoiceItem[],
      installments: (installments.data ?? []) as Installment[],
      divergences: (divergences.data ?? []) as Divergence[],
      xmlUrl: signed.data?.signedUrl ?? null,
    };
  }

  const schemaMissing = invoicesResult.error?.code === "42P01" || invoicesResult.error?.message.includes("finance_electronic_invoices");
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canCancel = cancelResult.data === true || privileged;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = invoices
    .filter((invoice) => !params.status || invoice.status === params.status)
    .filter((invoice) => !params.validation || invoice.validation_status === params.validation)
    .filter((invoice) => !query || [invoice.registry_number, invoice.invoice_number, invoice.access_key, invoice.issuer_name, invoice.issuer_trade_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const activeInvoices = invoices.filter((invoice) => invoice.status !== "cancelled");
  const reviewCount = activeInvoices.filter((invoice) => invoice.status === "review" || invoice.status === "rejected").length;
  const blockedCount = activeInvoices.filter((invoice) => invoice.validation_status === "blocked").length;
  const approvedTotal = invoices.filter((invoice) => invoice.status === "approved").reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const legalEntity = (entityResult.data ?? null) as InvoiceLegalEntityOption | null;

  return <AppShell
    activeGroup="finance"
    activeItem="electronic-invoices"
    eyebrow="Financeiro · Documentos fiscais"
    title="Notas Eletrônicas · XML"
    description={`${company.name} · ${context} · importação, conferência e geração das parcelas a pagar.`}
    actions={canManage && projectId ? <InvoiceImportDialog suppliers={suppliersResult.data} inputs={inputsResult.data} orders={ordersResult.data} orderItems={orderItemsResult.data} receipts={receiptsResult.data} receiptItems={receiptItemsResult.data} legalEntity={legalEntity} /> : undefined}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura de notas eletrônicas</h2><p>Execute a migration <code>20260729_0045_finance_electronic_invoices.sql</code>.</p></section> : null}
    {!projectId ? <section className="xml-empty-state">Selecione uma obra no topo para importar e conferir as NF-e.</section> : null}

    {projectId && selected ? <InvoiceDetail invoice={selected} data={selectedData} canApprove={canApprove} canCancel={canCancel} /> : projectId && !schemaMissing ? <>
      <section className="xml-kpis">
        <article><span>XMLs importados</span><strong>{activeInvoices.length}</strong><small>{invoices.length} registros no histórico</small></article>
        <article><span>Aguardando revisão</span><strong>{reviewCount}</strong><small>notas pendentes ou devolvidas</small></article>
        <article><span>Validação bloqueada</span><strong>{blockedCount}</strong><small>divergências de alta severidade</small></article>
        <article><span>NF-e aprovadas</span><strong>{invoices.filter((invoice) => invoice.status === "approved").length}</strong><small>parcelas geradas no financeiro</small></article>
        <article><span>Valor aprovado</span><strong>{money(approvedTotal)}</strong><small>documentos aprovados</small></article>
      </section>

      <section className="xml-toolbar">
        <form method="get">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Emitente, NF-e, chave ou registro" />
          <select name="status" defaultValue={params.status ?? ""><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select name="validation" defaultValue={params.validation ?? ""><option value="">Todas as validações</option>{Object.entries(validationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <button type="submit">Filtrar</button><Link href="/financeiro/notas-eletronicas">Limpar</Link>
        </form>
      </section>

      <section className="xml-list-panel">
        <div className="section-heading"><div><span>Documentos fiscais</span><h2>Notas importadas</h2></div><p>{filtered.length} nota(s) no filtro atual.</p></div>
        <div className="registry-table-wrap"><table className="registry-table xml-table"><thead><tr><th>Emissão</th><th>NF-e</th><th>Emitente</th><th>Origem</th><th>Mapeamento</th><th>Valor</th><th>Validação</th><th>Status</th></tr></thead><tbody>
          {filtered.map((invoice) => {
            const supplier = relatedOne(invoice.suppliers);
            return <tr key={invoice.id}>
              <td>{dateBR(invoice.issue_date)}<span>{invoice.registry_number}</span></td>
              <td><Link href={`?invoice=${invoice.id}`}><strong>{invoice.invoice_number}/{invoice.series || "—"}</strong><span>modelo {invoice.model}</span><small>{shortKey(invoice.access_key)}</small></Link></td>
              <td><strong>{supplier?.trade_name || invoice.issuer_trade_name || supplier?.legal_name || invoice.issuer_name}</strong><span>{invoice.issuer_tax_id}</span></td>
              <td>{invoice.order_id ? <span className="xml-origin-pill">Pedido</span> : null}{invoice.receipt_id ? <span className="xml-origin-pill receipt">Recebimento</span> : null}{!invoice.order_id && !invoice.receipt_id ? <span>Sem vínculo</span> : null}</td>
              <td><strong>{invoice.mapped_item_count}/{invoice.item_count}</strong><span>{invoice.divergence_count} divergência(s)</span></td>
              <td><strong>{money(invoice.invoice_total)}</strong><span>parcelas {money(invoice.payment_total)}</span></td>
              <td><span className={`xml-validation ${invoice.validation_status}`}>{validationLabels[invoice.validation_status]}</span></td>
              <td><span className={`xml-status ${invoice.status}`}>{statusLabels[invoice.status]}</span></td>
            </tr>;
          })}
          {!filtered.length ? <tr><td colSpan={8} className="empty-table">Nenhuma NF-e encontrada.</td></tr> : null}
        </tbody></table></div>
      </section>
    </> : null}
  </AppShell>;
}

function InvoiceDetail({ invoice, data, canApprove, canCancel }: { invoice: Invoice; data: SelectedData; canApprove: boolean; canCancel: boolean }) {
  const supplier = relatedOne(invoice.suppliers);
  const openDivergences = data.divergences.filter((divergence) => divergence.status === "open");
  const blocking = openDivergences.filter((divergence) => divergence.severity === "high" || divergence.severity === "critical");
  return <>
    <div className="xml-back"><Link href="/financeiro/notas-eletronicas">← Voltar às notas</Link><span>{invoice.registry_number}</span></div>
    <section className="xml-detail-hero">
      <div><span>NF-e importada</span><h2>{invoice.invoice_number}/{invoice.series || "—"} · {supplier?.trade_name || invoice.issuer_trade_name || invoice.issuer_name}</h2><p>{shortKey(invoice.access_key)} · emissão {dateBR(invoice.issue_date)}</p></div>
      <div><span className={`xml-validation ${invoice.validation_status}`}>{validationLabels[invoice.validation_status]}</span><span className={`xml-status ${invoice.status}`}>{statusLabels[invoice.status]}</span>{data.xmlUrl ? <a href={data.xmlUrl} target="_blank" rel="noreferrer">Baixar XML</a> : null}</div>
    </section>

    <section className="xml-detail-kpis">
      <article><span>Total da NF-e</span><strong>{money(invoice.invoice_total)}</strong><small>produtos {money(invoice.products_amount)}</small></article>
      <article><span>Frete</span><strong>{money(invoice.freight_amount)}</strong><small>desconto {money(invoice.discount_amount)}</small></article>
      <article><span>Tributos destacados</span><strong>{money(Number(invoice.icms_amount) + Number(invoice.ipi_amount))}</strong><small>ICMS + IPI</small></article>
      <article><span>Itens vinculados</span><strong>{invoice.mapped_item_count}/{invoice.item_count}</strong><small>produtos do XML</small></article>
      <article><span>Divergências abertas</span><strong>{openDivergences.length}</strong><small>{blocking.length} bloqueante(s)</small></article>
      <article><span>Parcelas</span><strong>{data.installments.length}</strong><small>{money(invoice.payment_total)}</small></article>
    </section>

    <section className="xml-detail-grid">
      <article className="xml-card"><div className="xml-card-title"><div><span>Emitente</span><h3>{invoice.issuer_trade_name || invoice.issuer_name}</h3></div></div><dl><div><dt>CNPJ/CPF</dt><dd>{invoice.issuer_tax_id}</dd></div><div><dt>Natureza</dt><dd>{invoice.operation_nature || "—"}</dd></div><div><dt>Fornecedor Elos</dt><dd>{supplier?.legal_name || invoice.issuer_name}</dd></div></dl></article>
      <article className="xml-card"><div className="xml-card-title"><div><span>Destinatário</span><h3>{invoice.recipient_name || "Não informado"}</h3></div></div><dl><div><dt>CNPJ/CPF</dt><dd>{invoice.recipient_tax_id || "—"}</dd></div><div><dt>Pedido</dt><dd>{invoice.order_id ? "Vinculado" : "Sem vínculo"}</dd></div><div><dt>Recebimento</dt><dd>{invoice.receipt_id ? "Vinculado" : "Sem vínculo"}</dd></div></dl></article>
    </section>

    <section className="xml-list-panel"><div className="section-heading"><div><span>Mapeamento fiscal e orçamentário</span><h2>Produtos da NF-e</h2></div><p>{data.items.length} item(ns)</p></div><div className="registry-table-wrap"><table className="registry-table xml-items-table"><thead><tr><th>XML</th><th>Insumo Elos</th><th>Quantidade</th><th>Preço XML</th><th>Pedido</th><th>Variação</th><th>Total</th><th>Vínculo</th></tr></thead><tbody>{data.items.map((item) => {
      const input = relatedOne(item.engineering_inputs);
      return <tr key={item.id}><td><strong>{item.line_number}. {item.description}</strong><span>{item.supplier_product_code || "sem código"} · NCM {item.ncm || "—"} · CFOP {item.cfop || "—"}</span></td><td><strong>{input ? `${input.code} · ${input.description}` : "Não vinculado"}</strong><span>{input?.unit || ""}</span></td><td>{number(item.quantity)} {item.unit_snapshot}</td><td>{money(item.unit_price)}</td><td>{item.order_quantity == null ? "—" : <><strong>{number(item.order_quantity)} {item.unit_snapshot}</strong><span>{money(item.order_unit_price)}</span></>}</td><td><span className={Math.abs(Number(item.quantity_variance || 0)) > 0.000001 ? "negative" : "positive"}>Qtd. {number(item.quantity_variance)}</span><span className={Math.abs(Number(item.unit_price_variance || 0)) > 0.01 ? "negative" : "positive"}>Preço {money(item.unit_price_variance)}</span></td><td><strong>{money(item.total_amount)}</strong></td><td><span className={`xml-mapping ${item.mapping_status}`}>{item.mapping_status === "matched" ? "Vinculado" : item.mapping_status === "divergent" ? "Divergente" : "Pendente"}</span></td></tr>;
    })}</tbody></table></div></section>

    <section className="xml-detail-grid">
      <article className="xml-card wide"><div className="xml-card-title"><div><span>Conferência</span><h3>Divergências</h3></div><strong>{openDivergences.length} aberta(s)</strong></div>{data.divergences.length ? <div className="xml-divergence-list">{data.divergences.map((divergence) => <div key={divergence.id} className={`${divergence.status} ${divergence.severity}`}><div><span>{divergenceTypeLabels[divergence.divergence_type] || divergence.divergence_type} · {divergence.severity}</span><strong>{divergence.title}</strong><p>{divergence.description}</p>{divergence.expected_value || divergence.actual_value ? <small>Esperado: {divergence.expected_value || "—"} · XML: {divergence.actual_value || "—"}</small> : null}{divergence.resolution_notes ? <small>Tratamento: {divergence.resolution_notes}</small> : null}</div>{canApprove && divergence.status === "open" ? <form action={resolveInvoiceDivergence}><input type="hidden" name="invoice_id" value={invoice.id} /><input type="hidden" name="divergence_id" value={divergence.id} /><textarea name="notes" required rows={2} placeholder="Justificativa técnica/fiscal" /><div><button name="action" value="resolve" type="submit">Resolver</button><button name="action" value="waive" type="submit">Dispensar</button></div></form> : <span className={`xml-divergence-status ${divergence.status}`}>{divergence.status === "open" ? "Aberta" : divergence.status === "resolved" ? "Resolvida" : "Dispensada"}</span>}</div>)}</div> : <p className="xml-muted">Nenhuma divergência registrada.</p>}</article>
      <article className="xml-card"><div className="xml-card-title"><div><span>Contas a pagar</span><h3>Parcelas</h3></div><strong>{money(invoice.payment_total)}</strong></div><div className="xml-installment-list">{data.installments.map((installment) => <div key={installment.id}><div><strong>{installment.sequence_no}/{data.installments.length}</strong><span>{dateBR(installment.due_date)}</span></div><div><strong>{money(installment.amount)}</strong><small>{installment.payment_method || "Não informado"}</small></div>{installment.payable_id ? <Link href="/financeiro/contas-a-pagar">Título gerado</Link> : <span className="xml-pending-label">Pendente da aprovação</span>}</div>)}</div></article>
    </section>

    {invoice.rejection_reason ? <div className="auth-message error workspace-message"><strong>Motivo da devolução:</strong> {invoice.rejection_reason}</div> : null}
    {invoice.cancellation_reason ? <div className="auth-message error workspace-message"><strong>Motivo do cancelamento:</strong> {invoice.cancellation_reason}</div> : null}

    {invoice.status === "review" || invoice.status === "rejected" ? <section className="xml-workflow"><div><span>Fluxo de aprovação</span><h3>Conferência fiscal concluída?</h3><p>{blocking.length ? `${blocking.length} divergência(s) bloqueante(s) precisam ser tratadas.` : "A aprovação criará as parcelas no Contas a Pagar e atualizará o pedido/recebimento."}</p></div><div className="xml-workflow-actions">{canApprove ? <form action={approveElectronicInvoice}><input type="hidden" name="invoice_id" value={invoice.id} /><input name="notes" placeholder="Observação da aprovação" /><button className="primary" type="submit">Aprovar e gerar parcelas</button></form> : null}{canApprove && invoice.status === "review" ? <form action={rejectElectronicInvoice}><input type="hidden" name="invoice_id" value={invoice.id} /><input name="reason" required placeholder="Motivo da devolução" /><button type="submit">Devolver</button></form> : null}{canCancel ? <form action={cancelElectronicInvoice}><input type="hidden" name="invoice_id" value={invoice.id} /><input name="reason" required placeholder="Motivo do cancelamento" /><button className="danger" type="submit">Cancelar</button></form> : null}</div></section> : null}
  </>;
}
