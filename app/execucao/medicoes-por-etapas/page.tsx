import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  StageMeasurementDialog,
  type MeasurementStage,
  type StageMeasurementContract,
  type StageMeasurementItemRecord,
  type StageMeasurementRecord,
} from "./stage-measurement-client";
import "../../execution-stage-measurements.css";

type Project = { id: string; code: string | null; name: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null };
type ContractRow = {
  id: string; contract_number: string; title: string; supplier_id: string; start_date: string; end_date: string; status: string;
  current_value: number; measured_value: number; retention_percent: number; guarantee_percent: number; payment_days: number;
};
type ContractItem = { id: string; contract_id: string; service_code: string; service_name: string; location_name: string | null };
type StageRow = {
  id: string; contract_id: string; contract_item_id: string; stage_code: string; stage_name: string; description: string | null;
  measurement_mode: "quantity" | "percent"; weight_percent: number; unit_snapshot: string; contracted_quantity: number;
  unit_price: number; total_value: number; measured_quantity: number; measured_value: number;
};
type MeasurementRow = StageMeasurementRecord & {
  measurement_number: string; supplier_id: string; gross_amount: number; net_amount: number; requester_name: string | null;
  submitted_at: string | null; approved_at: string | null; sent_to_finance_at: string | null; paid_amount: number; created_at: string;
};
type MeasurementItemRow = StageMeasurementItemRecord & { measurement_id: string };

const statusLabels: Record<string, string> = { draft: "Em elaboração", submitted: "Em aprovação", approved: "Aprovada", rejected: "Devolvida", invoiced: "No financeiro", paid: "Paga", cancelled: "Cancelada" };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 3) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }
function supplierName(supplier?: Supplier | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado"; }

export default async function StageMeasurementsPage({ searchParams }: {
  searchParams: Promise<{ contract?: string; measurement?: string; q?: string; status?: string; new?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.measurements.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const [projectResult, suppliersResult, contractsResult, contractItemsResult, stagesResult, measurementsResult, measurementItemsResult, manageResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    fetchAllRows<Supplier>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name").eq("company_id", companyId).order("legal_name").range(from, to); return { data: (data ?? []) as Supplier[], error }; }),
    projectId ? fetchAllRows<ContractRow>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contracts").select("id,contract_number,title,supplier_id,start_date,end_date,status,current_value,measured_value,retention_percent,guarantee_percent,payment_days").eq("company_id", companyId).eq("project_id", projectId).neq("status", "cancelled").order("contract_number").range(from, to); return { data: (data ?? []) as ContractRow[], error }; }) : Promise.resolve({ data: [] as ContractRow[], error: null }),
    projectId ? fetchAllRows<ContractItem>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_code,service_name,location_name").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ContractItem[], error }; }) : Promise.resolve({ data: [] as ContractItem[], error: null }),
    projectId ? fetchAllRows<StageRow>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_stages").select("id,contract_id,contract_item_id,stage_code,stage_name,description,measurement_mode,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value,measured_quantity,measured_value").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as StageRow[], error }; }) : Promise.resolve({ data: [] as StageRow[], error: null }),
    projectId ? fetchAllRows<MeasurementRow>(async (from, to) => { const { data, error } = await supabase.from("execution_contract_measurements").select("id,contract_id,supplier_id,measurement_number,period_start,period_end,status,gross_amount,net_amount,tax_withholding_amount,advance_deduction_amount,other_discount_amount,notes,contractor_notes,requester_name,submitted_at,approved_at,sent_to_finance_at,paid_amount,created_at").eq("company_id", companyId).eq("project_id", projectId).order("sequence_no", { ascending: false }).range(from, to); return { data: (data ?? []) as MeasurementRow[], error }; }) : Promise.resolve({ data: [] as MeasurementRow[], error: null }),
    projectId ? fetchAllRows<MeasurementItemRow>(async (from, to) => { const { data, error } = await supabase.from("execution_contract_measurement_items").select("measurement_id,contract_stage_id,current_quantity,notes").eq("company_id", companyId).eq("project_id", projectId).not("contract_stage_id", "is", null).range(from, to); return { data: (data ?? []) as MeasurementItemRow[], error }; }) : Promise.resolve({ data: [] as MeasurementItemRow[], error: null }),
    privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "execution.measurements.manage" }),
  ]);

  const project = projectResult.data as Project | null;
  const supplierMap = new Map(suppliersResult.data.map((supplier) => [supplier.id, supplier]));
  const itemMap = new Map(contractItemsResult.data.map((item) => [item.id, item]));
  const contracts: StageMeasurementContract[] = contractsResult.data.filter((contract) => ["active", "suspended"].includes(contract.status)).map((contract) => ({ ...contract, supplier_name: supplierName(supplierMap.get(contract.supplier_id)) }));
  const stages: MeasurementStage[] = stagesResult.data.map((stage) => {
    const item = itemMap.get(stage.contract_item_id);
    return { ...stage, service_code: item?.service_code ?? "", service_name: item?.service_name ?? "Serviço", location_name: item?.location_name ?? null };
  });
  const measurements = measurementsResult.data;
  const selected = params.measurement ? measurements.find((measurement) => measurement.id === params.measurement) ?? null : null;
  const measurementItemMap = new Map<string, MeasurementItemRow[]>(); measurementItemsResult.data.forEach((item) => measurementItemMap.set(item.measurement_id, [...(measurementItemMap.get(item.measurement_id) ?? []), item]));
  const selectedItems = selected ? measurementItemMap.get(selected.id) ?? [] : [];
  const canManage = manageResult.data === true || privileged;
  const structureError = contractsResult.error || stagesResult.error || measurementsResult.error || measurementItemsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = measurements.filter((measurement) => !params.contract || measurement.contract_id === params.contract).filter((measurement) => !params.status || measurement.status === params.status).filter((measurement) => {
    const contract = contractsResult.data.find((entry) => entry.id === measurement.contract_id);
    return !query || [measurement.measurement_number, contract?.contract_number, contract?.title, supplierName(supplierMap.get(measurement.supplier_id)), measurement.requester_name].join(" ").toLocaleLowerCase("pt-BR").includes(query);
  });
  const selectedContractId = selected?.contract_id ?? params.contract ?? "";
  const configuredContracts = contracts.filter((contract) => stages.some((stage) => stage.contract_id === contract.id));
  const inApproval = measurements.filter((measurement) => measurement.status === "submitted").length;
  const grossApproved = measurements.filter((measurement) => ["approved", "invoiced", "paid"].includes(measurement.status)).reduce((sum, measurement) => sum + Number(measurement.gross_amount), 0);
  const netApproved = measurements.filter((measurement) => ["approved", "invoiced", "paid"].includes(measurement.status)).reduce((sum, measurement) => sum + Number(measurement.net_amount), 0);
  const stageProgress = stages.reduce((sum, stage) => sum + Number(stage.measured_value), 0);
  const stageTotal = stages.reduce((sum, stage) => sum + Number(stage.total_value), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell activeGroup="execution" activeItem="stage-measurements" eyebrow="Execução · Contratos" title="Medições por Etapas"
    description={`${company.name} · ${context} · produção medida por chapisco, reboco, requadros e demais etapas contratuais.`}
    actions={canManage && projectId ? <StageMeasurementDialog contracts={configuredContracts} stages={stages} measurement={selected} measurementItems={selectedItems} selectedContractId={selectedContractId} autoOpen={params.new === "1" || Boolean(selected)} label={selected ? "Editar medição" : "+ Nova medição por etapas"} /> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura de etapas ainda não está instalada. Execute a migration <strong>20260801_0067_service_contract_procurement.sql</strong>.</div> : null}
    {!projectId ? <div className="stage-measurement-empty-page">Selecione uma obra no topo.</div> : null}

    <section className="stage-measurement-kpis">
      <article><span>Contratos configurados</span><strong>{configuredContracts.length}</strong><small>{stages.length} etapas disponíveis</small></article>
      <article><span>Aguardando aprovação</span><strong>{inApproval}</strong><small>use a central de medições para aprovar</small></article>
      <article><span>Bruto aprovado</span><strong>{money(grossApproved)}</strong><small>{money(netApproved)} líquidos</small></article>
      <article><span>Avanço das etapas</span><strong>{stageTotal ? number(stageProgress / stageTotal * 100, 1) : "0"}%</strong><small>{money(stageProgress)} de {money(stageTotal)}</small></article>
    </section>

    <nav className="stage-measurement-tabs"><Link href="/execucao/contratacoes-servicos?view=contracts">Contratos e etapas</Link><span className="active">Medições por etapas</span><Link href="/execucao/medicoes-contratos">Aprovação e financeiro</Link></nav>

    {projectId ? <>
      <section className="stage-measurement-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar medição, contrato ou fornecedor" /><select name="contract" defaultValue={params.contract ?? ""}><option value="">Todos os contratos</option>{configuredContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title}</option>)}</select><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/execucao/medicoes-por-etapas">Limpar</Link></form></section>

      <section className="stage-progress-card"><div className="budget-section-head"><div><span>Progresso contratado</span><h2>Etapas por serviço</h2></div><p>O valor das etapas fecha o valor de cada serviço principal.</p></div><div className="stage-progress-grid">{configuredContracts.map((contract) => <article key={contract.id}><header><div><strong>{contract.contract_number}</strong><span>{contract.title}</span></div><b>{money(contract.current_value)}</b></header>{stages.filter((stage) => stage.contract_id === contract.id).map((stage) => { const progress = stage.total_value ? Number(stage.measured_value) / Number(stage.total_value) * 100 : 0; return <div key={stage.id}><span>{stage.service_name} · {stage.stage_name}</span><div><i style={{ width: `${Math.min(100, progress)}%` }} /></div><strong>{number(progress, 1)}%</strong><small>{money(stage.measured_value)} / {money(stage.total_value)}</small></div>; })}<Link href={`?contract=${contract.id}&new=1`}>Nova medição deste contrato</Link></article>)}</div></section>

      <section className="stage-measurement-list-card"><div className="budget-section-head"><div><span>Boletins</span><h2>Medições contratuais</h2></div><p>{filtered.length} medição(ões)</p></div><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Medição</th><th>Contrato</th><th>Fornecedor</th><th>Período</th><th>Etapas medidas</th><th>Bruto / líquido</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {filtered.map((measurement) => { const contract = contractsResult.data.find((entry) => entry.id === measurement.contract_id); const items = measurementItemMap.get(measurement.id) ?? []; return <tr key={measurement.id}><td><strong>{measurement.measurement_number}</strong><span>{measurement.requester_name || "—"}</span><small>{dateBR(measurement.created_at)}</small></td><td><strong>{contract?.contract_number}</strong><span>{contract?.title}</span></td><td>{supplierName(supplierMap.get(measurement.supplier_id))}</td><td>{dateBR(measurement.period_start)}<small>até {dateBR(measurement.period_end)}</small></td><td><strong>{items.length}</strong><small>etapa(s) neste boletim</small></td><td><strong>{money(measurement.gross_amount)}</strong><small>{money(measurement.net_amount)} líquidos</small></td><td><span className={`stage-status ${measurement.status}`}>{statusLabels[measurement.status]}</span></td><td><div className="stage-row-actions">{canManage && ["draft", "rejected"].includes(measurement.status) ? <Link className="table-action" href={`?measurement=${measurement.id}`}>Editar etapas</Link> : null}<Link className="table-action" href={`/execucao/medicoes-contratos?measurement=${measurement.id}`}>{["draft", "rejected"].includes(measurement.status) ? "Abrir central" : "Aprovar / financeiro"}</Link></div></td></tr>; })}
        {!filtered.length ? <tr><td colSpan={8} className="empty-table">Nenhuma medição encontrada.</td></tr> : null}
      </tbody></table></div></section>
    </> : null}
  </AppShell>;
}
