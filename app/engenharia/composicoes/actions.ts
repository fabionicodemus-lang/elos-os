"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/composicoes";

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

function resultUrl(serviceId: string, message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ service: serviceId, [type]: message });
  return `${LIST_PATH}?${params.toString()}`;
}

function itemPayload(formData: FormData) {
  const serviceId = text(formData, "service_id");
  const inputId = text(formData, "input_id");
  const coefficient = numberValue(formData, "coefficient");
  const wastePercentage = numberValue(formData, "waste_percentage");

  if (
    !serviceId ||
    !inputId ||
    !Number.isFinite(coefficient) || coefficient <= 0 ||
    !Number.isFinite(wastePercentage) || wastePercentage < 0 || wastePercentage > 1000
  ) {
    return null;
  }

  return {
    serviceId,
    inputId,
    coefficient,
    wastePercentage,
    notes: optional(formData, "notes"),
  };
}

export async function createEngineeringCompositionItem(formData: FormData) {
  const payload = itemPayload(formData);
  const fallbackServiceId = text(formData, "service_id");
  if (!payload) redirect(resultUrl(fallbackServiceId, "Revise o insumo, o coeficiente e a perda informada."));

  const { supabase, companyId, userId } = await requireCompanyPermission("compositions.manage");
  const [serviceResult, inputResult] = await Promise.all([
    supabase
      .from("engineering_services")
      .select("id")
      .eq("id", payload.serviceId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("engineering_inputs")
      .select("id")
      .eq("id", payload.inputId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (!serviceResult.data) redirect(resultUrl(payload.serviceId, "O serviço selecionado não está disponível."));
  if (!inputResult.data) redirect(resultUrl(payload.serviceId, "O insumo selecionado não está disponível."));

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
    redirect(resultUrl(payload.serviceId, compositionError?.message ?? "Não foi possível preparar a composição."));
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

  if (error) redirect(resultUrl(payload.serviceId, error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(payload.serviceId, "Insumo adicionado à composição.", "success"));
}

export async function updateEngineeringCompositionItem(formData: FormData) {
  const itemId = text(formData, "item_id");
  const payload = itemPayload(formData);
  const status = text(formData, "status");
  const fallbackServiceId = text(formData, "service_id");

  if (!itemId || !payload || !["active", "inactive"].includes(status)) {
    redirect(resultUrl(fallbackServiceId, "Revise os dados do item da composição."));
  }

  const { supabase, companyId } = await requireCompanyPermission("compositions.manage");
  const { data: input } = await supabase
    .from("engineering_inputs")
    .select("id")
    .eq("id", payload.inputId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .maybeSingle();

  if (!input) redirect(resultUrl(payload.serviceId, "O insumo selecionado não está disponível."));

  const { error } = await supabase
    .from("engineering_service_composition_items")
    .update({
      input_id: payload.inputId,
      coefficient: payload.coefficient,
      waste_percentage: payload.wastePercentage,
      notes: payload.notes,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? "Este insumo já faz parte da composição do serviço."
      : error.message;
    redirect(resultUrl(payload.serviceId, message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl(payload.serviceId, "Item da composição atualizado.", "success"));
}

export async function toggleEngineeringCompositionItemStatus(formData: FormData) {
  const itemId = text(formData, "item_id");
  const serviceId = text(formData, "service_id");
  const nextStatus = text(formData, "next_status");

  if (!itemId || !serviceId || !["active", "inactive"].includes(nextStatus)) {
    redirect(resultUrl(serviceId, "Item da composição inválido."));
  }

  const { supabase, companyId } = await requireCompanyPermission("compositions.manage");
  const { error } = await supabase
    .from("engineering_service_composition_items")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(serviceId, error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(
    serviceId,
    nextStatus === "active" ? "Insumo reativado na composição." : "Insumo retirado da composição atual.",
    "success",
  ));
}
