import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CreatableCombobox } from "@/components/creatable-combobox";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  archiveBudget,
  deactivateBudgetItem,
  updateBudgetGroup,
  updateBudgetItem,
} from "../actions";
import { BudgetRevisionDialogs } from "./budget-revision-dialogs";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  reference_date: string | null;
  area_m2: number;
  notes: string | null;
  is_base: boolean;
  base_set_at: string | null;
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

type BudgetSection = {
  id: string;
  code: string;
  name: string;
  group: BudgetGroup | null;
  allItems: BudgetItem[];
  visibleItems: BudgetItem[];
};

type UnitRecord = { unit: string };

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

function sumDirect(items: BudgetItem[]) {
  return items.reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0);
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
    .select("id, code, name, version, status, reference_date, area_m2, notes, is_base, base_set_at, updated_at")
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
  const serviceUnitsQuery = supabase
    .from("engineering_services")
    .select("unit")
    .eq("company_id", companyId)
    .limit(10000);
  const inputUnitsQuery = supabase
    .from("engineering_inputs")
    .select("unit")
    .eq("company_id", companyId)
    .limit(10000);
  let transactionsQuery = supabase
    .from("execution_material_requests")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("budget_id", budgetId);
  if (projectId) transactionsQuery = transactionsQuery.eq("project_id", projectId);

  const [
    budgetResult,
    groupsResult,
    itemsResult,
    projectResult,
    manageResult,
    serviceUnitsResult,
    inputUnitsResult,
    transactionsResult,
  ] = await Promise.all([
    budgetQuery.maybeSingle(),
    groupsQuery,
    itemsQuery,
    projectQuery,
    managePromise,
    serviceUnitsQuery,
    inputUnitsQuery,
    transactionsQuery,
  ]);

  if (!budgetResult.data) redirect("/engenharia/orcamentos?error=Revisão%20não%20localizada.");

  const budget = budgetResult.data as Budget;
  const groups = (groupsResult.data ?? []) as BudgetGroup[];
  const items = (itemsResult.data ?? []) as BudgetItem[];
  const serviceUnits = (serviceUnitsResult.data ?? []) as UnitRecord[];
  const inputUnits = (inputUnitsResult.data ?? []) as UnitRecord[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const hasCostCenterTransactions = Number(transactionsResult.count ?? 0) > 0;
  const project = projectResult.data;
  const units = [...new Set([
    ...items.map((item) => item.unit),
    ...serviceUnits.map((service) => service.unit),
    ...inputUnits.map((input) => input.unit),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const materialTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.material_unit_cost), 0);
  const laborTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.labor_unit_cost), 0);
  const equipmentTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.equipment_unit_cost), 0);
  const otherTotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.other_unit_cost), 0);
  const directTotal = sumDirect(items);
  const costPerM2 = Number(budget.area_m2) > 0 ? directTotal / Number(budget.area_m2) : 0;
  const incompleteCount = items.filter(itemIncomplete).length;

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

  const groupSections: BudgetSection[] = groups
    .map((group) => ({
      id: group.id,
      code: group.code,
      name: group.name,
      group,
      allItems: items.filter((item) => item.group_id === group.id),
      visibleItems: filteredItems.filter((item) => item.group_id === group.id),
    }))
    .filter((section) => section.visibleItems.length > 0 || (!queryText && !groupFilter && !incompleteOnly));

  const ungroupedItems = items.filter((item) => !item.group_id);
  const visibleUngroupedItems = filteredItems.filter((item) => !item.group_id);
  if (visibleUngroupedItems.length > 0 || (ungroupedItems.length > 0 && !queryText && !groupFilter && !incompleteOnly)) {
    groupSections.push({
      id: "ungrouped",
      code: "—",
      name: "Serviços sem grupo",
      group: null,
      allItems: ungroupedItems,
      visibleItems: visibleUngroupedItems,
    });
  }

  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Obra ativa";
  const structureError = budgetResult.error || groupsResult.error || itemsResult.error || transactionsResult.error;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Orçamento"
      description={`${company.name} · ${context} · ${budget.code} · ${budget.version} · ${budget.name}.`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/orcamentos">Voltar</Link>
          {canManage ? <BudgetRevisionDialogs budget={budget} groups={groups} units={units} itemCount={items.length} hasCostCenterTransactions={hasCostCenterTransactions} /> : null}
          {canManage && budget.status !== "archived" && !budget.is_base ? (
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
      {structureError ? <div className="auth-message error workspace-message">Não foi possível carregar todos os dados da revisão.</div> : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Orçamentos</Link>
        <span>≡ Serviços</span>
        <span>◈ Insumos</span>
        <span>$ Preços e cotações</span>
        <span>∑ Levantamento</span>
        <span className="active">R$ Orçamento analítico</span>
      </nav>

      <section className="budget-reference-bar">
        <div>
          <span>Base desta revisão</span>
          <strong>Quantidades aprovadas · custos unitários adotados · composição por natureza</strong>
        </div>
        <div className="budget-reference-meta">
          <span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span>
          {budget.is_base ? <span className="budget-base-badge">Orçamento base</span> : null}
          <small>Data-base {dateBR(budget.reference_date)} · atualização {dateBR(budget.updated_at)}</small>
        </div>
      </section>

      <section className="budget-kpi-grid budget-detail-kpis">
        <article><span>Custo total da obra</span><strong>{money(directTotal)}</strong><small>total dos serviços ativos</small></article>
        <article><span>Custo por m²</span><strong>{Number(budget.area_m2) > 0 ? money(costPerM2) : "—"}</strong><small>{decimal(budget.area_m2)} m² cadastrados</small></article>
        <article><span>Serviços</span><strong>{items.length}</strong><small>{groups.length} grupo(s) da estrutura analítica</small></article>
        <article><span>Itens a revisar</span><strong className={incompleteCount > 0 ? "budgets-alert" : ""}>{incompleteCount}</strong><small>sem quantidade ou custo unitário</small></article>
      </section>

      <section className="budgets-cost-composition">
        <article><span>Materiais</span><strong>{money(materialTotal)}</strong><small>{directTotal > 0 ? decimal(materialTotal / directTotal * 100) : "0,00"}% do total</small><i style={{ width: `${directTotal > 0 ? materialTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Mão de obra</span><strong>{money(laborTotal)}</strong><small>{directTotal > 0 ? decimal(laborTotal / directTotal * 100) : "0,00"}% do total</small><i style={{ width: `${directTotal > 0 ? laborTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Equipamentos</span><strong>{money(equipmentTotal)}</strong><small>{directTotal > 0 ? decimal(equipmentTotal / directTotal * 100) : "0,00"}% do total</small><i style={{ width: `${directTotal > 0 ? equipmentTotal / directTotal * 100 : 0}%` }} /></article>
        <article><span>Outros custos</span><strong>{money(otherTotal)}</strong><small>{directTotal > 0 ? decimal(otherTotal / directTotal * 100) : "0,00"}% do total</small><i style={{ width: `${directTotal > 0 ? otherTotal / directTotal * 100 : 0}%` }} /></article>
      </section>

      <section className="budget-toolbar-card budget-analytic-toolbar">
        <form method="get" className="budgets-items-filter">
          <input name="q" defaultValue={queryParams.q ?? ""} placeholder="Digite o nome ou código do serviço" />
          <select name="group" defaultValue={groupFilter}><option value="">Todos os grupos</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select>
          <select name="incomplete" defaultValue={incompleteOnly ? "1" : ""}><option value="">Todos os serviços</option><option value="1">Somente itens a revisar</option></select>
          <button type="submit">Filtrar</button>
          <Link href={`/engenharia/orcamentos/${budget.id}`}>Limpar</Link>
        </form>
      </section>

      <section className="budget-table-card budget-analytic-card">
        <div className="budget-section-head">
          <div><span>Planilha orçamentária</span><h2>Serviços e custos da revisão</h2></div>
          <p>{filteredItems.length} de {items.length} serviço(s).</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-items-table">
            <thead><tr><th>Código</th><th>Serviço</th><th>Un.</th><th>Qtd.</th><th>Material/un.</th><th>M.O./un.</th><th>Equip./un.</th><th>Outros/un.</th><th>Custo un.</th><th>Custo total</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody>
              {groupSections.map((section) => (
                <Fragment key={section.id}>
                  <tr className="budget-group-row">
                    <td colSpan={12}>
                      <div className="budget-group-wrap">
                        <div><span className="budget-group-code">{section.code}</span><strong>{section.name}</strong><small>{section.allItems.length} serviço(s)</small></div>
                        <div><small>Custo do grupo</small><strong>{money(sumDirect(section.allItems))}</strong></div>
                      </div>
                    </td>
                  </tr>
                  {section.visibleItems.map((item) => (
                    <tr key={item.id} className={itemIncomplete(item) ? "budget-item-incomplete" : ""}>
                      <td><strong className="budget-code">{item.code ?? "—"}</strong></td>
                      <td><strong>{item.description}</strong>{item.notes ? <span>{item.notes}</span> : null}</td>
                      <td>{item.unit}</td><td>{decimal(item.quantity, 3)}</td><td>{money(item.material_unit_cost)}</td><td>{money(item.labor_unit_cost)}</td><td>{money(item.equipment_unit_cost)}</td><td>{money(item.other_unit_cost)}</td><td><strong>{money(item.unit_direct_cost)}</strong></td><td><strong>{money(item.total_direct_cost)}</strong></td>
                      <td>{itemIncomplete(item) ? <span className="budget-situation review">Revisar</span> : <span className="budget-situation complete">Completo</span>}</td>
                      <td>
                        {canManage && budget.status !== "archived" ? (
                          <div className="budget-item-actions">
                            <details className="budget-inline-edit budget-item-edit">
                              <summary>Editar</summary>
                              <form action={updateBudgetItem}>
                                <input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="item_id" value={item.id} />
                                <label><span>Grupo</span><select name="group_id" defaultValue={item.group_id ?? ""}><option value="">Sem grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select></label>
                                <label><span>Código</span><input name="code" defaultValue={item.code ?? ""} /></label>
                                <label className="budget-edit-wide"><span>Descrição</span><input name="description" defaultValue={item.description} required /></label>
                                <label>
                                  <span>Unidade</span>
                                  <CreatableCombobox
                                    name="unit"
                                    options={units}
                                    initialValue={item.unit}
                                    placeholder="Pesquise uma unidade"
                                    required
                                    createLabel="Criar nova unidade"
                                  />
                                </label>
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
                            <form action={deactivateBudgetItem}><input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="item_id" value={item.id} /><button className="table-action danger" type="submit">Remover</button></form>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {section.group && canManage ? (
                    <tr className="budget-group-edit-row"><td colSpan={12}><details className="budget-inline-edit budget-group-inline-edit"><summary>Editar grupo {section.code}</summary><form action={updateBudgetGroup}><input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="group_id" value={section.group.id} /><input name="code" defaultValue={section.group.code} required aria-label="Código do grupo" /><input name="name" defaultValue={section.group.name} required aria-label="Nome do grupo" /><input name="sort_order" type="number" defaultValue={section.group.sort_order} aria-label="Ordem do grupo" /><textarea name="notes" defaultValue={section.group.notes ?? ""} aria-label="Observações do grupo" /><button type="submit">Salvar grupo</button></form></details></td></tr>
                  ) : null}
                </Fragment>
              ))}
              {filteredItems.length === 0 ? <tr><td className="budget-empty-state" colSpan={12}><strong>Nenhum serviço encontrado.</strong><span>Adicione serviços ou altere os filtros da planilha.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
