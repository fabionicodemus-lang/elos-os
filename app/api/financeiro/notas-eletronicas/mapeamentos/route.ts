import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPermission } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  const supplierId = request.nextUrl.searchParams.get("supplier_id")?.trim() ?? "";
  if (!supplierId) return NextResponse.json({ mappings: [] });

  const { supabase, companyId } = await requireCompanyPermission("finance.invoices.view");
  const result = await supabase
    .from("finance_supplier_product_mappings")
    .select("supplier_id,product_key,supplier_product_code,ean,description_normalized,input_id,last_used_at")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .order("last_used_at", { ascending: false })
    .limit(5000);

  if (result.error) {
    if (result.error.code === "42P01") return NextResponse.json({ mappings: [] });
    return NextResponse.json({ error: result.error.message, mappings: [] }, { status: 500 });
  }

  return NextResponse.json({ mappings: result.data ?? [] });
}
