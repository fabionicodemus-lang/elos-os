// Shared stock-balance and dated-history semantics. Original principal is never
// replaced by its remaining balance. Integer cents avoid intermediate floats.
function cents(value) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError("Valor financeiro inválido; esperado decimal em centavos.");
  return (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"))) * (match[1] ? -1n : 1n);
}
function decimal(value) {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function titleFinancialValues(row) {
  const original = cents(row.amount ?? 0);
  const updated = cents(row.adjusted_amount ?? row.amount ?? 0);
  const paid = cents(row.paid_amount ?? (row.status === "paid" ? row.adjusted_amount ?? row.amount ?? 0 : 0));
  const remainder = updated - paid;
  const remaining = row.status === "open" && remainder > 0n ? remainder : 0n;
  return {
    original: Number(decimal(original)), updated: Number(decimal(updated)), paid: Number(decimal(paid)), remaining: Number(decimal(remaining)), historical_balance: Number(decimal(remainder)),
    original_amount: decimal(original), updated_amount: decimal(updated), paid_amount: decimal(paid), remaining_amount: decimal(remaining), historical_balance_amount: decimal(remainder),
    partial: row.status === "open" && paid > 0n && remaining > 0n,
  };
}

/** Timeline contains dated events and at most one forecast for the residual. */
export function titleFinancialTimeline(row, events = []) {
  const values = titleFinancialValues(row);
  const byId = new Map();
  const errors = [];
  let datesComplete = true;
  for (const event of events) {
    if (!event.event_id || event.title_id !== row.id || !/^\d{4}-\d{2}-\d{2}$/.test(event.occurred_on ?? "")) {
      errors.push("Evento sem identidade, título ou data consistentes.");
      continue;
    }
    const amount = cents(event.amount);
    if ((event.kind === "payment" && amount <= 0n) || (event.kind === "reversal" && amount >= 0n) || (event.kind === "voided_payment" && amount !== 0n) || !["payment", "reversal", "voided_payment"].includes(event.kind)) {
      errors.push("Sinal do evento financeiro inconsistente.");
      continue;
    }
    if (event.kind === "voided_payment" || event.history_dates_complete === false) datesComplete = false;
    const normalized = {
      event_id: event.event_id, title_kind: event.title_kind, title_id: event.title_id, project_id: event.project_id,
      occurred_on: event.occurred_on, amount: decimal(amount), kind: event.kind, medium: event.medium,
      account_name: event.account_name, source_system: event.source_system, history_dates_complete: event.history_dates_complete,
    };
    const before = byId.get(event.event_id);
    if (before && JSON.stringify(before) !== JSON.stringify(normalized)) errors.push("Mesmo evento financeiro com conteúdo diferente.");
    else byId.set(event.event_id, normalized);
  }
  const total = [...byId.values()].reduce((sum, event) => sum + cents(event.amount), 0n);
  if (total !== cents(values.paid_amount)) errors.push("Histórico por data não confere com o valor líquido pago; não foi agregado na última baixa.");
  const historyComplete = errors.length === 0;
  const entries = historyComplete ? [...byId.values()].filter(event => event.kind !== "voided_payment").map(event => ({
    id: event.event_id, situation: "realized", date: event.occurred_on, amount: Number(event.amount),
    kind: event.kind, medium: event.medium, account_name: event.account_name, source_system: event.source_system,
  })) : [];
  if (values.remaining > 0 && row.due_date) entries.push({
    id: `remaining:${row.id}`, situation: "forecast", date: row.due_date.slice(0, 10), amount: values.remaining,
    kind: "remaining", medium: null, account_name: null, source_system: row.source_system ?? null,
  });
  return { ...values, entries, history_complete: historyComplete, history_dates_complete: historyComplete && datesComplete, errors: [...new Set(errors)] };
}
