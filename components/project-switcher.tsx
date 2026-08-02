"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState(activeProjectId ?? "");

  useEffect(() => {
    setSelectedProjectId(activeProjectId ?? "");
  }, [activeProjectId]);

  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  function submitOnChange(event: FormEvent<HTMLSelectElement>) {
    const form = event.currentTarget.form;
    setSelectedProjectId(event.currentTarget.value);
    window.setTimeout(() => form?.requestSubmit(), 0);
  }

  return (
    <form className="elos-project-switcher" action={action}>
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label htmlFor="elos-project-select">Empreendimento</label>
      <select
        id="elos-project-select"
        name="project_id"
        value={selectedProjectId}
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
