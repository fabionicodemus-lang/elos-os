"use client";

import type { FormEvent } from "react";

export type ProjectSwitcherOption = {
  id: string;
  name: string;
  code: string | null;
};

export function ProjectSwitcher({
  companyId,
  activeProjectId,
  projects,
  action,
}: {
  companyId: string;
  activeProjectId: string | null;
  projects: ProjectSwitcherOption[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  function submitOnChange(event: FormEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="elos-project-switcher" action={action}>
      <input type="hidden" name="company_id" value={companyId} />
      <label htmlFor="elos-project-select">Empreendimento</label>
      <select
        id="elos-project-select"
        name="project_id"
        defaultValue={activeProjectId ?? ""}
        onChange={submitOnChange}
        aria-label="Selecionar empreendimento"
      >
        <option value="">Visão geral da empresa</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.code ? `${project.code} · ` : ""}{project.name}
          </option>
        ))}
      </select>
      <button className="elos-visually-hidden" type="submit">Aplicar</button>
    </form>
  );
}
