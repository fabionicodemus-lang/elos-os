import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { selectProjectFromRegistry } from "./actions";
import {
  ProjectCreateDialog,
  ProjectEditDialog,
  type LegalEntityOption,
  type ProjectRegistryData,
} from "./project-dialogs";

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

export default async function ProjectsRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("projects.view");
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "projects.manage",
      });

  const [projectsResult, entitiesResult, manageResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code, legal_entity_id, project_type, status, description, postal_code, street, address_number, complement, district, city, state, land_area_m2, built_area_m2, private_area_m2, common_area_m2, total_units, total_towers, total_floors, parking_spaces, launch_date, construction_start_date, delivery_date, registration_number, notes, cover_image_path")
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("legal_entities")
      .select("id, legal_name, trade_name, cnpj, status")
      .eq("company_id", companyId)
      .order("legal_name"),
    managePromise,
  ]);

  const structureMissing = Boolean(projectsResult.error || entitiesResult.error);
  const projects = ((projectsResult.data ?? []) as Omit<ProjectRegistryData, "cover_image_url">[]).map((project) => ({
    ...project,
    cover_image_url: project.cover_image_path
      ? supabase.storage.from(IMAGE_BUCKET).getPublicUrl(project.cover_image_path).data.publicUrl
      : null,
  }));
  const legalEntities = (entitiesResult.data ?? []) as LegalEntityOption[];
  const entityMap = new Map(legalEntities.map((entity) => [entity.id, entity]));
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const filtered = projects.filter((project) => {
    if (!queryText) return true;
    const entity = project.legal_entity_id ? entityMap.get(project.legal_entity_id) : null;
    return [project.name, project.code ?? "", project.city ?? "", project.state ?? "", entity?.legal_name ?? "", entity?.trade_name ?? "", company.name]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(queryText);
  });

  return (
    <AppShell
      activeGroup="projects"
      activeItem="projects"
      eyebrow="Empreendimentos"
      title="Cadastro de Empreendimentos"
      description="Cadastre cada empreendimento e mantenha seus dados principais."
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureMissing ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase as migrations <strong>20260727_0027_project_cover_images.sql</strong> e <strong>20260727_0030_legal_entities.sql</strong> para liberar a tela completa.
        </div>
      ) : null}

      <section className="project-prototype-toolbar">
        <form method="get" className="project-prototype-search-form">
          <input
            name="q"
            className="project-prototype-search"
            defaultValue={params.q ?? ""}
            placeholder="Buscar obra, empresa / SPE ou cidade"
            aria-label="Buscar empreendimento"
          />
          <button type="submit" className="project-search-submit">Buscar</button>
          {params.q ? <a href="/empreendimentos" className="project-search-clear">Limpar</a> : null}
        </form>
        {canManage ? <ProjectCreateDialog legalEntities={legalEntities} /> : null}
      </section>

      {!structureMissing && legalEntities.filter((entity) => entity.status === "active").length === 0 ? (
        <div className="auth-message error workspace-message">
          Cadastre uma empresa ativa com CNPJ válido em <strong>Empresas / SPEs</strong> antes de criar um novo empreendimento.
        </div>
      ) : null}

      <section className="project-prototype-card">
        <div className="project-prototype-table-wrap">
          <table className="project-prototype-table">
            <thead>
              <tr>
                <th>Imagem</th>
                <th>Código</th>
                <th>Empreendimento</th>
                <th>Empresa / SPE</th>
                <th>Cidade</th>
                <th>Área</th>
                <th>Unidades</th>
                <th>Pavimentos</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => {
                const entity = project.legal_entity_id ? entityMap.get(project.legal_entity_id) : null;
                return (
                  <tr key={project.id} className={project.id === projectId ? "is-active-project" : undefined}>
                    <td>
                      <div className="project-table-cover">
                        {project.cover_image_url ? (
                          <img src={project.cover_image_url} alt={`Imagem do ${project.name}`} />
                        ) : (
                          <span>{(project.code || project.name).slice(0, 4).toUpperCase()}</span>
                        )}
                      </div>
                    </td>
                    <td className="project-table-code">{project.code || "—"}</td>
                    <td>
                      <div className="project-table-name">
                        <b>{project.name}</b>
                        <small>{typeLabels[project.project_type] ?? "Empreendimento"}</small>
                      </div>
                    </td>
                    <td><div className="project-table-name"><b>{entity?.trade_name || entity?.legal_name || "Não vinculada"}</b><small>{entity?.cnpj ? entity.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "CNPJ pendente"}</small></div></td>
                    <td>{[project.city, project.state].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{Number(project.built_area_m2) > 0 ? `${decimal(project.built_area_m2)} m²` : "—"}</td>
                    <td>{project.total_units || "—"}</td>
                    <td>{project.total_floors || "—"}</td>
                    <td><span className={`project-status ${project.status}`}>{statusLabels[project.status] ?? project.status}</span></td>
                    <td>
                      <div className="project-table-actions">
                        {canManage ? <ProjectEditDialog project={project} legalEntities={legalEntities} /> : null}
                        <form action={selectProjectFromRegistry}>
                          <input type="hidden" name="project_id" value={project.id} />
                          <button className="project-table-action project-table-open" type="submit">Abrir</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!structureMissing && filtered.length === 0 ? (
                <tr><td colSpan={10} className="project-table-empty">Nenhum empreendimento encontrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
