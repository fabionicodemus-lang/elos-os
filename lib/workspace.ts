import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireCompanyPermission(permission: string) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  const email = typeof authData.claims.email === "string" ? authData.claims.email : "Usuário";
  const cookieStore = await cookies();
  const companyId = cookieStore.get("elos_company_id")?.value;
  const projectId = cookieStore.get("elos_project_id")?.value ?? null;

  if (!companyId) {
    redirect("/dashboard?error=Selecione%20uma%20empresa.");
  }

  const [{ data: company }, { data: membership }] = await Promise.all([
    supabase.from("companies").select("id, name, slug").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, roles(key)")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const roleRelation = membership?.roles as { key?: string } | { key?: string }[] | null | undefined;
  const roleKey = Array.isArray(roleRelation) ? roleRelation[0]?.key : roleRelation?.key;
  const privileged = roleKey === "owner" || roleKey === "admin";

  const { data: allowed } = privileged
    ? { data: true }
    : await supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: permission,
      });

  if (!company || !membership || allowed !== true) {
    redirect("/dashboard?error=Você%20não%20possui%20acesso%20a%20esta%20área.");
  }

  return { supabase, company, companyId, projectId, userId, email, roleKey };
}
