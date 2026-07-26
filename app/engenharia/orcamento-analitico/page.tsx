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
  updated_at: string;
};

type BudgetGroup = {
  budget_id: string;
  code: string;
  name: string;
  sort_order: number;
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
  service: Service;
  quantities: QuantitySummary;
  quantityUsed: number;
  unitCost: number | null;
  totalCost: number | null;
  unitNature: NatureTotals;
  totalNature: NatureTotals;
  missingPrices: number;
  compositionItems: number;
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
        .select("id, code, name, version, status, reference_date, area_m2, updated_at")
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
            .select("budget_id, code, name, sort_order")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as BudgetGroup[], error };
        })
      : Promise.resolve({ data: [] as BudgetGroup[], error: null }),
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
  const services = servicesResult.data;
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const selectedGroups = selectedBudget
    ? groupsResult.data.filter((group) => group.budget_id === selectedBudget.id)
    : [];
  const groupNameMap = new Map(selectedGroups.map((group) => [group.code.trim().toLowerCase(), group.name]));
  const groupOrderMap = new Map(selectedGroups.map((group) => [group.code.trim().toLowerCase(), group.sort_order]));

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

  const analyticalRows: AnalyticalRow[] = [];
  quantitiesByService.forEach((quantities, serviceId) => {
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
      ? Object.values(unitNature).reduce((sum, value) => sum + value, 0)
      : null;
    const totalNature = emptyNature();
    (Object.keys(totalNature) as (keyof NatureTotals)[]).forEach((key) => {
      totalNature[key] = unitNature[key] * quantityUsed;
    });

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

    analyticalRows.push({
      service,
      quantities,
      quantityUsed,
      unitCost,
      totalCost: unitCost == null ? null : unitCost * quantityUsed,
      unitNature,
      totalNature,
      missingPrices,
      compositionItems: compositionItems.length,
      statusKey,
      statusLabel,
    });
  });

  analyticalRows.sort((a, b) => {
    const groupA = (a.service.group_code ?? "").trim().toLowerCase();
    const groupB = (b.service.group_code ?? "").trim().toLowerCase();
    const orderA = groupOrderMap.get(groupA) ?? 999999;
    const orderB = groupOrderMap.get(groupB) ?? 999999;
    return orderA - orderB
      || groupA.localeCompare(groupB, "pt-BR", { numeric: true })
      || a.service.code.localeCompare(b.service.code, "pt-BR", { numeric: true });
  });

  const groupOptions = [...new Set(analyticalRows.map((row) => row.service.group_code?.trim() || "Sem grupo"))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const groupFilter = groupOptions.includes(params.group ?? "") ? params.group! : "";
  const filteredRows = analyticalRows.filter((row) => {
    const group = row.service.group_code?.trim() || "Sem grupo";
    if (groupFilter && group !== groupFilter) return false;
    if (situationFilter && row.statusKey !== situationFilter) return false;
    if (!queryText) return true;
    return [row.service.code, row.service.description, row.service.unit, row.service.group_code ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const groupedRows = new Map<string, AnalyticalRow[]>();
  filteredRows.forEach((row) => {
    const code = row.service.group_code?.trim() || "Sem grupo";
    const current = groupedRows.get(code) ?? [];
    current.push(row);
    groupedRows.set(code, current);
  });

  const completeRows = analyticalRows.filter((row) => row.statusKey === "complete" && row.quantityUsed > 0);
  const rowsWithQuantity = analyticalRows.filter((row) => row.quantityUsed > 0);
  const totalCost = completeRows.reduce((sum, row) => sum + Number(row.totalCost ?? 0), 0);
  const costPerM2 = selectedBudget && Number(selectedBudget.area_m2) > 0
    ? totalCost / Number(selectedBudget.area_m2)
    : null;
  const totalNature = emptyNature();
  completeRows.forEach((row) => addNature(totalNature, row.totalNature));
  const coverage = rowsWithQuantity.length > 0 ? completeRows.length / rowsWithQuantity.length * 100 : 0;
  const activeMemories = analyticalRows.reduce((sum, row) => sum + row.quantities.memories, 0);
  const approvedQuantityServices = analyticalRows.filter((row) => row.quantities.approved > 0).length;
  const missingCompositionCount = analyticalRows.filter((row) => row.statusKey === "missing_composition").length;
  const missingPriceCount = analyticalRows.filter((row) => row.statusKey === "missing_price").length;
  const staleInputs = new Set<string>();
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  analyticalRows.forEach((row) => {
    const composition = compositionByService.get(row.service.id);
    if (!composition) return;
    (itemsByComposition.get(composition.id) ?? []).forEach((item) => {
      const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id);
      if (price && new Date(price.price_date).getTime() < ninetyDaysAgo) staleInputs.add(item.input_id);
    });
  });

  const structureErrors = [
    budgetsResult.error,
    groupsResult.error,
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
      description={`${company.name} · consolidação de quantitativos, composições e preços. Obra atual: ${projectLabel}.`}
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
          <span>Crie uma revisão e faça o levantamento dos serviços antes da consolidação.</span>
          <Link href="/engenharia/orcamentos">Criar revisão</Link>
        </section>
      ) : null}

      {selectedBudget ? (
        <>
          <section className="analytical-reference-card">
            <div>
              <span>Revisão consolidada</span>
              <h2>{selectedBudget.code} · {selectedBudget.version} · {selectedBudget.name}</h2>
              <p>{statusLabels[selectedBudget.status]} · data-base {dateBR(selectedBudget.reference_date)} · área {decimal(selectedBudget.area_m2, 2)} m²</p>
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
                  <option value="active">Todas as memórias ativas</option>
                  <option value="approved">Somente quantidades aprovadas</option>
                </select>
              </label>
              <button type="submit">Recalcular</button>
            </form>
          </section>

          <section className="analytical-kpi-grid">
            <article><span>Custo consolidado</span><strong>{money(totalCost)}</strong><small>somente serviços com custo completo</small></article>
            <article><span>Custo por m²</span><strong>{money(costPerM2)}</strong><small>{decimal(selectedBudget.area_m2, 2)} m² na revisão</small></article>
            <article><span>Cobertura do orçamento</span><strong>{percentage(coverage)}</strong><small>{completeRows.length} de {rowsWithQuantity.length} serviço(s) com quantidade</small></article>
            <article><span>Serviços a revisar</span><strong className={analyticalRows.length - completeRows.length > 0 ? "analytical-alert-number" : ""}>{analyticalRows.length - completeRows.length}</strong><small>{missingCompositionCount} sem composição · {missingPriceCount} sem preço</small></article>
            <article><span>Memórias do levantamento</span><strong>{activeMemories}</strong><small>{approvedQuantityServices} serviço(s) com quantidade aprovada</small></article>
            <article><span>Preços desatualizados</span><strong className={staleInputs.size > 0 ? "analytical-alert-number" : ""}>{staleInputs.size}</strong><small>insumos adotados há mais de 90 dias</small></article>
          </section>

          <section className="analytical-nature-card">
            <div className="analytical-section-head">
              <div><span>Composição do custo</span><h2>Distribuição por natureza</h2></div>
              <p>Os valores consideram a base de quantidade selecionada e apenas serviços completos.</p>
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
              <input name="q" defaultValue={params.q ?? ""} placeholder="Código, serviço, grupo ou unidade" />
              <select name="group" defaultValue={groupFilter}>
                <option value="">Todos os grupos</option>
                {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
              <select name="situation" defaultValue={situationFilter}>
                <option value="">Todas as situações</option>
                <option value="complete">Completo</option>
                <option value="missing_composition">Sem composição</option>
                <option value="missing_price">Preço faltante</option>
                <option value="no_quantity">Sem quantidade</option>
              </select>
              <button type="submit">Filtrar</button>
              <Link href={`?budget=${selectedBudget.id}&base=${baseMode}`}>Limpar</Link>
            </form>
          </section>

          <section className="analytical-groups-card">
            <div className="analytical-section-head">
              <div><span>Estrutura analítica</span><h2>Serviços e custos da revisão</h2></div>
              <p>{filteredRows.length} serviço(s) no filtro atual.</p>
            </div>

            <div className="analytical-groups-list">
              {[...groupedRows.entries()].map(([groupCode, rows]) => {
                const groupTotal = rows.reduce((sum, row) => sum + Number(row.totalCost ?? 0), 0);
                const normalizedCode = groupCode.trim().toLowerCase();
                const groupName = groupNameMap.get(normalizedCode) ?? (groupCode === "Sem grupo" ? "Serviços sem grupo" : groupCode);
                return (
                  <section key={groupCode} className="analytical-group-section">
                    <header>
                      <div><span>Grupo {groupCode}</span><strong>{groupName}</strong></div>
                      <div><small>{rows.length} serviço(s)</small><b>{money(groupTotal)}</b></div>
                    </header>
                    <div className="registry-table-wrap">
                      <table className="registry-table analytical-table">
                        <thead>
                          <tr>
                            <th>Serviço</th>
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
                          {rows.map((row) => (
                            <tr key={row.service.id}>
                              <td><strong>{row.service.code}</strong><span>{row.service.description}</span></td>
                              <td>{row.service.unit}</td>
                              <td>{row.quantities.memories}</td>
                              <td>{decimal(row.quantities.total)} {row.service.unit}</td>
                              <td>{decimal(row.quantities.approved)} {row.service.unit}</td>
                              <td><strong>{decimal(row.quantityUsed)} {row.service.unit}</strong></td>
                              <td>{money(row.unitCost)}</td>
                              <td><strong>{money(row.totalCost)}</strong></td>
                              <td>
                                <span className={`analytical-status ${row.statusKey}`}>{row.statusLabel}</span>
                                {row.statusKey === "missing_composition" ? <Link href={`/engenharia/composicoes?q=${encodeURIComponent(row.service.code)}`}>Abrir composição</Link> : null}
                                {row.statusKey === "missing_price" ? <Link href="/engenharia/precos">Abrir preços</Link> : null}
                                {row.statusKey === "no_quantity" ? <Link href={`/engenharia/levantamento?budget=${selectedBudget.id}`}>Abrir levantamento</Link> : null}
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
                  <span>Faça o levantamento dos serviços ou altere os filtros.</span>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
