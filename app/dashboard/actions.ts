"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function dashboardUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `/dashboard?${params.toString()}`;
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function bootstrapWorkspace(formData: FormData) {
  const companyName = String(formData.get("company_name") ?? "").trim();
  const companySlug = String(formData.get("company_slug") ?? "").trim();
  const projectName = String(formData.get("project_name") ?? "").trim();
  const projectCode = String(formData.get("project_code") ?? "").trim();

  if (!companyName) {
    redirect(dashboardUrl("Informe o nome da empresa."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bootstrap_company", {
    p_company_name: companyName,
    p_company_slug: companySlug,
    p_project_name: projectName || null,
    p_project_code: projectCode || null,
  });

  if (error) {
    const message = error.message.includes("bootstrap_company")
      ? "A estrutura multiempresa ainda não foi instalada no Supabase. Execute a migration indicada no painel."
      : error.message;
    redirect(dashboardUrl(message));
  }

  const result = data as { company_id?: string; project_id?: string } | null;
  const cookieStore = await cookies();

  if (result?.company_id) {
    cookieStore.set("elos_company_id", result.company_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  if (result?.project_id) {
    cookieStore.set("elos_project_id", result.project_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/dashboard");
  redirect(dashboardUrl("Empresa e obra inicial criadas com sucesso.", "success"));
}

export async function selectWorkspace(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "");
  const projectId = String(formData.get("project_id") ?? "");

  if (!companyId) {
    redirect(dashboardUrl("Selecione uma empresa."));
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    redirect(dashboardUrl("Você não possui acesso ativo a esta empresa."));
  }

  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!project) {
      redirect(dashboardUrl("A obra selecionada não pertence à empresa."));
    }
  }

  const cookieStore = await cookies();
  cookieStore.set("elos_company_id", companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  if (projectId) {
    cookieStore.set("elos_project_id", projectId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete("elos_project_id");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
