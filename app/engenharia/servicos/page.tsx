import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { toggleEngineeringServiceStatus } from "./actions";
import { ServiceCreateDialog, ServiceEditDialog, type EngineeringServiceDialogData } from "./service-dialogs";

type EngineeringService = EngineeringServiceDialogData & {
  updated_at: string;
};

const PAGE_SIZE = 50;

const methodLabels: Record<string, string> = {
  unit: "Valor global / unidade",
  count: "Contagem",
  length: "Comprimento",
  area: "Área",
  volume: "Volume",
  weight: "Peso",
  custom: "Fórmula personalizada",
};

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function buildQuery(params: Record<string, string>, page: number) {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
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
    page?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("services.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const method = Object.keys(methodLabels).includes(params.method ?? "") ? params.method! : "";
  const status = ["active", "inactive"].includes(params.status ?? "") ? params.status! : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "services.manage",
      });

  const [servicesResult, manageResult] = await Promise.all([
    supabase
      .from("engineering_services")
      .select("id, code, description, unit, group_code, default_method, takeoff_rule, measurement_rule, notes, status, updated_at")
      .eq("company_id", companyId)
      .order("group_code", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true })
      .limit(10000),
    managePromise,
  ]);

  const services = (servicesResult.data ?? []) as EngineeringService[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const groups = [...new Set(services.map((service) => service.group_code).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const group = groups.includes(params.group ?? "") ? params.group! : "";

  const filteredServices = services.filter((service) => {
    if (group && service.group_code !== group) return false;
    if (method && service.default_method !== method) return false;
    if (status && service.status !== status) return false;
    if (!queryText) return true;
    return [service.code, service.description, service.unit, service.group_code ?? "", service.takeoff_rule ?? "", service.measurement_rule ?? "", service.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageServices = filteredServices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeServices = services.filter((service) => service.status === "active");
  const activeCount = activeServices.length;
  const inactiveCount = services.length - activeCount;
  const takeoffDefined = activeServices.filter((service) => Boolean(service.takeoff_rule?.trim())).length;
  const measurementDefined = activeServices.filter((service) => Boolean(service.measurement_rule?.trim())).length;
  const completeCount = activeServices.filter((service) => Boolean(service.takeoff_rule?.trim()) && Boolean(service.measurement_rule?.trim())).length;
  const filterParams = {
    q: params.q ?? "",
    group,
    method,
    status,
  };

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="services"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Catálogo de Serviços"
      description={`${company.name} · base técnica corporativa reutilizada nos orçamentos, levantamentos e medições de todas as obras.`}
      actions={canManage ? <ServiceCreateDialog groups={groups} /> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {servicesResult.error ? (
        <div className="auth-message error workspace-message">
          A estrutura do catálogo de serviços ainda não está instalada no Supabase. Execute a migration <strong>20260724_0015_engineering_services.sql</strong>.
        </div>
      ) : null}

      <nav className="budget-module-nav" aria-label="Etapas do orçamento de obras">
        <Link href="/engenharia/orcamentos">▦ Visão geral</Link>
        <span className="active">≡ Serviços</span>
        <span>◈ Insumos</span>
        <span>$ Preços e cotações</span>
        <span>∑ Levantamento</span>
        <span>R$ Orçamento analítico</span>
      </nav>

      <section className="service-kpi-grid">
        <article><span>Serviços ativos</span><strong>{activeCount}</strong><small>disponíveis para uso nas obras</small></article>
        <article><span>Grupos técnicos</span><strong>{groups.length}</strong><small>etapas e famílias do catálogo</small></article>
        <article><span>Critério de levantamento</span><strong>{takeoffDefined}</strong><small>{activeCount > 0 ? `${Math.round(takeoffDefined / activeCount * 100)}% dos ativos` : "base vazia"}</small></article>
        <article><span>Critério de medição</span><strong>{measurementDefined}</strong><small>{activeCount > 0 ? `${Math.round(measurementDefined / activeCount * 100)}% dos ativos` : "base vazia"}</small></article>
        <article><span>Cadastro técnico completo</span><strong>{completeCount}</strong><small>levantamento e medição definidos</small></article>
        <article><span>Inativos</span><strong>{inactiveCount}</strong><small>preservados no histórico</small></article>
      </section>

      <section className="service-guidance-card">
        <div>
          <span>Base única da incorporadora</span>
          <h2>O serviço é cadastrado uma vez e reutilizado em todas as obras</h2>
          <p>Código, unidade e critérios técnicos permanecem padronizados. As composições, insumos, preços e quantidades serão vinculados a esta mesma base nas próximas etapas.</p>
        </div>
        <div className="service-guidance-flow">
          <article><b>1</b><span><strong>Serviço técnico</strong><small>descrição, unidade e regras</small></span></article>
          <article><b>2</b><span><strong>Composição</strong><small>insumos e coeficientes</small></span></article>
          <article><b>3</b><span><strong>Levantamento</strong><small>quantidades por local</small></span></article>
          <article><b>4</b><span><strong>Orçamento</strong><small>custo real consolidado</small></span></article>
        </div>
      </section>

      <section className="service-toolbar-card">
        <form method="get" className="service-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Digite o nome, código ou critério do serviço" />
          <select name="group" defaultValue={group}>
            <option value="">Todos os grupos</option>
            {groups.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select name="method" defaultValue={method}>
            <option value="">Todos os métodos</option>
            {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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

      <section className="service-table-card">
        <div className="budget-section-head">
          <div><span>Catálogo técnico</span><h2>Serviços e critérios padronizados</h2></div>
          <p>{filteredServices.length} serviço(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table service-catalog-table">
            <thead>
              <tr><th>Código</th><th>Serviço</th><th>Grupo</th><th>Un.</th><th>Método</th><th>Critério de levantamento</th><th>Critério de medição</th><th>Status</th><th>Atualização</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {pageServices.map((service) => {
                const technicalComplete = Boolean(service.takeoff_rule?.trim()) && Boolean(service.measurement_rule?.trim());
                return (
                  <tr key={service.id} className={technicalComplete ? "" : "service-row-incomplete"}>
                    <td><strong className="budget-code">{service.code}</strong></td>
                    <td><strong>{service.description}</strong>{service.notes ? <span>{service.notes}</span> : null}</td>
                    <td>{service.group_code ?? "Sem grupo"}</td>
                    <td><strong>{service.unit}</strong></td>
                    <td><span className="service-method-badge">{methodLabels[service.default_method] ?? service.default_method}</span></td>
                    <td>{service.takeoff_rule ? <span className="service-rule-text">{service.takeoff_rule}</span> : <span className="service-pending-text">Não definido</span>}</td>
                    <td>{service.measurement_rule ? <span className="service-rule-text">{service.measurement_rule}</span> : <span className="service-pending-text">Não definido</span>}</td>
                    <td><span className={`service-status ${service.status}`}>{service.status === "active" ? "Ativo" : "Inativo"}</span></td>
                    <td>{dateBR(service.updated_at)}</td>
                    <td>
                      {canManage ? (
                        <div className="service-row-actions">
                          <ServiceEditDialog service={service} groups={groups} />
                          <form action={toggleEngineeringServiceStatus}>
                            <input type="hidden" name="service_id" value={service.id} />
                            <input type="hidden" name="next_status" value={service.status === "active" ? "inactive" : "active"} />
                            <button className={`table-action ${service.status === "active" ? "danger" : ""}`} type="submit">
                              {service.status === "active" ? "Inativar" : "Reativar"}
                            </button>
                          </form>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {pageServices.length === 0 ? (
                <tr><td className="budget-empty-state" colSpan={10}><strong>Nenhum serviço encontrado.</strong><span>Cadastre o primeiro serviço técnico ou altere os filtros.</span></td></tr>
              ) : null}
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
    </AppShell>
  );
}
