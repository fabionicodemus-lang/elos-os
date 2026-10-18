import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSupplyNeeds } from '../../lib/preconstruction/supply-needs.mjs';
const line = (composition_id, coefficient, input_id = 'mat') => ({ composition_id, input_id, effective_coefficient: coefficient, status: 'active' });
const fixture = () => ({ activities: [{ service_id: 's', planned_start: '2026-03-01', quantity_snapshot: 50 }, { service_id: 's', planned_start: '2026-02-01', quantity_snapshot: 50 }], budgetItems: [{ id: 'b', service_id: 's', quantity: 100 }], snapshots: [{ id: 'snap', budget_item_id: 'b' }], snapshotItems: [line('snap', 2)], compositions: [{ id: 'catalog', service_id: 's' }], compositionItems: [line('catalog', 99)], inputs: [{ id: 'mat', category: 'material' }, { id: 'mo', category: 'labor' }] });
test('revision composition overrides catalog and floor activities do not multiply budget quantities', () => {
  assert.deepEqual(calculateSupplyNeeds(fixture()).get('mat'), { required: 200, firstUse: '2026-02-01' });
});
test('an empty revision snapshot never silently restores catalog materials', () => {
  const data = fixture(); data.snapshotItems = [];
  assert.equal(calculateSupplyNeeds(data).size, 0);
});
test('repeated services retain each budget item own snapshot', () => {
  const data = fixture(); data.budgetItems.push({ id: 'b2', service_id: 's', quantity: 10 });
  data.snapshots.push({ id: 'snap2', budget_item_id: 'b2' }); data.snapshotItems.push(line('snap2', 5));
  assert.equal(calculateSupplyNeeds(data).get('mat').required, 250);
});
test('shared inputs sum across services and retain earliest need; labor and inactive lines are excluded', () => {
  const data = fixture(); data.activities.push({ service_id: 's2', planned_start: '2026-01-01', quantity_snapshot: 1 });
  data.budgetItems.push({ id: 'b2', service_id: 's2', quantity: 10 });
  data.snapshots.push({ id: 'snap2', budget_item_id: 'b2' });
  data.snapshotItems.push(line('snap2', 5), line('snap', 20, 'mo'), { ...line('snap', 500), status: 'inactive' });
  assert.deepEqual([...calculateSupplyNeeds(data)], [['mat', { required: 250, firstUse: '2026-01-01' }]]);
});
test('legacy budget items use catalog composition with budget quantities', () => {
  const data = fixture(); data.snapshots = [];
  assert.equal(calculateSupplyNeeds(data).get('mat').required, 9900);
});
test('legacy schedule services absent from budget fall back to summed activity quantities', () => {
  const data = fixture(); data.budgetItems = [];
  assert.equal(calculateSupplyNeeds(data).get('mat').required, 9900);
});
test('zero budget quantities do not fall back to scheduled quantities', () => {
  const data = fixture(); data.budgetItems[0].quantity = 0;
  assert.equal(calculateSupplyNeeds(data).size, 0);
});
