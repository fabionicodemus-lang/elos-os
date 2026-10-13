"use client";

import { APP_VERSION } from "@/lib/version";
import { useMemo, type FormEvent } from "react";
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
}: {
  companyId: string;
  activeProjectId: string | null;
  projects: ProjectSwitcherOption[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const companyOverview = searchParams.get("workspace") === "company";

  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  function submitOnChange(event: FormEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  const selectedValue = companyOverview ? "" : activeProjectId ?? "";

  return (
    <form
      className="elos-project-switcher"
      action="/api/workspace/select"
      method="post"
      data-build-version={APP_VERSION}
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label htmlFor="elos-project-select">Empreendimento</label>
      <select
        key={companyOverview ? "company-overview" : activeProjectId ?? "company-overview"}
        id="elos-project-select"
        name="project_id"
        defaultValue={selectedValue}
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
