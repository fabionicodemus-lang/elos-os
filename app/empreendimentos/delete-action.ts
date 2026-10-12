"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos";
const IMAGE_BUCKET = "project-images";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function listUrl(message: string, type: "error" | "success" = "error") {
  return `${LIST_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

export async function deleteProject(formData: FormData) {
  const projectId = text(formData, "project_id");
  if (!projectId) redirect(listUrl("Empreendimento inválido."));

  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, cover_image_path")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (projectError) redirect(listUrl(projectError.message));
  if (!project) redirect(listUrl("Empreendimento não localizado."));

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", project.id)
    .eq("company_id", companyId);

  if (error) {
    redirect(listUrl(`Não foi possível excluir o empreendimento: ${error.message}`));
  }

  if (project.cover_image_path) {
    await supabase.storage.from(IMAGE_BUCKET).remove([project.cover_image_path]);
  }

  const cookieStore = await cookies();
  if (cookieStore.get("elos_project_id")?.value === project.id) {
    cookieStore.delete("elos_project_id");
  }

  revalidatePath("/", "layout");
  redirect(listUrl(`${project.name} excluído com sucesso.`, "success"));
}
