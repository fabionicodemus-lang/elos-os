import { decimalToCents, allocateCents } from '../money.mjs';
// Allocate by persisted measurement items. Integer cents reconcile every title,
// including partial payments; a payment never creates a second recognized cost.
export function allocateByWeight(amount, items) {
  const cents = decimalToCents(amount, {rounding:'half-away-from-zero'});
  if(cents===null)throw new TypeError('Valor ausente não é zero');
  return allocateCents(cents,items.map(item=>({id:item.id,weight:item.current_amount}))).map(value=>value/100);
}
export function paidTitleAmount(title) {
  const amount = Math.max(0, Number(title.amount || 0));
  return Math.min(amount, Math.max(0, Number(title.paid_amount ?? (title.status === 'paid' ? amount : 0))));
}
