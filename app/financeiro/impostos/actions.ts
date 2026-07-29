"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/impostos";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function parseMoney(entry: FormDataEntryValue | null) {
  const raw = String(entry ?? "").trim().replace(/\s/g, "");
  if (!raw) return 0;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

function parseRate(entry: FormDataEntryValue | null) {
  const parsed = parseMoney(entry);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pageUrl(message: string, type: "success" | "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

export async function saveTaxType(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("finance.taxes.manage");
  const result = await supabase.rpc("save_finance_tax_type", {
    p_company_id: companyId,
    p_tax_type_id: optional(formData, "tax_type_id"),
    p_code: value(formData, "code"),
    p_name: value(formData, "name"),
    p_jurisdiction: value(formData, "jurisdiction"),
    p_calculation_method: value(formData, "calculation_method"),
    p_default_rate: parseRate(formData.get("default_rate")),
    p_due_day: Number(value(formData, "due_day") || 0) || null,
    p_supplier_id: optional(formData, "supplier_id"),
    p_status: value(formData, "status") || "active",
    p_notes: optional(formData, "notes"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error"));
  revalidatePath(PATH);
  redirect(pageUrl("Tributo salvo no cadastro fiscal.", "success"));
}

export async function saveTaxObligation(formData: FormData) {
  const principal = parseMoney(formData.get("principal_amount"));
  const penalty = parseMoney(formData.get("penalty_amount"));
  const interest = parseMoney(formData.get("interest_amount"));
  const other = parseMoney(formData.get("other_amount"));

  if (![principal, penalty, interest, other].every(Number.isFinite) || principal < 0 || penalty < 0 || interest < 0 || other < 0 || principal + penalty + interest + other <= 0) {
    redirect(pageUrl("Informe valores válidos para a obrigação fiscal.", "error"));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.taxes.manage");
  const result = await supabase.rpc("save_finance_tax_obligation", {
    p_company_id: companyId,
    p_obligation_id: optional(formData, "obligation_id"),
    p_project_id: optional(formData, "project_id") ?? projectId,
    p_legal_entity_id: optional(formData, "legal_entity_id"),
    p_tax_type_id: value(formData, "tax_type_id"),
    p_supplier_id: value(formData, "supplier_id"),
    p_competence: value(formData, "competence"),
    p_due_date: value(formData, "due_date"),
    p_principal_amount: principal,
    p_penalty_amount: penalty,
    p_interest_amount: interest,
    p_other_amount: other,
    p_document_number: optional(formData, "document_number"),
    p_barcode: optional(formData, "barcode"),
    p_source_type: optional(formData, "source_type") ?? "manual",
    p_source_id: optional(formData, "source_id"),
    p_notes: optional(formData, "notes"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error"));
  revalidatePath(PATH);
  redirect(pageUrl("Obrigação fiscal salva.", "success"));
}

export async function generateTaxPayable(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("finance.taxes.approve");
  const result = await supabase.rpc("generate_finance_tax_payable", {
    p_company_id: companyId,
    p_obligation_id: value(formData, "obligation_id"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error"));
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Guia enviada ao Contas a Pagar.", "success"));
}

export async function cancelTaxObligation(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("finance.taxes.cancel");
  const result = await supabase.rpc("cancel_finance_tax_obligation", {
    p_company_id: companyId,
    p_obligation_id: value(formData, "obligation_id"),
    p_reason: value(formData, "reason"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error"));
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  redirect(pageUrl("Obrigação fiscal cancelada com rastreabilidade.", "success"));
}
