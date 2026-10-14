"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyPermission } from "@/lib/workspace";
import { createAsaasCharge, type AsaasConnection } from "@/lib/banking/asaas";

const PATH = "/financeiro/contas-bancarias/operacoes";
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();

function done(account: string, message: string, error = false, tab = "collections"): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${new URLSearchParams({ account, tab, [error ? "error" : "success"]: message })}`);
}

export async function saveBankConnection(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("finance.bank_accounts.manage");
  const account = value(formData, "account");
  const { data: owner } = await supabase.from("finance_bank_accounts").select("id").eq("id", account).eq("company_id", companyId).maybeSingle();
  if (!owner) done(account, "Conta bancária inválida.", true, "settings");

  const { error } = await supabase.rpc("bank_save_connection", {
    p_account: account,
    p_connection: value(formData, "connection") || null,
    p_provider: value(formData, "provider"),
    p_label: value(formData, "label"),
    p_environment: value(formData, "environment") || "sandbox",
    p_credential_ref: value(formData, "credential_ref") || null,
    p_provider_account_ref: value(formData, "provider_account_ref") || null,
    p_status: value(formData, "status") || "active",
  });
  done(account, error?.message ?? "Conexão bancária salva.", Boolean(error), "settings");
}

export async function issueAsaasCharge(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("receivables.manage");
  const account = value(formData, "account");
  const connectionId = value(formData, "connection");
  const draftId = value(formData, "draft");
  const billingType = value(formData, "billing_type") === "pix" ? "PIX" : "BOLETO";

  const [{ data: connection }, { data: draft }] = await Promise.all([
    supabase
      .from("finance_bank_connections")
      .select("id,company_id,bank_account_id,provider,credential_ref,environment,status")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .eq("bank_account_id", account)
      .eq("provider", "asaas")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("finance_collection_drafts")
      .select("id,company_id,project_id,bank_account_id,receivable_id,amount,due_date,fine_percent,monthly_interest_percent,status")
      .eq("id", draftId)
      .eq("company_id", companyId)
      .eq("bank_account_id", account)
      .eq("status", "draft")
      .maybeSingle(),
  ]);

  if (!connection || !draft) done(account, "Conexão ou cobrança indisponível.", true);

  const { data: receivable } = await supabase
    .from("receivables")
    .select("id,client_id")
    .eq("id", draft.receivable_id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!receivable) done(account, "Parcela não encontrada.", true);

  const { data: client } = await supabase
    .from("clients")
    .select("id,name,tax_id,email,phone")
    .eq("id", receivable.client_id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!client) done(account, "Cliente não encontrado.", true);

  const externalReference = `elos:${draft.id}`;
  try {
    const charge = await createAsaasCharge(connection as AsaasConnection, {
      customer: client,
      billingType,
      amount: Number(draft.amount),
      dueDate: draft.due_date,
      externalReference,
      finePercent: Number(draft.fine_percent || 0),
      interestPercent: Number(draft.monthly_interest_percent || 0),
    });

    const { error } = await supabase.rpc("bank_register_provider_charge", {
      p_connection: connection.id,
      p_draft: draft.id,
      p_external_id: charge.id,
      p_external_reference: externalReference,
      p_billing_type: billingType === "PIX" ? "pix" : "boleto",
      p_invoice_url: charge.invoiceUrl,
      p_bank_slip_url: charge.bankSlipUrl,
      p_pix_payload: charge.pixPayload,
      p_pix_expiration_at: charge.pixExpirationAt,
      p_payload: charge.raw,
    });
    done(account, error?.message ?? `${billingType === "PIX" ? "Pix" : "Boleto"} emitido e vinculado à parcela.`, Boolean(error));
  } catch (error) {
    done(account, error instanceof Error ? error.message : "Falha ao emitir cobrança.", true);
  }
}
