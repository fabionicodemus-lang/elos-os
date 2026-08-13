"use client";

import { useMemo, useState } from "react";
import { selectWorkspace } from "./actions";

export type DashboardProjectCard = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  city: string | null;
  state: string | null;
  coverImageUrl: string | null;
  deliveryDate: string | null;
  builtAreaM2: number | null;
  totalUnits: number | null;
  totalFloors: number | null;
  progressPercent: number;
  memoryCount: number;
  isActiveProject: boolean;
};

const statusLabels: Record<string, string> = {
  planning: "Planejamento",
  active: "Em execução",
  paused: "Pausado",
  completed: "Concluído",
  archived: "Arquivado",
};

function decimal(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function deliveryLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
    .format(parsed)
    .replace(" de ", " / ")
    .replace(".", "");
}

function location(project: DashboardProjectCard) {
  return [project.city, project.state].filter(Boolean).join(" · ") || "Local não informado";
}

function cardNotice(project: DashboardProjectCard) {
  if (project.status === "completed") return { tone: "success", text: "Empreendimento concluído" };
  if (project.status === "active" && project.progressPercent <= 0) {
    return { tone: "warning", text: "Cronograma ainda sem medições registradas" };
  }
  if (project.status === "planning") return { tone: "neutral", text: "Empreendimento em fase de planejamento" };
  return {
    tone: "neutral",
    text: `${project.memoryCount} ${project.memoryCount === 1 ? "memória de cálculo cadastrada" : "memórias de cálculo cadastradas"}`,
  };
}

function ProjectOpenForm({ companyId, project }: { companyId: string; project: DashboardProjectCard }) {
  return (
    <form action={selectWorkspace} className="approved-project-open-form">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="project_id" value={project.id} />
      <input type="hidden" name="return_to" value="/dashboard" />
      <button className="approved-project-open" type="submit">
        Abrir empreendimento
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>
  );
}

export function ReferenceProjects({ projects, companyId }: { projects: DashboardProjectCard[]; companyId: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");

  const cities = useMemo(
    () => [...new Set(projects.map((project) => project.city).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [projects],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return projects.filter((project) => {
      if (status && project.status !== status) return false;
      if (city && project.city !== city) return false;
      if (!term) return true;
      return [project.name, project.code ?? "", project.city ?? "", project.state ?? ""]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(term);
    });
  }, [projects, query, status, city]);

  return (
    <>
      <div className="approved-dashboard-toolbar">
        <label className="approved-dashboard-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empreendimento…" aria-label="Buscar empreendimento" />
        </label>

        <label className="approved-dashboard-filter">
          <span className="elos-visually-hidden">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Status</option>
            <option value="planning">Planejamento</option>
            <option value="active">Em execução</option>
            <option value="paused">Pausado</option>
            <option value="completed">Concluído</option>
          </select>
        </label>

        <label className="approved-dashboard-filter">
          <span className="elos-visually-hidden">Cidade</span>
          <select value={city} onChange={(event) => setCity(event.target.value)}>
            <option value="">Cidade</option>
            {cities.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>

        <div className="approved-dashboard-view-switch" role="group" aria-label="Visualização dos empreendimentos">
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
            Cards
          </button>
          <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M3 12h18M3 19h18" /></svg>
            Tabela
          </button>
        </div>
      </div>

      {view === "cards" ? (
        <div className="approved-project-grid">
          {filtered.map((project) => {
            const notice = cardNotice(project);
            return (
              <article className={`approved-project-card ${project.isActiveProject ? "is-active" : ""}`} key={project.id}>
                <div className="approved-project-cover">
                  {project.coverImageUrl ? <img src={project.coverImageUrl} alt={`Imagem do empreendimento ${project.name}`} /> : (
                    <div className="approved-project-cover-fallback"><span>{(project.code || project.name).slice(0, 4).toUpperCase()}</span></div>
                  )}
                  <span className={`approved-project-status ${project.status}`}><i />{statusLabels[project.status] ?? project.status}</span>
                  {project.isActiveProject ? <span className="approved-project-current">Selecionado</span> : null}
                </div>

                <div className="approved-project-body">
                  <div>
                    <h2>{project.name}</h2>
                    <p className="approved-project-location">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                      {location(project)}
                    </p>
                  </div>

                  <div className="approved-project-progress">
                    <div><span>Avanço físico</span><strong>{Math.round(project.progressPercent)}%</strong></div>
                    <div className="approved-project-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, project.progressPercent))}%` }} /></div>
                  </div>

                  <div className="approved-project-stats">
                    <div><span>Conclusão prevista</span><strong>{deliveryLabel(project.deliveryDate)}</strong></div>
                    <div><span>Área construída</span><strong>{Number(project.builtAreaM2) > 0 ? `${decimal(project.builtAreaM2)} m²` : "—"}</strong></div>
                    <div><span>Unidades</span><strong>{project.totalUnits || "—"}</strong></div>
                    <div><span>Pavimentos</span><strong>{project.totalFloors || "—"}</strong></div>
                  </div>

                  <div className={`approved-project-notice ${notice.tone}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                    <span>{notice.text}</span>
                  </div>

                  <ProjectOpenForm companyId={companyId} project={project} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="approved-dashboard-table-card">
          <div className="approved-dashboard-table-wrap">
            <table className="approved-dashboard-table">
              <thead><tr><th>Empreendimento</th><th>Status</th><th>Avanço</th><th>Conclusão</th><th>Área</th><th>Unidades</th><th>Pavimentos</th><th></th></tr></thead>
              <tbody>
                {filtered.map((project) => (
                  <tr className={project.isActiveProject ? "is-active" : ""} key={project.id}>
                    <td><div className="approved-table-project"><div className="approved-table-thumb">{project.coverImageUrl ? <img src={project.coverImageUrl} alt="" /> : <span>{(project.code || project.name).slice(0, 3).toUpperCase()}</span>}</div><div><strong>{project.name}</strong><span>{location(project)}</span></div></div></td>
                    <td><span className={`approved-project-status table-status ${project.status}`}><i />{statusLabels[project.status] ?? project.status}</span></td>
                    <td><strong>{Math.round(project.progressPercent)}%</strong></td>
                    <td>{deliveryLabel(project.deliveryDate)}</td>
                    <td>{Number(project.builtAreaM2) > 0 ? `${decimal(project.builtAreaM2)} m²` : "—"}</td>
                    <td>{project.totalUnits || "—"}</td>
                    <td>{project.totalFloors || "—"}</td>
                    <td><ProjectOpenForm companyId={companyId} project={project} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.length === 0 ? <div className="approved-dashboard-empty">Nenhum empreendimento encontrado com esses filtros.</div> : null}
    </>
  );
}
