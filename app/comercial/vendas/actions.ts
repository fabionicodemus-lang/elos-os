"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function detailPath(saleId: string, message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `/comercial/vendas/${saleId}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

export async function updateSale(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const number = String(formData.get("number") ?? "").trim();
  const saleDate = String(formData.get("sale_date") ?? "");
  const totalAmount = parseMoney(formData.get("total_amount"));
  const commissionPctRaw = parseMoney(formData.get("commission_pct"));
  const commissionPct = Number.isFinite(commissionPctRaw) && commissionPctRaw >= 0 ? commissionPctRaw : 0;
  const status = String(formData.get("status") ?? "active");

  if (
    !saleId ||
    !clientId ||
    !unitId ||
    !number ||
    !saleDate ||
    !Number.isFinite(totalAmount) ||
    totalAmount <= 0 ||
    !["active", "cancelled"].includes(status)
  ) {
    redirect(detailPath(saleId, "Preencha cliente, unidade, identificação, data e valor válidos."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("sales.manage");

  if (!projectId) {
    redirect(detailPath(saleId, "Selecione uma obra antes de editar a venda."));
  }

  const [{ data: currentSale }, { data: client }, { data: unit }] = await Promise.all([
    supabase
      .from("sales")
      .select("id, unit_id, status")
      .eq("id", saleId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("units")
      .select("id, status")
      .eq("id", unitId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  if (!currentSale || !client || !unit) {
    redirect(detailPath(saleId, "A venda, o cliente ou a unidade não pertencem ao ambiente ativo."));
  }

  const commissionAmount = Math.round((totalAmount * commissionPct) * 100) / 10000;
  const { error } = await supabase
    .from("sales")
    .update({
      client_id: clientId,
      unit_id: unitId,
      number,
      source_code: optional(formData, "source_code"),
      contract_number: optional(formData, "contract_number"),
      sale_date: saleDate,
      total_amount: totalAmount,
      commission_pct: commissionPct,
      commission_amount: commissionAmount,
      broker_name: optional(formData, "broker_name"),
      status,
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", saleId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) {
    const message = error.code === "23505"
      ? "A unidade selecionada já possui outra venda ativa."
      : error.message;
    redirect(detailPath(saleId, message));
  }

  if (currentSale.unit_id !== unitId) {
    await supabase.from("units").update({ status: "available", updated_at: new Date().toISOString() }).eq("id", currentSale.unit_id);
  }

  await supabase
    .from("units")
    .update({ status: status === "active" ? "sold" : "available", updated_at: new Date().toISOString() })
    .eq("id", unitId);

  revalidatePath("/comercial/vendas");
  revalidatePath(`/comercial/vendas/${saleId}`);
  revalidatePath("/comercial/planos-de-pagamento");
  redirect(detailPath(saleId, "Venda atualizada com sucesso.", "success"));
}
