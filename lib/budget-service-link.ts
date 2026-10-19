import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { compatibleService } from "@/lib/preconstruction/service-identity.mjs";

type Item = {id: string; code: string | null; description: string; unit: string | null};
type Service = {id: string; code: string; description: string; unit: string; status: string};

export async function linkBudgetItemsToCatalog({supabase, companyId, budgetId, userId}: {supabase: SupabaseClient; companyId: string; budgetId: string; userId: string | null}): Promise<{linked: number; error: string | null; warnings: string[]}> {
  const [items, services] = await Promise.all([
    fetchAllRows<Item>(async (from,to) => {const {data,error}=await supabase.from("engineering_budget_items").select("id,code,description,unit").eq("company_id",companyId).eq("budget_id",budgetId).eq("status","active").is("service_id",null).order("id").range(from,to);return {data:(data??[]) as Item[],error};}),
    fetchAllRows<Service>(async (from,to) => {const {data,error}=await supabase.from("engineering_services").select("id,code,description,unit,status").eq("company_id",companyId).order("id").range(from,to);return {data:(data??[]) as Service[],error};}),
  ]);
  const warnings: string[]=[];
  if(items.error || services.error) return {linked:0,error:items.error?.message??services.error?.message??null,warnings};
  let linked=0;
  for(const item of items.data) {
    const code=item.code?.trim().toUpperCase() || `ORC-${item.id.slice(0,8).toUpperCase()}`;
    const sameCode=services.data.find(service => service.code.toUpperCase()===code);
    let service=services.data.find(service => service.status==='active' && service.code.toUpperCase()===code && compatibleService(item,service))
      ?? services.data.find(service => service.status==='active' && compatibleService(item,service));
    if(!service) {
      const safeCode=sameCode ? `${code}-${item.id.slice(0,8).toUpperCase()}` : code;
      const {data,error}=await supabase.from("engineering_services").insert({company_id:companyId,code:safeCode,description:item.description,unit:item.unit||"un",group_code:code.includes('.')?code.split('.')[0]:null,status:"active",created_by:userId,notes:sameCode?`Código ${code} já usado por cadastro incompatível. Criado sem alterar o serviço existente.`:null}).select("id,code,description,unit,status").single();
      if(error) return {linked,error:error.message,warnings};
      service=data as Service;services.data.push(service);
      if(sameCode) warnings.push(`${code}: descrição/unidade incompatível com o catálogo; vinculado ao novo cadastro ${safeCode}, sem alterar outras obras.`);
    }
    const {error}=await supabase.from("engineering_budget_items").update({service_id:service.id,updated_at:new Date().toISOString()}).eq("id",item.id).eq("company_id",companyId).eq("budget_id",budgetId).is("service_id",null);
    if(error) return {linked,error:error.message,warnings};
    linked++;
  }
  return {linked,error:null,warnings};
}
