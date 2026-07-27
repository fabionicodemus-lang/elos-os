import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { generateContractPlanFromSchedule, updateContractPackage } from "./actions";

type Project = { id: string; code: string | null; name: string };
type Baseline = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "review" | "approved" | "archived";
};
type Service = { id: string; code: string; description: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null };
type ContractPackage = {
  id: string;
  baseline_id: string;
  service_id: string;
  supplier_id: string | null;
  code: string;
  name: string;
  planned_service_start: string;
  quotation_lead_days: number;
  negotiation_lead_days: number;
  contracting_lead_days: number;
  mobilization_lead_days: number;
  quotation_start: string;
  negotiation_start: string;
  contract_deadline: string;
  mobilization_start: string;
  planned_value: number;
  status: "planned" | "quotation" | "negotiation" | "approval" | "contracted" | "mobilization" | "completed" | "canceled";
  responsible: string | null;
  notes: string | null;
  record_status: "active" | "inactive";
};

const statusLabels: Record<ContractPackage["status"], string> = {
  planned: "Planejado",
  quotation: "Em cotação",
  negotiation: "Em negociação",
  approval: "Em aprovação",
  contracted: "Contratado",
  mobilization: "Em mobilização",
  completed: "Concluído",
  canceled: "Cancelado",
};

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value));
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function daysBetween(start: Date, finish: Date) {
  return Math.round((finish.getTime() - start.getTime()) / 86_400_000);
}

function packageRisk(item: ContractPackage, today: Date) {
  if (["contracted", "mobilization", "completed", "canceled"].includes(item.status)) {
    return { key: "controlled", label: item.status === "canceled" ? "Cancelado" : "Controlado" };
  }
  const contractDeadline = parseDate(item.contract_deadline);
  const negotiationStart = parseDate(item.negotiation_start);
  const quotationStart = parseDate(item.quotation_start);
  if (today > contractDeadline) return { key: "critical", label: "Contratação vencida" };
  if (today >= negotiationStart) return { key: "attention", label: "Negociar agora" };
  if (today >= quotationStart) return { key: "quotation", label: "Cotar agora" };
  return { key: "future", label: "No prazo" };
}

export default async function ContractPlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    baseline?: string;
    q?: string;
    status?: string;
    risk?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const statusFilter = Object.prototype.hasOwnProperty.call(statusLabels, params.status ?? "") ? params.status! : "";
  const riskFilter = ["critical", "attention", "quotation", "future", "controlled"].includes(params.risk ?? "") ? params.risk! : "";

  const [projectResult, baselinesResult, servicesResult, suppliersResult, packagesResult, manageResult] = await Promise.all([
    projectId
      ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId
      ? fetchAllRows<Baseline>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id, budget_id, code, name, version, status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Baseline[], error };
        })
      : Promise.resolve({ data: [] as Baseline[], error: null }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<Supplier>(async (from, to) => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, legal_name, trade_name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("legal_name")
        .range(from, to);
      return { data: (data ?? []) as Supplier[], error };
    }),
    projectId
      ? fetchAllRows<ContractPackage>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_contract_packages")
            .select("id, baseline_id, service_id, supplier_id, code, name, planned_service_start, quotation_lead_days, negotiation_lead_days, contracting_lead_days, mobilization_lead_days, quotation_start, negotiation_start, contract_deadline, mobilization_start, planned_value, status, responsible, notes, record_status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("record_status", "active")
            .order("contract_deadline")
            .range(from, to);
          return { data: (data ?? []) as ContractPackage[], error };
        })
      : Promise.resolve({ data: [] as ContractPackage[], error: null }),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: "schedule.manage",
        }),
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((baseline) => baseline.id === params.baseline)
    ?? baselines.find((baseline) => baseline.status === "approved")
    ?? baselines.find((baseline) => baseline.status !== "archived")
    ?? baselines[0]
    ?? null;
  const allPackages = selectedBaseline
    ? packagesResult.data.filter((item) => item.baseline_id === selectedBaseline.id)
    : [];
  const serviceMap = new Map(servicesResult.data.map((service) => [service.id, service]));
  const supplierMap = new Map(suppliersResult.data.map((supplier) => [supplier.id, supplier]));
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  const packages = allPackages.filter((item) => {
    const risk = packageRisk(item, today);
    if (statusFilter && item.status !== statusFilter) return false;
    if (riskFilter && risk.key !== riskFilter) return false;
    if (!query) return true;
    const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null;
    const service = serviceMap.get(item.service_id);
    return [item.code, item.name, item.responsible ?? "", supplier?.legal_name ?? "", supplier?.trade_name ?? "", service?.code ?? ""]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query);
  });

  const totalValue = allPackages.reduce((sum, item) => sum + Number(item.planned_value), 0);
  const contractedValue = allPackages
    .filter((item) => ["contracted", "mobilization", "completed"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.planned_value), 0);
  const criticalCount = allPackages.filter((item) => packageRisk(item, today).key === "critical").length;
  const nextDeadline = allPackages
    .filter((item) => !["contracted", "mobilization", "completed", "canceled"].includes(item.status))
    .sort((a, b) => a.contract_deadline.localeCompare(b.contract_deadline))[0];
  const structureError = packagesResult.error;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="contract-plan"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Plano de Contratações"
      description={`${company.name} · ${context} · agenda de cotações, negociações, contratos e mobilizações.`}
      actions={(
        <>
          <Link className="elos-button secondary" href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Abrir cronograma</Link>
          {canManage && selectedBaseline ? (
            <form action={generateContractPlanFromSchedule}>
              <input type="hidden" name="baseline_id" value={selectedBaseline.id} />
              <button className="elos-button" type="submit">Sincronizar com cronograma</button>
            </form>
          ) : null}
        </>
      )}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          A estrutura do plano de contratações ainda não está instalada. Execute a migration <strong>20260727_0024_engineering_contract_plan.sql</strong> no Supabase.
        </div>
      ) : null}
      {!projectId ? <div className="contract-plan-empty">Selecione uma obra no topo para acessar o plano de contratações.</div> : null}

      <nav className="budget-module-nav" aria-label="Planejamento da obra">
        <Link href="/engenharia/cronograma">▤ Cronograma físico</Link>
        <Link href="/engenharia/curvas">◒ Curvas física e financeira</Link>
        <span className="active">⌁ Plano de contratações</span>
        <span>▧ Planejamento de suprimentos</span>
      </nav>

      <section className="contract-baseline-card">
        <div>
          <span>Linha de base selecionada</span>
          <strong>{selectedBaseline ? `${selectedBaseline.code} · ${selectedBaseline.version} · ${selectedBaseline.name}` : "Nenhuma linha de base disponível"}</strong>
        </div>
        {baselines.length ? (
          <form method="get">
            <select name="baseline" defaultValue={selectedBaseline?.id ?? ""}>
              {baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version} · {baseline.name}</option>)}
            </select>
            <button type="submit">Abrir</button>
          </form>
        ) : null}
      </section>

      <section className="contract-plan-kpis">
        <article><span>Pacotes planejados</span><strong>{allPackages.length}</strong><small>serviços com agenda de contratação</small></article>
        <article><span>Valor planejado</span><strong>{money(totalValue)}</strong><small>base dos serviços vinculados</small></article>
        <article><span>Contratado ou mobilizado</span><strong>{money(contractedValue)}</strong><small>{totalValue ? (contractedValue / totalValue * 100).toFixed(1) : "0,0"}% do plano</small></article>
        <article className={criticalCount ? "critical" : ""}><span>Contratações vencidas</span><strong>{criticalCount}</strong><small>{nextDeadline ? `próximo prazo: ${dateBR(nextDeadline.contract_deadline)}` : "sem prazo pendente"}</small></article>
      </section>

      <section className="contract-plan-flow">
        <div><i>1</i><strong>Cotação</strong><span>consultar mercado e receber propostas</span></div>
        <div><i>2</i><strong>Negociação</strong><span>equalizar escopo, preço e condições</span></div>
        <div><i>3</i><strong>Contratação</strong><span>aprovação, documentos e assinatura</span></div>
        <div><i>4</i><strong>Mobilização</strong><span>equipe, projetos, materiais e segurança</span></div>
        <div><i>5</i><strong>Execução</strong><span>início previsto no cronograma físico</span></div>
      </section>

      <section className="contract-plan-toolbar">
        <form method="get">
          <input type="hidden" name="baseline" value={selectedBaseline?.id ?? ""} />
          <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar pacote, serviço, fornecedor ou responsável" />
          <select name="status" defaultValue={statusFilter}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select name="risk" defaultValue={riskFilter}>
            <option value="">Todos os riscos</option>
            <option value="critical">Contratação vencida</option>
            <option value="attention">Negociar agora</option>
            <option value="quotation">Cotar agora</option>
            <option value="future">No prazo</option>
            <option value="controlled">Controlado</option>
          </select>
          <button type="submit">Filtrar</button>
          <Link href={selectedBaseline ? `?baseline=${selectedBaseline.id}` : "/engenharia/plano-contratacoes"}>Limpar</Link>
        </form>
      </section>

      <section className="contract-plan-table-card">
        <div className="budget-section-head">
          <div><span>Agenda contratual</span><h2>Pacotes vinculados ao cronograma</h2></div>
          <p>{packages.length} pacote(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table contract-plan-table">
            <thead><tr><th>Pacote</th><th>Fornecedor</th><th>Cotação</th><th>Negociação</th><th>Contratar até</th><th>Mobilização</th><th>Início do serviço</th><th>Valor</th><th>Status / risco</th><th>Ação</th></tr></thead>
            <tbody>
              {packages.map((item) => {
                const service = serviceMap.get(item.service_id);
                const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null;
                const risk = packageRisk(item, today);
                const leadDays = daysBetween(parseDate(item.quotation_start), parseDate(item.planned_service_start));
                return (
                  <tr key={item.id}>
                    <td><strong>{item.code}</strong><span>{item.name}</span><small>{service ? `${service.code} · ${leadDays} dias de antecedência` : `${leadDays} dias de antecedência`}</small></td>
                    <td><strong>{supplier?.trade_name || supplier?.legal_name || "Não definido"}</strong><small>{item.responsible ? `Responsável: ${item.responsible}` : "Sem responsável"}</small></td>
                    <td>{dateBR(item.quotation_start)}</td>
                    <td>{dateBR(item.negotiation_start)}</td>
                    <td><strong>{dateBR(item.contract_deadline)}</strong></td>
                    <td>{dateBR(item.mobilization_start)}</td>
                    <td><strong>{dateBR(item.planned_service_start)}</strong></td>
                    <td>{money(item.planned_value)}</td>
                    <td><span className={`contract-status status-${item.status}`}>{statusLabels[item.status]}</span><span className={`contract-risk risk-${risk.key}`}>{risk.label}</span></td>
                    <td>
                      {canManage ? (
                        <details className="contract-edit">
                          <summary>Editar</summary>
                          <div className="contract-edit-popover">
                            <form action={updateContractPackage}>
                              <input type="hidden" name="baseline_id" value={selectedBaseline?.id ?? ""} />
                              <input type="hidden" name="package_id" value={item.id} />
                              <h3>{item.code} · {item.name}</h3>
                              <div className="contract-edit-grid">
                                <label>Fornecedor<select name="supplier_id" defaultValue={item.supplier_id ?? ""}><option value="">Não definido</option>{suppliersResult.data.map((option) => <option key={option.id} value={option.id}>{option.trade_name || option.legal_name}</option>)}</select></label>
                                <label>Responsável<input name="responsible" defaultValue={item.responsible ?? ""} /></label>
                                <label>Início do serviço<input name="planned_service_start" type="date" defaultValue={item.planned_service_start} required /></label>
                                <label>Valor planejado<input name="planned_value" type="number" min="0" step="0.01" defaultValue={Number(item.planned_value)} /></label>
                                <label>Dias para cotação<input name="quotation_lead_days" type="number" min="0" defaultValue={item.quotation_lead_days} /></label>
                                <label>Dias para negociação<input name="negotiation_lead_days" type="number" min="0" defaultValue={item.negotiation_lead_days} /></label>
                                <label>Dias para contratação<input name="contracting_lead_days" type="number" min="0" defaultValue={item.contracting_lead_days} /></label>
                                <label>Dias para mobilização<input name="mobilization_lead_days" type="number" min="0" defaultValue={item.mobilization_lead_days} /></label>
                                <label>Status<select name="status" defaultValue={item.status}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                                <label className="contract-wide">Observações<textarea name="notes" rows={3} defaultValue={item.notes ?? ""} /></label>
                              </div>
                              <div className="contract-edit-actions"><button type="submit">Salvar pacote</button></div>
                            </form>
                          </div>
                        </details>
                      ) : <span>Somente leitura</span>}
                    </td>
                  </tr>
                );
              })}
              {packages.length === 0 ? <tr><td colSpan={10} className="empty-table">Nenhum pacote encontrado. Use “Sincronizar com cronograma” para gerar o plano.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
