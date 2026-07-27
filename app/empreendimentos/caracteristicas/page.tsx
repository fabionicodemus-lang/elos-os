import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { ProjectEditDialog, type ProjectRegistryData } from "../project-dialogs";

const IMAGE_BUCKET = "project-images";

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
  const firstLine = [project.street, project.address_number].filter(Boolean).join(", ");
  const secondLine = [project.complement, project.district].filter(Boolean).join(" · ");
  return [firstLine, secondLine].filter(Boolean).join(" — ") || "—";
}

export default async function ProjectCharacteristicsPage() {
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("projects.view");

  const [projectsResult, manageResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code, project_type, status, description, postal_code, street, address_number, complement, district, city, state, land_area_m2, built_area_m2, private_area_m2, common_area_m2, total_units, total_towers, total_floors, parking_spaces, launch_date, construction_start_date, delivery_date, registration_number, notes, cover_image_path")
      .eq("company_id", companyId)
      .neq("status", "archived")
      .order("name"),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: "projects.manage",
        }),
  ]);

  const projects = ((projectsResult.data ?? []) as Omit<ProjectRegistryData, "cover_image_url">[]).map((project) => ({
    ...project,
    cover_image_url: project.cover_image_path
      ? supabase.storage.from(IMAGE_BUCKET).getPublicUrl(project.cover_image_path).data.publicUrl
      : null,
  }));
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  return (
    <AppShell
      activeGroup="projects"
      activeItem="project-characteristics"
      eyebrow="Empreendimentos"
      title="Características do Empreendimento"
      description="Visualize área, endereço, unidades, pavimentos e demais características."
    >
      {projectsResult.error ? (
        <div className="auth-message error workspace-message">
          Não foi possível carregar os dados do empreendimento: {projectsResult.error.message}
        </div>
      ) : null}

      {!project ? (
        <section className="project-details-empty">
          <strong>Nenhum empreendimento selecionado.</strong>
          <span>Cadastre ou selecione um empreendimento para visualizar suas características.</span>
          <Link href="/empreendimentos">Abrir cadastro de empreendimentos</Link>
        </section>
      ) : (
        <section className="project-details-view">
          <div className="project-details-section-head">
            <div className="project-details-title-group">
              {project.cover_image_url ? (
                <div className="project-details-cover"><img src={project.cover_image_url} alt={`Imagem do ${project.name}`} /></div>
              ) : (
                <div className="project-details-cover project-details-cover-fallback">{(project.code || project.name).slice(0, 4).toUpperCase()}</div>
              )}
              <div>
                <h2>{project.name}</h2>
                <p>{project.code || "Sem código"} · {typeLabels[project.project_type] ?? "Tipo não informado"}</p>
              </div>
            </div>
            {canManage ? (
              <ProjectEditDialog
                project={project}
                buttonLabel="Editar empreendimento"
                buttonClassName="project-details-edit-button"
              />
            ) : null}
          </div>

          <div className="project-details-kpis">
            <article><span>Área construída</span><strong>{Number(project.built_area_m2) > 0 ? `${decimal(project.built_area_m2)} m²` : "—"}</strong><small>área total cadastrada</small></article>
            <article><span>Unidades</span><strong>{project.total_units || "—"}</strong><small>apartamentos ou unidades</small></article>
            <article><span>Pavimentos</span><strong>{project.total_floors || "—"}</strong><small>pavimentos informados</small></article>
            <article><span>Vagas</span><strong>{project.parking_spaces || "—"}</strong><small>vagas de garagem</small></article>
          </div>

          <div className="project-details-grid">
            <article className="project-details-card">
              <h3>Identificação e localização</h3>
              <dl>
                <dt>Código</dt><dd>{project.code || "—"}</dd>
                <dt>Cliente / incorporadora</dt><dd>{company.name}</dd>
                <dt>Endereço</dt><dd>{address(project)}</dd>
                <dt>CEP</dt><dd>{project.postal_code || "—"}</dd>
                <dt>Cidade / UF</dt><dd>{[project.city, project.state].filter(Boolean).join(" / ") || "—"}</dd>
                <dt>Status</dt><dd><span className={`project-status ${project.status}`}>{statusLabels[project.status] ?? project.status}</span></dd>
              </dl>
            </article>

            <article className="project-details-card">
              <h3>Características físicas e datas</h3>
              <dl>
                <dt>Tipo</dt><dd>{typeLabels[project.project_type] ?? "—"}</dd>
                <dt>Área do terreno</dt><dd>{Number(project.land_area_m2) > 0 ? `${decimal(project.land_area_m2)} m²` : "—"}</dd>
                <dt>Área privativa total</dt><dd>{Number(project.private_area_m2) > 0 ? `${decimal(project.private_area_m2)} m²` : "—"}</dd>
                <dt>Área comum total</dt><dd>{Number(project.common_area_m2) > 0 ? `${decimal(project.common_area_m2)} m²` : "—"}</dd>
                <dt>Torres</dt><dd>{project.total_towers || "—"}</dd>
                <dt>Lançamento</dt><dd>{dateBR(project.launch_date)}</dd>
                <dt>Início da obra</dt><dd>{dateBR(project.construction_start_date)}</dd>
                <dt>Entrega prevista</dt><dd>{dateBR(project.delivery_date)}</dd>
              </dl>
            </article>
          </div>

          <article className="project-details-card project-details-description">
            <h3>Descrição do empreendimento</h3>
            <p>{project.description || "Nenhuma descrição complementar cadastrada."}</p>
          </article>

          <article className="project-details-card project-details-records">
            <h3>Dados complementares</h3>
            <dl>
              <dt>Matrícula / incorporação</dt><dd>{project.registration_number || "—"}</dd>
              <dt>Observações internas</dt><dd>{project.notes || "—"}</dd>
            </dl>
          </article>
        </section>
      )}
    </AppShell>
  );
}
