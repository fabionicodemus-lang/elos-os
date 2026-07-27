import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { ProjectCreateDialog, ProjectEditDialog, type ProjectRegistryData } from "./project-dialogs";

const statusLabels: Record<string, string> = {
  planning: "Planejamento",
  active: "Em construção",
  paused: "Pausado",
  completed: "Concluído",
  archived: "Arquivado",
};

const typeLabels: Record<string, string> = {
  residential: "Residencial",
  commercial: "Comercial",
  mixed: "Misto",
  land: "Loteamento",
  industrial: "Industrial",
  other: "Outro",
};

function decimal(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function address(project: ProjectRegistryData) {
  const line = [project.street, project.address_number].filter(Boolean).join(", ");
  const city = [project.district, project.city, project.state].filter(Boolean).join(" · ");
  return [line, city].filter(Boolean).join(" — ") || "Endereço não informado";
}

export default async function ProjectsRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("projects.view");
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const status = Object.keys(statusLabels).includes(params.status ?? "") ? params.status! : "";

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "projects.manage",
      });

  const [projectsResult, manageResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code, project_type, status, description, postal_code, street, address_number, complement, district, city, state, land_area_m2, built_area_m2, private_area_m2, common_area_m2, total_units, total_towers, total_floors, parking_spaces, launch_date, construction_start_date, delivery_date, registration_number, notes")
      .eq("company_id", companyId)
      .order("status")
      .order("name"),
    managePromise,
  ]);

  const structureMissing = Boolean(projectsResult.error);
  const projects = (projectsResult.data ?? []) as ProjectRegistryData[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const filtered = projects.filter((project) => {
    if (status && project.status !== status) return false;
    if (!queryText) return true;
    return [project.name, project.code ?? "", project.city ?? "", project.state ?? "", project.description ?? ""]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(queryText);
  });

  const operating = projects.filter((project) => project.status === "active");
  const portfolio = projects.filter((project) => project.status !== "archived");
  const totalUnits = portfolio.reduce((sum, project) => sum + Number(project.total_units ?? 0), 0);
  const totalBuiltArea = portfolio.reduce((sum, project) => sum + Number(project.built_area_m2 ?? 0), 0);
  const nextDelivery = portfolio
    .filter((project) => project.delivery_date && project.status !== "completed")
    .sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))[0] ?? null;

  return (
    <AppShell
      activeGroup="projects"
      activeItem="projects"
      eyebrow="Empreendimentos · Portfólio"
      title="Cadastro de Empreendimentos"
      description={`${company.name} · visão consolidada dos empreendimentos, áreas, unidades e datas principais.`}
      actions={canManage ? <ProjectCreateDialog /> : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureMissing ? (
        <div className="auth-message error workspace-message">
          A estrutura completa de Empreendimentos ainda não está instalada no Supabase. Execute a migration <strong>20260727_0026_projects_registry.sql</strong>.
        </div>
      ) : null}

      <nav className="project-module-nav" aria-label="Etapas do módulo Empreendimentos">
        <span>▣ Empresas / SPEs</span>
        <span className="active">▦ Cadastro de Empreendimentos</span>
        <span>◇ Características</span>
        <span>≡ Locais / Pavimentos</span>
        <span>⌂ Unidades privativas</span>
      </nav>

      <section className="project-kpi-grid">
        <article><span>Portfólio ativo</span><strong>{portfolio.length}</strong><small>{operating.length} em construção</small></article>
        <article><span>Unidades privativas</span><strong>{totalUnits}</strong><small>soma dos empreendimentos ativos</small></article>
        <article><span>Área construída</span><strong>{decimal(totalBuiltArea)} m²</strong><small>área total cadastrada</small></article>
        <article><span>Próxima entrega</span><strong>{nextDelivery ? dateBR(nextDelivery.delivery_date) : "—"}</strong><small>{nextDelivery?.name ?? "nenhuma data futura cadastrada"}</small></article>
      </section>

      <section className="project-filter-card">
        <form method="get">
          <label><span>Buscar</span><input name="q" defaultValue={params.q ?? ""} placeholder="Nome, código, cidade ou descrição" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="submit">Aplicar filtros</button>
          {(params.q || status) ? <a href="/empreendimentos">Limpar</a> : null}
        </form>
        <p>{filtered.length} empreendimento(s) no filtro atual.</p>
      </section>

      <section className="project-card-grid">
        {filtered.map((project) => (
          <article className="project-card" key={project.id}>
            <header>
              <div className="project-code">{project.code || project.name.slice(0, 3).toUpperCase()}</div>
              <div><span>{typeLabels[project.project_type] ?? "Empreendimento"}</span><h2>{project.name}</h2><p>{address(project)}</p></div>
              <em className={`project-status ${project.status}`}>{statusLabels[project.status] ?? project.status}</em>
            </header>

            <div className="project-card-metrics">
              <div><span>Área construída</span><strong>{decimal(project.built_area_m2)} m²</strong></div>
              <div><span>Unidades</span><strong>{project.total_units}</strong></div>
              <div><span>Pavimentos</span><strong>{project.total_floors}</strong></div>
              <div><span>Vagas</span><strong>{project.parking_spaces}</strong></div>
            </div>

            <div className="project-card-dates">
              <div><span>Início da obra</span><strong>{dateBR(project.construction_start_date)}</strong></div>
              <div><span>Entrega</span><strong>{dateBR(project.delivery_date)}</strong></div>
              <div><span>Matrícula / incorporação</span><strong>{project.registration_number || "—"}</strong></div>
            </div>

            <p className="project-description">{project.description || "Cadastre o conceito e as principais características deste empreendimento."}</p>
            <footer>{canManage ? <ProjectEditDialog project={project} /> : <span>Somente leitura</span>}<small>{project.total_towers} torre(s) · {decimal(project.land_area_m2)} m² de terreno</small></footer>
          </article>
        ))}
        {!structureMissing && filtered.length === 0 ? <div className="project-empty"><strong>Nenhum empreendimento encontrado.</strong><span>Altere os filtros ou cadastre o primeiro empreendimento.</span></div> : null}
      </section>
    </AppShell>
  );
}
