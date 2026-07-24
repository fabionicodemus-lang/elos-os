import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { createBudget } from "./actions";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  reference_date: string | null;
  area_m2: number;
  bdi_percentage: number;
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
  totalWithBdi: number;
};

const PAGE_SIZE = 30;

const statusLabels: Record<Budget["status"], string> = {
  draft: "Rascunho",
  in_progress: "Em elaboração",
  review: "Em revisão",
  approved: "Aprovado",
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
  const clean = value.slice(0, 10);
  const [year, month, day] = clean.split("-");
  return `${day}/${month}/${year}`;
}

function buildMetrics(budget: Budget, items: BudgetItem[]): BudgetMetrics {
  return items.reduce<BudgetMetrics>((summary, item) => {
    const quantity = Number(item.quantity ?? 0);
    const materialUnit = Number(item.material_unit_cost ?? 0);
    const laborUnit = Number(item.labor_unit_cost ?? 0);
    const equipmentUnit = Number(item.equipment_unit_cost ?? 0);
    const otherUnit = Number(item.other_unit_cost ?? 0);
    const direct = Number(item.total_direct_cost ?? quantity * (materialUnit + laborUnit + equipmentUnit + otherUnit));

    summary.itemCount += 1;
    if (quantity <= 0 || materialUnit + laborUnit + equipmentUnit + otherUnit <= 0) summary.incompleteCount += 1;
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
    totalWithBdi: 0,
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
    .select("id, code, name, version, status, reference_date, area_m2, bdi_percentage, notes, updated_at")
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
    const metrics = buildMetrics(budget, itemsByBudget.get(budget.id) ?? []);
    metrics.totalWithBdi = metrics.direct * (1 + Number(budget.bdi_percentage ?? 0) / 100);
    metricsByBudget.set(budget.id, metrics);
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
  const approvedCount = budgets.filter((budget) => budget.status === "approved").length;
  const inProgressCount = budgets.filter((budget) => ["draft", "in_progress", "review"].includes(budget.status)).length;
  const directTotal = activeBudgets.reduce((sum, budget) => sum + (metricsByBudget.get(budget.id)?.direct ?? 0), 0);
  const totalWithBdi = activeBudgets.reduce((sum, budget) => sum + (metricsByBudget.get(budget.id)?.totalWithBdi ?? 0), 0);
  const incompleteItems = activeBudgets.reduce((sum, budget) => sum + (metricsByBudget.get(budget.id)?.incompleteCount ?? 0), 0);
  const project = projectResult.data;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";
  const structureMissing = Boolean(budgetsResult.error || itemsResult.error);

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamentação"
      title="Cadastro de Orçamentos"
      description={`${company.name} · ${context} · versões, etapas e custos do orçamento da obra.`}
      actions={canManage ? <a className="elos-button" href="#novo-orcamento">Novo orçamento</a> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura de orçamentos ainda não está instalada no Supabase. Execute a migration <strong>20260724_0014_engineering_budgets.sql</strong>.
        </div>
      ) : null}

      <section className="finance-summary-grid budgets-summary-grid">
        <article><span>Orçamentos ativos</span><strong>{activeBudgets.length}</strong><small>versões não arquivadas</small></article>
        <article><span>Em elaboração</span><strong>{inProgressCount}</strong><small>rascunho, elaboração ou revisão</small></article>
        <article><span>Aprovados</span><strong>{approvedCount}</strong><small>versões liberadas</small></article>
        <article><span>Custo direto</span><strong>{money(directTotal)}</strong><small>soma dos serviços ativos</small></article>
        <article><span>Total com BDI</span><strong>{money(totalWithBdi)}</strong><small>preço orçado das versões ativas</small></article>
        <article><span>Itens incompletos</span><strong className={incompleteItems > 0 ? "budgets-alert" : ""}>{incompleteItems}</strong><small>sem quantidade ou custo</small></article>
      </section>

      {canManage ? (
        <details id="novo-orcamento" className="registry-form-panel budgets-create-panel">
          <summary>Novo orçamento</summary>
          <form action={createBudget} className="registry-form budgets-create-form">
            <label><span>Código</span><input name="code" placeholder="Ex.: ORC-FLOW" required /></label>
            <label><span>Nome</span><input name="name" placeholder="Ex.: Orçamento executivo Flow" required /></label>
            <label><span>Versão</span><input name="version" defaultValue="R00" required /></label>
            <label><span>Data-base</span><input name="reference_date" type="date" /></label>
            <label><span>Área construída (m²)</span><input name="area_m2" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label><span>BDI (%)</span><input name="bdi_percentage" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label className="registry-form-wide"><span>Observações</span><textarea name="notes" rows={3} placeholder="Escopo, premissas, exclusões e referência desta versão." /></label>
            <div className="registry-form-actions"><button type="submit">Criar orçamento</button></div>
          </form>
        </details>
      ) : null}

      <section className="registry-toolbar budgets-toolbar">
        <form method="get" className="budgets-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Código, nome, versão ou observação" />
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/orcamentos">Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel budgets-table-panel">
        <div className="section-heading">
          <div><span>Orçamentos da obra</span><h2>Versões cadastradas</h2></div>
          <p>{filteredBudgets.length} orçamento(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-table">
            <thead>
              <tr>
                <th>Orçamento</th><th>Status</th><th>Data-base</th><th>Área</th><th>Serviços</th><th>Custo direto</th><th>BDI</th><th>Total orçado</th><th>Custo/m²</th><th>Revisão</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {pageBudgets.map((budget) => {
                const metrics = metricsByBudget.get(budget.id)!;
                const costPerM2 = Number(budget.area_m2) > 0 ? metrics.totalWithBdi / Number(budget.area_m2) : 0;
                return (
                  <tr key={budget.id}>
                    <td><strong>{budget.code} · {budget.version}</strong><span>{budget.name}</span></td>
                    <td><span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span></td>
                    <td>{dateBR(budget.reference_date)}</td>
                    <td>{decimal(budget.area_m2)} m²</td>
                    <td><strong>{metrics.itemCount}</strong>{metrics.incompleteCount > 0 ? <span className="budgets-alert-text">{metrics.incompleteCount} incompleto(s)</span> : <span>completos</span>}</td>
                    <td>{money(metrics.direct)}</td>
                    <td>{decimal(budget.bdi_percentage)}%</td>
                    <td><strong>{money(metrics.totalWithBdi)}</strong></td>
                    <td>{Number(budget.area_m2) > 0 ? money(costPerM2) : "—"}</td>
                    <td>{dateBR(budget.updated_at)}</td>
                    <td><Link className="table-action" href={`/engenharia/orcamentos/${budget.id}`}>Abrir orçamento</Link></td>
                  </tr>
                );
              })}
              {pageBudgets.length === 0 ? <tr><td className="empty-table" colSpan={11}>Nenhum orçamento encontrado.</td></tr> : null}
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
