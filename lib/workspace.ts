import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const COMPANY_OVERVIEW_COOKIE = "__company_overview__";

type Company = {
  id: string;
  name: string;
  slug: string;
};

type Role = {
  id?: string;
  key?: string;
  name?: string;
};

type Membership = {
  company_id: string;
  role_id?: string;
  companies: Company | Company[] | null;
  roles: Role | Role[] | null;
};

type Project = {
  id: string;
  company_id: string;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function resolveActiveWorkspace() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  const email = typeof authData.claims.email === "string" ? authData.claims.email : "Usuário";
  const cookieStore = await cookies();
  const requestedCompanyId = cookieStore.get("elos_company_id")?.value ?? null;
  const projectCookie = cookieStore.get("elos_project_id")?.value ?? null;
  const companyOverviewRequested = projectCookie === COMPANY_OVERVIEW_COOKIE;
  const requestedProjectId = companyOverviewRequested ? null : projectCookie;

  const { data: membershipData, error: membershipError } = await supabase
    .from("company_memberships")
    .select("company_id, role_id, companies(id, name, slug), roles(id, key, name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const memberships = (membershipData ?? []) as unknown as Membership[];
  const membership =
    memberships.find((item) => item.company_id === requestedCompanyId) ??
    memberships[0] ??
    null;
  const company = membership ? relatedOne(membership.companies) : null;
  const role = membership ? relatedOne(membership.roles) : null;

  if (membershipError || !membership || !company || !role) {
    redirect("/dashboard?error=Você%20não%20possui%20uma%20empresa%20ativa.");
  }

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, company_id")
    .eq("company_id", company.id)
    .neq("status", "archived")
    .order("name", { ascending: true });

  const projects = (projectData ?? []) as Project[];
  const project = companyOverviewRequested
    ? null
    : requestedProjectId
      ? projects.find((item) => item.id === requestedProjectId) ?? null
      : projects[0] ?? null;

  return {
    supabase,
    userId,
    email,
    company,
    companyId: company.id,
    projectId: project?.id ?? null,
    role,
    roleKey: role.key ?? "",
  };
}

export async function requireCompanyPermission(permission: string) {
  const workspace = await resolveActiveWorkspace();
  const { supabase, company, companyId, projectId, userId, email, roleKey } = workspace;
  const privileged = roleKey === "owner" || roleKey === "admin";

  const { data: allowed } = privileged
    ? { data: true }
    : await supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: permission,
      });

  if (allowed !== true) {
    redirect("/dashboard?error=Você%20não%20possui%20acesso%20a%20esta%20área.");
  }

  return { supabase, company, companyId, projectId, userId, email, roleKey };
}
