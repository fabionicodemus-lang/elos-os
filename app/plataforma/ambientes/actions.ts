"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin";

function environmentsUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `/plataforma/ambientes?${params.toString()}`;
}

function friendlyEnvironmentError(message: string) {
  if (message.includes("proprietário precisa criar e confirmar")) {
    return "O primeiro proprietário ainda não criou ou confirmou a conta no Elos OS.";
  }
  if (message.includes("identificador já pertence")) {
    return "Este identificador já está sendo usado por outro ambiente.";
  }
  if (message.includes("duplicate key")) {
    return "Já existe um ambiente com estes dados.";
  }
  if (message.includes("Área restrita")) {
    return "Você não possui autorização para criar ambientes.";
  }
  return message || "Não foi possível criar o ambiente.";
}

export async function createPlatformEnvironment(formData: FormData) {
  const companyName = String(formData.get("company_name") ?? "").trim();
  const companySlug = String(formData.get("company_slug") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim().toLowerCase();
  const projectName = String(formData.get("project_name") ?? "").trim();
  const projectCode = String(formData.get("project_code") ?? "").trim();

  if (!companyName || !ownerEmail) {
    redirect(environmentsUrl("Informe o nome da empresa e o e-mail do primeiro proprietário."));
  }

  const { supabase } = await requirePlatformAdmin();
  const { error } = await supabase.rpc("platform_create_environment", {
    p_company_name: companyName,
    p_company_slug: companySlug,
    p_owner_email: ownerEmail,
    p_project_name: projectName || null,
    p_project_code: projectCode || null,
  });

  if (error) {
    redirect(environmentsUrl(friendlyEnvironmentError(error.message)));
  }

  revalidatePath("/plataforma/ambientes");
  redirect(environmentsUrl(`Ambiente ${companyName} criado e liberado para ${ownerEmail}.`, "success"));
}
