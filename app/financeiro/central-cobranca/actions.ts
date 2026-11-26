"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/central-cobranca";
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const nullable = (f: FormData, key: string) => value(f, key) || null;

async function execute(f: FormData, rpc: string, args: Record<string, unknown>) {
  const { supabase, companyId } = await requireCompanyPermission("receivables.manage");
  const { error } = await supabase.rpc(rpc, { p_company: companyId, ...args });
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/gestao-inadimplencias");
  const query = new URLSearchParams({ [error ? "error" : "success"]: error?.message ?? "Operação registrada." });
  if (value(f, "receivable")) query.set("detail", value(f, "receivable"));
  redirect(`${PATH}?${query}`);
}

export async function saveConfig(f: FormData) {
  await execute(f, "collection_config", { p_project: value(f, "project"), p_sale: nullable(f, "sale"), p_account: value(f, "account"), p_provider: value(f, "provider"), p_agreement: value(f, "agreement"), p_reason: nullable(f, "reason"), p_email: nullable(f, "email"), p_whatsapp: nullable(f, "whatsapp"), p_time: value(f, "reminder_time") });
}
export async function prepare(f: FormData) {
  await execute(f, "collection_prepare", { p_receivable: value(f, "receivable") });
}
export async function reviewImport(f: FormData) {
  await execute(f, "collection_review_import", { p_receivable: value(f, "receivable"), p_reason: value(f, "reason") });
}
export async function command(f: FormData) {
  await execute(f, "collection_command", { p_id: value(f, "collection"), p_action: value(f, "command"), p_reason: nullable(f, "reason") });
}
export async function allocate(f: FormData) {
  await execute(f, "collection_allocate", { p_id: value(f, "collection"), p_link: value(f, "link"), p_fee: nullable(f, "fee"), p_reversal: nullable(f, "reversal"), p_reason: value(f, "reason") });
}
