import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-pagination";

type UnlinkedItem = { id: string; code: string | null; description: string; unit: string | null };

// Itens incluídos manualmente no orçamento ("+ Serviço") não têm vínculo com o
// catálogo de serviços. Cronograma, levantamento e suprimentos dependem desse
// vínculo, então ligamos cada item a um serviço do catálogo pelo código
// (criando o serviço quando ainda não existe).
export async function linkBudgetItemsToCatalog({
  supabase,
  companyId,
  budgetId,
  userId,
}: {
  supabase: SupabaseClient;
  companyId: string;
  budgetId: string;
  userId: string | null;
}): Promise<{ linked: number; error: string | null }> {
  const itemsResult = await fetchAllRows<UnlinkedItem>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_budget_items")
      .select("id, code, description, unit")
      .eq("company_id", companyId)
      .eq("budget_id", budgetId)
      .eq("status", "active")
      .is("service_id", null)
      .range(from, to);
    return { data: (data ?? []) as UnlinkedItem[], error };
  });
  if (itemsResult.error) return { linked: 0, error: itemsResult.error.message };
  const items = itemsResult.data;
  if (items.length === 0) return { linked: 0, error: null };

  const codeFor = (item: UnlinkedItem) => (item.code?.trim().toUpperCase() || `ORC-${item.id.slice(0, 8).toUpperCase()}`);
  const codes = [...new Set(items.map(codeFor))];

  const serviceIdByCode = new Map<string, string>();
  for (let index = 0; index < codes.length; index += 200) {
    const chunk = codes.slice(index, index + 200);
    const { data, error } = await supabase
      .from("engineering_services")
      .select("id, code")
      .eq("company_id", companyId)
      .in("code", chunk);
    if (error) return { linked: 0, error: error.message };
    (data ?? []).forEach((service) => serviceIdByCode.set(String(service.code).toUpperCase(), service.id));
  }

  const missing = codes
    .filter((code) => !serviceIdByCode.has(code))
    .map((code) => {
      const item = items.find((candidate) => codeFor(candidate) === code)!;
      return {
        company_id: companyId,
        code,
        description: item.description,
        unit: item.unit || "un",
        group_code: code.includes(".") ? code.split(".")[0] : null,
        status: "active",
        created_by: userId,
      };
    });
  if (missing.length > 0) {
    const { data, error } = await supabase.from("engineering_services").insert(missing).select("id, code");
    if (error) return { linked: 0, error: error.message };
    (data ?? []).forEach((service) => serviceIdByCode.set(String(service.code).toUpperCase(), service.id));
  }

  let linked = 0;
  for (const item of items) {
    const serviceId = serviceIdByCode.get(codeFor(item));
    if (!serviceId) continue;
    const { error } = await supabase
      .from("engineering_budget_items")
      .update({ service_id: serviceId, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("company_id", companyId);
    if (error) return { linked, error: error.message };
    linked += 1;
  }
  return { linked, error: null };
}
