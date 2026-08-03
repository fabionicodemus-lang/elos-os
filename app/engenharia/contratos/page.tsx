import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  addCommittedContractAmendment,
  approveCommittedContractMeasurement,
  createSimpleContractMeasurement,
  reverseCommittedContractMeasurement,
} from "./actions";
import {
  contractItemsMatchOriginal,
  serviceDeviation,
  sumContractItems,
} from "./contract-calculations.mjs";
import "../../engineering-contracts.css";

type Project = { id: string; code: string | null; name: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type Contract = {
  id: string; company_id: string; project_id: string; supplier_id: string; budget_id: string | null;
  contract_number: string; title: string; scope_summary: string; status: string; signed_date: string | null;
  start_date: string; end_date: string; original_value: number; amendments_value: number; current_value: number;
  measured_value: number; retained_value: number; paid_value: number; retention_percent: number;
  guarantee_percent: number; payment_days: number; responsible_name: string | null; notes: string | null; created_at: string;
};
type ContractItem = {
  id: string; company_id: string; project_id: string; contract_id: string; service_id: string;
  service_code: string; service_name: string; location_name: string | null; unit_snapshot: string;
  contracted_quantity: number; unit_price: number; total_value: number; measured_quantity: number; measured_value: number;
};
type Amendment = {
  id: string; contract_id: string; amendment_number: string; amendment_type: string; description: string;
  value_change: number; previous_end_date: string | null; new_end_date: string | null; justification: string; approved_at: string;
};
type AmendmentItem = { id: string; contract_id: string; amendment_id: string; contract_item_id: string; service_id: string; value_change: number };
type Measurement = {
  id: string; contract_id: string; measurement_number: string; period_start: string; period_end: string; status: string;
  gross_amount: number; contractual_retention_amount: number; guarantee_retention_amount: number; total_deductions: number;
  net_amount: number; approved_at: string | null; payable_id: string | null; paid_amount: number; paid_at: string | null;
  over_contract_confirmed: boolean; reversed_at: string | null; reversal_reason: string | null; created_at: string;
};
type Payable = { id: string; status: string; due_date: string; amount: number; paid_amount: number | null; paid_at: string | null };
type BudgetItem = { service_id: string | null; total_direct_cost: number; status: string };
type ContractAudit = { id: string; contract_id: string; action: string; previous_status: string | null; new_status: string | null; reason: string | null; changed_at: string };
type MeasurementAudit = { id: string; measurement_id: string; action: string; previous_status: string | null; new_status: string | null; reason: string | null; changed_at: string };

type Params = {
  contract?: string; q?: string; status?: string; supplier?: string; project?: string; success?: string; error?: string;
};

const contractStatusLabels: Record<string, string> = {
  draft: "Em elaboração", active: "Ativo", suspended: "Suspenso", finished: "Encerrado", cancelled: "Cancelado",
};
const measurementStatusLabels: Record<string, string> = {
  draft: "Rascunho", submitted: "Em aprovação", approved: "Aprovada", rejected: "Devolvida",
  invoiced: "Comprometida", paid: "Paga", cancelled: "Cancelada", reversed: "Estornada",
};
const amendmentTypeLabels: Record<string, string> = {
  addition: "Acréscimo", suppression: "Supressão", time: "Prazo", mixed: "Valor e prazo",
};
const timelineLabels: Record<string, string> = {
  created: "Contrato criado", updated: "Contrato atualizado", activated: "Contrato ativado", suspended: "Contrato suspenso",
  resumed: "Contrato retomado", finished: "Contrato encerrado", cancelled: "Contrato cancelado", amendment: "Aditivo aprovado",
  created_and_submitted: "Medição registrada", submitted: "Medição enviada", approved_and_committed: "Medição aprovada e comprometida",
  reversed: "Medição estornada", paid: "Medição paga",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function number(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0));
}
function dateBR(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—";
}
function supplierName(supplier?: Supplier | null) {
  return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado";
}
function projectName(project?: Project | null) {
  return project ? [project.code, project.name].filter(Boolean).join(" · ") : "Obra não localizada";
}

export default async function EngineeringContractsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId: activeProjectId, roleKey } = await requireCompanyPermission("execution.contracts.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectsResult, suppliersResult, contractsResult, itemsResult, amendmentsResult, amendmentItemsResult, measurementsResult, contractAuditResult,
    manageResult, amendResult, measureResult, approveResult, reverseResult] = await Promise.all([
    fetchAllRows<Project>(async (from, to) => {
      const { data, error } = await supabase.from("projects").select("id,code,name").eq("company_id", companyId).neq("status", "archived").order("name").range(from, to);
      return { data: (data ?? []) as Project[], error };
    }),
    fetchAllRows<Supplier>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).order("legal_name").range(from, to);
      return { data: (data ?? []) as Supplier[], error };
    }),
    fetchAllRows<Contract>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contracts")
        .select("id,company_id,project_id,supplier_id,budget_id,contract_number,title,scope_summary,status,signed_date,start_date,end_date,original_value,amendments_value,current_value,measured_value,retained_value,paid_value,retention_percent,guarantee_percent,payment_days,responsible_name,notes,created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Contract[], error };
    }),
    fetchAllRows<ContractItem>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_items")
        .select("id,company_id,project_id,contract_id,service_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price,total_value,measured_quantity,measured_value")
        .eq("company_id", companyId).order("sort_order").range(from, to);
      return { data: (data ?? []) as ContractItem[], error };
    }),
    fetchAllRows<Amendment>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_amendments")
        .select("id,contract_id,amendment_number,amendment_type,description,value_change,previous_end_date,new_end_date,justification,approved_at")
        .eq("company_id", companyId).order("approved_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Amendment[], error };
    }),
    fetchAllRows<AmendmentItem>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_amendment_items")
        .select("id,contract_id,amendment_id,contract_item_id,service_id,value_change")
        .eq("company_id", companyId).range(from, to);
      return { data: (data ?? []) as AmendmentItem[], error };
    }),
    fetchAllRows<Measurement>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurements")
        .select("id,contract_id,measurement_number,period_start,period_end,status,gross_amount,contractual_retention_amount,guarantee_retention_amount,total_deductions,net_amount,approved_at,payable_id,paid_amount,paid_at,over_contract_confirmed,reversed_at,reversal_reason,created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Measurement[], error };
    }),
    fetchAllRows<ContractAudit>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_audit")
        .select("id,contract_id,action,previous_status,new_status,reason,changed_at")
        .eq("company_id", companyId).order("changed_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as ContractAudit[], error };
    }),
    permission("execution.contracts.manage"), permission("execution.contracts.amend"), permission("execution.measurements.manage"),
    permission("execution.measurements.approve"), permission("execution.measurements.reverse"),
  ]);

  const projects = projectsResult.data;
  const suppliers = suppliersResult.data;
  const contracts = contractsResult.data;
  const items = itemsResult.data;
  const amendments = amendmentsResult.data;
  const amendmentItems = amendmentItemsResult.data;
  const measurements = measurementsResult.data;
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
  const selectedProjectId = params.project && projectMap.has(params.project) ? params.project : activeProjectId;
  const selected = params.contract ? contracts.find((contract) => contract.id === params.contract) ?? null : null;
  const selectedItems = selected ? items.filter((item) => item.contract_id === selected.id) : [];
  const selectedAmendments = selected ? amendments.filter((item) => item.contract_id === selected.id) : [];
  const selectedAmendmentItems = selected ? amendmentItems.filter((item) => item.contract_id === selected.id) : [];
  const selectedMeasurements = selected ? measurements.filter((item) => item.contract_id === selected.id) : [];
  const selectedAudit = selected ? contractAuditResult.data.filter((item) => item.contract_id === selected.id) : [];
  const selectedMeasurementIds = new Set(selectedMeasurements.map((measurement) => measurement.id));

  let measurementAudit: MeasurementAudit[] = [];
  if (selectedMeasurementIds.size) {
    measurementAudit = await fetchAllRows<MeasurementAudit>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurement_audit")
        .select("id,measurement_id,action,previous_status,new_status,reason,changed_at")
        .eq("company_id", companyId).order("changed_at", { ascending: false }).range(from, to);
      return { data: ((data ?? []) as MeasurementAudit[]).filter((item) => selectedMeasurementIds.has(item.measurement_id)), error };
    }).then((result) => result.data);
  }

  const payableIds = selectedMeasurements.map((measurement) => measurement.payable_id).filter((value): value is string => Boolean(value));
  let payables: Payable[] = [];
  if (payableIds.length) {
    const result = await supabase.from("payables").select("id,status,due_date,amount,paid_amount,paid_at").eq("company_id", companyId).in("id", payableIds);
    payables = (result.data ?? []) as Payable[];
  }
  const payableMap = new Map(payables.map((payable) => [payable.id, payable]));

  let budgetItems: BudgetItem[] = [];
  if (selected?.budget_id) {
    budgetItems = await fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_budget_items")
        .select("service_id,total_direct_cost,status").eq("company_id", companyId).eq("project_id", selected.project_id)
        .eq("budget_id", selected.budget_id as string).eq("status", "active").range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }).then((result) => result.data);
  }

  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = contracts
    .filter((contract) => !selectedProjectId || contract.project_id === selectedProjectId)
    .filter((contract) => !params.status || contract.status === params.status)
    .filter((contract) => !params.supplier || contract.supplier_id === params.supplier)
    .filter((contract) => !query || [contract.contract_number, contract.title, contract.scope_summary, supplierName(supplierMap.get(contract.supplier_id))].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const visibleContracts = filtered.filter((contract) => contract.status !== "cancelled");
  const totals = visibleContracts.reduce((summary, contract) => ({
    current: summary.current + Number(contract.current_value), measured: summary.measured + Number(contract.measured_value),
    retained: summary.retained + Number(contract.retained_value), paid: summary.paid + Number(contract.paid_value),
  }), { current: 0, measured: 0, retained: 0, paid: 0 });
  const totalBalance = totals.current - totals.measured;

  const canManage = manageResult.data === true || privileged;
  const canAmend = amendResult.data === true || privileged;
  const canMeasure = measureResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canReverse = reverseResult.data === true || privileged;
  const selectedIsActiveWorkspace = Boolean(selected && selected.project_id === activeProjectId);
  const structureError = contractsResult.error || itemsResult.error || amendmentsResult.error || amendmentItemsResult.error || measurementsResult.error;

  const budgetByService = new Map<string, number>();
  budgetItems.forEach((item) => {
    if (item.service_id) budgetByService.set(item.service_id, (budgetByService.get(item.service_id) ?? 0) + Number(item.total_direct_cost));
  });
  const committedByService = new Map<string, number>();
  items.forEach((item) => {
    const contract = contractMap.get(item.contract_id);
    if (contract && contract.status !== "cancelled" && (!selected || contract.project_id === selected.project_id)) {
      committedByService.set(item.service_id, (committedByService.get(item.service_id) ?? 0) + Number(item.total_value));
    }
  });
  amendmentItems.forEach((item) => {
    const contract = contractMap.get(item.contract_id);
    if (contract && contract.status !== "cancelled" && (!selected || contract.project_id === selected.project_id)) {
      committedByService.set(item.service_id, (committedByService.get(item.service_id) ?? 0) + Number(item.value_change));
    }
  });

  const serviceRows = Array.from(new Map(selectedItems.map((item) => [item.service_id, item])).values()).map((item) => {
    const budgeted = budgetByService.get(item.service_id) ?? 0;
    const committed = committedByService.get(item.service_id) ?? 0;
    return { ...item, budgeted, committed, ...serviceDeviation(budgeted, committed) };
  });
  const selectedItemTotal = sumContractItems(selectedItems);
  const missingAllocationAmendments = selectedAmendments.filter((amendment) => Math.abs(Number(amendment.value_change)) > 0.01 && !selectedAmendmentItems.some((item) => item.amendment_id === amendment.id));
  const selectedBalance = selected ? Number(selected.current_value) - Number(selected.measured_value) : 0;
  const alerts = selected ? [
    ...(!contractItemsMatchOriginal(Number(selected.original_value), selectedItems) ? [`A soma dos itens (${money(selectedItemTotal)}) difere do valor original (${money(selected.original_value)}).`] : []),
    ...serviceRows.filter((row) => row.overBudget).map((row) => `${row.service_code} · ${row.service_name}: comprometido ${money(row.committed)}, orçamento ${money(row.budgeted)}, desvio ${money(row.deviation)}.`),
    ...missingAllocationAmendments.map((amendment) => `${amendment.amendment_number} possui valor de ${money(amendment.value_change)} sem alocação por serviço.`),
    ...(selectedBalance < -0.01 ? [`O contrato está ${money(Math.abs(selectedBalance))} acima do valor vigente.`] : []),
  ] : [];

  const timeline = [
    ...selectedAudit.map((item) => ({ id: `c-${item.id}`, date: item.changed_at, label: timelineLabels[item.action] ?? item.action, detail: item.reason })),
    ...measurementAudit.map((item) => ({ id: `m-${item.id}`, date: item.changed_at, label: timelineLabels[item.action] ?? item.action, detail: item.reason })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const actions = canManage && activeProjectId
    ? <Link className="elos-button contract-main-button" href="/execucao/contratos-servicos?new=1">+ Novo contrato</Link>
    : undefined;

  return <AppShell
    activeGroup="engineering" activeItem="contracts" eyebrow="Engenharia · Compromissos" title="Contratos e Medições"
    description={`${company.name} · camada comprometida entre o orçamento, a execução e o financeiro.`}
    actions={actions}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura da Fase 3 ainda não foi instalada. Execute a migration <strong>20260803_0071_execution_contract_commitments.sql</strong>.</div> : null}

    {selected ? <>
      <section className="contract-detail-head">
        <div><Link href="/engenharia/contratos">← Voltar aos contratos</Link><span>{selected.contract_number} · {contractStatusLabels[selected.status] ?? selected.status}</span><h2>{selected.title}</h2><p>{selected.scope_summary}</p></div>
        <div className="contract-detail-actions"><Link href={`/execucao/contratos-servicos?contract=${selected.id}`}>Abrir gestão completa</Link>{canManage && selected.status === "draft" && selectedIsActiveWorkspace ? <Link className="primary" href={`/execucao/contratos-servicos?contract=${selected.id}&edit=1`}>Editar contrato</Link> : null}</div>
      </section>
      {!selectedIsActiveWorkspace ? <div className="contract-integrity-warning">Para lançar aditivos ou medições, selecione <strong>{projectName(projectMap.get(selected.project_id))}</strong> no topo do sistema.</div> : null}

      <section className="contract-kpis phase3">
        <article><span>Valor original</span><strong>{money(selected.original_value)}</strong><small>{selectedItems.length} item(ns)</small></article>
        <article><span>Aditivos</span><strong>{money(selected.amendments_value)}</strong><small>{selectedAmendments.length} aditivo(s)</small></article>
        <article><span>Valor vigente</span><strong>{money(selected.current_value)}</strong><small>comprometido atual</small></article>
        <article><span>Medido aprovado</span><strong>{money(selected.measured_value)}</strong><small>{selected.current_value ? number(selected.measured_value / selected.current_value * 100, 1) : "0"}%</small></article>
        <article className={selectedBalance < 0 ? "danger" : ""}><span>Saldo contratual</span><strong>{money(selectedBalance)}</strong><small>{selectedBalance < 0 ? "estouro contratual" : "a medir"}</small></article>
        <article><span>Retido a devolver</span><strong>{money(selected.retained_value)}</strong><small>devolução será manual</small></article>
      </section>

      <section className={`contract-integrity-panel ${alerts.length ? "warning" : "ok"}`}>
        <div><span>Integridade do compromisso</span><h3>{alerts.length ? `${alerts.length} alerta(s) encontrado(s)` : "Cobertura íntegra"}</h3></div>
        {alerts.length ? <ul>{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul> : <p>Itens, aditivos e orçamento estão conciliados para este contrato.</p>}
      </section>

      <section className="contract-phase-grid">
        <article className="contract-phase-card span2">
          <div className="budget-section-head"><div><span>Escopo comprometido</span><h2>Serviços do contrato</h2></div><p>{money(selectedItemTotal)}</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Serviço / local</th><th>Quantidade</th><th>Valor base</th><th>Aditivos alocados</th><th>Medido</th><th>Saldo do item</th></tr></thead><tbody>{selectedItems.map((item) => {
            const allocated = selectedAmendmentItems.filter((allocation) => allocation.contract_item_id === item.id).reduce((sum, allocation) => sum + Number(allocation.value_change), 0);
            const current = Number(item.total_value) + allocated;
            return <tr key={item.id}><td><strong>{item.service_code} · {item.service_name}</strong><small>{item.location_name || "Todos / não definido"}</small></td><td>{number(item.contracted_quantity, 4)} {item.unit_snapshot}</td><td>{money(item.total_value)}</td><td className={allocated < 0 ? "negative" : ""}>{money(allocated)}</td><td>{money(item.measured_value)}</td><td className={current - Number(item.measured_value) < 0 ? "negative" : ""}>{money(current - Number(item.measured_value))}</td></tr>;
          })}</tbody></table></div>
        </article>

        <article className="contract-phase-card span2">
          <div className="budget-section-head"><div><span>Comparativo</span><h2>Comprometido por serviço × orçamento</h2></div><p>{selected.budget_id ? "Orçamento vinculado" : "Sem orçamento"}</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Serviço</th><th>Orçado</th><th>Comprometido</th><th>Desvio</th><th>Situação</th></tr></thead><tbody>{serviceRows.map((row) => <tr key={row.service_id}><td><strong>{row.service_code} · {row.service_name}</strong></td><td>{money(row.budgeted)}</td><td>{money(row.committed)}</td><td className={row.overBudget ? "negative" : "positive"}>{money(row.deviation)}</td><td><span className={`contract-status ${row.overBudget ? "danger" : "ok"}`}>{row.overBudget ? "Acima do orçamento" : "Dentro do orçamento"}</span></td></tr>)}</tbody></table></div>
        </article>
      </section>

      <section className="contract-phase-grid">
        <article className="contract-phase-card">
          <div className="budget-section-head"><div><span>Atualização contratual</span><h2>Aditivos</h2></div><p>{selectedAmendments.length}</p></div>
          <div className="contract-stack-list">{selectedAmendments.map((amendment) => <div key={amendment.id}><div><strong>{amendment.amendment_number} · {amendmentTypeLabels[amendment.amendment_type] ?? amendment.amendment_type}</strong><span>{dateBR(amendment.approved_at)}</span></div><p>{amendment.description}</p><b className={amendment.value_change < 0 ? "negative" : ""}>{money(amendment.value_change)}</b><small>{amendment.justification}</small></div>)}{!selectedAmendments.length ? <p>Nenhum aditivo registrado.</p> : null}</div>
          {canAmend && selectedIsActiveWorkspace && ["active", "suspended"].includes(selected.status) ? <details className="contract-action-box"><summary>+ Registrar aditivo</summary><form action={addCommittedContractAmendment} className="contract-action-form"><input type="hidden" name="contract_id" value={selected.id} /><label>Tipo<select name="amendment_type" required><option value="addition">Acréscimo</option><option value="suppression">Supressão</option><option value="time">Prazo</option><option value="mixed">Valor e prazo</option></select></label><label>Valor da alteração<input name="value_change" type="number" step="0.01" defaultValue="0" /></label><label>Nova data final<input name="new_end_date" type="date" min={selected.end_date} /></label><label className="span2">Descrição<input name="description" required /></label><label className="span2">Justificativa<textarea name="justification" rows={3} required /></label><div className="span2 contract-allocation"><strong>Alocação por serviço</strong><small>A soma precisa coincidir com o valor do aditivo. Para supressão, informe valores positivos; o sistema converte o sinal.</small>{selectedItems.map((item) => <label key={item.id}><input type="hidden" name="allocation_contract_item_id" value={item.id} /><span>{item.service_code} · {item.service_name}{item.location_name ? ` · ${item.location_name}` : ""}</span><input name="allocation_value" type="number" step="0.01" defaultValue="0" /></label>)}</div><button type="submit">Aprovar aditivo</button></form></details> : null}
        </article>

        <article className="contract-phase-card">
          <div className="budget-section-head"><div><span>Produção mensal</span><h2>Nova medição simples</h2></div><p>{selectedMeasurements.length} lançamento(s)</p></div>
          {canMeasure && selectedIsActiveWorkspace && ["active", "suspended"].includes(selected.status) ? <form action={createSimpleContractMeasurement} className="contract-action-form"><input type="hidden" name="contract_id" value={selected.id} /><label>Competência<input name="competence" type="month" required /></label><label>Valor bruto<input name="gross_amount" type="number" min="0" step="0.01" placeholder="Ou informe o percentual" /></label><label>Percentual desta medição<input name="progress_percent" type="number" min="0" step="0.0001" placeholder="% do valor vigente" /></label><label className="span2">Observações<textarea name="notes" rows={3} /></label><label className="span2 contract-confirm"><input name="over_contract_confirmed" type="checkbox" /><span>Confirmo explicitamente a medição mesmo que ela ultrapasse o valor vigente. O estouro será exibido em vermelho e não será escondido.</span></label><button type="submit">Registrar e enviar para aprovação</button></form> : <p>Selecione a obra correta e confirme que o contrato está ativo para lançar uma medição.</p>}
        </article>
      </section>

      <section className="contract-phase-card contract-measurements-card">
        <div className="budget-section-head"><div><span>Compromissos financeiros</span><h2>Medições do contrato</h2></div><p>{selectedMeasurements.length}</p></div>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Medição</th><th>Competência</th><th>Bruto</th><th>Retenção</th><th>Líquido</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>{selectedMeasurements.map((measurement) => {
          const payable = measurement.payable_id ? payableMap.get(measurement.payable_id) : null;
          const retained = Number(measurement.contractual_retention_amount) + Number(measurement.guarantee_retention_amount);
          return <tr key={measurement.id} className={measurement.over_contract_confirmed ? "contract-overrun-row" : ""}><td><strong>{measurement.measurement_number}</strong>{measurement.over_contract_confirmed ? <small>Estouro confirmado</small> : null}</td><td>{dateBR(measurement.period_start)}</td><td>{money(measurement.gross_amount)}</td><td>{money(retained)}</td><td>{money(measurement.net_amount)}</td><td>{payable ? dateBR(payable.due_date) : "—"}</td><td><span className={`contract-status ${measurement.status}`}>{measurementStatusLabels[measurement.status] ?? measurement.status}</span></td><td><div className="contract-row-actions"><Link href={`/execucao/medicoes-contratos?measurement=${measurement.id}`}>Detalhes</Link>{measurement.status === "submitted" && canApprove && selectedIsActiveWorkspace ? <form action={approveCommittedContractMeasurement}><input type="hidden" name="measurement_id" value={measurement.id} /><input type="hidden" name="contract_id" value={selected.id} /><button type="submit">Aprovar</button></form> : null}{["approved", "invoiced"].includes(measurement.status) && canReverse && selectedIsActiveWorkspace ? <details><summary>Estornar</summary><form action={reverseCommittedContractMeasurement}><input type="hidden" name="measurement_id" value={measurement.id} /><input type="hidden" name="contract_id" value={selected.id} /><input name="reason" placeholder="Motivo obrigatório" required /><button type="submit">Confirmar estorno</button></form></details> : null}</div></td></tr>;
        })}{!selectedMeasurements.length ? <tr><td colSpan={8}>Nenhuma medição registrada.</td></tr> : null}</tbody></table></div>
      </section>

      <section className="contract-phase-card contract-timeline-card"><div className="budget-section-head"><div><span>Rastreabilidade</span><h2>Linha do tempo</h2></div><p>{timeline.length} evento(s)</p></div><div className="contract-timeline">{timeline.map((event) => <div key={event.id}><span>{dateBR(event.date)}</span><strong>{event.label}</strong><p>{event.detail || "Registro automático do sistema."}</p></div>)}{!timeline.length ? <p>Nenhum evento de auditoria localizado.</p> : null}</div></section>
    </> : <>
      <section className="contract-kpis phase3">
        <article><span>Total contratado</span><strong>{money(totals.current)}</strong><small>{visibleContracts.length} contrato(s)</small></article>
        <article><span>Total medido</span><strong>{money(totals.measured)}</strong><small>aprovado e comprometido</small></article>
        <article className={totalBalance < 0 ? "danger" : ""}><span>Saldo contratual</span><strong>{money(totalBalance)}</strong><small>{totalBalance < 0 ? "estouro acumulado" : "a medir"}</small></article>
        <article><span>Total retido</span><strong>{money(totals.retained)}</strong><small>caução e garantia</small></article>
        <article><span>Total pago</span><strong>{money(totals.paid)}</strong><small>baixas financeiras</small></article>
      </section>
      <section className="contract-toolbar phase3"><form method="get"><select name="project" defaultValue={selectedProjectId ?? ""}><option value="">Todas as obras</option>{projects.map((project) => <option key={project.id} value={project.id}>{projectName(project)}</option>)}</select><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(contractStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select name="supplier" defaultValue={params.supplier ?? ""}><option value="">Todos os fornecedores</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplierName(supplier)}</option>)}</select><input name="q" defaultValue={params.q ?? ""} placeholder="Contrato, fornecedor ou escopo" /><button type="submit">Filtrar</button><Link href="/engenharia/contratos">Limpar</Link></form></section>
      <section className="contract-list-card phase3"><div className="budget-section-head"><div><span>Camada comprometida</span><h2>Contratos de mão de obra e serviços</h2></div><p>{filtered.length} contrato(s)</p></div><div className="registry-table-wrap"><table className="registry-table contract-table"><thead><tr><th>Contrato</th><th>Obra</th><th>Fornecedor</th><th>Valor vigente</th><th>Medido</th><th>Saldo</th><th>Retido</th><th>Status</th></tr></thead><tbody>{filtered.map((contract) => {
        const balance = Number(contract.current_value) - Number(contract.measured_value);
        return <tr key={contract.id}><td><Link href={`/engenharia/contratos?contract=${contract.id}`}><strong>{contract.contract_number}</strong><span>{contract.title}</span></Link></td><td>{projectName(projectMap.get(contract.project_id))}</td><td>{supplierName(supplierMap.get(contract.supplier_id))}</td><td>{money(contract.current_value)}</td><td>{money(contract.measured_value)}</td><td className={balance < 0 ? "negative" : ""}>{money(balance)}</td><td>{money(contract.retained_value)}</td><td><span className={`contract-status ${contract.status}`}>{contractStatusLabels[contract.status] ?? contract.status}</span></td></tr>;
      })}{!filtered.length ? <tr><td colSpan={8}>Nenhum contrato encontrado para os filtros.</td></tr> : null}</tbody></table></div></section>
    </>}
  </AppShell>;
}
