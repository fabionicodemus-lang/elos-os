import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { moveProjectLocation, setProjectLocationStatus } from "./actions";
import {
  LocationCreateDialog,
  LocationEditDialog,
  LocationImportDialog,
  type ProjectLocationData,
} from "./location-dialogs";

const typeLabels: Record<string, string> = {
  enterprise: "Empreendimento",
  tower: "Torre / bloco",
  floor: "Pavimento / local",
  unit: "Unidade",
  room: "Ambiente",
  sector: "Setor / trecho",
  external: "Área externa",
  other: "Outro",
};

function numberBR(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(Number(value ?? 0));
}

export default async function ProjectLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, companyId, projectId, roleKey } = await requireCompanyPermission("projects.view");

  const [projectsResult, manageResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code, status")
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

  const projects = projectsResult.data ?? [];
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const locationsResult = project
    ? await supabase
        .from("engineering_takeoff_locations")
        .select("id, parent_id, code, name, location_type, repetitions, sort_order, notes, status")
        .eq("company_id", companyId)
        .eq("project_id", project.id)
        .order("sort_order")
        .order("name")
    : { data: [], error: null };

  const locations = (locationsResult.data ?? []) as ProjectLocationData[];
  const activeLocations = locations.filter((item) => item.status === "active");
  const parentMap = new Map(locations.map((item) => [item.id, item]));
  const nextOrder = Math.max(0, ...locations.map((item) => Number(item.sort_order ?? 0))) + 10;
  const repeatedLocation = activeLocations.find((item) => Number(item.repetitions) > 1);
  const totalRepetitions = activeLocations.reduce((sum, item) => sum + Number(item.repetitions ?? 0), 0);

  return (
    <AppShell
      activeGroup="projects"
      activeItem="project-locations"
      eyebrow="Empreendimentos"
      title="Locais / Pavimentos"
      description="Organize a estrutura física do empreendimento selecionado."
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {locationsResult.error ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0028_project_locations.sql</strong> para liberar esta tela: {locationsResult.error.message}
        </div>
      ) : null}

      {!project ? (
        <section className="location-empty-state">
          <strong>Nenhum empreendimento selecionado.</strong>
          <span>Cadastre ou selecione uma obra antes de organizar seus locais e pavimentos.</span>
          <Link href="/empreendimentos">Abrir cadastro de empreendimentos</Link>
        </section>
      ) : (
        <section className="location-page">
          <div className="location-toolbar">
            <div>
              <span>Obra selecionada</span>
              <strong>{project.name}</strong>
              <small>{project.code || "Sem código"} · {activeLocations.length} local(is) ativo(s) · {numberBR(totalRepetitions)} repetição(ões)</small>
            </div>
            {canManage ? (
              <div className="location-toolbar-actions">
                <LocationImportDialog />
                <LocationCreateDialog locations={locations} nextOrder={nextOrder} />
              </div>
            ) : null}
          </div>

          <div className="location-table-card">
            <div className="location-table-wrap">
              <table className="location-table">
                <thead>
                  <tr>
                    <th>Ordem</th>
                    <th>Código</th>
                    <th>Local / Pavimento</th>
                    <th>Tipo</th>
                    <th>Repetições</th>
                    <th>Local superior</th>
                    <th>Observações</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location, index) => {
                    const parent = location.parent_id ? parentMap.get(location.parent_id) : null;
                    return (
                      <tr key={location.id} className={location.status === "inactive" ? "is-inactive" : undefined}>
                        <td>
                          <div className="location-order-cell">
                            <strong>{location.sort_order}</strong>
                            {canManage && location.status === "active" ? (
                              <div className="location-order-buttons">
                                <form action={moveProjectLocation}>
                                  <input type="hidden" name="location_id" value={location.id} />
                                  <input type="hidden" name="direction" value="up" />
                                  <button type="submit" disabled={index === 0} title="Mover para cima">↑</button>
                                </form>
                                <form action={moveProjectLocation}>
                                  <input type="hidden" name="location_id" value={location.id} />
                                  <input type="hidden" name="direction" value="down" />
                                  <button type="submit" disabled={index === locations.length - 1} title="Mover para baixo">↓</button>
                                </form>
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td><span className="location-code">{location.code}</span></td>
                        <td><div className="location-name"><strong>{location.name}</strong><small>{parent ? `Dentro de ${parent.name}` : "Nível principal"}</small></div></td>
                        <td>{typeLabels[location.location_type] ?? location.location_type}</td>
                        <td><span className="location-repetitions">× {numberBR(location.repetitions)}</span></td>
                        <td>{parent ? `${parent.code} · ${parent.name}` : "—"}</td>
                        <td className="location-notes">{location.notes || "—"}</td>
                        <td><span className={`location-status ${location.status}`}>{location.status === "active" ? "Ativo" : "Excluído"}</span></td>
                        <td>
                          {canManage ? (
                            <div className="location-actions">
                              <LocationEditDialog location={location} locations={locations} nextOrder={nextOrder} />
                              <form action={setProjectLocationStatus}>
                                <input type="hidden" name="location_id" value={location.id} />
                                <input type="hidden" name="status" value={location.status === "active" ? "inactive" : "active"} />
                                <button className={location.status === "active" ? "location-delete-button" : "location-restore-button"} type="submit">
                                  {location.status === "active" ? "Excluir" : "Reativar"}
                                </button>
                              </form>
                            </div>
                          ) : <span className="location-readonly">Somente leitura</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!locationsResult.error && locations.length === 0 ? (
                    <tr><td colSpan={9} className="location-table-empty">Nenhum local ou pavimento cadastrado para esta obra.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="location-source-section">
            <div>
              <h2>Fonte única do multiplicador</h2>
              <p>Alterar a repetição atualiza automaticamente as memórias vinculadas que não possuem override justificado.</p>
            </div>
          </div>
          <div className="location-callout">
            <b>Exemplo:</b> <span>{repeatedLocation?.code || "TIP"}</span> × {repeatedLocation ? numberBR(repeatedLocation.repetitions) : "11"}. Uma exceção pode usar outro multiplicador, mas exige justificativa registrada na própria memória.
          </div>
        </section>
      )}
    </AppShell>
  );
}
