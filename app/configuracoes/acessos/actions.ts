"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function accessUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `/configuracoes/acessos?${params.toString()}`;
}

export async function addExistingMember(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const roleKey = String(formData.get("role_key") ?? "").trim();

  if (!email || !roleKey) {
    redirect(accessUrl("Informe o e-mail e o papel de acesso."));
  }

  const { supabase, companyId } = await requireCompanyPermission("admin.users.manage");
  const { error } = await supabase.rpc("add_company_member_by_email", {
    p_company_id: companyId,
    p_email: email,
    p_role_key: roleKey,
  });

  if (error) {
    redirect(accessUrl(error.message));
  }

  revalidatePath("/configuracoes/acessos");
  redirect(accessUrl("Usuário adicionado à empresa com sucesso.", "success"));
}

export async function changeMemberRole(formData: FormData) {
  const membershipId = String(formData.get("membership_id") ?? "");
  const roleKey = String(formData.get("role_key") ?? "");

  if (!membershipId || !roleKey) {
    redirect(accessUrl("Selecione um papel válido."));
  }

  const { supabase } = await requireCompanyPermission("admin.users.manage");
  const { error } = await supabase.rpc("set_company_member_role", {
    p_membership_id: membershipId,
    p_role_key: roleKey,
  });

  if (error) {
    redirect(accessUrl(error.message));
  }

  revalidatePath("/configuracoes/acessos");
  redirect(accessUrl("Papel atualizado com sucesso.", "success"));
}
