import {paidTitlePrincipal} from "../finance-core/titles.mjs";
import { decimalToCents, allocateCents } from '../money.mjs';
// Allocate by persisted measurement items. Integer cents reconcile every title,
// including partial payments; a payment never creates a second recognized cost.
export function allocateByWeight(amount, items) {
  const cents = decimalToCents(amount, {rounding:'half-away-from-zero'});
  if(cents===null)throw new TypeError('Valor ausente não é zero');
  return allocateCents(cents,items.map(item=>({id:item.id,weight:item.current_amount}))).map(value=>value/100);
}
export function paidTitleAmount(title) {
  return paidTitlePrincipal(title);
}
