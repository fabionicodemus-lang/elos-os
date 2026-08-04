import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  addBudgetCompositionInput,
  removeBudgetCompositionInput,
  updateBudgetCompositionInput,
} from "./actions";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  project_id: string;
};

type BudgetItem = {
  id: string;
  budget_id: string;
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
};

type Project = {
  id: string;
  code: string | null;
  name: string;
};

type Composition = {
  id: string;
  source_service_id: string | null;
  source_composition_id: string | null;
  is_customized: boolean;
};

type EngineeringInput = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
};

type CompositionItem = {
  id: string;
  input_id: string;
  coefficient: number;
  waste_percentage: number;
  effective_coefficient: number;
  unit_price: number;
  price_source: "catalog_snapshot" | "manual" | "koper" | "imported";
  sort_order: number;
  notes: string | null;
  engineering_inputs: EngineeringInput | EngineeringInput[] | null;
};

type AdoptedPrice = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
};

type EnrichedCompositionItem = CompositionItem & {
  input: EngineeringInput | null;
  unitCost: number;
  totalQuantity: number;
  totalCost: number;
};

const categoryLabels: Record<EngineeringInput["category"], string> = {
  material: "Material",
  labor: "Mão de obra",
  equipment: "Equipamento",
  service: "Serviço terceirizado",
  freight: "Frete",
  other: "Outro custo",
};

const priceSourceLabels: Record<CompositionItem["price_source"], string> = {
  catalog_snapshot: "Preço copiado ao criar a revisão",
  manual: "Preço definido nesta revisão",
  koper: "Preço importado do Koper",
  imported: "Preço importado",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function cleanServiceName(value: string) {
  return value.replace(/^(?:(?:c[oó]pia)\s+de\s+)+/i, "").trim() || value;
}

function money(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 6) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function categoryBucket(category: EngineeringInput["category"] | undefined) {
  if (category === "material" || category === "labor" || category === "equipment") return category;
  return "other";
}

export default async function BudgetItemCompositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ budgetId: string; itemId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const [{ budgetId, itemId }, queryParams] = await Promise.all([params, searchParams]);
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("budgets.view");

  let budgetQuery = supabase
    .from("engineering_budgets")
    .select("id, code, name, version, status, project_id")
    .eq("id", budgetId)
    .eq("company_id", companyId);

  let itemQuery = supabase
    .from("engineering_budget_items")
    .select("id, budget_id, code, description, unit, quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost, unit_direct_cost, total_direct_cost")
    .eq("id", itemId)
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active");

  if (projectId) {
    budgetQuery = budgetQuery.eq("project_id", projectId);
    itemQuery = itemQuery.eq("project_id", projectId);
  }

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "budgets.manage",
      });

  const [budgetResult, itemResult, manageResult] = await Promise.all([
    budgetQuery.maybeSingle(),
    itemQuery.maybeSingle(),
    managePromise,
  ]);

  if (!budgetResult.data || !itemResult.data) {
    redirect(`/engenharia/orcamentos/${budgetId}?error=${encodeURIComponent("Serviço não localizado nesta revisão.")}`);
  }

  const budget = budgetResult.data as Budget;
  const budgetItem = itemResult.data as BudgetItem;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canEdit = canManage && budget.status !== "archived";

  let compositionResult = await supabase
    .from("engineering_budget_item_compositions")
    .select("id, source_service_id, source_composition_id, is_customized")
    .eq("company_id", companyId)
    .eq("budget_id", budgetId)
    .eq("budget_item_id", itemId)
    .maybeSingle();

  const schemaMissing = compositionResult.error?.code === "42P01"
    || compositionResult.error?.message.includes("engineering_budget_item_composition");

  if (!schemaMissing && !compositionResult.data && canEdit) {
    const ensureResult = await supabase.rpc("ensure_engineering_budget_item_composition", {
      p_company_id: companyId,
      p_budget_id: budgetId,
      p_budget_item_id: itemId,
    });

    if (!ensureResult.error) {
      compositionResult = await supabase
        .from("engineering_budget_item_compositions")
        .select("id, source_service_id, source_composition_id, is_customized")
        .eq("company_id", companyId)
        .eq("budget_id", budgetId)
        .eq("budget_item_id", itemId)
        .maybeSingle();
    }
  }

  const composition = compositionResult.data as Composition | null;
  const projectPromise = supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", budget.project_id)
    .maybeSingle();

  const compositionItemsPromise = composition
    ? supabase
        .from("engineering_budget_item_composition_items")
        .select("id, input_id, coefficient, waste_percentage, effective_coefficient, unit_price, price_source, sort_order, notes, engineering_inputs(id, code, description, unit, category)")
        .eq("company_id", companyId)
        .eq("composition_id", composition.id)
        .eq("status", "active")
        .order("sort_order")
        .order("created_at")
        .limit(30000)
    : Promise.resolve({ data: [], error: null });

  const inputsPromise = supabase
    .from("engineering_inputs")
    .select("id, code, description, unit, category")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("category")
    .order("code")
    .limit(10000);

  const pricesPromise = supabase
    .from("engineering_input_prices")
    .select("input_id, project_id, final_unit_price")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("is_adopted", true)
    .limit(30000);

  const [projectResult, compositionItemsResult, inputsResult, pricesResult] = await Promise.all([
    projectPromise,
    compositionItemsPromise,
    inputsPromise,
    pricesPromise,
  ]);

  const project = projectResult.data as Project | null;
  const inputs = (inputsResult.data ?? []) as EngineeringInput[];
  const prices = (pricesResult.data ?? []) as AdoptedPrice[];
  const rawCompositionItems = (compositionItemsResult.data ?? []) as unknown as CompositionItem[];

  const projectPrices = new Map<string, number>();
  const corporatePrices = new Map<string, number>();
  prices.forEach((price) => {
    if (price.project_id === budget.project_id) projectPrices.set(price.input_id, Number(price.final_unit_price));
    else if (!price.project_id) corporatePrices.set(price.input_id, Number(price.final_unit_price));
  });

  const compositionItems: EnrichedCompositionItem[] = rawCompositionItems.map((item) => {
    const input = relatedOne(item.engineering_inputs);
    const effectiveCoefficient = Number(item.effective_coefficient ?? 0);
    const unitPrice = Number(item.unit_price ?? 0);
    return {
      ...item,
      input,
      unitCost: effectiveCoefficient * unitPrice,
      totalQuantity: effectiveCoefficient * Number(budgetItem.quantity ?? 0),
      totalCost: effectiveCoefficient * unitPrice * Number(budgetItem.quantity ?? 0),
    };
  });

  const activeInputIds = new Set(compositionItems.map((item) => item.input_id));
  const availableInputs = inputs.filter((input) => !activeInputIds.has(input.id));
  const compositionUnitCost = compositionItems.reduce((sum, item) => sum + item.unitCost, 0);
  const compositionTotalCost = compositionUnitCost * Number(budgetItem.quantity ?? 0);
  const recordedUnitCost = Number(budgetItem.unit_direct_cost ?? 0);
  const difference = compositionUnitCost - recordedUnitCost;
  const hasDifference = Math.abs(difference) > 0.01;

  const categoryTotals = compositionItems.reduce<Record<"material" | "labor" | "equipment" | "other", number>>(
    (totals, item) => {
      const bucket = categoryBucket(item.input?.category);
      totals[bucket] += item.unitCost;
      return totals;
    },
    { material: 0, labor: 0, equipment: 0, other: 0 },
  );

  const structureError = schemaMissing
    || compositionResult.error
    || compositionItemsResult.error
    || inputsResult.error
    || pricesResult.error;

  const serviceName = cleanServiceName(budgetItem.description);
  const projectLabel = project
    ? `${project.code ? `${project.code} · ` : ""}${project.name}`
    : "Obra da revisão";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamento de Obras"
      title={serviceName}
      description={`${company.name} · ${projectLabel} · ${budget.code} ${budget.version} · composição exclusiva desta revisão.`}
      actions={<Link className="elos-button" href={`/engenharia/orcamentos/${budgetId}`}>Voltar ao orçamento</Link>}
    >
      {queryParams.success ? <div className="auth-message success workspace-message">{queryParams.success}</div> : null}
      {queryParams.error ? <div className="auth-message error workspace-message">{queryParams.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          A estrutura de composições por revisão ainda não está disponível. Execute a migration <strong>20260804_0079_budget_item_compositions.sql</strong>.
        </div>
      ) : null}

      <section className="budget-item-composition-context">
        <div>
          <span>Serviço desta revisão</span>
          <strong>{budgetItem.code ?? "—"} · {serviceName}</strong>
          <small>
            As alterações feitas aqui não modificam o cadastro geral de Serviços nem outras revisões do orçamento.
          </small>
        </div>
        <div>
          <span>Origem</span>
          <strong>{composition?.is_customized ? "Composição personalizada" : "Cópia da composição-base"}</strong>
          <small>{composition?.is_customized ? "Já possui alterações exclusivas desta revisão." : "Ainda preserva os valores copiados na criação."}</small>
        </div>
      </section>

      <section className="budget-kpi-grid budget-item-composition-kpis">
        <article><span>Quantidade do serviço</span><strong>{decimal(budgetItem.quantity, 3)} {budgetItem.unit}</strong><small>quantidade desta revisão</small></article>
        <article><span>Custo unitário da composição</span><strong>{money(compositionUnitCost)}</strong><small>soma dos insumos abaixo</small></article>
        <article><span>Custo total calculado</span><strong>{money(compositionTotalCost)}</strong><small>composição × quantidade</small></article>
        <article><span>Insumos ativos</span><strong>{compositionItems.length}</strong><small>materiais, mão de obra e demais custos</small></article>
      </section>

      <section className="budgets-cost-composition budget-item-category-costs">
        <article><span>Materiais</span><strong>{money(categoryTotals.material)}</strong><small>por {budgetItem.unit}</small></article>
        <article><span>Mão de obra</span><strong>{money(categoryTotals.labor)}</strong><small>por {budgetItem.unit}</small></article>
        <article><span>Equipamentos</span><strong>{money(categoryTotals.equipment)}</strong><small>por {budgetItem.unit}</small></article>
        <article><span>Outros custos</span><strong>{money(categoryTotals.other)}</strong><small>por {budgetItem.unit}</small></article>
      </section>

      {hasDifference ? (
        <div className="auth-message workspace-message budget-composition-difference">
          A composição copiada soma <strong>{money(compositionUnitCost)}</strong> por {budgetItem.unit}, enquanto o item do orçamento registra <strong>{money(recordedUnitCost)}</strong>.
          Ao salvar, adicionar ou excluir um insumo, o custo do item será recalculado pela composição desta revisão.
        </div>
      ) : null}

      {canEdit && composition ? (
        <section className="budget-toolbar-card budget-composition-add-card">
          <div className="budget-section-head">
            <div><span>Composição desta revisão</span><h2>Adicionar insumo ou mão de obra</h2></div>
            <p>O preço informado fica congelado somente neste orçamento.</p>
          </div>
          <form action={addBudgetCompositionInput} className="budget-composition-item-form">
            <input type="hidden" name="budget_id" value={budgetId} />
            <input type="hidden" name="budget_item_id" value={itemId} />
            <label className="budget-composition-input-wide">
              <span>Insumo</span>
              <select name="input_id" defaultValue="" required>
                <option value="">Selecione o insumo</option>
                {availableInputs.map((input) => {
                  const adoptedPrice = projectPrices.get(input.id) ?? corporatePrices.get(input.id);
                  return (
                    <option key={input.id} value={input.id}>
                      {input.code} · {input.description} ({input.unit}){adoptedPrice != null ? ` · referência ${money(adoptedPrice)}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label><span>Coeficiente</span><input name="coefficient" type="number" min="0.00000001" step="0.00000001" defaultValue="1" required /></label>
            <label><span>Perda (%)</span><input name="waste_percentage" type="number" min="0" max="1000" step="0.0001" defaultValue="0" required /></label>
            <label><span>Preço unitário nesta revisão</span><input name="unit_price" type="number" min="0" step="0.000001" required /></label>
            <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={compositionItems.length + 1} /></label>
            <label className="budget-composition-input-wide"><span>Observações</span><input name="notes" placeholder="Referência, condição de compra ou justificativa do preço." /></label>
            <button type="submit" className="budget-primary-button">Adicionar à composição</button>
          </form>
        </section>
      ) : null}

      <section className="budget-table-card budget-item-composition-table-card">
        <div className="budget-section-head">
          <div><span>Composição para 1 {budgetItem.unit}</span><h2>Insumos e custos do serviço</h2></div>
          <p>{compositionItems.length} item(ns) · {money(compositionUnitCost)} por {budgetItem.unit}</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budget-item-composition-table">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Natureza</th>
                <th>Un.</th>
                <th>Coeficiente</th>
                <th>Perda</th>
                <th>Coef. efetivo</th>
                <th>Preço unit.</th>
                <th>Custo/{budgetItem.unit}</th>
                <th>Qtd. total</th>
                <th>Custo total</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {compositionItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.input?.code ?? "—"}</strong>
                    <span>{item.input?.description ?? "Insumo indisponível"}</span>
                    <small>{priceSourceLabels[item.price_source]}</small>
                  </td>
                  <td><span className={`budget-composition-category ${item.input?.category ?? "other"}`}>{categoryLabels[item.input?.category ?? "other"]}</span></td>
                  <td><strong>{item.input?.unit ?? "—"}</strong></td>
                  <td>{decimal(item.coefficient, 8)}</td>
                  <td>{decimal(item.waste_percentage, 4)}%</td>
                  <td><strong>{decimal(item.effective_coefficient, 8)}</strong></td>
                  <td>{money(item.unit_price)}</td>
                  <td><strong>{money(item.unitCost)}</strong></td>
                  <td>{decimal(item.totalQuantity, 6)} {item.input?.unit ?? ""}</td>
                  <td><strong>{money(item.totalCost)}</strong></td>
                  <td>
                    {canEdit ? (
                      <div className="budget-item-actions">
                        <details className="budget-inline-edit budget-composition-inline-edit">
                          <summary>Editar</summary>
                          <form action={updateBudgetCompositionInput}>
                            <input type="hidden" name="budget_id" value={budgetId} />
                            <input type="hidden" name="budget_item_id" value={itemId} />
                            <input type="hidden" name="composition_item_id" value={item.id} />
                            <label className="budget-edit-wide">
                              <span>Insumo</span>
                              <select name="input_id" defaultValue={item.input_id} required>
                                {inputs.map((input) => <option key={input.id} value={input.id}>{input.code} · {input.description} ({input.unit})</option>)}
                              </select>
                            </label>
                            <label><span>Coeficiente</span><input name="coefficient" type="number" min="0.00000001" step="0.00000001" defaultValue={item.coefficient} required /></label>
                            <label><span>Perda (%)</span><input name="waste_percentage" type="number" min="0" max="1000" step="0.0001" defaultValue={item.waste_percentage} required /></label>
                            <label><span>Preço unitário</span><input name="unit_price" type="number" min="0" step="0.000001" defaultValue={item.unit_price} required /></label>
                            <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={item.sort_order} /></label>
                            <label className="budget-edit-wide"><span>Observações</span><textarea name="notes" defaultValue={item.notes ?? ""} /></label>
                            <button type="submit">Salvar nesta revisão</button>
                          </form>
                        </details>
                        <form action={removeBudgetCompositionInput}>
                          <input type="hidden" name="budget_id" value={budgetId} />
                          <input type="hidden" name="budget_item_id" value={itemId} />
                          <input type="hidden" name="composition_item_id" value={item.id} />
                          <button type="submit" className="table-action danger">Excluir</button>
                        </form>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {compositionItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="budget-empty-state">
                    <strong>Esta composição ainda não possui insumos.</strong>
                    <span>Adicione materiais, mão de obra, equipamentos ou outros custos para calcular o serviço nesta revisão.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
