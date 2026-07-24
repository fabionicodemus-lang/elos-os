"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/insumos";
const allowedCategories = new Set(["material", "labor", "equipment", "service", "freight", "other"]);

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

function inputPayload(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const description = text(formData, "description");
  const unit = text(formData, "unit").toLowerCase();
  const category = text(formData, "category") || "material";
  const familyCode = optional(formData, "family_code")?.toUpperCase() ?? null;

  if (!code || !description || !unit || !allowedCategories.has(category)) {
    return null;
  }

  return {
    code,
    description,
    unit,
    category,
    family_code: familyCode,
    family_label: optional(formData, "family_label"),
    brand_reference: optional(formData, "brand_reference"),
    technical_specification: optional(formData, "technical_specification"),
    source_system: optional(formData, "source_system") || "elos_os",
    source_code: optional(formData, "source_code"),
    notes: optional(formData, "notes"),
  };
}

export async function createEngineeringInput(formData: FormData) {
  const payload = inputPayload(formData);
  if (!payload) redirect(resultUrl("Informe código, descrição, unidade e natureza válidos."));

  const { supabase, companyId, userId } = await requireCompanyPermission("inputs.manage");
  const { error } = await supabase.from("engineering_inputs").insert({
    company_id: companyId,
    ...payload,
    status: "active",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um insumo com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Insumo adicionado ao catálogo técnico.", "success"));
}

export async function updateEngineeringInput(formData: FormData) {
  const inputId = text(formData, "input_id");
  const payload = inputPayload(formData);
  const status = text(formData, "status");

  if (!inputId || !payload || !["active", "inactive"].includes(status)) {
    redirect(resultUrl("Revise os dados do insumo."));
  }

  const { supabase, companyId } = await requireCompanyPermission("inputs.manage");
  const { error } = await supabase
    .from("engineering_inputs")
    .update({
      ...payload,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inputId)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? `Já existe um insumo com o código ${payload.code}.`
      : error.message;
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Insumo atualizado.", "success"));
}

export async function toggleEngineeringInputStatus(formData: FormData) {
  const inputId = text(formData, "input_id");
  const nextStatus = text(formData, "next_status");

  if (!inputId || !["active", "inactive"].includes(nextStatus)) {
    redirect(resultUrl("Insumo inválido."));
  }

  const { supabase, companyId } = await requireCompanyPermission("inputs.manage");
  const { error } = await supabase
    .from("engineering_inputs")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", inputId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(nextStatus === "active" ? "Insumo reativado." : "Insumo inativado.", "success"));
}
