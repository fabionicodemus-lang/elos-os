import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { toggleEngineeringCompositionItemStatus } from "./actions";
import {
  CompositionItemCreateDialog,
  CompositionItemEditDialog,
  type CompositionInputOption,
  type CompositionItemDialogData,
  type CompositionServiceOption,
} from "./composition-dialogs";

type Service = CompositionServiceOption & {
  group_code: string | null;
  status: "active" | "inactive";
};

type Input = CompositionInputOption & {
  family_code: string | null;
};

type Composition = {
  id: string;
  service_id: string;
  notes: string | null;
  status: "active" | "inactive";
};

type CompositionItem = CompositionItemDialogData & {
  composition_id: string;
  effective_coefficient: number;
  created_at: string;
  updated_at: string;
  engineering_inputs: Input | Input[] | null;
};

type Supplier = { id: string; legal_name: string; trade_name: string | null };
type AdoptedPrice = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
  price_date: string;
  source: string | null;
  suppliers: Supplier | Supplier[] | null;
};

type Project = { id: string; code: string | null; name: string };

type EnrichedItem = CompositionItem & {
  input: Input | null;
  price: AdoptedPrice | null;
  priceScope: "project" | "corporate" | "missing";
  totalCost: number;
};

type ServiceSummary = {
  service: Service;
  composition: Composition | null;
  activeItems: EnrichedItem[];
  allItems: EnrichedItem[];
  itemCount: number;
  missingPriceCount: number;
  categoryCosts: Record<string, number>;
  totalCost: number;
  situation: "empty" | "missing_price" | "complete";
};

const PAGE_SIZE = 40;

const categoryLabels: Record<string, string> = {
  material: "Material",
  labor: "Mão de obra",
  equipment: "Equipamento",
  service: "Serviço terceirizado",
  freight: "Frete",
  other: "Outros",
};

const categoryOrder = ["material", "labor", "equipment", "service", "freight", "other"];

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
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

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function daysSince(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function buildQuery(params: Record<string, string>, page: number, serviceId?: string) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  if (serviceId) query.set("service", serviceId);
  return `?${query.toString()}`;
}

export default async function EngineeringCompositionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    group?: string;
    situation?: string;
    service?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("compositions.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const situation = ["empty", "missing_price", "complete"].includes(params.situation ?? "") ? params.situation! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "compositions.manage",
      });

  const [servicesResult, inputsResult, compositionsResult, itemsResult, pricesResult, projectResult, manageResult] = await Promise.all([
    supabase
      .from("engineering_services")
      .select("id, code, description, unit, group_code, status")
      .eq("company_id", companyId)
      .order("group_code", { ascending: true, nullsFirst: false })
      .order("code")
      .limit(10000),
    supabase
      .from("engineering_inputs")
      .select("id, code, description, unit, category, family_code")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("category")
      .order("code")
      .limit(10000),
    supabase
      .from("engineering_service_compositions")
      .select("id, service_id, notes, status")
      .eq("company_id", companyId)
      .limit(10000),
    supabase
      .from("engineering_service_composition_items")
      .select("id, composition_id, input_id, coefficient, waste_percentage, effective_coefficient, notes, status, created_at, updated_at, engineering_inputs(id, code, description, unit, category, family_code)")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("created_at")
      .limit(20000),
    supabase
      .from("engineering_input_prices")
      .select("input_id, project_id, final_unit_price, price_date, source, suppliers(id, legal_name, trade_name)")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("is_adopted", true)
      .limit(20000),
    projectPromise,
    managePromise,
  ]);

  const services = (servicesResult.data ?? []) as Service[];
  const activeServices = services.filter((service) => service.status === "active");
  const inputs = (inputsResult.data ?? []) as Input[];
  const compositions = (compositionsResult.data ?? []) as Composition[];
  const items = (itemsResult.data ?? []) as unknown as CompositionItem[];
  const adoptedPrices = (pricesResult.data ?? []) as unknown as AdoptedPrice[];
  const project = projectResult.data as Project | null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const groups = [...new Set(activeServices.map((service) => service.group_code).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const group = groups.includes(params.group ?? "") ? params.group! : "";

  const corporatePriceMap = new Map<string, AdoptedPrice>();
  const projectPriceMap = new Map<string, AdoptedPrice>();
  adoptedPrices.forEach((price) => {
    if (projectId && price.project_id === projectId) projectPriceMap.set(price.input_id, price);
    else if (!price.project_id) corporatePriceMap.set(price.input_id, price);
  });

  const compositionByService = new Map(compositions.map((composition) => [composition.service_id, composition]));
  const itemsByComposition = new Map<string, CompositionItem[]>();
  items.forEach((item) => {
    const values = itemsByComposition.get(item.composition_id) ?? [];
    values.push(item);
    itemsByComposition.set(item.composition_id, values);
  });

  const summaries: ServiceSummary[] = activeServices.map((service) => {
    const composition = compositionByService.get(service.id) ?? null;
    const rawItems = composition ? itemsByComposition.get(composition.id) ?? [] : [];
    const allItems: EnrichedItem[] = rawItems.map((item) => {
      const input = relatedOne(item.engineering_inputs);
      const projectPrice = projectPriceMap.get(item.input_id) ?? null;
      const corporatePrice = corporatePriceMap.get(item.input_id) ?? null;
      const price = projectPrice ?? corporatePrice;
      const priceScope = projectPrice ? "project" : corporatePrice ? "corporate" : "missing";
      const totalCost = item.status === "active" && price
        ? Number(item.effective_coefficient) * Number(price.final_unit_price)
        : 0;
      return { ...item, input, price, priceScope, totalCost };
    });
    const activeItems = allItems.filter((item) => item.status === "active");
    const categoryCosts: Record<string, number> = {};
    activeItems.forEach((item) => {
      const category = item.input?.category ?? "other";
      categoryCosts[category] = (categoryCosts[category] ?? 0) + item.totalCost;
    });
    const missingPriceCount = activeItems.filter((item) => !item.price).length;
    const totalCost = Object.values(categoryCosts).reduce((total, value) => total + value, 0);
    const situation: ServiceSummary["situation"] = activeItems.length === 0
      ? "empty"
      : missingPriceCount > 0
        ? "missing_price"
        : "complete";

    return {
      service,
      composition,
      activeItems,
      allItems,
      itemCount: activeItems.length,
      missingPriceCount,
      categoryCosts,
      totalCost,
      situation,
    };
  });

  const filteredSummaries = summaries.filter((summary) => {
    if (group && summary.service.group_code !== group) return false;
    if (situation && summary.situation !== situation) return false;
    if (!queryText) return true;
    return [summary.service.code, summary.service.description, summary.service.unit, summary.service.group_code ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const totalPages = Math.max(1, Math.ceil(filteredSummaries.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageSummaries = filteredSummaries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const requestedService = summaries.find((summary) => summary.service.id === params.service);
  const selectedSummary = requestedService ?? pageSummaries[0] ?? summaries[0] ?? null;
  const selectedService = selectedSummary?.service ?? null;
  const selectedActiveItems = selectedSummary?.activeItems ?? [];
  const selectedAllItems = selectedSummary?.allItems ?? [];
  const selectedMissing = selectedSummary?.missingPriceCount ?? 0;
  const composedCount = summaries.filter((summary) => summary.itemCount > 0).length;
  const completeCount = summaries.filter((summary) => summary.situation === "complete").length;
  const missingPriceServices = summaries.filter((summary) => summary.situation === "missing_price").length;
  const linkedInputs = summaries.reduce((total, summary) => total + summary.itemCount, 0);
  const filterParams = {
    q: params.q ?? "",
    group,
    situation,
  };
  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "sem obra selecionada";
  const schemaMissing = [compositionsResult.error, itemsResult.error].some((error) => error?.code === "42P01" || error?.message.includes("engineering_service_composition"));

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="compositions"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Composições de Serviços"
      description={`${company.name} · insumos, coeficientes, perdas e custos unitários dos serviços. Referência atual: ${projectLabel}.`}
      actions={canManage && selectedService ? (
        <CompositionItemCreateDialog service={selectedService} inputs={inputs} />
      ) : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {schemaMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura das composições ainda não está instalada. Execute a migration <strong>20260724_0019_engineering_service_compositions.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <Link href="/engenharia/servicos">≡ Serviços</Link>
        <Link href="/engenharia/insumos">◈ Insumos</Link>
        <Link href="/engenharia/precos">$ Preços e cotações</Link>
        <span className="active">⌘ Composições</span>
        <span>∑ Levantamento</span>
        <span>R$ Orçamento analítico</span>
      </nav>

      <section className="composition-kpi-grid">
        <article><span>Serviços ativos</span><strong>{activeServices.length}</strong><small>base disponível para composição</small></article>
        <article><span>Com composição</span><strong>{composedCount}</strong><small>serviços com insumos vinculados</small></article>
        <article><span>Composição completa</span><strong>{completeCount}</strong><small>todos os insumos possuem preço</small></article>
        <article><span>Aguardando preço</span><strong className={missingPriceServices > 0 ? "budgets-alert" : ""}>{missingPriceServices}</strong><small>serviços com referência ausente</small></article>
        <article><span>Vínculos ativos</span><strong>{linkedInputs}</strong><small>insumos usados nas composições</small></article>
        <article><span>Custo selecionado</span><strong>{selectedSummary ? money(selectedSummary.totalCost, 2) : "—"}</strong><small>por {selectedService?.unit ?? "unidade"} do serviço</small></article>
      </section>

      <section className="composition-guidance-card">
        <div>
          <span>Custo unitário automático</span>
          <h2>A composição usa primeiro o preço adotado da obra e, na falta dele, o preço corporativo</h2>
          <p>O custo de cada item é calculado pelo coeficiente efetivo multiplicado pelo preço adotado. Alterar uma cotação atualiza a leitura da composição sem apagar o histórico comercial.</p>
        </div>
        <div className="composition-guidance-flow">
          <article><b>1</b><span><strong>Coeficiente</strong><small>consumo para 1 unidade do serviço</small></span></article>
          <article><b>2</b><span><strong>Perda</strong><small>acréscimo técnico sobre o consumo</small></span></article>
          <article><b>3</b><span><strong>Preço adotado</strong><small>obra prioritária, corporativo como base</small></span></article>
          <article><b>4</b><span><strong>Custo unitário</strong><small>total consolidado por natureza</small></span></article>
        </div>
      </section>

      <section className="composition-toolbar-card">
        <form method="get" className="composition-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Código ou descrição do serviço" />
          <select name="group" defaultValue={group}>
            <option value="">Todos os grupos</option>
            {groups.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select name="situation" defaultValue={situation}>
            <option value="">Todas as situações</option>
            <option value="complete">Composição completa</option>
            <option value="missing_price">Aguardando preço</option>
            <option value="empty">Sem composição</option>
          </select>
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/composicoes">Limpar</Link>
        </form>
      </section>

      <section className="composition-map-card">
        <div className="budget-section-head">
          <div><span>Mapa corporativo</span><h2>Serviços e custos unitários compostos</h2></div>
          <p>{filteredSummaries.length} serviço(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table composition-map-table">
            <thead>
              <tr><th>Serviço</th><th>Grupo</th><th>Un.</th><th>Itens</th><th>Material</th><th>Mão de obra</th><th>Equipamentos</th><th>Terceiros</th><th>Outros</th><th>Custo unitário</th><th>Situação</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {pageSummaries.map((summary) => (
                <tr key={summary.service.id} className={selectedService?.id === summary.service.id ? "composition-service-selected" : ""}>
                  <td><strong>{summary.service.code}</strong><span>{summary.service.description}</span></td>
                  <td>{summary.service.group_code ?? "Sem grupo"}</td>
                  <td><strong>{summary.service.unit}</strong></td>
                  <td>{summary.itemCount}</td>
                  <td>{money(summary.categoryCosts.material ?? 0)}</td>
                  <td>{money(summary.categoryCosts.labor ?? 0)}</td>
                  <td>{money(summary.categoryCosts.equipment ?? 0)}</td>
                  <td>{money(summary.categoryCosts.service ?? 0)}</td>
                  <td>{money((summary.categoryCosts.freight ?? 0) + (summary.categoryCosts.other ?? 0))}</td>
                  <td><strong className="composition-total-value">{money(summary.totalCost)}</strong></td>
                  <td>
                    {summary.situation === "complete" ? <span className="composition-status complete">Completa</span> : null}
                    {summary.situation === "missing_price" ? <span className="composition-status missing">{summary.missingPriceCount} sem preço</span> : null}
                    {summary.situation === "empty" ? <span className="composition-status empty">Sem composição</span> : null}
                  </td>
                  <td><Link className="table-action composition-open-action" href={buildQuery(filterParams, page, summary.service.id)}>Abrir</Link></td>
                </tr>
              ))}
              {pageSummaries.length === 0 ? <tr><td className="budget-empty-state" colSpan={12}><strong>Nenhum serviço encontrado.</strong><span>Altere os filtros ou cadastre serviços no catálogo.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link href={buildQuery(filterParams, page - 1, selectedService?.id)}>Anterior</Link> : null}
            {page < totalPages ? <Link href={buildQuery(filterParams, page + 1, selectedService?.id)}>Próxima</Link> : null}
          </div>
        </div>
      </section>

      {selectedSummary && selectedService ? (
        <section className="composition-detail-card">
          <div className="composition-detail-head">
            <div>
              <span>Composição selecionada</span>
              <h2>{selectedService.code} · {selectedService.description}</h2>
              <p>Consumos e custos para produzir <strong>1 {selectedService.unit}</strong> do serviço.</p>
            </div>
            {canManage ? <CompositionItemCreateDialog service={selectedService} inputs={inputs} /> : null}
          </div>

          <div className="composition-cost-grid">
            {categoryOrder.map((category) => (
              <article key={category}>
                <span>{categoryLabels[category]}</span>
                <strong>{money(selectedSummary.categoryCosts[category] ?? 0)}</strong>
                <small>{selectedActiveItems.filter((item) => (item.input?.category ?? "other") === category).length} item(ns)</small>
              </article>
            ))}
            <article className="total"><span>Custo unitário total</span><strong>{money(selectedSummary.totalCost)}</strong><small>{selectedMissing > 0 ? `${selectedMissing} preço(s) pendente(s)` : `por ${selectedService.unit}`}</small></article>
          </div>

          <div className="registry-table-wrap composition-items-wrap">
            <table className="registry-table composition-items-table">
              <thead>
                <tr><th>Insumo</th><th>Natureza</th><th>Un.</th><th>Coeficiente</th><th>Perda</th><th>Coef. efetivo</th><th>Preço adotado</th><th>Escopo</th><th>Custo no serviço</th><th>Observação</th><th>Status</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {selectedAllItems.map((item) => {
                  const supplier = item.price ? relatedOne(item.price.suppliers) : null;
                  const stale = item.price ? daysSince(item.price.price_date) > 90 : false;
                  return (
                    <tr key={item.id} className={item.status === "inactive" ? "composition-item-inactive" : !item.price ? "composition-item-missing" : ""}>
                      <td><strong>{item.input?.code ?? "—"}</strong><span>{item.input?.description ?? "Insumo removido"}</span></td>
                      <td><span className={`input-category ${item.input?.category ?? "other"}`}>{categoryLabels[item.input?.category ?? "other"]}</span></td>
                      <td><strong>{item.input?.unit ?? "—"}</strong></td>
                      <td>{decimal(item.coefficient, 8)}</td>
                      <td>{Number(item.waste_percentage) > 0 ? `${decimal(item.waste_percentage, 4)}%` : "—"}</td>
                      <td><strong>{decimal(item.effective_coefficient, 8)}</strong></td>
                      <td>
                        {item.price ? <><strong>{money(item.price.final_unit_price)}</strong><span>{dateBR(item.price.price_date)}{supplier ? ` · ${supplier.trade_name || supplier.legal_name}` : ""}</span></> : <span className="composition-price-missing">Sem preço adotado</span>}
                      </td>
                      <td>
                        {item.priceScope === "project" ? <span className={`composition-price-scope project ${stale ? "stale" : ""}`}>{stale ? "Obra · revisar" : "Obra"}</span> : null}
                        {item.priceScope === "corporate" ? <span className={`composition-price-scope corporate ${stale ? "stale" : ""}`}>{stale ? "Corporativo · revisar" : "Corporativo"}</span> : null}
                        {item.priceScope === "missing" ? "—" : null}
                      </td>
                      <td><strong className="composition-total-value">{item.price ? money(item.totalCost) : "—"}</strong></td>
                      <td>{item.notes || item.price?.source || "—"}</td>
                      <td><span className={`service-status ${item.status}`}>{item.status === "active" ? "Ativo" : "Inativo"}</span></td>
                      <td>
                        {canManage ? (
                          <div className="composition-row-actions">
                            <CompositionItemEditDialog service={selectedService} inputs={inputs} item={item} />
                            <form action={toggleEngineeringCompositionItemStatus}>
                              <input type="hidden" name="item_id" value={item.id} />
                              <input type="hidden" name="service_id" value={selectedService.id} />
                              <input type="hidden" name="next_status" value={item.status === "active" ? "inactive" : "active"} />
                              <button className={`table-action ${item.status === "active" ? "danger" : ""}`} type="submit">{item.status === "active" ? "Retirar" : "Reativar"}</button>
                            </form>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {selectedAllItems.length === 0 ? <tr><td className="budget-empty-state" colSpan={12}><strong>Este serviço ainda não possui composição.</strong><span>Adicione os insumos e seus coeficientes para calcular o custo unitário.</span></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
