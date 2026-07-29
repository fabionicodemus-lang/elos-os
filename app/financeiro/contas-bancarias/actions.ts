"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/contas-bancarias";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function parseMoney(entry: FormDataEntryValue | null) {
  const raw = String(entry ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

function pageUrl(message: string, type: "success" | "error", accountId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (accountId) params.set("account", accountId);
  return `${PATH}?${params.toString()}`;
}

export async function saveBankAccount(formData: FormData) {
  const accountId = optional(formData, "account_id");
  const openingBalance = parseMoney(formData.get("opening_balance"));
  const { supabase, companyId } = await requireCompanyPermission("finance.bank_accounts.manage");

  const result = await supabase.rpc("save_finance_bank_account", {
    p_company_id: companyId,
    p_account_id: accountId,
    p_legal_entity_id: optional(formData, "legal_entity_id"),
    p_label: value(formData, "label"),
    p_bank_code: optional(formData, "bank_code"),
    p_bank_name: value(formData, "bank_name"),
    p_agency: optional(formData, "agency"),
    p_account_number: value(formData, "account_number"),
    p_account_digit: optional(formData, "account_digit"),
    p_account_type: value(formData, "account_type"),
    p_pix_key: optional(formData, "pix_key"),
    p_opening_balance: Number.isFinite(openingBalance) ? openingBalance : 0,
    p_opening_balance_date: value(formData, "opening_balance_date"),
    p_allow_negative: value(formData, "allow_negative") === "1",
    p_is_default: value(formData, "is_default") === "1",
    p_status: value(formData, "status") || "active",
    p_notes: optional(formData, "notes"),
  });

  if (result.error || !result.data) redirect(pageUrl(result.error?.message ?? "Não foi possível salvar a conta bancária.", "error", accountId ?? undefined));
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/comercial/planos-de-pagamento");
  redirect(pageUrl(accountId ? "Conta bancária atualizada." : "Conta bancária cadastrada.", "success", String(result.data)));
}

export async function postBankTransaction(formData: FormData) {
  const accountId = value(formData, "account_id");
  const amount = parseMoney(formData.get("amount"));
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.bank_accounts.manage");

  const result = await supabase.rpc("post_finance_bank_transaction", {
    p_company_id: companyId,
    p_project_id: optional(formData, "project_id") ?? projectId,
    p_account_id: accountId,
    p_transaction_date: value(formData, "transaction_date"),
    p_competence_date: optional(formData, "competence_date"),
    p_direction: value(formData, "direction"),
    p_transaction_type: value(formData, "transaction_type"),
    p_description: value(formData, "description"),
    p_document: optional(formData, "document"),
    p_counterparty: optional(formData, "counterparty"),
    p_amount: Number.isFinite(amount) ? amount : 0,
    p_notes: optional(formData, "notes"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error", accountId));
  revalidatePath(PATH);
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Movimentação lançada no extrato.", "success", accountId));
}

export async function transferBankAccounts(formData: FormData) {
  const fromAccountId = value(formData, "from_account_id");
  const amount = parseMoney(formData.get("amount"));
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.bank_accounts.transfer");

  const result = await supabase.rpc("transfer_finance_bank_accounts", {
    p_company_id: companyId,
    p_project_id: optional(formData, "project_id") ?? projectId,
    p_from_account_id: fromAccountId,
    p_to_account_id: value(formData, "to_account_id"),
    p_transfer_date: value(formData, "transfer_date"),
    p_amount: Number.isFinite(amount) ? amount : 0,
    p_description: optional(formData, "description"),
  });

  if (result.error) redirect(pageUrl(result.error.message, "error", fromAccountId));
  revalidatePath(PATH);
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Transferência registrada nas duas contas.", "success", fromAccountId));
}

export async function reconcileBankTransaction(formData: FormData) {
  const accountId = value(formData, "account_id");
  const { supabase, companyId } = await requireCompanyPermission("finance.bank_accounts.reconcile");
  const result = await supabase.rpc("reconcile_finance_bank_transaction", {
    p_company_id: companyId,
    p_transaction_id: value(formData, "transaction_id"),
    p_reconciliation_date: value(formData, "reconciliation_date"),
    p_reference: optional(formData, "reference"),
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", accountId));
  revalidatePath(PATH);
  redirect(pageUrl("Movimentação conciliada.", "success", accountId));
}

export async function cancelBankTransaction(formData: FormData) {
  const accountId = value(formData, "account_id");
  const { supabase, companyId } = await requireCompanyPermission("finance.bank_accounts.reconcile");
  const result = await supabase.rpc("cancel_finance_bank_transaction", {
    p_company_id: companyId,
    p_transaction_id: value(formData, "transaction_id"),
    p_reason: value(formData, "reason"),
  });
  if (result.error) redirect(pageUrl(result.error.message, "error", accountId));
  revalidatePath(PATH);
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Movimentação cancelada com rastreabilidade.", "success", accountId));
}
