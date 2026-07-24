"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/precos";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string) {
  const raw = text(formData, key).replace(",", ".");
  const value = Number(raw || 0);
  return Number.isFinite(value) ? value : Number.NaN;
}

function resultUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${LIST_PATH}?${params.toString()}`;
}

function pricePayload(formData: FormData, activeProjectId: string | null) {
  const inputId = text(formData, "input_id");
  const supplierId = optional(formData, "supplier_id");
  const scope = text(formData, "scope") || "corporate";
  const priceDate = text(formData, "price_date");
  const unitPrice = numberValue(formData, "unit_price");
  const freightUnitCost = numberValue(formData, "freight_unit_cost");
  const otherUnitCost = numberValue(formData, "other_unit_cost");
  const discountPercentage = numberValue(formData, "discount_percentage");

  if (
    !inputId ||
    !priceDate ||
    !["corporate", "project"].includes(scope) ||
    !Number.isFinite(unitPrice) || unitPrice < 0 ||
    !Number.isFinite(freightUnitCost) || freightUnitCost < 0 ||
    !Number.isFinite(otherUnitCost) || otherUnitCost < 0 ||
    !Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100
  ) {
    return null;
  }

  if (scope === "project" && !activeProjectId) return null;

  return {
    input_id: inputId,
    supplier_id: supplierId,
    project_id: scope === "project" ? activeProjectId : null,
    price_date: priceDate,
    unit_price: unitPrice,
    freight_unit_cost: freightUnitCost,
    other_unit_cost: otherUnitCost,
    discount_percentage: discountPercentage,
    currency: "BRL",
    source: optional(formData, "source"),
    notes: optional(formData, "notes"),
  };
}

async function clearAdoptedPrice(
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
  companyId: string,
  inputId: string,
  projectId: string | null,
  exceptId?: string,
) {
  let query = supabase
    .from("engineering_input_prices")
    .update({ is_adopted: false, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("input_id", inputId)
    .eq("status", "active")
    .eq("is_adopted", true);

  query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
  if (exceptId) query = query.neq("id", exceptId);

  const { error } = await query;
  return error;
}

export async function createEngineeringInputPrice(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("prices.manage");
  const payload = pricePayload(formData, projectId);
  const shouldAdopt = text(formData, "is_adopted") === "on";

  if (!payload) redirect(resultUrl("Revise o insumo, a data e os valores da cotação."));

  if (shouldAdopt) {
    const clearError = await clearAdoptedPrice(supabase, companyId, payload.input_id, payload.project_id);
    if (clearError) redirect(resultUrl(clearError.message));
  }

  const { error } = await supabase.from("engineering_input_prices").insert({
    company_id: companyId,
    ...payload,
    is_adopted: shouldAdopt,
    status: "active",
    created_by: userId,
  });

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(shouldAdopt ? "Cotação criada e adotada como referência." : "Cotação criada com sucesso.", "success"));
}

export async function updateEngineeringInputPrice(formData: FormData) {
  const priceId = text(formData, "price_id");
  const status = text(formData, "status");
  const shouldAdopt = text(formData, "is_adopted") === "on";
  const { supabase, companyId, projectId } = await requireCompanyPermission("prices.manage");
  const payload = pricePayload(formData, projectId);

  if (!priceId || !payload || !["active", "inactive"].includes(status)) {
    redirect(resultUrl("Revise os dados da cotação."));
  }

  const adopted = status === "active" && shouldAdopt;
  if (adopted) {
    const clearError = await clearAdoptedPrice(supabase, companyId, payload.input_id, payload.project_id, priceId);
    if (clearError) redirect(resultUrl(clearError.message));
  }

  const { error } = await supabase
    .from("engineering_input_prices")
    .update({
      ...payload,
      status,
      is_adopted: adopted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", priceId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Cotação atualizada.", "success"));
}

export async function adoptEngineeringInputPrice(formData: FormData) {
  const priceId = text(formData, "price_id");
  if (!priceId) redirect(resultUrl("Cotação inválida."));

  const { supabase, companyId } = await requireCompanyPermission("prices.manage");
  const { data: price, error: readError } = await supabase
    .from("engineering_input_prices")
    .select("id, input_id, project_id, status")
    .eq("id", priceId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (readError || !price || price.status !== "active") {
    redirect(resultUrl("Não foi possível adotar esta cotação."));
  }

  const clearError = await clearAdoptedPrice(supabase, companyId, price.input_id, price.project_id, priceId);
  if (clearError) redirect(resultUrl(clearError.message));

  const { error } = await supabase
    .from("engineering_input_prices")
    .update({ is_adopted: true, updated_at: new Date().toISOString() })
    .eq("id", priceId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Preço adotado como referência do insumo.", "success"));
}

export async function toggleEngineeringInputPriceStatus(formData: FormData) {
  const priceId = text(formData, "price_id");
  const nextStatus = text(formData, "next_status");

  if (!priceId || !["active", "inactive"].includes(nextStatus)) {
    redirect(resultUrl("Cotação inválida."));
  }

  const { supabase, companyId } = await requireCompanyPermission("prices.manage");
  const { error } = await supabase
    .from("engineering_input_prices")
    .update({
      status: nextStatus,
      is_adopted: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", priceId)
    .eq("company_id", companyId);

  if (error) redirect(resultUrl(error.message));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(nextStatus === "active" ? "Cotação reativada." : "Cotação inativada.", "success"));
}
