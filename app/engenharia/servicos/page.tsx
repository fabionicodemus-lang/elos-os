import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  removeEngineeringServiceInput,
  toggleEngineeringServiceStatus,
} from "./actions";
import {
  ServiceInputCreateDialog,
  ServiceInputEditDialog,
  type ServiceCompositionInputOption,
  type ServiceCompositionItemData,
} from "./composition-dialogs";
import {
  ServiceCreateDialog,
  ServiceEditDialog,
  type EngineeringServiceDialogData,
} from "./service-dialogs";

type EngineeringService = EngineeringServiceDialogData & { updated_at: string };
type EngineeringInput = ServiceCompositionInputOption & {
  family_code: string | null;
  family_label: string | null;
};
type Composition = {
  id: string;
  service_id: string;
  status: "active" | "inactive";
};
type CompositionItem = ServiceCompositionItemData & {
  composition_id: string;
  effective_coefficient: number;
  status: "active" | "inactive";
  engineering_inputs: EngineeringInput | EngineeringInput[] | null;
};
type AdoptedPrice = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
};
type Project = { id: string; code: string | null; name: string };
type EnrichedItem = CompositionItem & {
  input: EngineeringInput | null;
  price: AdoptedPrice | null;
  totalCost: number;
};
type ServiceSummary = {
  service: EngineeringService;
  composition: Composition | null;
  items: EnrichedItem[];
  categoryCosts: Record<string, number>;
  totalCost: number;
  missingPriceCount: number;
  outsourcedLabor: EnrichedItem | null;
  directLaborCount: number;
  situation: "empty" | "missing_price" | "complete";
};

const PAGE_SIZE = 40;
const methodLabels: Record<string, string> = {
  unit: "Valor global / unidade",
  count: "Contagem",
  length: "Comprimento",
  area: "Área",
  volume: "Volume",
  weight: "Peso",
  custom: "Fórmula personalizada",
};
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

function decimal(value: number | null | undefined, digits = 8) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isOutsourcedLabor(input: EngineeringInput | null) {
  if (!input || input.category !== "labor") return false;
  return input.family_code === "MO-EMP" || normalizeText(input.description).includes("mao de obra empreitada");
}

function excludedFromAutomaticLabor(service: EngineeringService) {
  const value = normalizeText(`${service.group_code ?? ""} ${service.description}`);
  return /(estrutura|estrutural|fundacao|estaca|concreto|armacao|forma|laje|viga|pilar|instalac|eletric|hidraul|sanitar|esgoto|agua fria|agua quente|gas|incendio|spda|climatiz|elevador|automacao|telecom|cftv|esquadr|aluminio|vidro|serralher|porta|janela)/.test(value);
}

function buildQuery(params: Record<string, string>, page: number, serviceId?: string) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  if (serviceId) query.set("service", serviceId);
  return `?${query.toString()}`;
}

export default async function EngineeringServicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    group?: string;
    method?: string;
    status?: string;
    situation?: string;
    service?: string;
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("services.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const method = Object.keys(methodLabels).includes(params.method ?? "") ? params.method! : "";
  const status = ["active", "inactive"].includes(params.status ?? "") ? params.status! : "";
  const situation = ["empty", "missing_price", "complete"].includes(params.situation ?? "") ? params.situation! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "services.manage",
      });

  const [servicesResult, inputsResult, compositionsResult, itemsResult, pricesResult, projectResult, manageResult] = await Promise.all([
    supabase
      .from("engineering_services")
      .select("id, code, description, unit, group_code, default_method, takeoff_rule, measurement_rule, notes, status, updated_at")
      .eq("company_id", companyId)
      .order("group_code", { ascending: true, nullsFirst: false })
      .order("code")
      .limit(10000),
    supabase
      .from("engineering_inputs")
      .select("id, code, description, unit, category, family_code, family_label")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("category")
      .order("code")
      .limit(10000),
    supabase
      .from("engineering_service_compositions")
      .select("id, service_id, status")
      .eq("company_id", companyId)
      .limit(10000),
    supabase
      .from("engineering_service_composition_items")
      .select("id, composition_id, input_id, coefficient, waste_percentage, effective_coefficient, notes, status, engineering_inputs(id, code, description, unit, category, family_code, family_label)")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("sort_order")
      .limit(30000),
    supabase
      .from("engineering_input_prices")
      .select("input_id, project_id, final_unit_price")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("is_adopted", true)
      .limit(30000),
    projectPromise,
    managePromise,
  ]);

  const services = (servicesResult.data ?? []) as EngineeringService[];
  const inputs = (inputsResult.data ?? []) as EngineeringInput[];
  const compositions = (compositionsResult.data ?? []) as Composition[];
  const items = (itemsResult.data ?? []) as unknown as CompositionItem[];
  const prices = (pricesResult.data ?? []) as AdoptedPrice[];
  const project = projectResult.data as Project | null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const groups = [...new Set(services.map((service) => service.group_code).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const units = [...new Set([
    ...services.map((service) => service.unit),
    ...inputs.map((input) => input.unit),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const group = groups.includes(params.group ?? "") ? params.group! : "";

  const corporatePriceMap = new Map<string, AdoptedPrice>();
  const projectPriceMap = new Map<string, AdoptedPrice>();
  prices.forEach((price) => {
    if (projectId && price.project_id === projectId) projectPriceMap.set(price.input_id, price);
    else if (!price.project_id) corporatePriceMap.set(price.input_id, price);
  });

  const compositionByService = new Map(compositions.map((composition) => [composition.service_id, composition]));
  const itemsByComposition = new Map<string, CompositionItem[]>();
  items.forEach((item) => {
    const current = itemsByComposition.get(item.composition_id) ?? [];
    current.push(item);
    itemsByComposition.set(item.composition_id, current);
  });

  const summaries: ServiceSummary[] = services.map((service) => {
    const composition = compositionByService.get(service.id) ?? null;
    const rawItems = composition ? itemsByComposition.get(composition.id) ?? [] : [];
    const enrichedItems: EnrichedItem[] = rawItems.map((item) => {
      const input = relatedOne(item.engineering_inputs);
      const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id) ?? null;
      return {
        ...item,
        input,
        price,
        totalCost: price ? Number(item.effective_coefficient) * Number(price.final_unit_price) : 0,
      };
    });
    const categoryCosts: Record<string, number> = {};
    enrichedItems.forEach((item) => {
      const category = item.input?.category ?? "other";
      categoryCosts[category] = (categoryCosts[category] ?? 0) + item.totalCost;
    });
    const missingPriceCount = enrichedItems.filter((item) => !item.price).length;
    const totalCost = Object.values(categoryCosts).reduce((sum, value) => sum + value, 0);
    const outsourcedLabor = enrichedItems.find((item) => isOutsourcedLabor(item.input)) ?? null;
    const directLaborCount = enrichedItems.filter((item) => item.input?.category === "labor" && !isOutsourcedLabor(item.input)).length;
    const itemSituation: ServiceSummary["situation"] = enrichedItems.length === 0
      ? "empty"
      : missingPriceCount > 0
        ? "missing_price"
        : "complete";

    return {
      service,
      composition,
      items: enrichedItems,
      categoryCosts,
      totalCost,
      missingPriceCount,
      outsourcedLabor,
      directLaborCount,
      situation: itemSituation,
    };
  });

  const filteredSummaries = summaries.filter((summary) => {
    const service = summary.service;
    if (group && service.group_code !== group) return false;
    if (method && service.default_method !== method) return false;
    if (status && service.status !== status) return false;
    if (situation && summary.situation !== situation) return false;
    if (!queryText) return true;
    return [service.code, service.description, service.unit, service.group_code ?? "", service.takeoff_rule ?? "", service.measurement_rule ?? ""]
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
  const activeServices = summaries.filter((summary) => summary.service.status === "active");
  const composedCount = activeServices.filter((summary) => summary.items.length > 0).length;
  const completeCount = activeServices.filter((summary) => summary.situation === "complete").length;
  const outsourcedCount = activeServices.filter((summary) => Boolean(summary.outsourcedLabor)).length;
  const directLaborLinks = summaries.reduce((sum, summary) => sum + summary.directLaborCount, 0);
  const linkedInputs = activeServices.reduce((sum, summary) => sum + summary.items.length, 0);
  const filterParams = {
    q: params.q ?? "",
    group,
    method,
    status,
    situation,
  };
  const schemaMissing = [compositionsResult.error, itemsResult.error].some((error) => error?.code === "42P01" || error?.message.includes("engineering_service_composition"));
  const projectLabel = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "preços corporativos";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="services"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Serviços"
      description={`${company.name} · cadastro técnico e insumos de cada serviço em uma única tela. Custos pela referência ${projectLabel}.`}
      actions={canManage ? <ServiceCreateDialog groups={groups} units={units} /> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {servicesResult.error || schemaMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura integrada de serviços ainda não está instalada. Execute a migration <strong>20260729_0049_engineering_services_compositions_merge.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <span className="active">≡ Serviços</span>
        <Link href="/engenharia/insumos">◈ Insumos</Link>
        <Link href="/engenharia/precos">$ Preços e cotações</Link>
        <Link href="/engenharia/levantamento">∑ Levantamento</Link>
        <Link href="/engenharia/orcamento-analitico">R$ Orçamento analítico</Link>
      </nav>

      <section className="composition-kpi-grid services-composition-kpis">
        <article><span>Serviços ativos</span><strong>{activeServices.length}</strong><small>cadastro técnico disponível</small></article>
        <article><span>Com insumos</span><strong>{composedCount}</strong><small>serviços já compostos</small></article>
        <article><span>Com custo completo</span><strong>{completeCount}</strong><small>todos os insumos com preço</small></article>
        <article><span>Mão de obra empreitada</span><strong>{outsourcedCount}</strong><small>serviços com empreitada vinculada</small></article>
        <article><span>Insumos ativos</span><strong>{linkedInputs}</strong><small>vínculos nos serviços</small></article>
        <article><span>Mão de obra direta</span><strong className={directLaborLinks > 0 ? "budgets-alert" : ""}>{directLaborLinks}</strong><small>{directLaborLinks > 0 ? "revisar vínculos remanescentes" : "nenhum vínculo ativo"}</small></article>
      </section>

      <section className="service-guidance-card merged-service-guidance">
        <div>
          <span>Cadastro e composição unificados</span>
          <h2>Abra o serviço para editar diretamente os insumos e coeficientes</h2>
          <p>A mão de obra direta foi retirada da base ativa. Nos serviços aplicáveis, o sistema usa mão de obra empreitada com coeficiente 1 por unidade do serviço. Estrutura, instalações e esquadrias permanecem sem inclusão automática.</p>
        </div>
        <div className="service-guidance-flow">
          <article><b>1</b><span><strong>Serviço</strong><small>código, unidade e critérios</small></span></article>
          <article><b>2</b><span><strong>Insumos</strong><small>materiais e empreitada</small></span></article>
          <article><b>3</b><span><strong>Coeficientes</strong><small>consumo e perdas</small></span></article>
          <article><b>4</b><span><strong>Custo unitário</strong><small>preços adotados</small></span></article>
        </div>
      </section>

      <section className="service-toolbar-card">
        <form method="get" className="service-filter merged-service-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Código, serviço ou critério técnico" />
          <select name="group" defaultValue={group}>
            <option value="">Todos os grupos</option>
            {groups.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select name="method" defaultValue={method}>
            <option value="">Todos os métodos</option>
            {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select name="situation" defaultValue={situation}>
            <option value="">Todas as composições</option>
            <option value="complete">Custo completo</option>
            <option value="missing_price">Aguardando preço</option>
            <option value="empty">Sem insumos</option>
          </select>
          <select name="status" defaultValue={status}>
            <option value="">Ativos e inativos</option>
            <option value="active">Somente ativos</option>
            <option value="inactive">Somente inativos</option>
          </select>
          <button type="submit">Filtrar</button>
          <Link href="/engenharia/servicos">Limpar</Link>
        </form>
      </section>

      <section className="composition-map-card merged-services-map">
        <div className="budget-section-head">
          <div><span>Base técnica corporativa</span><h2>Serviços e seus insumos</h2></div>
          <p>{filteredSummaries.length} serviço(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table composition-map-table merged-services-table">
            <thead>
              <tr><th>Serviço</th><th>Grupo</th><th>Un.</th><th>Insumos</th><th>Materiais</th><th>Mão de obra empreitada</th><th>Custo unitário</th><th>Situação</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {pageSummaries.map((summary) => {
                const service = summary.service;
                const selected = selectedService?.id === service.id;
                const excluded = excludedFromAutomaticLabor(service);
                return (
                  <tr key={service.id} className={selected ? "composition-service-selected" : ""}>
                    <td><strong>{service.code}</strong><span>{service.description}</span><small>{methodLabels[service.default_method] ?? service.default_method}</small></td>
                    <td>{service.group_code ?? "Sem grupo"}</td>
                    <td><strong>{service.unit}</strong></td>
                    <td><strong>{summary.items.length}</strong></td>
                    <td>{money(summary.categoryCosts.material ?? 0)}</td>
                    <td>
                      {summary.outsourcedLabor?.input ? <><strong className="outsourced-labor-name">{summary.outsourcedLabor.input.description}</strong><small>coef. {decimal(summary.outsourcedLabor.effective_coefficient)}</small></> : <span className={`labor-policy-badge ${excluded ? "excluded" : "pending"}`}>{excluded ? "Não aplicável" : "Aguardando vínculo"}</span>}
                    </td>
                    <td><strong className="composition-total-value">{money(summary.totalCost)}</strong></td>
                    <td>
                      <span className={`service-status ${service.status}`}>{service.status === "active" ? "Ativo" : "Inativo"}</span>
                      {summary.situation === "missing_price" ? <small className="composition-price-missing">{summary.missingPriceCount} sem preço</small> : null}
                      {summary.situation === "empty" ? <small>Sem insumos</small> : null}
                    </td>
                    <td>
                      <div className="service-row-actions merged-service-actions">
                        <Link className="table-action composition-open-action" href={buildQuery(filterParams, page, service.id)}>Abrir</Link>
                        {canManage ? <ServiceEditDialog service={service} groups={groups} units={units} /> : null}
                        {canManage ? (
                          <form action={toggleEngineeringServiceStatus}>
                            <input type="hidden" name="service_id" value={service.id} />
                            <input type="hidden" name="next_status" value={service.status === "active" ? "inactive" : "active"} />
                            <button className={`table-action ${service.status === "active" ? "danger" : ""}`} type="submit">{service.status === "active" ? "Inativar" : "Reativar"}</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageSummaries.length === 0 ? <tr><td className="budget-empty-state" colSpan={9}><strong>Nenhum serviço encontrado.</strong><span>Altere os filtros ou cadastre um novo serviço.</span></td></tr> : null}
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
        <section className="composition-detail-card merged-service-detail" id="insumos-do-servico">
          <div className="composition-detail-head">
            <div>
              <span>Serviço aberto</span>
              <h2>{selectedService.code} · {selectedService.description}</h2>
              <p>Insumos e coeficientes para executar <strong>1 {selectedService.unit}</strong>.</p>
            </div>
            <div className="merged-detail-actions">
              {canManage ? <ServiceEditDialog service={selectedService} groups={groups} units={units} /> : null}
              {canManage && selectedService.status === "active" ? <ServiceInputCreateDialog service={selectedService} inputs={inputs} /> : null}
            </div>
          </div>

          <div className="service-technical-strip">
            <article><span>Grupo</span><strong>{selectedService.group_code ?? "Sem grupo"}</strong></article>
            <article><span>Método</span><strong>{methodLabels[selectedService.default_method] ?? selectedService.default_method}</strong></article>
            <article><span>Levantamento</span><strong>{selectedService.takeoff_rule || "Não definido"}</strong></article>
            <article><span>Medição</span><strong>{selectedService.measurement_rule || "Não definido"}</strong></article>
          </div>

          <div className="composition-cost-grid">
            {categoryOrder.map((category) => (
              <article key={category}>
                <span>{categoryLabels[category]}</span>
                <strong>{money(selectedSummary.categoryCosts[category] ?? 0)}</strong>
                <small>{selectedSummary.items.filter((item) => (item.input?.category ?? "other") === category).length} item(ns)</small>
              </article>
            ))}
            <article className="total"><span>Custo unitário total</span><strong>{money(selectedSummary.totalCost)}</strong><small>{selectedSummary.missingPriceCount > 0 ? `${selectedSummary.missingPriceCount} preço(s) pendente(s)` : `por ${selectedService.unit}`}</small></article>
          </div>

          <div className="registry-table-wrap composition-items-wrap">
            <table className="registry-table composition-items-table merged-service-items-table">
              <thead>
                <tr><th>Insumo</th><th>Natureza</th><th>Un.</th><th>Coeficiente</th><th>Perda</th><th>Coef. efetivo</th><th>Preço adotado</th><th>Custo no serviço</th><th>Observação</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {selectedSummary.items.map((item) => (
                  <tr key={item.id} className={!item.price ? "composition-item-missing" : ""}>
                    <td><strong>{item.input?.code ?? "—"}</strong><span>{item.input?.description ?? "Insumo indisponível"}</span>{isOutsourcedLabor(item.input) ? <small className="outsourced-labor-tag">Empreitada do serviço</small> : null}</td>
                    <td><span className={`input-category ${item.input?.category ?? "other"}`}>{categoryLabels[item.input?.category ?? "other"]}</span></td>
                    <td><strong>{item.input?.unit ?? "—"}</strong></td>
                    <td>{decimal(item.coefficient)}</td>
                    <td>{Number(item.waste_percentage) > 0 ? `${decimal(item.waste_percentage, 4)}%` : "—"}</td>
                    <td><strong>{decimal(item.effective_coefficient)}</strong></td>
                    <td>{item.price ? <strong>{money(item.price.final_unit_price)}</strong> : <span className="composition-price-missing">Sem preço adotado</span>}</td>
                    <td><strong className="composition-total-value">{item.price ? money(item.totalCost) : "—"}</strong></td>
                    <td>{item.notes || "—"}</td>
                    <td>
                      {canManage ? (
                        <div className="composition-row-actions">
                          <ServiceInputEditDialog service={selectedService} inputs={inputs} item={item} />
                          <form action={removeEngineeringServiceInput}>
                            <input type="hidden" name="item_id" value={item.id} />
                            <input type="hidden" name="service_id" value={selectedService.id} />
                            <button className="table-action danger" type="submit">Excluir</button>
                          </form>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {selectedSummary.items.length === 0 ? <tr><td className="budget-empty-state" colSpan={10}><strong>Este serviço ainda não possui insumos.</strong><span>Adicione materiais, equipamentos ou outros custos para formar o custo unitário.</span></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
