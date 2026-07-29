import { NextResponse } from "next/server";
import { requireCompanyPermission } from "@/lib/workspace";

export async function GET() {
  const { supabase, companyId, projectId } = await requireCompanyPermission("finance.bank_accounts.view");

  const projectResult = projectId
    ? await supabase.from("projects").select("legal_entity_id").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : { data: null, error: null };

  let query = supabase
    .from("finance_bank_accounts")
    .select("id,label,bank_name,agency,account_number,account_digit,legal_entity_id,is_default,legal_entities(legal_name,trade_name)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("label");

  const legalEntityId = projectResult.data?.legal_entity_id ?? null;
  if (legalEntityId) query = query.or(`legal_entity_id.is.null,legal_entity_id.eq.${legalEntityId}`);

  const result = await query.limit(300);
  if (result.error) {
    if (result.error.code === "42P01") return NextResponse.json({ accounts: [] });
    return NextResponse.json({ accounts: [], error: result.error.message }, { status: 500 });
  }

  const accounts = (result.data ?? []).map((account) => {
    const entity = Array.isArray(account.legal_entities) ? account.legal_entities[0] : account.legal_entities;
    return {
      id: account.id,
      label: account.label,
      bank_name: account.bank_name,
      agency: account.agency,
      account_number: account.account_number,
      account_digit: account.account_digit,
      is_default: account.is_default,
      legal_entity_name: entity?.trade_name || entity?.legal_name || null,
    };
  });

  return NextResponse.json({ accounts });
}
