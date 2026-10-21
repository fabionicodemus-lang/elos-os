import { decimalToCents, allocateCents } from '../money.mjs';
const cents = value => decimalToCents(value, { rounding: 'half-away-from-zero' });
// Persisted monetary allocations are amounts, not weights over known services.
// Unmapped services and omitted parts remain visible as A Apropriar.
export function allocatePersistedCosts(payable, amount, allocations, developmentServiceIds = new Set()) {
  const principal = cents(payable.amount), target = cents(amount);
  if (principal === null || target === null || principal < 0 || target < 0) throw Error('Base de apropriação inválida');
  const rows = (allocations ?? []).map((r, i) => ({ ...r, key: r.id ?? `${r.service_id ?? '~pending'}:${i}`, cents: cents(r.allocation_amount) }));
  if (rows.some(r => r.cents === null || r.cents < 0)) throw Error('Rateio inválido');
  const known = rows.reduce((sum, r) => sum + r.cents, 0);
  if (!Number.isSafeInteger(known) || known > principal) throw Error('Rateio excede o título');
  if (known < principal) rows.push({ key: '~unallocated', service_id: null, cents: principal - known });
  if (principal === 0) return target === 0 ? [] : [{id: `${payable.id}:~unclassified_excess`, contractId: null, serviceId: null, amount: target / 100}];
  const distributed = allocateCents(Math.min(target, principal), rows.map(r => ({ id: r.key, weight: r.cents })));
  const result = rows.flatMap((r, i) => developmentServiceIds.has(r.service_id) ? [] : [{
    id: `${payable.id}:${r.key}`, contractId: null, serviceId: r.service_id ?? null, amount: distributed[i] / 100,
  }]);
  if (target > principal) result.push({id: `${payable.id}:~unclassified_excess`, contractId: null, serviceId: null, amount: (target - principal) / 100});
  return result;
}
