// Revision snapshots are authoritative, including an intentionally empty one.
// Catalog compositions are a fallback only for legacy items without a snapshot.
export function calculateSupplyNeeds({ activities, budgetItems, snapshots, snapshotItems, compositions, compositionItems, inputs }) {
  const firstByService = new Map();
  const quantityByService = new Map();
  for (const activity of activities) {
    if (!activity.service_id) continue;
    const previous = firstByService.get(activity.service_id);
    if (!previous || activity.planned_start < previous) firstByService.set(activity.service_id, activity.planned_start);
    quantityByService.set(activity.service_id, (quantityByService.get(activity.service_id) ?? 0) + Math.max(0, Number(activity.quantity_snapshot ?? 0)));
  }
  const snapshotByItem = new Map(snapshots.map(row => [row.budget_item_id, row.id]));
  const catalogByService = new Map(compositions.map(row => [row.service_id, row.id]));
  const group = rows => {
    const result = new Map();
    for (const row of rows) {
      if (row.status !== 'active') continue;
      result.set(row.composition_id, [...(result.get(row.composition_id) ?? []), row]);
    }
    return result;
  };
  const snapshotLines = group(snapshotItems);
  const catalogLines = group(compositionItems);
  const inputMap = new Map(inputs.map(row => [row.id, row]));
  const needs = new Map();
  const add = (serviceId, quantity, rows) => {
    const firstUse = firstByService.get(serviceId);
    if (!firstUse || quantity <= 0) return;
    for (const row of rows ?? []) {
      const input = inputMap.get(row.input_id);
      if (!input || !['material', 'equipment', 'freight', 'other'].includes(input.category)) continue;
      const required = quantity * Math.max(0, Number(row.effective_coefficient ?? 0));
      if (required <= 0) continue;
      const previous = needs.get(input.id);
      needs.set(input.id, { required: (previous?.required ?? 0) + required, firstUse: !previous || firstUse < previous.firstUse ? firstUse : previous.firstUse });
    }
  };
  const budgetServices = new Set();
  for (const item of budgetItems) {
    if (!item.service_id) continue;
    budgetServices.add(item.service_id);
    const snapshotId = snapshotByItem.get(item.id);
    const rows = snapshotId ? snapshotLines.get(snapshotId) : catalogLines.get(catalogByService.get(item.service_id));
    add(item.service_id, Math.max(0, Number(item.quantity ?? 0)), rows);
  }
  for (const [serviceId, quantity] of quantityByService) {
    if (!budgetServices.has(serviceId)) add(serviceId, quantity, catalogLines.get(catalogByService.get(serviceId)));
  }
  return needs;
}
