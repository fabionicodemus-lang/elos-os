"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyPermission } from "@/lib/workspace";
import { parseOfx } from "@/lib/banking/ofx";
const PATH = "/financeiro/contas-bancarias/operacoes";
const value = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function finish(
  account: string,
  message: string,
  error = false,
  tab = "reconcile",
): never {
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-bancarias");
  redirect(
    `${PATH}?${new URLSearchParams({ account, tab, [error ? "error" : "success"]: message })}`,
  );
}
async function rpc(
  f: FormData,
  name: string,
  args: Record<string, unknown>,
  permission = "finance.bank_accounts.manage",
) {
  const { supabase, companyId } = await requireCompanyPermission(permission);
  const account = value(f, "account");
  const { data: owner, error: ownerError } = await supabase
    .from("finance_bank_accounts")
    .select("id")
    .eq("id", account)
    .eq("company_id", companyId)
    .maybeSingle();
  if (ownerError || !owner) finish(account, "Conta indisponível.", true);
  const references: Record<string, [string, string]> = {
    bank_link_entry: ["finance_statement_entries", "p_entry"],
    bank_post_difference: ["finance_statement_entries", "p_entry"],
    bank_change_instrument: ["finance_bank_instruments", "p_id"],
    bank_cancel_collection: ["finance_collection_drafts", "p_id"],
  };
  if (references[name]) {
    const [table, key] = references[name];
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("id", args[key])
      .eq("bank_account_id", account)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) finish(account, "Registro indisponível nesta conta.", true);
  }
  if (name === "bank_reverse_link") {
    const { data: l } = await supabase
      .from("finance_reconciliation_links")
      .select("entry_id")
      .eq("id", args.p_link)
      .eq("company_id", companyId)
      .maybeSingle();
    const { data: e } = l
      ? await supabase
          .from("finance_statement_entries")
          .select("id")
          .eq("id", l.entry_id)
          .eq("bank_account_id", account)
          .maybeSingle()
      : { data: null };
    if (!e) finish(account, "Vínculo indisponível nesta conta.", true);
  }
  const { error } = await supabase.rpc(name, args);
  finish(
    account,
    error?.message ?? "Operação registrada.",
    Boolean(error),
    value(f, "tab") || "reconcile",
  );
}
export async function importOfx(f: FormData) {
  const { supabase, companyId } = await requireCompanyPermission(
    "finance.bank_accounts.manage",
  );
  const account = value(f, "account");
  const file = f.get("file");
  if (!(file instanceof File) || file.size > 4_000_000)
    finish(account, "Selecione um OFX de até 4 MB.", true);
  const { data: owner } = await supabase
    .from("finance_bank_accounts")
    .select("id")
    .eq("id", account)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!owner) finish(account, "Conta indisponível.", true);
  let parsed: ReturnType<typeof parseOfx>;
  try {
    const bytes = await file.arrayBuffer();
    const utf = new TextDecoder("utf-8", { fatal: true });
    let text: string;
    try {
      text = utf.decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
    parsed = parseOfx(text);
  } catch (e) {
    finish(account, e instanceof Error ? e.message : "OFX inválido.", true);
  }
  const { data, error } = await supabase.rpc("bank_import_ofx", {
    p_account: account,
    p_name: file.name,
    p_hash: parsed.sha256,
    p_bank: parsed.bank,
    p_number: parsed.account,
    p_entries: parsed.entries,
  });
  finish(
    account,
    error?.message ??
      (data?.duplicate_file
        ? "Este arquivo já foi importado."
        : `${data?.inserted ?? 0} movimentos novos importados. Nenhuma baixa foi realizada.`),
    Boolean(error),
    "reconcile",
  );
}
export async function linkEntry(f: FormData) {
  await rpc(
    f,
    "bank_link_entry",
    {
      p_entry: value(f, "entry"),
      p_transaction: value(f, "transaction"),
      p_amount: Number(value(f, "amount")),
    },
    "finance.bank_accounts.reconcile",
  );
}
export async function postDifference(f: FormData) {
  await rpc(f, "bank_post_difference", {
    p_entry: value(f, "entry"),
    p_type: value(f, "type"),
    p_reason: value(f, "reason"),
  });
}
export async function reverseLink(f: FormData) {
  await rpc(
    f,
    "bank_reverse_link",
    { p_link: value(f, "link"), p_reason: value(f, "reason") },
    "finance.bank_accounts.reconcile",
  );
}
export async function saveSettings(f: FormData) {
  await rpc(f, "bank_save_settings", {
    p_account: value(f, "account"),
    p_group: value(f, "group"),
    p_close: value(f, "closed") || null,
    p_reason: value(f, "reason"),
  });
}
export async function saveInstrument(f: FormData) {
  await rpc(f, "bank_save_instrument", {
    p_account: value(f, "account"),
    p_kind: value(f, "kind"),
    p_label: value(f, "label"),
    p_last_four: value(f, "last_four"),
    p_amount: value(f, "amount") ? Number(value(f, "amount")) : null,
    p_due: value(f, "due") || null,
  });
}
export async function changeInstrument(f: FormData) {
  await rpc(f, "bank_change_instrument", {
    p_id: value(f, "instrument"),
    p_cancel: value(f, "cancel") === "1",
    p_date: value(f, "date") || null,
    p_reason: value(f, "reason"),
  });
}
export async function cancelCollection(f: FormData) {
  await rpc(
    f,
    "bank_cancel_collection",
    { p_id: value(f, "draft"), p_reason: value(f, "reason") },
    "receivables.manage",
  );
}
export async function draftCollection(f: FormData) {
  await rpc(
    f,
    "bank_draft_collection",
    {
      p_account: value(f, "account"),
      p_receivable: value(f, "receivable"),
      p_fine: Number(value(f, "fine")),
      p_interest: Number(value(f, "interest")),
      p_instructions: value(f, "instructions"),
    },
    "receivables.manage",
  );
}
export async function uploadPdf(f: FormData) {
  const { supabase, companyId } = await requireCompanyPermission(
    "finance.bank_accounts.manage",
  );
  const account = value(f, "account");
  const file = f.get("file");
  if (!(file instanceof File) || file.size > 4_000_000 || file.size < 5)
    finish(account, "Selecione um PDF de até 4 MB.", true);
  const { data: a } = await supabase
    .from("finance_bank_accounts")
    .select("id")
    .eq("id", account)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!a) finish(account, "Conta inválida.", true);
  const transaction = value(f, "transaction");
  if (transaction) {
    const { data: t } = await supabase
      .from("finance_bank_transactions")
      .select("id")
      .eq("id", transaction)
      .eq("bank_account_id", account)
      .maybeSingle();
    if (!t) finish(account, "Lançamento inválido.", true, "files");
  }
  if (!["statement", "receipt"].includes(value(f, "kind")))
    finish(account, "Tipo de documento inválido.", true, "files");
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    finish(account, "Conteúdo não é PDF.", true);
  const path = `${companyId}/${account}/${randomUUID()}.pdf`;
  const uploaded = await supabase.storage
    .from("bank-documents")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploaded.error) finish(account, uploaded.error.message, true);
  const { error } = await supabase.rpc("bank_save_document", {
    p_account: account,
    p_transaction: value(f, "transaction") || null,
    p_name: file.name,
    p_path: path,
    p_kind: value(f, "kind"),
  });
  if (error) await supabase.storage.from("bank-documents").remove([path]);
  finish(
    account,
    error?.message ??
      "PDF arquivado. O conteúdo não gera lançamentos automaticamente.",
    Boolean(error),
    "files",
  );
}
