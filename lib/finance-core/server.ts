import { fetchAllRows } from "@/lib/supabase-pagination";
import type { SettlementCashRow } from "./cash.mjs";
type Client = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];
export async function loadSettlementCash(supabase: Client,companyId:string,projectId:string|null){
 const rows=await fetchAllRows<SettlementCashRow>(async(from,to)=>{
  let query=supabase.from("finance_settlement_cash_rows").select("*").eq("company_id",companyId).order("effective_date").order("event_id").order("title_id");
  if(projectId)query=query.eq("project_id",projectId);
  const {data,error}=await query.range(from,to);return {data:(data??[]) as SettlementCashRow[],error};
 });
 if(rows.error)throw new Error(`Liquidações indisponíveis: ${rows.error.message}`);
 return rows.data;
}
