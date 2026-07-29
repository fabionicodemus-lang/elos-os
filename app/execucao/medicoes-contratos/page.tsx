import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  approveContractMeasurement,
  cancelContractMeasurement,
  rejectContractMeasurement,
  removeContractMeasurementDocument,
  sendContractMeasurementToFinance,
  submitContractMeasurement,
  uploadContractMeasurementDocuments,
} from "./actions";
import {
  ContractMeasurementDialog,
  type MeasurementContract,
  type MeasurementContractItem,
  type MeasurementItemRecord,
  type MeasurementRecord,
} from "./measurement-client";
import "../../execution-contract-measurements.css";

type Project = { id: string; code: string | null; name: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type ContractRow = {
  id: string; contract_number: string; title: string; supplier_id: string; start_date: string; end_date: string; status: string;
  current_value: number; measured_value: number; retention_percent: number; guarantee_percent: number; payment_days: number;
};
type Measurement = MeasurementRecord & {
  company_id: string; project_id: string; supplier_id: string; sequence_no: number; measurement_number: string;
  gross_amount: number; contractual_retention_percent: number; contractual_retention_amount: number;
  guarantee_retention_percent: number; guarantee_retention_amount: number; tax_withholding_amount: number;
  advance_deduction_amount: number; other_discount_amount: number; total_deductions: number; net_amount: number;
  requester_name: string | null; submitted_at: string | null; approved_at: string | null; approval_notes: string | null;
  rejected_at: string | null; rejection_reason: string | null; cancellation_reason: string | null;
  invoice_number: string | null; invoice_date: string | null; invoice_gross_amount: number | null; payable_id: string | null;
  sent_to_finance_at: string | null; paid_amount: number; paid_at: string | null; created_at: string;
};
type MeasurementItem = MeasurementItemRecord & {
  id: string; measurement_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; contracted_quantity: number; previous_approved_quantity: number; accumulated_quantity: number;
  unit_price: number; previous_approved_amount: number; current_amount: number; accumulated_amount: number; progress_percent: number;
};
type MeasurementDocument = { id: string; measurement_id: string; document_type: string; storage_path: string; file_name: string; caption: string | null; uploaded_at: string };
type SignedDocument = MeasurementDocument & { signed_url: string | null };
type Payable = { id: string; status: string; due_date: string; amount: number; paid_amount: number | null; paid_at: string | null; document: string | null };

const statusLabels: Record<string, string> = {
  draft: "Em elaboração", submitted: "Em aprovação", approved: "Aprovada", rejected: "Devolvida",
  invoiced: "No financeiro", paid: "Paga", cancelled: "Cancelada",
};
const documentLabels: Record<string, string> = { bulletin: "Boletim", evidence: "Evidência", invoice: "Nota fiscal", approval: "Aprovação", other: "Outro" };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }
function supplierName(supplier?: Supplier | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado"; }
function addDays(value: string, days: number) { const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

export default async function ContractMeasurementsPage({ searchParams }: {
  searchParams: Promise<{ measurement?: string; q?: string; status?: string; new?: string; edit?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.measurements.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, suppliersResult, contractsResult, contractItemsResult, measurementsResult, measurementItemsResult, documentsResult, manageResult, submitResult, approveResult, financeResult, cancelResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    fetchAllRows<Supplier>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).order("legal_name").range(from, to);
      return { data: (data ?? []) as Supplier[], error };
    }),
    projectId ? fetchAllRows<ContractRow>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contracts").select("id,contract_number,title,supplier_id,start_date,end_date,status,current_value,measured_value,retention_percent,guarantee_percent,payment_days").eq("company_id", companyId).eq("project_id", projectId).neq("status", "cancelled").order("contract_number").range(from, to);
      return { data: (data ?? []) as ContractRow[], error };
    }) : Promise.resolve({ data: [] as ContractRow[], error: null }),
    projectId ? fetchAllRows<MeasurementContractItem>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,measured_quantity,unit_price,measured_value").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as MeasurementContractItem[], error };
    }) : Promise.resolve({ data: [] as MeasurementContractItem[], error: null }),
    projectId ? fetchAllRows<Measurement>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurements").select("id,company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,gross_amount,contractual_retention_percent,contractual_retention_amount,guarantee_retention_percent,guarantee_retention_amount,tax_withholding_amount,advance_deduction_amount,other_discount_amount,total_deductions,net_amount,notes,contractor_notes,requester_name,submitted_at,approved_at,approval_notes,rejected_at,rejection_reason,cancellation_reason,invoice_number,invoice_date,invoice_gross_amount,payable_id,sent_to_finance_at,paid_amount,paid_at,created_at").eq("company_id", companyId).eq("project_id", projectId).order("sequence_no", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Measurement[], error };
    }) : Promise.resolve({ data: [] as Measurement[], error: null }),
    projectId ? fetchAllRows<MeasurementItem>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurement_items").select("id,measurement_id,contract_item_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,previous_approved_quantity,current_quantity,accumulated_quantity,unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as MeasurementItem[], error };
    }) : Promise.resolve({ data: [] as MeasurementItem[], error: null }),
    projectId ? fetchAllRows<MeasurementDocument>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurement_documents").select("id,measurement_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id", companyId).eq("project_id", projectId).order("uploaded_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as MeasurementDocument[], error };
    }) : Promise.resolve({ data: [] as MeasurementDocument[], error: null }),
    permission("execution.measurements.manage"), permission("execution.measurements.submit"), permission("execution.measurements.approve"), permission("execution.measurements.finance"), permission("execution.measurements.cancel"),
  ]);

  const project = projectResult.data as Project | null;
  const suppliers = suppliersResult.data;
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const contractMap = new Map(contractsResult.data.map((contract) => [contract.id, contract]));
  const dialogContracts: MeasurementContract[] = contractsResult.data.filter((contract) => ["active", "suspended"].includes(contract.status)).map((contract) => ({
    ...contract, supplier_name: supplierName(supplierMap.get(contract.supplier_id)),
  }));
  const itemMap = new Map<string, MeasurementItem[]>();
  measurementItemsResult.data.forEach((item) => itemMap.set(item.measurement_id, [...(itemMap.get(item.measurement_id) ?? []), item]));
  const documentMap = new Map<string, MeasurementDocument[]>();
  documentsResult.data.forEach((document) => documentMap.set(document.measurement_id, [...(documentMap.get(document.measurement_id) ?? []), document]));
  const measurements = measurementsResult.data;
  const selected = params.measurement ? measurements.find((measurement) => measurement.id === params.measurement) ?? null : null;
  const selectedItems = selected ? itemMap.get(selected.id) ?? [] : [];
  const selectedDocuments = selected ? documentMap.get(selected.id) ?? [] : [];
  let signedDocuments: SignedDocument[] = [];
  if (selectedDocuments.length) {
    const signed = await supabase.storage.from("contract-measurement-documents").createSignedUrls(selectedDocuments.map((document) => document.storage_path), 3600);
    const urlMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    signedDocuments = selectedDocuments.map((document) => ({ ...document, signed_url: urlMap.get(document.storage_path) ?? null }));
  }
  let payable: Payable | null = null;
  if (selected?.payable_id) {
    const result = await supabase.from("payables").select("id,status,due_date,amount,paid_amount,paid_at,document").eq("id", selected.payable_id).eq("company_id", companyId).maybeSingle();
    payable = result.data as Payable | null;
  }

  const canManage = manageResult.data === true || privileged;
  const canSubmit = submitResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canFinance = financeResult.data === true || privileged;
  const canCancel = cancelResult.data === true || privileged;
  const structureError = contractsResult.error || contractItemsResult.error || measurementsResult.error || measurementItemsResult.error || documentsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = measurements.filter((measurement) => !params.status || measurement.status === params.status).filter((measurement) => {
    const contract = contractMap.get(measurement.contract_id);
    return !query || [measurement.measurement_number, contract?.contract_number, contract?.title, supplierName(supplierMap.get(measurement.supplier_id)), measurement.requester_name].join(" ").toLocaleLowerCase("pt-BR").includes(query);
  });

  const approvedStatuses = new Set(["approved", "invoiced", "paid"]);
  const submittedCount = measurements.filter((measurement) => measurement.status === "submitted").length;
  const grossApproved = measurements.filter((measurement) => approvedStatuses.has(measurement.status)).reduce((sum, measurement) => sum + Number(measurement.gross_amount), 0);
  const netApproved = measurements.filter((measurement) => approvedStatuses.has(measurement.status)).reduce((sum, measurement) => sum + Number(measurement.net_amount), 0);
  const inFinance = measurements.filter((measurement) => ["invoiced", "paid"].includes(measurement.status)).reduce((sum, measurement) => sum + Number(measurement.net_amount), 0);
  const paid = measurements.filter((measurement) => measurement.status === "paid").reduce((sum, measurement) => sum + Number(measurement.paid_amount), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell
    activeGroup="execution" activeItem="contract-measurements" eyebrow="Execução · Contratos" title="Medições dos Contratos"
    description={`${company.name} · ${context} · quantidades executadas, acumulados, retenções, aprovação técnica e atendimento financeiro.`}
    actions={canManage && projectId ? <ContractMeasurementDialog contracts={dialogContracts} contractItems={contractItemsResult.data} autoOpen={params.new === "1"} /> : undefined}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura das medições ainda não está instalada. Execute a migration <strong>20260728_0039_execution_contract_measurements.sql</strong>.</div> : null}
    {!projectId ? <div className="measurement-empty">Selecione uma obra no topo.</div> : null}

    {projectId && selected ? <MeasurementDetail
      measurement={selected} contract={contractMap.get(selected.contract_id) ?? null} supplier={supplierMap.get(selected.supplier_id) ?? null}
      items={selectedItems} documents={signedDocuments} payable={payable} contracts={dialogContracts} contractItems={contractItemsResult.data}
      canManage={canManage} canSubmit={canSubmit} canApprove={canApprove} canFinance={canFinance} canCancel={canCancel} autoEdit={params.edit === "1"}
    /> : projectId ? <>
      <section className="measurement-kpis">
        <article><span>Medições cadastradas</span><strong>{measurements.length}</strong><small>incluindo elaboração e histórico</small></article>
        <article><span>Aguardando aprovação</span><strong>{submittedCount}</strong><small>pendentes de análise técnica</small></article>
        <article><span>Bruto aprovado</span><strong>{money(grossApproved)}</strong><small>produção reconhecida</small></article>
        <article><span>Líquido aprovado</span><strong>{money(netApproved)}</strong><small>após retenções e descontos</small></article>
        <article><span>Enviado ao financeiro</span><strong>{money(inFinance)}</strong><small>{money(paid)} já pago</small></article>
      </section>
      <section className="measurement-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar medição, contrato, fornecedor ou solicitante" /><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/execucao/medicoes-contratos">Limpar</Link></form></section>
      <section className="measurement-list-card"><div className="budget-section-head"><div><span>Boletins da obra</span><h2>Medições contratuais</h2></div><p>{filtered.length} medição(ões)</p></div><div className="registry-table-wrap"><table className="registry-table measurement-table"><thead><tr><th>Medição</th><th>Contrato / fornecedor</th><th>Período</th><th>Solicitante</th><th>Bruto</th><th>Deduções</th><th>Líquido</th><th>Atendimento</th><th>Status</th></tr></thead><tbody>{filtered.map((measurement) => {
        const contract = contractMap.get(measurement.contract_id);
        return <tr key={measurement.id}><td><Link href={`?measurement=${measurement.id}`}><strong>{measurement.measurement_number}</strong><span>{(itemMap.get(measurement.id) ?? []).length} item(ns)</span></Link></td><td><strong>{contract?.contract_number ?? "—"} · {contract?.title ?? "Contrato"}</strong><span>{supplierName(supplierMap.get(measurement.supplier_id))}</span></td><td>{dateBR(measurement.period_start)}<span>até {dateBR(measurement.period_end)}</span></td><td>{measurement.requester_name || "—"}</td><td><strong>{money(measurement.gross_amount)}</strong></td><td>{money(measurement.total_deductions)}<span>{measurement.gross_amount ? number(measurement.total_deductions / measurement.gross_amount * 100, 1) : "0"}%</span></td><td><strong>{money(measurement.net_amount)}</strong></td><td>{measurement.invoice_number ? <><strong>NF {measurement.invoice_number}</strong><span>{measurement.status === "paid" ? `Pago ${money(measurement.paid_amount)}` : "Conta a pagar gerada"}</span></> : <span className="measurement-pending-note">Aguardando nota</span>}</td><td><span className={`measurement-status ${measurement.status}`}>{statusLabels[measurement.status]}</span></td></tr>;
      })}{!filtered.length ? <tr><td colSpan={9} className="budget-empty-state">Nenhuma medição encontrada.</td></tr> : null}</tbody></table></div></section>
    </> : null}
  </AppShell>;
}

function MeasurementDetail({ measurement, contract, supplier, items, documents, payable, contracts, contractItems, canManage, canSubmit, canApprove, canFinance, canCancel, autoEdit }: {
  measurement: Measurement; contract: ContractRow | null; supplier: Supplier | null; items: MeasurementItem[]; documents: SignedDocument[]; payable: Payable | null;
  contracts: MeasurementContract[]; contractItems: MeasurementContractItem[]; canManage: boolean; canSubmit: boolean; canApprove: boolean; canFinance: boolean; canCancel: boolean; autoEdit: boolean;
}) {
  const editable = ["draft", "rejected"].includes(measurement.status);
  const defaultInvoiceDate = new Date().toISOString().slice(0, 10);
  const defaultDueDate = addDays(defaultInvoiceDate, Number(contract?.payment_days ?? 15));
  return <>
    <div className="measurement-back"><Link href="/execucao/medicoes-contratos">← Voltar às medições</Link><span>{measurement.measurement_number}</span></div>
    <section className="measurement-hero"><div><span>Boletim de medição contratual</span><h2>{measurement.measurement_number} · {contract?.contract_number ?? "Contrato"}</h2><p>{contract?.title ?? "—"} · {supplierName(supplier)}</p></div><div><span className={`measurement-status ${measurement.status}`}>{statusLabels[measurement.status]}</span>{canManage && editable ? <ContractMeasurementDialog contracts={contracts} contractItems={contractItems} measurement={measurement} measurementItems={items} autoOpen={autoEdit} label="Editar medição" /> : null}</div></section>

    {measurement.rejection_reason ? <div className="measurement-alert rejected"><strong>Correção solicitada</strong><p>{measurement.rejection_reason}</p></div> : null}
    {measurement.cancellation_reason ? <div className="measurement-alert cancelled"><strong>Medição cancelada</strong><p>{measurement.cancellation_reason}</p></div> : null}

    <section className="measurement-detail-kpis">
      <article><span>Valor bruto</span><strong>{money(measurement.gross_amount)}</strong><small>{items.length} item(ns) medido(s)</small></article>
      <article><span>Retenção contratual</span><strong>{money(measurement.contractual_retention_amount)}</strong><small>{number(measurement.contractual_retention_percent, 2)}%</small></article>
      <article><span>Garantia retida</span><strong>{money(measurement.guarantee_retention_amount)}</strong><small>{number(measurement.guarantee_retention_percent, 2)}%</small></article>
      <article><span>Outras deduções</span><strong>{money(measurement.tax_withholding_amount + measurement.advance_deduction_amount + measurement.other_discount_amount)}</strong><small>tributos, adiantamentos e descontos</small></article>
      <article><span>Valor líquido</span><strong>{money(measurement.net_amount)}</strong><small>base do contas a pagar</small></article>
      <article><span>Período</span><strong>{dateBR(measurement.period_end)}</strong><small>{dateBR(measurement.period_start)} a {dateBR(measurement.period_end)}</small></article>
    </section>

    <section className="measurement-detail-grid">
      <article className="measurement-card wide"><div className="measurement-card-title"><div><span>Produção do período</span><h3>Itens medidos</h3></div><strong>{money(measurement.gross_amount)}</strong></div><div className="registry-table-wrap"><table className="registry-table measurement-items-table"><thead><tr><th>Serviço / local</th><th>Contratado</th><th>Aprovado anterior</th><th>Atual</th><th>Acumulado</th><th>Progresso</th><th>Valor atual</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.service_code} · {item.service_name}</strong><span>{item.location_name || "Todos / não definido"}</span>{item.notes ? <small>{item.notes}</small> : null}</td><td>{number(item.contracted_quantity)} {item.unit_snapshot}<span>{money(item.contracted_quantity * item.unit_price)}</span></td><td>{number(item.previous_approved_quantity)} {item.unit_snapshot}<span>{money(item.previous_approved_amount)}</span></td><td><strong>{number(item.current_quantity)} {item.unit_snapshot}</strong><span>{money(item.current_amount)}</span></td><td>{number(item.accumulated_quantity)} {item.unit_snapshot}<span>{money(item.accumulated_amount)}</span></td><td><div className="measurement-progress"><span style={{ width: `${Math.min(100, Number(item.progress_percent))}%` }} /></div><strong>{number(item.progress_percent, 1)}%</strong></td><td><strong>{money(item.current_amount)}</strong></td></tr>)}</tbody></table></div></article>
      <article className="measurement-card"><div className="measurement-card-title"><div><span>Resumo financeiro</span><h3>Retenções e descontos</h3></div></div><dl className="measurement-financial-summary"><div><dt>Bruto medido</dt><dd>{money(measurement.gross_amount)}</dd></div><div><dt>Retenção contratual</dt><dd>- {money(measurement.contractual_retention_amount)}</dd></div><div><dt>Garantia retida</dt><dd>- {money(measurement.guarantee_retention_amount)}</dd></div><div><dt>Retenções tributárias</dt><dd>- {money(measurement.tax_withholding_amount)}</dd></div><div><dt>Adiantamentos</dt><dd>- {money(measurement.advance_deduction_amount)}</dd></div><div><dt>Outros descontos</dt><dd>- {money(measurement.other_discount_amount)}</dd></div><div className="total"><dt>Valor líquido</dt><dd>{money(measurement.net_amount)}</dd></div></dl></article>
    </section>

    <section className="measurement-detail-grid">
      <article className="measurement-card wide"><div className="measurement-card-title"><div><span>Registro técnico</span><h3>Observações e aprovações</h3></div></div><div className="measurement-notes-grid"><div><strong>Fiscalização</strong><p>{measurement.notes || "Nenhuma observação interna."}</p></div><div><strong>Prestador</strong><p>{measurement.contractor_notes || "Nenhuma observação do prestador."}</p></div><div><strong>Aprovação</strong><p>{measurement.approval_notes || "Nenhuma observação de aprovação."}</p></div><div><strong>Solicitante</strong><p>{measurement.requester_name || "—"}</p></div></div></article>
      <article className="measurement-card"><div className="measurement-card-title"><div><span>Arquivo privado</span><h3>Documentos</h3></div><strong>{documents.length}</strong></div>{documents.length ? <div className="measurement-document-list">{documents.map((document) => <div key={document.id}><div><strong>{document.file_name}</strong><small>{documentLabels[document.document_type]} · {dateBR(document.uploaded_at)}</small></div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{canManage && editable ? <form action={removeContractMeasurementDocument}><input type="hidden" name="measurement_id" value={measurement.id} /><input type="hidden" name="document_id" value={document.id} /><button type="submit">Remover</button></form> : null}</div>)}</div> : <p className="measurement-muted">Nenhum documento anexado.</p>}{canManage ? <form action={uploadContractMeasurementDocuments} className="measurement-upload-form" encType="multipart/form-data"><input type="hidden" name="measurement_id" value={measurement.id} /><label>Tipo<select name="document_type"><option value="bulletin">Boletim</option><option value="evidence">Evidência</option><option value="invoice">Nota fiscal</option><option value="approval">Aprovação</option><option value="other">Outro</option></select></label><label>Arquivos<input name="documents" type="file" multiple accept="application/pdf,image/*,.xlsx" /></label><label>Legenda<input name="caption" /></label><button type="submit">Anexar documentos</button></form> : null}</article>
    </section>

    {measurement.invoice_number || payable ? <section className="measurement-finance-card"><div><span>Atendimento financeiro</span><h3>Nota fiscal e conta a pagar</h3><p>O valor líquido aprovado é a base financeira desta medição.</p></div><dl><div><dt>Nota fiscal</dt><dd>{measurement.invoice_number || payable?.document || "—"}</dd></div><div><dt>Emissão</dt><dd>{dateBR(measurement.invoice_date)}</dd></div><div><dt>Bruto da nota</dt><dd>{money(measurement.invoice_gross_amount ?? 0)}</dd></div><div><dt>Conta a pagar</dt><dd>{money(payable?.amount ?? measurement.net_amount)}</dd></div><div><dt>Vencimento</dt><dd>{dateBR(payable?.due_date)}</dd></div><div><dt>Status</dt><dd>{payable?.status === "paid" ? "Pago" : payable?.status === "cancelled" ? "Cancelado" : "Em aberto"}</dd></div></dl>{payable ? <Link href="/financeiro/contas-a-pagar">Abrir Contas a Pagar</Link> : null}</section> : null}

    <section className="measurement-workflow"><div><span>Fluxo da medição</span><h3>Ações disponíveis</h3><p>Elaboração → aprovação técnica → nota fiscal → contas a pagar → pagamento.</p></div><div className="measurement-workflow-actions">
      {canSubmit && editable ? <form action={submitContractMeasurement}><input type="hidden" name="measurement_id" value={measurement.id} /><button className="primary" type="submit">Enviar para aprovação</button></form> : null}
      {canApprove && measurement.status === "submitted" ? <form action={approveContractMeasurement} className="measurement-approval-form"><input type="hidden" name="measurement_id" value={measurement.id} /><input name="approval_notes" placeholder="Observação da aprovação (opcional)" /><button className="primary" type="submit">Aprovar medição</button></form> : null}
      {canApprove && measurement.status === "submitted" ? <form action={rejectContractMeasurement} className="measurement-reject-form"><input type="hidden" name="measurement_id" value={measurement.id} /><input name="reason" required placeholder="Motivo obrigatório da devolução" /><button className="danger" type="submit">Devolver para correção</button></form> : null}
      {canCancel && editable ? <form action={cancelContractMeasurement} className="measurement-cancel-form"><input type="hidden" name="measurement_id" value={measurement.id} /><input name="reason" required placeholder="Motivo obrigatório do cancelamento" /><button className="danger" type="submit">Cancelar medição</button></form> : null}
    </div></section>

    {canFinance && measurement.status === "approved" ? <section className="measurement-finance-form"><div><span>Financeiro</span><h3>Vincular nota e gerar conta a pagar</h3><p>A conta será criada automaticamente pelo valor líquido de <strong>{money(measurement.net_amount)}</strong>.</p></div><form action={sendContractMeasurementToFinance}><input type="hidden" name="measurement_id" value={measurement.id} /><label>Número da nota<input name="invoice_number" required /></label><label>Data de emissão<input name="invoice_date" type="date" defaultValue={defaultInvoiceDate} required /></label><label>Valor bruto da nota<input name="invoice_gross_amount" type="number" min="0.01" step="0.01" defaultValue={Number(measurement.gross_amount).toFixed(2)} required /></label><label>Vencimento<input name="due_date" type="date" defaultValue={defaultDueDate} required /></label><label>Forma de pagamento<input name="payment_method" placeholder="Boleto, PIX, transferência..." /></label><label className="wide">Observações<input name="finance_notes" placeholder="Dados bancários, retenções fiscais e orientações ao financeiro" /></label><button type="submit">Gerar conta a pagar</button></form></section> : null}
  </>;
}
