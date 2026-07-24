import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { BudgetCreateDialog } from "./budget-create-dialog";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  reference_date: string | null;
  area_m2: number;
  notes: string | null;
  updated_at: string;
};

type BudgetItem = {
  budget_id: string;
  quantity: number;
  material_unit_cost: number;
  labor_unit_cost: number;
  equipment_unit_cost: number;
  other_unit_cost: number;
  total_direct_cost: number;
};

type BudgetMetrics = {
  itemCount: number;
  incompleteCount: number;
  material: number;
  labor: number;
  equipment: number;
  other: number;
  direct: number;
};

const PAGE_SIZE = 30;

const statusLabels: Record<Budget["status"], string> = {
  draft: "Rascunho",
  in_progress: "Em elaboração",
  review: "Em revisão",
  approved: "Revisão fechada",
  archived: "Arquivado",
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function buildMetrics(items: BudgetItem[]): BudgetMetrics {
  return items.reduce<BudgetMetrics>((summary, item) => {
    const quantity = Number(item.quantity ?? 0);
    const materialUnit = Number(item.material_unit_cost ?? 0);
    const laborUnit = Number(item.labor_unit_cost ?? 0);
    const equipmentUnit = Number(item.equipment_unit_cost ?? 0);
    const otherUnit = Number(item.other_unit_cost ?? 0);
    const unitCost = materialUnit + laborUnit + equipmentUnit + otherUnit;
    const direct = Number(item.total_direct_cost ?? quantity * unitCost);

    summary.itemCount += 1;
    if (quantity <= 0 || unitCost <= 0) summary.incompleteCount += 1;
    summary.material += quantity * materialUnit;
    summary.labor += quantity * laborUnit;
    summary.equipment += quantity * equipmentUnit;
    summary.other += quantity * otherUnit;
    summary.direct += direct;
    return summary;
  }, {
    itemCount: 0,
    incompleteCount: 0,
    material: 0,
    labor: 0,
    equipment: 0,
    other: 0,
    direct: 0,
  });
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("budgets.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const status = Object.keys(statusLabels).includes(params.status ?? "") ? params.status! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  let budgetsQuery = supabase
    .from("engineering_budgets")
    .select("id, code, name, version, status, reference_date, area_m2, notes, updated_at")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(10000);

  let itemsQuery = supabase
    .from("engineering_budget_items")
    .select("budget_id, quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost, total_direct_cost")
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(50000);

  if (projectId) {
    budgetsQuery = budgetsQuery.eq("project_id", projectId);
    itemsQuery = itemsQuery.eq("project_id", projectId);
  }

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "budgets.manage",
      });

  const [projectResult, budgetsResult, itemsResult, manageResult] = await Promise.all([
    projectQuery,
    budgetsQuery,
    itemsQuery,
    managePromise,
  ]);

  const budgets = (budgetsResult.data ?? []) as Budget[];
  const items = (itemsResult.data ?? []) as BudgetItem[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const itemsByBudget = new Map<string, BudgetItem[]>();

  items.forEach((item) => {
    const current = itemsByBudget.get(item.budget_id) ?? [];
    current.push(item);
    itemsByBudget.set(item.budget_id, current);
  });

  const metricsByBudget = new Map<string, BudgetMetrics>();
  budgets.forEach((budget) => {
    metricsByBudget.set(budget.id, buildMetrics(itemsByBudget.get(budget.id) ?? []));
  });

  const filteredBudgets = budgets.filter((budget) => {
    if (status && budget.status !== status) return false;
    if (!queryText) return true;
    return [budget.code, budget.name, budget.version, budget.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const totalPages = Math.max(1, Math.ceil(filteredBudgets.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageBudgets = filteredBudgets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const paginationQuery = `q=${encodeURIComponent(params.q ?? "")}&status=${status}`;

  const activeBudgets = budgets.filter((budget) => budget.status !== "archived");
  const latestBudget = activeBudgets[0] ?? null;
  const latestMetrics = latestBudget ? metricsByBudget.get(latestBudget.id) ?? buildMetrics([]) : buildMetrics([]);
  const inProgressCount = activeBudgets.filter((budget) => ["draft", "in_progress", "review"].includes(budget.status)).length;
  const approvedCount = activeBudgets.filter((budget) => budget.status === "approved").length;
  const project = projectResult.data;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";
  const structureMissing = Boolean(budgetsResult.error || itemsResult.error);
  const latestCostPerM2 = latestBudget && Number(latestBudget.area_m2) > 0
    ? latestMetrics.direct / Number(latestBudget.area_m2)
    : 0;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Visão geral do orçamento"
      description={`${company.name} · ${context} · quantitativos e custos reais de execução do empreendimento.`}
      actions={canManage ? <BudgetCreateDialog /> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura de orçamentos ainda não está instalada no Supabase. Execute a migration <strong>20260724_0014_engineering_budgets.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <span className="active">▦ Visão geral</span>
        <span>≡ Serviços</span>
        <span>◈ Insumos</span>
        <span>$ Preços e cotações</span>
        <span>∑ Levantamento</span>
        <span>R$ Orçamento analítico</span>
      </nav>

      <section className="budget-kpi-grid">
        <article>
          <span>Revisões ativas</span>
          <strong>{activeBudgets.length}</strong>
          <small>{inProgressCount} em elaboração · {approvedCount} fechada(s)</small>
        </article>
        <article>
          <span>Serviços na revisão atual</span>
          <strong>{latestMetrics.itemCount}</strong>
          <small>{latestBudget ? `${latestBudget.code} · ${latestBudget.version}` : "nenhuma revisão criada"}</small>
        </article>
        <article>
          <span>Custo total da revisão atual</span>
          <strong>{money(latestMetrics.direct)}</strong>
          <small>custo real previsto para execução</small>
        </article>
        <article>
          <span>Custo por m²</span>
          <strong>{latestBudget && Number(latestBudget.area_m2) > 0 ? money(latestCostPerM2) : "—"}</strong>
          <small>{latestBudget ? `${decimal(latestBudget.area_m2)} m² cadastrados` : "informe a área da obra"}</small>
        </article>
      </section>

      <section className="budget-flow-card">
        <div className="budget-flow-head">
          <div>
            <span>Fluxo integrado</span>
            <h2>Como o orçamento da obra é formado</h2>
          </div>
          <p>A revisão consolida estrutura, serviços, insumos, levantamentos e preços adotados.</p>
        </div>
        <div className="budget-flow-grid">
          <article><b>1. Estrutura da obra</b><span>Grupos, etapas, locais e pavimentos.</span></article>
          <article><b>2. Serviços e insumos</b><span>Composições e custos unitários rastreáveis.</span></article>
          <article><b>3. Levantamento</b><span>Quantidades por local, repetição e memória de cálculo.</span></article>
          <article><b>4. Orçamento analítico</b><span>Custo total, custo por m² e revisão fechada.</span></article>
        </div>
      </section>

      <section className="budget-toolbar-card">
        <form method="get" className="budgets-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar código, revisão, nome ou premissa" />
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/orcamentos">Limpar</Link>
        </form>
      </section>

      <section className="budget-table-card">
        <div className="budget-section-head">
          <div>
            <span>Revisões do orçamento</span>
            <h2>Histórico da obra</h2>
          </div>
          <p>{filteredBudgets.length} revisão(ões) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-table">
            <thead>
              <tr>
                <th>Código / revisão</th>
                <th>Status</th>
                <th>Data-base</th>
                <th>Área</th>
                <th>Serviços</th>
                <th>Custo total</th>
                <th>Custo/m²</th>
                <th>Atualização</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {pageBudgets.map((budget) => {
                const metrics = metricsByBudget.get(budget.id) ?? buildMetrics([]);
                const costPerM2 = Number(budget.area_m2) > 0 ? metrics.direct / Number(budget.area_m2) : 0;
                return (
                  <tr key={budget.id}>
                    <td>
                      <strong className="budget-code">{budget.code} · {budget.version}</strong>
                      <span>{budget.name}</span>
                    </td>
                    <td><span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span></td>
                    <td>{dateBR(budget.reference_date)}</td>
                    <td>{decimal(budget.area_m2)} m²</td>
                    <td>
                      <strong>{metrics.itemCount}</strong>
                      {metrics.incompleteCount > 0
                        ? <span className="budgets-alert-text">{metrics.incompleteCount} a revisar</span>
                        : <span>completos</span>}
                    </td>
                    <td><strong>{money(metrics.direct)}</strong></td>
                    <td>{Number(budget.area_m2) > 0 ? money(costPerM2) : "—"}</td>
                    <td>{dateBR(budget.updated_at)}</td>
                    <td><Link className="table-action" href={`/engenharia/orcamentos/${budget.id}`}>Abrir orçamento</Link></td>
                  </tr>
                );
              })}
              {pageBudgets.length === 0 ? (
                <tr>
                  <td className="budget-empty-state" colSpan={9}>
                    <strong>Nenhuma revisão cadastrada.</strong>
                    <span>Crie a primeira revisão para iniciar a estrutura do orçamento da obra.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}
            {page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
