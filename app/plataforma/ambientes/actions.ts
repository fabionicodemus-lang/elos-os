"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import {
  PLATFORM_ROLE_OPTIONS, getPlatformInvitationRedirect, isValidEmail, normalizeCompanySlug,
} from "@/lib/platform-onboarding";

type Lookup = { exists: boolean; confirmed: boolean; invited: boolean };

function environmentsUrl(message: string, type: "error" | "success" = "error", companyId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (companyId) params.set("company", companyId);
  return `/plataforma/ambientes?${params.toString()}`;
}

function friendlyEnvironmentError(message: string) {
  if (message.includes("identificador já pertence")) return "Este identificador já está sendo usado por outra empresa.";
  if (message.includes("duplicate key")) return "Estes dados já pertencem a uma empresa cadastrada.";
  if (message.includes("Área restrita")) return "Acesso restrito ao administrador global do Elos OS.";
  if (message.includes("Papel de acesso inválido")) return "Este papel não está disponível para a empresa selecionada.";
  if (message.includes("inexistente ou inativa")) return "A empresa está inativa ou não foi encontrada.";
  return "Não foi possível concluir a operação. Nenhuma permissão adicional foi liberada.";
}

async function lookupAuthUser(
  supabase: Awaited<ReturnType<typeof requirePlatformAdmin>>["supabase"],
  email: string,
) {
  const { data, error } = await supabase.rpc("platform_lookup_user", { p_email: email });
  if (error || !data || typeof data !== "object") {
    return { error: "Atualização de banco pendente. Aplique a migration de convites antes de criar acessos." };
  }
  return { data: data as unknown as Lookup };
}

async function inviteIfNecessary(email: string, lookup: Lookup) {
  if (lookup.exists) {
    if (!lookup.confirmed && !lookup.invited) {
      return { error: "Esta conta já foi iniciada, mas o e-mail ainda não foi confirmado. Peça a confirmação antes de liberar o acesso." };
    }
    return { invited: false, pending: !lookup.confirmed };
  }

  const redirectTo = getPlatformInvitationRedirect();
  if (!redirectTo) {
    return { error: "Configure NEXT_PUBLIC_SITE_URL com o endereço HTTPS oficial do Elos OS antes de enviar convites." };
  }

  let admin: ReturnType<typeof createAuthAdminClient>;
  try {
    admin = createAuthAdminClient();
  } catch {
    return { error: "A chave secreta de administração do Supabase está ausente no servidor." };
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error || !data?.user) {
    return { error: "Falha ao enviar o convite. Confira a configuração de e-mail e URLs autorizadas no Supabase." };
  }
  return { invited: true, pending: true };
}

export async function createPlatformEnvironment(formData: FormData) {
  const companyName = String(formData.get("company_name") ?? "").trim();
  const slug = normalizeCompanySlug(String(formData.get("company_slug") || companyName).trim());
  const ownerEmail = String(formData.get("owner_email") ?? "").trim().toLowerCase();
  const projectName = String(formData.get("project_name") ?? "").trim();
  const projectCode = String(formData.get("project_code") ?? "").trim();

  if (!companyName || companyName.length > 150 || !slug || slug.length > 80 || !isValidEmail(ownerEmail)) {
    redirect(environmentsUrl("Informe empresa, identificador e e-mail válidos."));
  }

  const { supabase } = await requirePlatformAdmin();
  // Pré-validação evita disparar convite para um identificador já ocupado.
  const { data: environments, error: listError } = await supabase.rpc("platform_list_environments");
  if (listError) redirect(environmentsUrl("Não foi possível validar as empresas existentes."));
  if (((environments ?? []) as { company_slug: string }[]).some((company) => company.company_slug === slug)) {
    redirect(environmentsUrl("Este identificador já está cadastrado. Escolha outro."));
  }

  const lookup = await lookupAuthUser(supabase, ownerEmail);
  if (lookup.error || !lookup.data) redirect(environmentsUrl(lookup.error || "Não foi possível validar o e-mail."));

  const invitation = await inviteIfNecessary(ownerEmail, lookup.data);
  if (invitation.error) redirect(environmentsUrl(invitation.error));

  const { data, error } = await supabase.rpc("platform_create_environment", {
    p_company_name: companyName,
    p_company_slug: slug,
    p_owner_email: ownerEmail,
    p_project_name: projectName || null,
    p_project_code: projectCode || null,
  });
  if (error) {
    const message = invitation.invited
      ? "Convite enviado, porém a empresa ainda não foi criada. Tente novamente usando o mesmo e-mail."
      : friendlyEnvironmentError(error.message);
    redirect(environmentsUrl(message));
  }

  revalidatePath("/plataforma/ambientes");
  const companyId = (data as { company_id?: string } | null)?.company_id;
  const message = invitation.invited
    ? `${companyName} criada. Convite enviado para ${ownerEmail}; o proprietário deverá definir a senha.`
    : invitation.pending
      ? `${companyName} criada. O proprietário ainda precisa aceitar o convite recebido anteriormente.`
      : `${companyName} criada e vinculada ao proprietário ${ownerEmail}.`;
  redirect(environmentsUrl(message, "success", companyId));
}

export async function invitePlatformCompanyMember(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleKey = String(formData.get("role_key") ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId) || !isValidEmail(email) ||
    !PLATFORM_ROLE_OPTIONS.some((role) => role.key === roleKey)) {
    redirect(environmentsUrl("Selecione uma empresa, um e-mail e um perfil válidos.", "error", companyId));
  }

  const { supabase } = await requirePlatformAdmin();
  const { data: companies, error: listError } = await supabase.rpc("platform_list_environments");
  if (listError || !((companies ?? []) as { company_id: string; company_status: string }[])
    .some((company) => company.company_id === companyId && company.company_status === "active")) {
    redirect(environmentsUrl("A empresa não está ativa ou não foi encontrada.", "error", companyId));
  }

  const lookup = await lookupAuthUser(supabase, email);
  if (lookup.error || !lookup.data) redirect(environmentsUrl(lookup.error || "Não foi possível validar o e-mail.", "error", companyId));

  const invitation = await inviteIfNecessary(email, lookup.data);
  if (invitation.error) redirect(environmentsUrl(invitation.error, "error", companyId));

  const { error } = await supabase.rpc("platform_add_company_member", {
    p_company_id: companyId, p_email: email, p_role_key: roleKey,
  });
  if (error) {
    const message = invitation.invited
      ? "Convite enviado, mas o vínculo com a construtora falhou. Tente novamente com o mesmo e-mail."
      : friendlyEnvironmentError(error.message);
    redirect(environmentsUrl(message, "error", companyId));
  }

  revalidatePath("/plataforma/ambientes");
  const message = invitation.invited
    ? `Convite enviado para ${email}. O acesso já está vinculado à construtora e ficará disponível após a confirmação.`
    : invitation.pending
      ? `Acesso de ${email} vinculado. Falta aceitar o convite enviado anteriormente.`
      : `Acesso de ${email} liberado. Como essa conta já existia, avise o usuário sobre o novo ambiente.`;
  redirect(environmentsUrl(message, "success", companyId));
}
