import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  advanceEngineeringTakeoffStatus,
  duplicateEngineeringTakeoff,
  toggleEngineeringTakeoffRecordStatus,
} from "./actions";
import {
  TakeoffCreateDialog,
  TakeoffEditDialog,
  TakeoffLocationCreateDialog,
  TakeoffLocationEditDialog,
  type TakeoffBudgetOption,
  type TakeoffDialogData,
  type TakeoffLocationOption,
  type TakeoffServiceOption,
} from "./takeoff-dialogs";

type Project = { id: string; code: string | null; name: string };
type Composition = { id: string; service_id: string; status: "active" | "inactive" };
type CompositionItem = {
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
  status: "active" | "inactive";
};
type AdoptedPrice = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
};

type ServiceCost = {
  unitCost: number | null;
  missingPrices: number;
  itemCount: number;
};

type ConsolidatedRow = {
  service: TakeoffServiceOption;
  memories: number;
  draft: number;
  inReview: number;
  approved: number;
  total: number;
  unitCost: number | null;
  totalCost: number | null;
};

const PAGE_SIZE = 50;

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  in_review: "Em conferência",
  approved: "Aprovado",
};

const budgetStatusLabels: Record<string, string> = {
  draft: "Rascunho",
  in_progress: "Em elaboração",
  review: "Em revisão",
  approved: "Aprovado",
  archived: "Arquivado",
};

const locationTypeLabels: Record<string, string> = {
  enterprise: "Empreendimento",
  tower: "Torre / bloco",
  floor: "Pavimento",
  unit: "Unidade",
  room: "Ambiente",
  sector: "Setor",
  external: "Área externa",
  other: "Outro",
};

function decimal(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
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

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function buildQuery(params: Record<string, string>, page: number) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  return `?${query.toString()}`;
}

export default async function EngineeringTakeoffsPage({
  searchParams,
}: {
  searchParams: Promise<{
    budget?: string;
    q?: string;
    status?: string;
    location?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("takeoffs.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const statusFilter = ["draft", "in_review", "approved", "inactive"].includes(params.status ?? "") ? params.status! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const budgetsPromise = projectId
    ? supabase
        .from("engineering_budgets")
        .select("id, code, name, version, status, reference_date, updated_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(500)
    : Promise.resolve({ data: [], error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "takeoffs.manage",
      });

  const [
    projectResult,
    budgetsResult,
    locationsResult,
    servicesResult,
    takeoffsResult,
    compositionsResult,
    compositionItemsResult,
    adoptedPricesResult,
    manageResult,
  ] = await Promise.all([
    projectPromise,
    budgetsPromise,
    projectId
      ? fetchAllRows<TakeoffLocationOption>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoff_locations")
            .select("id, code, name, location_type, parent_id, repetitions, sort_order, notes, status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("sort_order")
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as TakeoffLocationOption[], error };
        })
      : Promise.resolve({ data: [] as TakeoffLocationOption[], error: null }),
    fetchAllRows<TakeoffServiceOption>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description, unit, group_code, default_method, takeoff_rule")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("group_code", { ascending: true, nullsFirst: false })
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as TakeoffServiceOption[], error };
    }),
    projectId
      ? fetchAllRows<TakeoffDialogData>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoffs")
            .select("id, budget_id, location_id, service_id, method, element_count, dimension_a, dimension_b, dimension_c, adjustment, location_repetitions_snapshot, repetition_override, repetition_reason, quantity_per_location, total_quantity, formula, unit_snapshot, source_reference, project_revision, description, status, record_status, created_at, updated_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as TakeoffDialogData[], error };
        })
      : Promise.resolve({ data: [] as TakeoffDialogData[], error: null }),
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
    fetchAllRows<AdoptedPrice>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_input_prices")
        .select("input_id, project_id, final_unit_price")
        .eq("company_id", companyId)
        .eq("status", "active")
        .eq("is_adopted", true)
        .range(from, to);
      return { data: (data ?? []) as AdoptedPrice[], error };
    }),
    managePromise,
  ]);

  const project = projectResult.data as Project | null;
  const budgets = ((budgetsResult.data ?? []) as (TakeoffBudgetOption & { reference_date: string | null; updated_at: string })[])
    .filter((budget) => budget.status !== "archived");
  const selectedBudget = budgets.find((budget) => budget.id === params.budget) ?? budgets[0] ?? null;
  const locations = locationsResult.data;
  const activeLocations = locations.filter((location) => location.status === "active");
  const services = servicesResult.data;
  const allTakeoffs = takeoffsResult.data;
  const selectedTakeoffs = selectedBudget
    ? allTakeoffs.filter((takeoff) => takeoff.budget_id === selectedBudget.id)
    : [];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const validLocationId = locations.some((location) => location.id === params.location) ? params.location! : "";

  const corporatePriceMap = new Map<string, AdoptedPrice>();
  const projectPriceMap = new Map<string, AdoptedPrice>();
  adoptedPricesResult.data.forEach((price) => {
    if (projectId && price.project_id === projectId) projectPriceMap.set(price.input_id, price);
    else if (!price.project_id) corporatePriceMap.set(price.input_id, price);
  });

  const compositionByService = new Map(
    compositionsResult.data
      .filter((composition) => composition.status === "active")
      .map((composition) => [composition.service_id, composition]),
  );
  const itemsByComposition = new Map<string, CompositionItem[]>();
  compositionItemsResult.data.forEach((item) => {
    if (item.status !== "active") return;
    const values = itemsByComposition.get(item.composition_id) ?? [];
    values.push(item);
    itemsByComposition.set(item.composition_id, values);
  });

  const serviceCostMap = new Map<string, ServiceCost>();
  services.forEach((service) => {
    const composition = compositionByService.get(service.id);
    const items = composition ? itemsByComposition.get(composition.id) ?? [] : [];
    let total = 0;
    let missingPrices = 0;
    items.forEach((item) => {
      const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id);
      if (!price) {
        missingPrices += 1;
        return;
      }
      total += Number(item.effective_coefficient) * Number(price.final_unit_price);
    });
    serviceCostMap.set(service.id, {
      unitCost: items.length > 0 && missingPrices === 0 ? total : null,
      missingPrices,
      itemCount: items.length,
    });
  });

  const activeRevisionTakeoffs = selectedTakeoffs.filter((takeoff) => takeoff.record_status === "active");
  const consolidatedMap = new Map<string, ConsolidatedRow>();
  activeRevisionTakeoffs.forEach((takeoff) => {
    const service = serviceMap.get(takeoff.service_id);
    if (!service) return;
    const cost = serviceCostMap.get(service.id)?.unitCost ?? null;
    const current = consolidatedMap.get(service.id) ?? {
      service,
      memories: 0,
      draft: 0,
      inReview: 0,
      approved: 0,
      total: 0,
      unitCost: cost,
      totalCost: cost == null ? null : 0,
    };
    const quantity = Number(takeoff.total_quantity ?? 0);
    current.memories += 1;
    current.total += quantity;
    if (takeoff.status === "draft") current.draft += quantity;
    if (takeoff.status === "in_review") current.inReview += quantity;
    if (takeoff.status === "approved") current.approved += quantity;
    current.totalCost = current.unitCost == null ? null : current.total * current.unitCost;
    consolidatedMap.set(service.id, current);
  });
  const consolidatedRows = [...consolidatedMap.values()].sort((a, b) => {
    const groupCompare = (a.service.group_code ?? "").localeCompare(b.service.group_code ?? "", "pt-BR", { numeric: true });
    return groupCompare || a.service.code.localeCompare(b.service.code, "pt-BR", { numeric: true });
  });

  const filteredTakeoffs = selectedTakeoffs.filter((takeoff) => {
    const location = takeoff.location_id ? locationMap.get(takeoff.location_id) : null;
    const service = serviceMap.get(takeoff.service_id);
    if (validLocationId && takeoff.location_id !== validLocationId) return false;
    if (statusFilter === "inactive" && takeoff.record_status !== "inactive") return false;
    if (statusFilter && statusFilter !== "inactive" && (takeoff.record_status !== "active" || takeoff.status !== statusFilter)) return false;
    if (!statusFilter && takeoff.record_status !== "active") return false;
    if (!queryText) return true;
    return [
      location?.code ?? "",
      location?.name ?? "",
      service?.code ?? "",
      service?.description ?? "",
      service?.group_code ?? "",
      takeoff.description ?? "",
      takeoff.source_reference ?? "",
      takeoff.project_revision ?? "",
      takeoff.formula,
    ].join(" ").toLowerCase().includes(queryText);
  });

  const totalPages = Math.max(1, Math.ceil(filteredTakeoffs.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageTakeoffs = filteredTakeoffs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const approvedCount = activeRevisionTakeoffs.filter((takeoff) => takeoff.status === "approved").length;
  const estimatedCost = consolidatedRows.reduce((total, row) => total + (row.totalCost ?? 0), 0);
  const servicesWithoutCost = consolidatedRows.filter((row) => row.unitCost == null).length;
  const filterParams = {
    budget: selectedBudget?.id ?? "",
    q: params.q ?? "",
    status: statusFilter,
    location: validLocationId,
  };
  const schemaMissing = [locationsResult.error, takeoffsResult.error].some((error) => error?.code === "42P01" || error?.message.includes("engineering_takeoff"));
  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "nenhuma obra selecionada";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="takeoffs"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Levantamento de Quantitativos"
      description={`${company.name} · memórias de cálculo rastreáveis por serviço e local. Obra atual: ${projectLabel}.`}
      actions={canManage && selectedBudget ? (
        <>
          <TakeoffLocationCreateDialog locations={locations} budgetId={selectedBudget.id} />
          {activeLocations.length > 0 && services.length > 0 ? (
            <TakeoffCreateDialog budget={selectedBudget} locations={activeLocations} services={services} />
          ) : null}
        </>
      ) : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {schemaMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura do levantamento ainda não está instalada. Execute a migration <strong>20260724_0021_engineering_takeoffs.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <Link href="/engenharia/servicos">≡ Serviços</Link>
        <Link href="/engenharia/insumos">◈ Insumos</Link>
        <Link href="/engenharia/precos">$ Preços e cotações</Link>
        <Link href="/engenharia/composicoes">⌘ Composições</Link>
        <span className="active">∑ Levantamento</span>
        <span>R$ Orçamento analítico</span>
      </nav>

      {!project ? (
        <section className="takeoff-empty-card">
          <strong>Selecione uma obra para iniciar o levantamento.</strong>
          <span>O levantamento sempre pertence ao empreendimento ativo.</span>
        </section>
      ) : null}

      {project && budgets.length === 0 ? (
        <section className="takeoff-empty-card">
          <strong>Crie uma revisão de orçamento antes de iniciar as memórias.</strong>
          <span>Cada quantidade deve ficar vinculada a uma revisão técnica específica.</span>
          <Link href="/engenharia/orcamentos">Abrir Cadastro de Orçamentos</Link>
        </section>
      ) : null}

      {selectedBudget ? (
        <>
          <section className="takeoff-revision-card">
            <div>
              <span>Revisão ativa no levantamento</span>
              <h2>{selectedBudget.code} · {selectedBudget.name}</h2>
              <p>{selectedBudget.version} · {budgetStatusLabels[selectedBudget.status] ?? selectedBudget.status} · data-base {dateBR(selectedBudget.reference_date)}</p>
            </div>
            <form method="get">
              <label>
                <span>Trocar revisão</span>
                <select name="budget" defaultValue={selectedBudget.id}>
                  {budgets.map((budget) => (
                    <option key={budget.id} value={budget.id}>{budget.code} · {budget.version} · {budget.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Abrir</button>
            </form>
          </section>

          <section className="takeoff-kpi-grid">
            <article><span>Serviços levantados</span><strong>{consolidatedRows.length}</strong><small>códigos com quantidade</small></article>
            <article><span>Memórias</span><strong>{activeRevisionTakeoffs.length}</strong><small>itens rastreáveis na revisão</small></article>
            <article><span>Aprovadas</span><strong>{approvedCount}</strong><small>{activeRevisionTakeoffs.length ? `${Math.round((approvedCount / activeRevisionTakeoffs.length) * 100)}% das memórias` : "sem memórias"}</small></article>
            <article><span>Locais ativos</span><strong>{activeLocations.length}</strong><small>pavimentos, unidades e setores</small></article>
            <article><span>Custo estimado</span><strong>{money(estimatedCost)}</strong><small>{servicesWithoutCost > 0 ? `${servicesWithoutCost} serviço(s) sem custo completo` : "composições e preços aplicados"}</small></article>
          </section>

          <details className="takeoff-locations-card" open={activeLocations.length === 0}>
            <summary>
              <div><span>Estrutura da obra</span><strong>Locais, pavimentos e repetições</strong></div>
              <small>{locations.length} local(is) cadastrado(s)</small>
            </summary>
            <div className="takeoff-location-grid">
              {locations.map((location) => {
                const parent = location.parent_id ? locationMap.get(location.parent_id) : null;
                return (
                  <article key={location.id} className={location.status === "inactive" ? "inactive" : ""}>
                    <div><span>{locationTypeLabels[location.location_type] ?? location.location_type}</span><strong>{location.code} · {location.name}</strong></div>
                    <p>{parent ? `Dentro de ${parent.code} · ${parent.name}` : "Nível principal"}</p>
                    <small>{decimal(location.repetitions)} repetição(ões) · ordem {location.sort_order}</small>
                    {canManage ? <TakeoffLocationEditDialog location={location} locations={locations} budgetId={selectedBudget.id} /> : null}
                  </article>
                );
              })}
              {locations.length === 0 ? <div className="takeoff-inline-empty">Cadastre o primeiro pavimento ou local para começar.</div> : null}
            </div>
          </details>

          {activeLocations.length === 0 ? (
            <section className="takeoff-empty-card compact">
              <strong>Cadastre pelo menos um local ou pavimento.</strong>
              <span>As memórias precisam de um contexto físico e de uma quantidade oficial de repetições.</span>
            </section>
          ) : null}

          {services.length === 0 ? (
            <section className="takeoff-empty-card compact">
              <strong>O catálogo ainda não possui serviços ativos.</strong>
              <Link href="/engenharia/servicos">Cadastrar serviços</Link>
            </section>
          ) : null}

          <section className="takeoff-consolidated-card">
            <div className="budget-section-head">
              <div><span>Quantitativos consolidados</span><h2>Quantidade por serviço</h2></div>
              <p>Soma das memórias ativas da revisão selecionada.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table takeoff-consolidated-table">
                <thead>
                  <tr><th>Grupo</th><th>Serviço</th><th>Un.</th><th>Memórias</th><th>Rascunho</th><th>Conferência</th><th>Aprovado</th><th>Total</th><th>Custo unit.</th><th>Custo total</th></tr>
                </thead>
                <tbody>
                  {consolidatedRows.map((row) => (
                    <tr key={row.service.id}>
                      <td>{row.service.group_code || "—"}</td>
                      <td><strong>{row.service.code}</strong><span>{row.service.description}</span></td>
                      <td>{row.service.unit}</td>
                      <td>{row.memories}</td>
                      <td>{decimal(row.draft)} {row.service.unit}</td>
                      <td>{decimal(row.inReview)} {row.service.unit}</td>
                      <td>{decimal(row.approved)} {row.service.unit}</td>
                      <td><strong>{decimal(row.total)} {row.service.unit}</strong></td>
                      <td>{row.unitCost == null ? <span className="takeoff-warning">A revisar</span> : money(row.unitCost)}</td>
                      <td><strong>{row.totalCost == null ? "—" : money(row.totalCost)}</strong></td>
                    </tr>
                  ))}
                  {consolidatedRows.length === 0 ? <tr><td className="budget-empty-state" colSpan={10}><strong>Sem quantitativos para consolidar.</strong><span>Adicione a primeira memória de cálculo.</span></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="takeoff-toolbar-card">
            <form method="get" className="takeoff-filter">
              <input type="hidden" name="budget" value={selectedBudget.id} />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Local, serviço, descrição, origem ou fórmula" />
              <select name="location" defaultValue={validLocationId}>
                <option value="">Todos os locais</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
              </select>
              <select name="status" defaultValue={statusFilter}>
                <option value="">Memórias ativas</option>
                <option value="draft">Rascunho</option>
                <option value="in_review">Em conferência</option>
                <option value="approved">Aprovado</option>
                <option value="inactive">Retiradas da revisão</option>
              </select>
              <button type="submit">Filtrar</button>
              <Link href={`?budget=${selectedBudget.id}`}>Limpar</Link>
            </form>
          </section>

          <section className="takeoff-table-card">
            <div className="budget-section-head">
              <div><span>Memórias da revisão</span><h2>Origem, fórmula e quantidade</h2></div>
              <p>{filteredTakeoffs.length} memória(s) no filtro atual.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table takeoff-memory-table">
                <thead>
                  <tr><th>Local</th><th>Serviço</th><th>Descrição</th><th>Memória</th><th>Quantidade</th><th>Origem</th><th>Status</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {pageTakeoffs.map((takeoff) => {
                    const location = takeoff.location_id ? locationMap.get(takeoff.location_id) : null;
                    const service = serviceMap.get(takeoff.service_id);
                    const isInactive = takeoff.record_status === "inactive";
                    const nextStatus = takeoff.status === "draft" ? "in_review" : takeoff.status === "in_review" ? "approved" : "draft";
                    const nextLabel = takeoff.status === "draft" ? "Conferir" : takeoff.status === "in_review" ? "Aprovar" : "Reabrir";
                    return (
                      <tr key={takeoff.id} className={isInactive ? "takeoff-row-inactive" : ""}>
                        <td><strong>{location?.code ?? "—"}</strong><span>{location?.name ?? "Local removido"}</span></td>
                        <td><strong>{service?.code ?? "—"}</strong><span>{service?.description ?? "Serviço removido"}</span></td>
                        <td>{takeoff.description || "—"}{takeoff.project_revision ? <span>Projeto {takeoff.project_revision}</span> : null}</td>
                        <td><code>{takeoff.formula}</code><span>{decimal(takeoff.quantity_per_location)} {takeoff.unit_snapshot} por local</span></td>
                        <td><strong>{decimal(takeoff.total_quantity)} {takeoff.unit_snapshot}</strong></td>
                        <td>{takeoff.source_reference || "—"}</td>
                        <td>{isInactive ? <span className="takeoff-status inactive">Retirada</span> : <span className={`takeoff-status ${takeoff.status}`}>{statusLabels[takeoff.status]}</span>}</td>
                        <td>
                          {canManage && service && selectedBudget ? (
                            <div className="takeoff-row-actions">
                              <TakeoffEditDialog budget={selectedBudget} locations={activeLocations} services={services} takeoff={takeoff} />
                              {!isInactive ? (
                                <form action={advanceEngineeringTakeoffStatus}>
                                  <input type="hidden" name="takeoff_id" value={takeoff.id} />
                                  <input type="hidden" name="budget_id" value={selectedBudget.id} />
                                  <input type="hidden" name="next_status" value={nextStatus} />
                                  <button className="table-action" type="submit">{nextLabel}</button>
                                </form>
                              ) : null}
                              {!isInactive ? (
                                <form action={duplicateEngineeringTakeoff}>
                                  <input type="hidden" name="takeoff_id" value={takeoff.id} />
                                  <input type="hidden" name="budget_id" value={selectedBudget.id} />
                                  <button className="table-action" type="submit">Duplicar</button>
                                </form>
                              ) : null}
                              <form action={toggleEngineeringTakeoffRecordStatus}>
                                <input type="hidden" name="takeoff_id" value={takeoff.id} />
                                <input type="hidden" name="budget_id" value={selectedBudget.id} />
                                <input type="hidden" name="next_record_status" value={isInactive ? "active" : "inactive"} />
                                <button className={`table-action ${isInactive ? "" : "danger"}`} type="submit">{isInactive ? "Reativar" : "Retirar"}</button>
                              </form>
                            </div>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {pageTakeoffs.length === 0 ? <tr><td className="budget-empty-state" colSpan={8}><strong>Nenhuma memória encontrada.</strong><span>Adicione a primeira memória ou altere os filtros.</span></td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="registry-pagination">
              <span>Página {page} de {totalPages}</span>
              <div>
                {page > 1 ? <Link href={buildQuery(filterParams, page - 1)}>Anterior</Link> : null}
                {page < totalPages ? <Link href={buildQuery(filterParams, page + 1)}>Próxima</Link> : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
