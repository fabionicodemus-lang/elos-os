import { fetchAllRows } from "@/lib/supabase-pagination";
import { allocateByWeight, paidTitleAmount } from "./native-allocation.mjs";
import type { CostVsBudgetTitle } from "./title-details";
type Client = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];
type Measurement = { id: string; payable_id: string | null };
type Item = { id: string; measurement_id: string; service_id: string; service_code: string; service_name: string; current_amount: number };
type Payable = { id: string; document: string | null; due_date: string; amount: number; status: "open" | "paid"; paid_amount: number | null; paid_at: string | null; installment_label: string | null; notes: string | null; suppliers: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null };
export async function loadNativeMeasurementTitles(supabase: Client, companyId: string, projectId: string) {
  const [measurements, items] = await Promise.all([
    fetchAllRows<Measurement>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurements").select("id,payable_id").eq("company_id", companyId).eq("project_id", projectId).in("status", ["approved", "invoiced", "paid"]).not("payable_id", "is", null).order("id").range(from, to);
      return { data: (data ?? []) as Measurement[], error };
    }),
    fetchAllRows<Item>(async (from, to) => {
      const { data, error } = await supabase.from("execution_contract_measurement_items").select("id,measurement_id,service_id,service_code,service_name,current_amount").eq("company_id", companyId).eq("project_id", projectId).order("id").range(from, to);
      return { data: (data ?? []) as Item[], error };
    }),
  ]);
  const errors = [measurements.error?.message, items.error?.message].filter(Boolean) as string[];
  const ids = [...new Set(measurements.data.flatMap((m) => m.payable_id ? [m.payable_id] : []))];
  const payables: Payable[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await fetchAllRows<Payable>(async (from, to) => {
      const { data, error } = await supabase.from("payables").select("id,document,due_date,amount,status,paid_amount,paid_at,installment_label,notes,suppliers(legal_name,trade_name)").eq("company_id", companyId).eq("project_id", projectId).eq("source_system", "elos_os").in("id", ids.slice(offset, offset + 100)).in("status", ["open", "paid"]).order("id").range(from, to);
      return { data: (data ?? []) as unknown as Payable[], error };
    });
    payables.push(...result.data);
    if (result.error) errors.push(result.error.message);
  }
  const payableById = new Map(payables.map((p) => [p.id, p]));
  const allocations: { serviceId: string; code: string; name: string; title: CostVsBudgetTitle }[] = [];
  for (const m of measurements.data) {
    const p = payableById.get(m.payable_id ?? "");
    if (!p) continue;
    const rows = items.data.filter((item) => item.measurement_id === m.id);
    const allocated: number[] = allocateByWeight(p.amount, rows);
    const paid = allocateByWeight(paidTitleAmount(p), allocated.map((value) => ({ current_amount: value })));
    const supplier = Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers;
    rows.forEach((item, index) => allocations.push({
      serviceId: item.service_id, code: item.service_code, name: item.service_name,
      title: { id: p.id, document: p.document || p.id, supplierName: supplier?.trade_name || supplier?.legal_name || "Favorecido não identificado", dueDate: p.due_date, status: p.status, titleAmount: Number(p.amount), allocatedAmount: allocated[index], paidAllocatedAmount: paid[index], openAllocatedAmount: allocated[index] - paid[index], paidAt: p.paid_at, paidAmount: p.paid_amount, installmentLabel: p.installment_label, notes: p.notes, purchaseOrderRefs: [] },
    }));
  }
  return { allocations, errors };
}
