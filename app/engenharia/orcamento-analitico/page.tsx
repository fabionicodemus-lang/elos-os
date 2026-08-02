import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  reference_date: string | null;
  area_m2: number;
  source_system: string | null;
  updated_at: string;
};

type BudgetGroup = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  sort_order: number;
};

type BudgetItem = {
  id: string;
  budget_id: string;
  group_id: string | null;
  service_id: string | null;
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

type Service = {
  id: string;
  code: string;
  description: string;
  unit: string;
  group_code: string | null;
};

type Takeoff = {
  budget_id: string;
  service_id: string;
  total_quantity: number;
  status: "draft" | "in_review" | "approved";
  record_status: "active" | "inactive";
};

type Composition = {
  id: string;
  service_id: string;
  status: "active" | "inactive";
};

type CompositionItem = {
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
  status: "active" | "inactive";
};

type Input = {
  id: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
};

type AdoptedPrice = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
  price_date: string;
};

type QuantitySummary = {
  memories: number;
  draft: number;
  inReview: number;
  approved: number;
  total: number;
};

type NatureTotals = {
  material: number;
  labor: number;
  equipment: number;
  service: number;
  freight: number;
  other: number;
};

type AnalyticalRow = {
  id: string;
  source: "revision" | "takeoff";
  sourceLabel: string;
  serviceId: string | null;
  code: string;
  description: string;
  unit: string;
  groupCode: string;
  groupName: string;
  groupOrder: number;
  sortOrder: number;
  quantities: QuantitySummary;
  quantityUsed: number;
  unitCost: number | null;
  totalCost: number | null;
  unitNature: NatureTotals;
  totalNature: NatureTotals;
  statusKey: "complete" | "missing_composition" | "missing_price" | "no_quantity";
  statusLabel: string;
};

const statusLabels: Record<Budget["status"], string> = {
  draft: "Rascunho",
  in_progress: "Em elaboração",
  review: "Em revisão",
  approved: "Revisão fechada",
  archived: "Arquivado",
};

const natureLabels: Record<keyof NatureTotals, string> = {
  material: "Materiais",
  labor: "Mão de obra",
  equipment: "Equipamentos",
  service: "Serviços terceirizados",
  freight: "Fretes",
  other: "Outros custos",
};

function emptyNature(): NatureTotals {
  return { material: 0, labor: 0, equipment: 0, service: 0, freight: 0, other: 0 };
}

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function decimal(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function percentage(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function sumNature(value: NatureTotals) {
  return Object.values(value).reduce((sum, current) => sum + current, 0);
}

function multiplyNature(value: NatureTotals, quantity: number): NatureTotals {
  return {
    material: value.material * quantity,
    labor: value.labor * quantity,
    equipment: value.equipment * quantity,
    service: value.service * quantity,
    freight: value.freight * quantity,
    other: value.other * quantity,
  };
}

function addNature(target: NatureTotals, source: NatureTotals) {
  (Object.keys(target) as (keyof NatureTotals)[]).forEach((key) => {
    target[key] += source[key];
  });
}

export default async function AnalyticalBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{
    budget?: string;
    base?: string;
    q?: string;
    group?: string;
    situation?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("budgets.view");
  const baseMode = params.base === "approved" ? "approved" : "active";
  const queryText = (params.q ?? "").trim().toLowerCase();
  const situationFilter = ["complete", "missing_composition", "missing_price", "no_quantity"].includes(params.situation ?? "")
    ? params.situation!
    : "";

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const budgetsPromise = projectId
    ? supabase
        .from("engineering_budgets")
        .select("id, code, name, version, status, reference_date, area_m2, source_system, updated_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(500)
    : Promise.resolve({ data: [], error: null });

  const [
    projectResult,
    budgetsResult,
    groupsResult,
    budgetItemsResult,
    servicesResult,
    takeoffsResult,
    compositionsResult,
    compositionItemsResult,
    inputsResult,
    pricesResult,
  ] = await Promise.all([
    projectPromise,
    budgetsPromise,
    projectId
      ? fetchAllRows<BudgetGroup>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_budget_groups")
            .select("id, budget_id, code, name, sort_order")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as BudgetGroup[], error };
        })
      : Promise.resolve({ data: [] as BudgetGroup[], error: null }),
    projectId
      ? fetchAllRows<BudgetItem>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_budget_items")
            .select("id, budget_id, group_id, service_id, code, description, unit, quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost, unit_direct_cost, total_direct_cost, sort_order, notes")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as BudgetItem[], error };
        })
      : Promise.resolve({ data: [] as BudgetItem[], error: null }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description, unit, group_code")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("group_code", { ascending: true, nullsFirst: false })
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    projectId
      ? fetchAllRows<Takeoff>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoffs")
            .select("budget_id, service_id, total_quantity, status, record_status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .range(from, to);
          return { data: (data ?? []) as Takeoff[], error };
        })
      : Promise.resolve({ data: [] as Takeoff[], error: null }),
    fetchAllRows<Composition>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_service_compositions")
        .select("id, service_id, status")
        .eq("company_id", companyId)
        .range(from, to);
      return { data: (data ?? []) as Composition[], error };
    }),
    fetchAllRows<CompositionItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_service_composition_items")
        .select("composition_id, input_id, effective_coefficient, status")
        .eq("company_id", companyId)
        .range(from, to);
      return { data: (data ?? []) as CompositionItem[], error };
    }),
    fetchAllRows<Input>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_inputs")
        .select("id, category")
        .eq("company_id", companyId)
        .range(from, to);
      return { data: (data ?? []) as Input[], error };
    }),
    fetchAllRows<AdoptedPrice>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_input_prices")
        .select("input_id, project_id, final_unit_price, price_date")
        .eq("company_id", companyId)
        .eq("status", "active")
        .eq("is_adopted", true)
        .range(from, to);
      return { data: (data ?? []) as AdoptedPrice[], error };
    }),
  ]);

  const budgets = (budgetsResult.data ?? []) as Budget[];
  const selectedBudget = budgets.find((budget) => budget.id === params.budget) ?? budgets[0] ?? null;
  const project = projectResult.data as { id: string; code: string | null; name: string } | null;
  const selectedGroups = selectedBudget
    ? groupsResult.data.filter((group) => group.budget_id === selectedBudget.id)
    : [];
  const groupById = new Map(selectedGroups.map((group) => [group.id, group]));
  const groupByCode = new Map(selectedGroups.map((group) => [group.code.trim().toLowerCase(), group]));
  const serviceMap = new Map(servicesResult.data.map((service) => [service.id, service]));

  const compositionByService = new Map(
    compositionsResult.data
      .filter((composition) => composition.status === "active")
      .map((composition) => [composition.service_id, composition]),
  );
  const itemsByComposition = new Map<string, CompositionItem[]>();
  compositionItemsResult.data.forEach((item) => {
    if (item.status !== "active") return;
    const current = itemsByComposition.get(item.composition_id) ?? [];
    current.push(item);
    itemsByComposition.set(item.composition_id, current);
  });
  const inputMap = new Map(inputsResult.data.map((input) => [input.id, input]));
  const corporatePriceMap = new Map<string, AdoptedPrice>();
  const projectPriceMap = new Map<string, AdoptedPrice>();
  pricesResult.data.forEach((price) => {
    if (projectId && price.project_id === projectId) projectPriceMap.set(price.input_id, price);
    else if (!price.project_id) corporatePriceMap.set(price.input_id, price);
  });

  const rows: AnalyticalRow[] = [];
  const directServiceIds = new Set<string>();
  const importedRevision = Boolean(selectedBudget?.source_system === "koper" || selectedBudget?.code.startsWith("KOPER-"));

  if (selectedBudget) {
    budgetItemsResult.data
      .filter((item) => item.budget_id === selectedBudget.id)
      .forEach((item) => {
        if (item.service_id) directServiceIds.add(item.service_id);
        const group = item.group_id ? groupById.get(item.group_id) : null;
        const quantity = Number(item.quantity ?? 0);
        const unitNature: NatureTotals = {
          material: Number(item.material_unit_cost ?? 0),
          labor: Number(item.labor_unit_cost ?? 0),
          equipment: Number(item.equipment_unit_cost ?? 0),
          service: 0,
          freight: 0,
          other: Number(item.other_unit_cost ?? 0),
        };
        const calculatedUnitCost = sumNature(unitNature);
        const unitCost = Number(item.unit_direct_cost ?? 0) > 0
          ? Number(item.unit_direct_cost)
          : calculatedUnitCost;
        const totalCost = Number(item.total_direct_cost ?? 0) > 0
          ? Number(item.total_direct_cost)
          : unitCost * quantity;

        let statusKey: AnalyticalRow["statusKey"] = "complete";
        let statusLabel = importedRevision ? "Completo · Koper" : "Completo · revisão";
        if (quantity <= 0) {
          statusKey = "no_quantity";
          statusLabel = "Sem quantidade na revisão";
        } else if (unitCost <= 0) {
          statusKey = "missing_price";
          statusLabel = "Sem custo na revisão";
        }

        rows.push({
          id: `budget-item:${item.id}`,
          source: "revision",
          sourceLabel: importedRevision ? "Koper" : "Revisão",
          serviceId: item.service_id,
          code: item.code ?? "—",
          description: item.description,
          unit: item.unit,
          groupCode: group?.code ?? "Sem grupo",
          groupName: group?.name ?? "Serviços sem grupo",
          groupOrder: group?.sort_order ?? 999999,
          sortOrder: Number(item.sort_order ?? 0),
          quantities: {
            memories: 0,
            draft: 0,
            inReview: 0,
            approved: quantity,
            total: quantity,
          },
          quantityUsed: quantity,
          unitCost: unitCost > 0 ? unitCost : null,
          totalCost: unitCost > 0 ? totalCost : null,
          unitNature,
          totalNature: multiplyNature(unitNature, quantity),
          statusKey,
          statusLabel,
        });
      });
  }

  const quantitiesByService = new Map<string, QuantitySummary>();
  if (selectedBudget) {
    takeoffsResult.data
      .filter((takeoff) => takeoff.budget_id === selectedBudget.id && takeoff.record_status === "active")
      .forEach((takeoff) => {
        const quantity = Number(takeoff.total_quantity ?? 0);
        const current = quantitiesByService.get(takeoff.service_id) ?? {
          memories: 0,
          draft: 0,
          inReview: 0,
          approved: 0,
          total: 0,
        };
        current.memories += 1;
        current.total += quantity;
        if (takeoff.status === "draft") current.draft += quantity;
        if (takeoff.status === "in_review") current.inReview += quantity;
        if (takeoff.status === "approved") current.approved += quantity;
        quantitiesByService.set(takeoff.service_id, current);
      });
  }

  quantitiesByService.forEach((quantities, serviceId) => {
    if (directServiceIds.has(serviceId)) return;
    const service = serviceMap.get(serviceId);
    if (!service) return;

    const quantityUsed = baseMode === "approved" ? quantities.approved : quantities.total;
    const composition = compositionByService.get(serviceId);
    const compositionItems = composition ? itemsByComposition.get(composition.id) ?? [] : [];
    const unitNature = emptyNature();
    let missingPrices = 0;

    compositionItems.forEach((item) => {
      const input = inputMap.get(item.input_id);
      const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id);
      if (!price) {
        missingPrices += 1;
        return;
      }
      const category = input?.category ?? "other";
      unitNature[category] += Number(item.effective_coefficient ?? 0) * Number(price.final_unit_price ?? 0);
    });

    const unitCost = composition && compositionItems.length > 0 && missingPrices === 0
      ? sumNature(unitNature)
      : null;
    const groupCode = service.group_code?.trim() || "Sem grupo";
    const group = groupByCode.get(groupCode.toLowerCase());

    let statusKey: AnalyticalRow["statusKey"] = "complete";
    let statusLabel = "Completo";
    if (!composition || compositionItems.length === 0) {
      statusKey = "missing_composition";
      statusLabel = !composition ? "Sem composição" : "Composição vazia";
    } else if (missingPrices > 0) {
      statusKey = "missing_price";
      statusLabel = `${missingPrices} preço(s) faltante(s)`;
    } else if (quantityUsed <= 0) {
      statusKey = "no_quantity";
      statusLabel = baseMode === "approved" ? "Sem quantidade aprovada" : "Sem quantitativo";
    }

    rows.push({
      id: `takeoff:${service.id}`,
      source: "takeoff",
      sourceLabel: "Levantamento",
      serviceId,
      code: service.code,
      description: service.description,
      unit: service.unit,
      groupCode,
      groupName: group?.name ?? (groupCode === "Sem grupo" ? "Serviços sem grupo" : groupCode),
      groupOrder: group?.sort_order ?? 999999,
      sortOrder: 0,
      quantities,
      quantityUsed,
      unitCost,
      totalCost: unitCost == null ? null : unitCost * quantityUsed,
      unitNature,
      totalNature: multiplyNature(unitNature, quantityUsed),
      statusKey,
      statusLabel,
    });
  });

  rows.sort((a, b) =>
    a.groupOrder - b.groupOrder
    || a.groupCode.localeCompare(b.groupCode, "pt-BR", { numeric: true })
    || a.sortOrder - b.sortOrder
    || a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
  );

  const groupOptions = [...new Set(rows.map((row) => row.groupCode))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const groupFilter = groupOptions.includes(params.group ?? "") ? params.group! : "";
  const filteredRows = rows.filter((row) => {
    if (groupFilter && row.groupCode !== groupFilter) return false;
    if (situationFilter && row.statusKey !== situationFilter) return false;
    if (!queryText) return true;
    return [row.code, row.description, row.unit, row.groupCode, row.groupName, row.sourceLabel]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const groupedRows = new Map<string, AnalyticalRow[]>();
  filteredRows.forEach((row) => {
    const current = groupedRows.get(row.groupCode) ?? [];
    current.push(row);
    groupedRows.set(row.groupCode, current);
  });

  const completeRows = rows.filter((row) => row.statusKey === "complete" && row.quantityUsed > 0);
  const rowsWithQuantity = rows.filter((row) => row.quantityUsed > 0);
  const totalCost = completeRows.reduce((sum, row) => sum + Number(row.totalCost ?? 0), 0);
  const costPerM2 = selectedBudget && Number(selectedBudget.area_m2) > 0
    ? totalCost / Number(selectedBudget.area_m2)
    : null;
  const totalNature = emptyNature();
  completeRows.forEach((row) => addNature(totalNature, row.totalNature));
  const coverage = rowsWithQuantity.length > 0 ? completeRows.length / rowsWithQuantity.length * 100 : 0;
  const activeMemories = rows.reduce((sum, row) => sum + row.quantities.memories, 0);
  const reviewCount = rows.filter((row) => row.statusKey !== "complete").length;

  const structureErrors = [
    budgetsResult.error,
    groupsResult.error,
    budgetItemsResult.error,
    servicesResult.error,
    takeoffsResult.error,
    compositionsResult.error,
    compositionItemsResult.error,
    inputsResult.error,
    pricesResult.error,
  ].filter(Boolean);

  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "nenhuma obra selecionada";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="analytical-budget"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Orçamento Analítico"
      description={`${company.name} · consolidação de quantitativos, composições e valores da revisão. Obra atual: ${projectLabel}.`}
      actions={selectedBudget ? (
        <>
          <Link className="elos-button" href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link>
          <Link className="elos-button" href={`/engenharia/orcamentos/${selectedBudget.id}`}>Dados da revisão</Link>
        </>
      ) : undefined}
    >
      {structureErrors.length > 0 ? <div className="auth-message error workspace-message">Não foi possível carregar toda a cadeia de custos do orçamento.</div> : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <Link href="/engenharia/servicos">≡ Serviços</Link>
        <Link href="/engenharia/insumos">◈ Insumos</Link>
        <Link href="/engenharia/precos">$ Preços e cotações</Link>
        <Link href="/engenharia/composicoes">⌘ Composições</Link>
        <Link href="/engenharia/levantamento">∑ Levantamento</Link>
        <span className="active">R$ Orçamento analítico</span>
      </nav>

      {!project ? (
        <section className="analytical-empty-card">
          <strong>Selecione uma obra para abrir o orçamento analítico.</strong>
          <span>A consolidação sempre respeita o empreendimento ativo no topo do sistema.</span>
        </section>
      ) : null}

      {project && budgets.length === 0 ? (
        <section className="analytical-empty-card">
          <strong>A obra ainda não possui revisão de orçamento.</strong>
          <span>Crie uma revisão para iniciar a consolidação dos serviços.</span>
          <Link href="/engenharia/orcamentos">Criar revisão</Link>
        </section>
      ) : null}

      {selectedBudget ? (
        <>
          <section className="analytical-reference-card">
            <div>
              <span>Revisão consolidada</span>
              <h2>{selectedBudget.code} · {selectedBudget.version} · {selectedBudget.name}</h2>
              <p>
                {statusLabels[selectedBudget.status]} · data-base {dateBR(selectedBudget.reference_date)} · área {decimal(selectedBudget.area_m2, 2)} m²
                {importedRevision ? " · valores importados do Koper" : ""}
              </p>
            </div>
            <form method="get" className="analytical-reference-form">
              <label>
                <span>Revisão</span>
                <select name="budget" defaultValue={selectedBudget.id}>
                  {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.code} · {budget.version} · {budget.name}</option>)}
                </select>
              </label>
              <label>
                <span>Base das quantidades</span>
                <select name="base" defaultValue={baseMode}>
                  <option value="active">Revisão + memórias ativas</option>
                  <option value="approved">Revisão + levantamentos aprovados</option>
                </select>
              </label>
              <button type="submit">Recalcular</button>
            </form>
          </section>

          {importedRevision ? (
            <div className="auth-message success workspace-message">
              As quantidades importadas do Koper pertencem à própria revisão e são consideradas nas duas bases, sem exigir memória de levantamento.
            </div>
          ) : null}

          <section className="analytical-kpi-grid">
            <article><span>Custo consolidado</span><strong>{money(totalCost)}</strong><small>serviços completos da revisão</small></article>
            <article><span>Custo por m²</span><strong>{money(costPerM2)}</strong><small>{decimal(selectedBudget.area_m2, 2)} m² na revisão</small></article>
            <article><span>Cobertura do orçamento</span><strong>{percentage(coverage)}</strong><small>{completeRows.length} de {rowsWithQuantity.length} serviço(s) com custo</small></article>
            <article><span>Serviços da revisão</span><strong>{rows.length}</strong><small>{rowsWithQuantity.length} com quantidade</small></article>
            <article><span>Memórias do levantamento</span><strong>{activeMemories}</strong><small>além dos quantitativos da revisão</small></article>
            <article><span>Serviços a revisar</span><strong className={reviewCount > 0 ? "analytical-alert-number" : ""}>{reviewCount}</strong><small>sem quantidade, composição ou custo</small></article>
          </section>

          <section className="analytical-nature-card">
            <div className="analytical-section-head">
              <div><span>Composição do custo</span><h2>Distribuição por natureza</h2></div>
              <p>Valores importados preservam a natureza registrada na revisão; levantamentos usam composições e preços adotados.</p>
            </div>
            <div className="analytical-nature-grid">
              {(Object.keys(natureLabels) as (keyof NatureTotals)[]).map((key) => {
                const value = totalNature[key];
                const share = totalCost > 0 ? value / totalCost * 100 : 0;
                return (
                  <article key={key}>
                    <span>{natureLabels[key]}</span>
                    <strong>{money(value)}</strong>
                    <small>{percentage(share)} do custo consolidado</small>
                    <i style={{ width: `${Math.min(100, share)}%` }} />
                  </article>
                );
              })}
            </div>
          </section>

          <section className="analytical-toolbar-card">
            <form method="get" className="analytical-filter">
              <input type="hidden" name="budget" value={selectedBudget.id} />
              <input type="hidden" name="base" value={baseMode} />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Código, serviço, grupo, origem ou unidade" />
              <select name="group" defaultValue={groupFilter}>
                <option value="">Todos os grupos</option>
                {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
              <select name="situation" defaultValue={situationFilter}>
                <option value="">Todas as situações</option>
                <option value="complete">Completo</option>
                <option value="missing_composition">Sem composição</option>
                <option value="missing_price">Sem custo ou preço</option>
                <option value="no_quantity">Sem quantidade</option>
              </select>
              <button type="submit">Filtrar</button>
              <Link href={`?budget=${selectedBudget.id}&base=${baseMode}`}>Limpar</Link>
            </form>
          </section>

          <section className="analytical-groups-card">
            <div className="analytical-section-head">
              <div><span>Estrutura analítica</span><h2>Serviços, quantidades e valores da revisão</h2></div>
              <p>{filteredRows.length} serviço(s) no filtro atual.</p>
            </div>

            <div className="analytical-groups-list">
              {[...groupedRows.entries()].map(([groupCode, groupRows]) => {
                const groupTotal = groupRows.reduce((sum, row) => sum + Number(row.totalCost ?? 0), 0);
                const groupName = groupRows[0]?.groupName ?? groupCode;
                return (
                  <section key={groupCode} className="analytical-group-section">
                    <header>
                      <div><span>Grupo {groupCode}</span><strong>{groupName}</strong></div>
                      <div><small>{groupRows.length} serviço(s)</small><b>{money(groupTotal)}</b></div>
                    </header>
                    <div className="registry-table-wrap">
                      <table className="registry-table analytical-table">
                        <thead>
                          <tr>
                            <th>Serviço</th>
                            <th>Origem</th>
                            <th>Un.</th>
                            <th>Memórias</th>
                            <th>Qtd. total</th>
                            <th>Qtd. aprovada</th>
                            <th>Qtd. considerada</th>
                            <th>Custo unit.</th>
                            <th>Custo total</th>
                            <th>Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupRows.map((row) => (
                            <tr key={row.id}>
                              <td><strong>{row.code}</strong><span>{row.description}</span></td>
                              <td>{row.sourceLabel}</td>
                              <td>{row.unit}</td>
                              <td>{row.quantities.memories}</td>
                              <td>{decimal(row.quantities.total)} {row.unit}</td>
                              <td>{decimal(row.quantities.approved)} {row.unit}</td>
                              <td><strong>{decimal(row.quantityUsed)} {row.unit}</strong></td>
                              <td>{money(row.unitCost)}</td>
                              <td><strong>{money(row.totalCost)}</strong></td>
                              <td>
                                <span className={`analytical-status ${row.statusKey}`}>{row.statusLabel}</span>
                                {row.source === "revision" && row.statusKey !== "complete"
                                  ? <Link href={`/engenharia/orcamentos/${selectedBudget.id}`}>Revisar item</Link>
                                  : null}
                                {row.source === "takeoff" && row.statusKey === "missing_composition"
                                  ? <Link href={`/engenharia/composicoes?q=${encodeURIComponent(row.code)}`}>Abrir composição</Link>
                                  : null}
                                {row.source === "takeoff" && row.statusKey === "missing_price"
                                  ? <Link href="/engenharia/precos">Abrir preços</Link>
                                  : null}
                                {row.source === "takeoff" && row.statusKey === "no_quantity"
                                  ? <Link href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link>
                                  : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}

              {filteredRows.length === 0 ? (
                <div className="analytical-empty-inline">
                  <strong>Nenhum serviço encontrado.</strong>
                  <span>Altere os filtros ou revise os itens do orçamento.</span>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
