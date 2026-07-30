"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/configuracoes/permissoes";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function resultUrl(message: string, type: "success" | "error", roleId?: string | null) {
  const params = new URLSearchParams({ [type]: message });
  if (roleId) params.set("role", roleId);
  return `${PATH}?${params.toString()}`;
}

function refresh() {
  revalidatePath(PATH);
  revalidatePath("/configuracoes/acessos");
  revalidatePath("/dashboard");
}

export async function saveRoleDefinition(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("admin.roles.manage");
  const roleId = optional(formData, "role_id");
  const { data, error } = await supabase.rpc("save_company_role", {
    p_company_id: companyId,
    p_role_id: roleId,
    p_name: text(formData, "name"),
    p_description: optional(formData, "description"),
    p_status: text(formData, "status") || "active",
  });

  if (error || !data) {
    redirect(resultUrl(error?.message ?? "Não foi possível salvar o papel.", "error", roleId));
  }

  refresh();
  redirect(resultUrl(roleId ? "Papel atualizado com segurança." : "Papel personalizado criado.", "success", String(data)));
}

export async function cloneRoleDefinition(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("admin.roles.manage");
  const sourceRoleId = text(formData, "source_role_id");
  const { data, error } = await supabase.rpc("clone_company_role", {
    p_company_id: companyId,
    p_source_role_id: sourceRoleId,
    p_name: text(formData, "name"),
    p_description: optional(formData, "description"),
  });

  if (error || !data) {
    redirect(resultUrl(error?.message ?? "Não foi possível duplicar o papel.", "error", sourceRoleId));
  }

  refresh();
  redirect(resultUrl("Papel duplicado com todas as permissões selecionadas.", "success", String(data)));
}

export async function saveRolePermissions(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("admin.roles.manage");
  const roleId = text(formData, "role_id");
  const permissionKeys = formData.getAll("permission_keys").map(String).filter(Boolean);
  const { data, error } = await supabase.rpc("set_company_role_permissions", {
    p_company_id: companyId,
    p_role_id: roleId,
    p_permission_keys: permissionKeys,
  });

  if (error || data === null) {
    redirect(resultUrl(error?.message ?? "Não foi possível atualizar as permissões.", "error", roleId));
  }

  refresh();
  redirect(resultUrl(`${Number(data)} permissões salvas para o papel.`, "success", roleId));
}
