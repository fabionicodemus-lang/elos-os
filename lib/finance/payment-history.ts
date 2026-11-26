import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialPaymentEvent } from "./title-balances.mjs";

/** Page server reads to avoid the API's implicit row cap in financial totals. */
export async function loadCompleteFinanceRows<T>(query: {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}) {
  const rows: T[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const result = await query.range(offset, offset + 999);
    if (result.error) throw new Error(`Não foi possível conferir todos os títulos: ${result.error.message}`);
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return { data: rows, error: null };
  }
  throw new Error("Consulta financeira excede o limite de títulos. Selecione uma obra menor.");
}

/** A sanitized RPC applies tenant/title permissions; it never posts source cash. */
export async function loadTitlePaymentHistory({
  supabase, companyId, projectId = null, titleKind = null, titleIds = null,
}: {
  supabase: SupabaseClient;
  companyId: string;
  projectId?: string | null;
  titleKind?: "receivable" | "payable" | null;
  titleIds?: readonly string[] | null;
}) {
  const ids = titleIds === null ? null : [...new Set(titleIds)];
  const byTitle = new Map<string, FinancialPaymentEvent[]>();
  if (ids?.length === 0) return byTitle;
  const pageSize = 1000;
  const maximumEvents = 100000;
  const groups = ids === null ? [null] : Array.from({ length: Math.ceil(ids.length / 10000) }, (_, index) => ids.slice(index * 10000, (index + 1) * 10000));
  let eventCount = 0;
  for (const group of groups) for (let offset = 0; offset < maximumEvents; offset += pageSize) {
    const { data, error } = await supabase.rpc("finance_title_payment_events", {
      p_company_id: companyId, p_project_id: projectId, p_title_kind: titleKind, p_title_ids: group,
    }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Não foi possível conferir o histórico financeiro por data: ${error.message}`);
    const events = (data ?? []) as FinancialPaymentEvent[];
    eventCount += events.length;
    if (eventCount >= maximumEvents) throw new Error("Histórico financeiro excede o limite de consulta. Selecione uma obra menor.");
    for (const event of events) {
      const key = `${event.title_kind}:${event.title_id}`;
      const list = byTitle.get(key) ?? [];
      list.push(event);
      byTitle.set(key, list);
    }
    if (events.length < pageSize) break;
  }
  return byTitle;
}
