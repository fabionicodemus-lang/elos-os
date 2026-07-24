import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  archiveBudget,
  createBudgetGroup,
  createBudgetItem,
  deactivateBudgetItem,
  updateBudget,
  updateBudgetGroup,
  updateBudgetItem,
} from "../actions";

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

type BudgetGroup = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  notes: string | null;
};

type BudgetItem = {
  id: string;
  group_id: string | null;
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  material_unit_cost: number;
  labor_unit_cost: number;
  equipment_unit_cost: number;
  other_unit_cost: number;
  unit_direct_cost: number;
  total_direct_cost: number;
  sort_order: number;
  notes: string | null;
};

type GroupSummary = {
  id: string;
  code: string;
  name: string;
  itemCount: number;
  incompleteCount: number;
  material: number;
  labor: number;
  equipment: number;
  other: number;
  direct: number;
};

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
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function itemIncomplete(item: BudgetItem) {
  return Number(item.quantity) <= 0 || Number(item.unit_direct_cost) <= 0;
}

function groupSummary(group: BudgetGroup | null, items: BudgetItem[]): GroupSummary {
  return items.reduce<GroupSummary>((summary, item) => {
    const quantity = Number(item.quantity ?? 0);
    summary.itemCount += 1;
    if (itemIncomplete(item)) summary.incompleteCount += 1;
    summary.material += quantity * Number(item.material_unit_cost ?? 0);
    summary.labor += quantity * Number(item.labor_unit_cost ?? 0);
    summary.equipment += quantity * Number(item.equipment_unit_cost ?? 0);
    summary.other += quantity * Number(item.other_unit_cost ?? 0);
    summary.direct += Number(item.total_direct_cost ?? 0);
    return summary;
  }, {
    id: group?.id ?? "ungrouped",
    code: group?.code ?? "—",
    name: group?.name ?? "Serviços sem grupo",
    itemCount: 0,
    incompleteCount: 0,
    material: 0,
    labor: 0,
    equipment: 0,
    other: 0,
    direct: 0,
  });
}

export default async function BudgetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ budgetId: string }>;
  searchParams: Promise<{
    q?: string;
    group?: string;
    incomplete?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const [{ budgetId }, queryParams] = await Promise.all([params, searchParams]);
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("budgets.view");

  let budgetQuery = supabase
    .from("engineering_budgets")
    .select("id, code, name, version, status, reference_date, area_m2, bdi_percentage, notes, updated_at")
    .eq("id", budgetId)
    .eq("company_id", companyId);
  let groupsQuery = supabase
    .from("engineering_budget_groups")
    .select("id, code, name, sort_order, notes")
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("sort_order")
    .order("code");
  let itemsQuery = supabase
    .from("engineering_budget_items")
    .select("id, group_id, code, description, unit, quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost, unit_direct_cost, total_direct_cost, sort_order, notes")
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("sort_order")
    .order("description")
    .limit(50000);

  if (projectId) {
    budgetQuery = budgetQuery.eq("project_id", projectId);
    groupsQuery = groupsQuery.eq("project_id", projectId);
    itemsQuery = itemsQuery.eq("project_id", projectId);
  }

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "budgets.manage",
      });

  const [budgetResult, groupsResult, itemsResult, projectResult, manageResult] = await Promise.all([
    budgetQuery.maybeSingle(),
    groupsQuery,
    itemsQuery,
    projectQuery,
    managePromise,
  ]);

  if (!budgetResult.data) redirect("/engenharia/orcamentos?error=Orçamento%20não%20localizado.");

  const budget = budgetResult.data as Budget;
  const groups = (groupsResult.data ?? []) as BudgetGroup[];
  const items = (itemsResult.data ?? []) as BudgetItem[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const project = projectResult.data;

  const materialTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.material_unit_cost), 0);
  const laborTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.labor_unit_cost), 0);
  const equipmentTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.equipment_unit_cost), 0);
  const otherTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.other_unit_cost), 0);
  const directTotal = items.reduce((sum, item) => sum + Number(item.total_direct_cost), 0);
  const bdiValue = directTotal * Number(budget.bdi_percentage) / 100;
  const budgetTotal = directTotal + bdiValue;
  const costPerM2 = Number(budget.area_m2) > 0 ? budgetTotal / Number(budget.area_m2) : 0;
  const incompleteCount = items.filter(itemIncomplete).length;

  const itemsByGroup = new Map<string, BudgetItem[]>();
  items.forEach((item) => {
    const key = item.group_id ?? "ungrouped";
    const current = itemsByGroup.get(key) ?? [];
    current.push(item);
    itemsByGroup.set(key, current);
  });
  const groupSummaries = groups.map((group) => groupSummary(group, itemsByGroup.get(group.id) ?? []));
  if (itemsByGroup.has("ungrouped")) groupSummaries.push(groupSummary(null, itemsByGroup.get("ungrouped") ?? []));

  const queryText = (queryParams.q ?? "").trim().toLowerCase();
  const groupFilter = groups.some((group) => group.id === queryParams.group) ? queryParams.group! : "";
  const incompleteOnly = queryParams.incomplete === "1";
  const filteredItems = items.filter((item) => {
    if (groupFilter && item.group_id !== groupFilter) return false;
    if (incompleteOnly && !itemIncomplete(item)) return false;
    if (!queryText) return true;
    return [item.code ?? "", item.description, item.unit, item.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const groupNameById = new Map(groups.map((group) => [group.id, `${group.code} · ${group.name}`]));
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Obra ativa";
  const structureError = budgetResult.error || groupsResult.error || itemsResult.error;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamentação"
      title={`${budget.code} · ${budget.version}`}
      description={`${company.name} · ${context} · ${budget.name}.`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/orcamentos">Voltar aos orçamentos</Link>
          {canManage && budget.status !== "archived" ? (
            <form action={archiveBudget}>
              <input type="hidden" name="budget_id" value={budget.id} />
              <button className="elos-button elos-button-danger" type="submit">Arquivar</button>
            </form>
          ) : null}
        </>
      }
    >
      {queryParams.success ? <div className="auth-message success workspace-message">{queryParams.success}</div> : null}
      {queryParams.error ? <div className="auth-message error workspace-message">{queryParams.error}</div> : null}
      {structureError ? <div className="auth-message error workspace-message">Não foi possível carregar todos os dados do orçamento.</div> : null}

      <section className="finance-summary-grid budgets-detail-summary">
        <article><span>Custo direto</span><strong>{money(directTotal)}</strong><small>sem BDI</small></article>
        <article><span>BDI</span><strong>{money(bdiValue)}</strong><small>{decimal(budget.bdi_percentage)}% sobre o custo direto</small></article>
        <article><span>Total orçado</span><strong>{money(budgetTotal)}</strong><small>custo direto mais BDI</small></article>
        <article><span>Custo por m²</span><strong>{Number(budget.area_m2) > 0 ? money(costPerM2) : "—"}</strong><small>{decimal(budget.area_m2)} m² informados</small></article>
        <article><span>Serviços</span><strong>{items.length}</strong><small>{groups.length} grupo(s) ativo(s)</small></article>
        <article><span>Itens incompletos</span><strong className={incompleteCount > 0 ? "budgets-alert" : ""}>{incompleteCount}</strong><small>sem quantidade ou custo</small></article>
      </section>

      <section className="budgets-cost-composition">
        <article><span>Materiais</span><strong>{money(materialTotal)}</strong><i style={{ width: `${directTotal > 0 ? materialTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Mão de obra</span><strong>{money(laborTotal)}</strong><i style={{ width: `${directTotal > 0 ? laborTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Equipamentos</span><strong>{money(equipmentTotal)}</strong><i style={{ width: `${directTotal > 0 ? equipmentTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Outros custos</span><strong>{money(otherTotal)}</strong><i style={{ width: `${directTotal > 0 ? otherTotal / directTotal * 100 : 0}%` }} /></article>
      </section>

      <details className="registry-form-panel budgets-general-panel">
        <summary>Dados gerais do orçamento</summary>
        <form action={updateBudget} className="registry-form budgets-general-form">
          <input type="hidden" name="budget_id" value={budget.id} />
          <label><span>Código</span><input name="code" defaultValue={budget.code} required disabled={!canManage} /></label>
          <label><span>Nome</span><input name="name" defaultValue={budget.name} required disabled={!canManage} /></label>
          <label><span>Versão</span><input name="version" defaultValue={budget.version} required disabled={!canManage} /></label>
          <label><span>Status</span><select name="status" defaultValue={budget.status} disabled={!canManage}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Data-base</span><input name="reference_date" type="date" defaultValue={budget.reference_date ?? ""} disabled={!canManage} /></label>
          <label><span>Área construída (m²)</span><input name="area_m2" type="number" min="0" step="0.01" defaultValue={budget.area_m2} disabled={!canManage} /></label>
          <label><span>BDI (%)</span><input name="bdi_percentage" type="number" min="0" step="0.01" defaultValue={budget.bdi_percentage} disabled={!canManage} /></label>
          <label className="registry-form-wide"><span>Observações e premissas</span><textarea name="notes" rows={4} defaultValue={budget.notes ?? ""} disabled={!canManage} /></label>
          {canManage ? <div className="registry-form-actions"><button type="submit">Salvar dados gerais</button></div> : null}
        </form>
      </details>

      {canManage && budget.status !== "archived" ? (
        <section className="budgets-entry-grid">
          <details className="registry-form-panel" open={groups.length === 0}>
            <summary>Adicionar grupo ou etapa</summary>
            <form action={createBudgetGroup} className="registry-form budgets-group-form">
              <input type="hidden" name="budget_id" value={budget.id} />
              <label><span>Código</span><input name="code" placeholder="Ex.: 01" required /></label>
              <label><span>Nome do grupo</span><input name="name" placeholder="Ex.: Serviços preliminares" required /></label>
              <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={groups.length + 1} /></label>
              <label className="registry-form-wide"><span>Observações</span><textarea name="notes" rows={2} /></label>
              <div className="registry-form-actions"><button type="submit">Adicionar grupo</button></div>
            </form>
          </details>

          <details className="registry-form-panel" open={items.length === 0 && groups.length > 0}>
            <summary>Adicionar serviço ao orçamento</summary>
            <form action={createBudgetItem} className="registry-form budgets-item-form">
              <input type="hidden" name="budget_id" value={budget.id} />
              <label><span>Grupo</span><select name="group_id" defaultValue=""><option value="">Sem grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select></label>
              <label><span>Código</span><input name="code" placeholder="Ex.: 01.001" /></label>
              <label className="budgets-description-field"><span>Descrição do serviço</span><input name="description" required placeholder="Serviço conforme projeto e memorial" /></label>
              <label><span>Unidade</span><input name="unit" defaultValue="un" required /></label>
              <label><span>Quantidade</span><input name="quantity" type="number" min="0" step="0.000001" defaultValue="0" /></label>
              <label><span>Material/un.</span><input name="material_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
              <label><span>Mão de obra/un.</span><input name="labor_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
              <label><span>Equipamento/un.</span><input name="equipment_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
              <label><span>Outros/un.</span><input name="other_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
              <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={items.length + 1} /></label>
              <label className="registry-form-wide"><span>Observações</span><textarea name="notes" rows={2} /></label>
              <div className="registry-form-actions"><button type="submit">Incluir serviço</button></div>
            </form>
          </details>
        </section>
      ) : null}

      <section className="registry-table-panel budgets-groups-panel">
        <div className="section-heading">
          <div><span>Estrutura do orçamento</span><h2>Resumo por grupo ou etapa</h2></div>
          <p>{groups.length} grupo(s) · atualizado em {dateBR(budget.updated_at)}.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-groups-table">
            <thead><tr><th>Grupo</th><th>Serviços</th><th>Materiais</th><th>Mão de obra</th><th>Equipamentos</th><th>Outros</th><th>Custo direto</th><th>Com BDI</th><th>Ação</th></tr></thead>
            <tbody>
              {groupSummaries.map((summary) => {
                const group = groups.find((candidate) => candidate.id === summary.id);
                return (
                  <tr key={summary.id}>
                    <td><strong>{summary.code} · {summary.name}</strong>{summary.incompleteCount > 0 ? <span className="budgets-alert-text">{summary.incompleteCount} incompleto(s)</span> : null}</td>
                    <td>{summary.itemCount}</td>
                    <td>{money(summary.material)}</td>
                    <td>{money(summary.labor)}</td>
                    <td>{money(summary.equipment)}</td>
                    <td>{money(summary.other)}</td>
                    <td><strong>{money(summary.direct)}</strong></td>
                    <td><strong>{money(summary.direct * (1 + Number(budget.bdi_percentage) / 100))}</strong></td>
                    <td>
                      {canManage && group ? (
                        <details className="budget-inline-edit">
                          <summary>Editar</summary>
                          <form action={updateBudgetGroup}>
                            <input type="hidden" name="budget_id" value={budget.id} />
                            <input type="hidden" name="group_id" value={group.id} />
                            <input name="code" defaultValue={group.code} required aria-label="Código do grupo" />
                            <input name="name" defaultValue={group.name} required aria-label="Nome do grupo" />
                            <input name="sort_order" type="number" defaultValue={group.sort_order} aria-label="Ordem do grupo" />
                            <textarea name="notes" defaultValue={group.notes ?? ""} aria-label="Observações do grupo" />
                            <button type="submit">Salvar</button>
                          </form>
                        </details>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {groupSummaries.length === 0 ? <tr><td className="empty-table" colSpan={9}>Crie o primeiro grupo para estruturar o orçamento.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="registry-toolbar budgets-items-toolbar">
        <form method="get" className="budgets-items-filter">
          <input name="q" defaultValue={queryParams.q ?? ""} placeholder="Código, descrição, unidade ou observação" />
          <select name="group" defaultValue={groupFilter}><option value="">Todos os grupos</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select>
          <select name="incomplete" defaultValue={incompleteOnly ? "1" : ""}><option value="">Todos os serviços</option><option value="1">Somente incompletos</option></select>
          <button type="submit">Filtrar</button>
          <Link href={`/engenharia/orcamentos/${budget.id}`}>Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel budgets-items-panel">
        <div className="section-heading">
          <div><span>Planilha orçamentária</span><h2>Serviços e custos unitários</h2></div>
          <p>{filteredItems.length} de {items.length} serviço(s).</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-items-table">
            <thead><tr><th>Grupo</th><th>Código / serviço</th><th>Un.</th><th>Qtd.</th><th>Material/un.</th><th>M.O./un.</th><th>Equip./un.</th><th>Outros/un.</th><th>Custo un.</th><th>Total direto</th><th>Total c/ BDI</th><th>Ação</th></tr></thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className={itemIncomplete(item) ? "budget-item-incomplete" : ""}>
                  <td>{item.group_id ? groupNameById.get(item.group_id) ?? "Grupo inativo" : "Sem grupo"}</td>
                  <td><strong>{item.code ? `${item.code} · ` : ""}{item.description}</strong>{item.notes ? <span>{item.notes}</span> : null}{itemIncomplete(item) ? <span className="budgets-alert-text">Revisar quantidade ou custo</span> : null}</td>
                  <td>{item.unit}</td>
                  <td>{decimal(item.quantity, 3)}</td>
                  <td>{money(item.material_unit_cost)}</td>
                  <td>{money(item.labor_unit_cost)}</td>
                  <td>{money(item.equipment_unit_cost)}</td>
                  <td>{money(item.other_unit_cost)}</td>
                  <td><strong>{money(item.unit_direct_cost)}</strong></td>
                  <td><strong>{money(item.total_direct_cost)}</strong></td>
                  <td><strong>{money(Number(item.total_direct_cost) * (1 + Number(budget.bdi_percentage) / 100))}</strong></td>
                  <td>
                    {canManage && budget.status !== "archived" ? (
                      <div className="budget-item-actions">
                        <details className="budget-inline-edit budget-item-edit">
                          <summary>Editar</summary>
                          <form action={updateBudgetItem}>
                            <input type="hidden" name="budget_id" value={budget.id} />
                            <input type="hidden" name="item_id" value={item.id} />
                            <label><span>Grupo</span><select name="group_id" defaultValue={item.group_id ?? ""}><option value="">Sem grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select></label>
                            <label><span>Código</span><input name="code" defaultValue={item.code ?? ""} /></label>
                            <label className="budget-edit-wide"><span>Descrição</span><input name="description" defaultValue={item.description} required /></label>
                            <label><span>Unidade</span><input name="unit" defaultValue={item.unit} required /></label>
                            <label><span>Quantidade</span><input name="quantity" type="number" min="0" step="0.000001" defaultValue={item.quantity} /></label>
                            <label><span>Material/un.</span><input name="material_unit_cost" type="number" min="0" step="0.000001" defaultValue={item.material_unit_cost} /></label>
                            <label><span>Mão de obra/un.</span><input name="labor_unit_cost" type="number" min="0" step="0.000001" defaultValue={item.labor_unit_cost} /></label>
                            <label><span>Equipamento/un.</span><input name="equipment_unit_cost" type="number" min="0" step="0.000001" defaultValue={item.equipment_unit_cost} /></label>
                            <label><span>Outros/un.</span><input name="other_unit_cost" type="number" min="0" step="0.000001" defaultValue={item.other_unit_cost} /></label>
                            <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={item.sort_order} /></label>
                            <label className="budget-edit-wide"><span>Observações</span><textarea name="notes" defaultValue={item.notes ?? ""} /></label>
                            <button type="submit">Salvar serviço</button>
                          </form>
                        </details>
                        <form action={deactivateBudgetItem}>
                          <input type="hidden" name="budget_id" value={budget.id} />
                          <input type="hidden" name="item_id" value={item.id} />
                          <button className="table-action danger" type="submit">Remover</button>
                        </form>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 ? <tr><td className="empty-table" colSpan={12}>Nenhum serviço encontrado.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
