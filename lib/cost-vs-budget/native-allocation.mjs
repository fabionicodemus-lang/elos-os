// Allocate by persisted measurement items. Integer cents reconcile every title,
// including partial payments; a payment never creates a second recognized cost.
export function allocateByWeight(amount, items) {
  const cents = Math.max(0, Math.round(Number(amount || 0) * 100));
  const weights = items.map((item) => Math.max(0, Number(item.current_amount || 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return items.map(() => 0);
  const shares = weights.map((weight) => cents * weight / total);
  const values = shares.map(Math.floor);
  let remainder = cents - values.reduce((a, b) => a + b, 0);
  const order = shares.map((share, index) => ({ index, fraction: share - values[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of order) { if (remainder-- <= 0) break; values[entry.index] += 1; }
  return values.map((value) => value / 100);
}
export function paidTitleAmount(title) {
  const amount = Math.max(0, Number(title.amount || 0));
  return Math.min(amount, Math.max(0, Number(title.paid_amount ?? (title.status === 'paid' ? amount : 0))));
}
