"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/servicos";
const allowedMethods = new Set(["unit", "count", "length", "area", "volume", "weight", "custom"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function resultUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${LIST_PATH}?${params.toString()}`;
}

function servicePayload(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const description = text(formData, "description");
  const unit = text(formData, "unit").toLowerCase();
  const groupCode = optional(formData, "group_code")?.toUpperCase() ?? null;
  const defaultMethod = text(formData, "default_method") || "unit";

  if (!code || !description || !unit || !allowedMethods.has(defaultMethod)) {
    return null;
  }

  return {
    code,
    description,
    unit,
    group_code: groupCode,
    default_method: defaultMethod,
    takeoff_rule: optional(formData, "takeoff_rule"),
    measurement_rule: optional(formData, "measurement_rule"),
    notes: optional(formData, "notes"),
  };
}

export async function createEngineeringService(formData: FormData) {
  const payload = servicePayload(formData);
  if (!payload) redirect(resultUrl("Informe código, descrição, unidade e método válidos."));

  const { supabase, companyId, userId } = await requireCompanyPermission("services.manage");
  const { error } = await supabase.from("engineering_services").insert({
    company_id: companyId,
    ...payload,
    status: "active",
    source_system: "elos_os",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um serviço com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Serviço adicionado ao catálogo técnico.", "success"));
}

export async function updateEngineeringService(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const payload = servicePayload(formData);
  const status = text(formData, "status");

  if (!serviceId || !payload || !["active", "inactive"].includes(status)) {
    redirect(resultUrl("Revise os dados do serviço."));
  }

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const { error } = await supabase
    .from("engineering_services")
    .update({
      ...payload,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serviceId)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um serviço com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Serviço atualizado.", "success"));
}

export async function toggleEngineeringServiceStatus(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const nextStatus = text(formData, "next_status");

  if (!serviceId || !["active", "inactive"].includes(nextStatus)) {
    redirect(resultUrl("Serviço inválido."));
  }

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const { error } = await supabase
    .from("engineering_services")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(nextStatus === "active" ? "Serviço reativado." : "Serviço inativado.", "success"));
}