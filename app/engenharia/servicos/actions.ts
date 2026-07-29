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

function numberValue(formData: FormData, key: string) {
  const raw = text(formData, key).replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

function resultUrl(message: string, type: "error" | "success" = "error", serviceId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (serviceId) params.set("service", serviceId);
  return `${LIST_PATH}?${params.toString()}`;
}

function servicePayload(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const description = text(formData, "description");
  const unit = text(formData, "unit").toLowerCase();
  const groupCode = optional(formData, "group_code")?.toUpperCase() ?? null;
  const defaultMethod = text(formData, "default_method") || "unit";

  if (!code || !description || !unit || !allowedMethods.has(defaultMethod)) return null;

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

function serviceInputPayload(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const inputId = text(formData, "input_id");
  const coefficient = numberValue(formData, "coefficient");
  const wastePercentage = numberValue(formData, "waste_percentage");

  if (
    !serviceId ||
    !inputId ||
    !Number.isFinite(coefficient) || coefficient <= 0 ||
    !Number.isFinite(wastePercentage) || wastePercentage < 0 || wastePercentage > 1000
  ) return null;

  return {
    serviceId,
    inputId,
    coefficient,
    wastePercentage,
    notes: optional(formData, "notes"),
  };
}

export async function createEngineeringService(formData: FormData) {
  const payload = servicePayload(formData);
  if (!payload) redirect(resultUrl("Informe código, descrição, unidade e método válidos."));

  const { supabase, companyId, userId } = await requireCompanyPermission("services.manage");
  const { data, error } = await supabase.from("engineering_services").insert({
    company_id: companyId,
    ...payload,
    status: "active",
    source_system: "elos_os",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  }).select("id").single();

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um serviço com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Serviço criado. Os insumos já podem ser editados abaixo.", "success", data.id));
}

export async function updateEngineeringService(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const payload = servicePayload(formData);
  const status = text(formData, "status");

  if (!serviceId || !payload || !["active", "inactive"].includes(status)) {
    redirect(resultUrl("Revise os dados do serviço.", "error", serviceId));
  }

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const { error } = await supabase
    .from("engineering_services")
    .update({ ...payload, status, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um serviço com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message, "error", serviceId));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Serviço atualizado.", "success", serviceId));
}

export async function toggleEngineeringServiceStatus(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const nextStatus = text(formData, "next_status");

  if (!serviceId || !["active", "inactive"].includes(nextStatus)) {
    redirect(resultUrl("Serviço inválido.", "error", serviceId));
  }

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const { error } = await supabase
    .from("engineering_services")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message, "error", serviceId));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(nextStatus === "active" ? "Serviço reativado." : "Serviço inativado.", "success", serviceId));
}

export async function createEngineeringServiceInput(formData: FormData) {
  const payload = serviceInputPayload(formData);
  const fallbackServiceId = text(formData, "service_id");
  if (!payload) redirect(resultUrl("Revise o insumo, o coeficiente e a perda informada.", "error", fallbackServiceId));

  const { supabase, companyId, userId } = await requireCompanyPermission("services.manage");
  const [serviceResult, inputResult] = await Promise.all([
    supabase.from("engineering_services").select("id").eq("id", payload.serviceId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
    supabase.from("engineering_inputs").select("id").eq("id", payload.inputId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
  ]);

  if (!serviceResult.data) redirect(resultUrl("O serviço selecionado não está disponível.", "error", payload.serviceId));
  if (!inputResult.data) redirect(resultUrl("O insumo selecionado não está disponível.", "error", payload.serviceId));

  const { data: composition, error: compositionError } = await supabase
    .from("engineering_service_compositions")
    .upsert({
      company_id: companyId,
      service_id: payload.serviceId,
      status: "active",
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,service_id" })
    .select("id")
    .single();

  if (compositionError || !composition) {
    redirect(resultUrl(compositionError?.message ?? "Não foi possível preparar os insumos do serviço.", "error", payload.serviceId));
  }

  const { error } = await supabase
    .from("engineering_service_composition_items")
    .upsert({
      company_id: companyId,
      composition_id: composition.id,
      input_id: payload.inputId,
      coefficient: payload.coefficient,
      waste_percentage: payload.wastePercentage,
      notes: payload.notes,
      status: "active",
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "composition_id,input_id" });

  if (error) redirect(resultUrl(error.message, "error", payload.serviceId));

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Insumo adicionado ao serviço.", "success", payload.serviceId));
}

export async function updateEngineeringServiceInput(formData: FormData) {
  const itemId = text(formData, "item_id");
  const payload = serviceInputPayload(formData);
  const fallbackServiceId = text(formData, "service_id");

  if (!itemId || !payload) {
    redirect(resultUrl("Revise os dados do insumo.", "error", fallbackServiceId));
  }

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const [inputResult, compositionResult] = await Promise.all([
    supabase.from("engineering_inputs").select("id").eq("id", payload.inputId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
    supabase.from("engineering_service_compositions").select("id").eq("company_id", companyId).eq("service_id", payload.serviceId).maybeSingle(),
  ]);

  if (!inputResult.data) redirect(resultUrl("O insumo selecionado não está disponível.", "error", payload.serviceId));
  if (!compositionResult.data) redirect(resultUrl("O serviço não possui composição válida.", "error", payload.serviceId));

  const { error } = await supabase
    .from("engineering_service_composition_items")
    .update({
      input_id: payload.inputId,
      coefficient: payload.coefficient,
      waste_percentage: payload.wastePercentage,
      notes: payload.notes,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("composition_id", compositionResult.data.id)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? "Este insumo já faz parte do serviço. Edite o item existente."
      : error.message;
    redirect(resultUrl(message, "error", payload.serviceId));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Insumo e coeficiente atualizados.", "success", payload.serviceId));
}

export async function removeEngineeringServiceInput(formData: FormData) {
  const itemId = text(formData, "item_id");
  const serviceId = text(formData, "service_id");

  if (!itemId || !serviceId) redirect(resultUrl("Insumo inválido.", "error", serviceId));

  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  const { data: composition } = await supabase
    .from("engineering_service_compositions")
    .select("id")
    .eq("company_id", companyId)
    .eq("service_id", serviceId)
    .maybeSingle();

  if (!composition) redirect(resultUrl("Serviço sem composição válida.", "error", serviceId));

  const { error } = await supabase
    .from("engineering_service_composition_items")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("composition_id", composition.id)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message, "error", serviceId));

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Insumo excluído do serviço.", "success", serviceId));
}
