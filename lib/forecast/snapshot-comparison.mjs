function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function field(row, camel, snake) {
  return row?.[camel] ?? row?.[snake] ?? null;
}

function emptySummary(serviceKey, row = {}) {
  return {
    serviceKey,
    serviceId: field(row, "serviceId", "service_id"),
    code: String(field(row, "serviceCode", "service_code") ?? ""),
    name: String(field(row, "serviceName", "service_name") ?? "Serviço"),
    budget: number(field(row, "serviceBudgetAmount", "service_budget_amount")),
    actual: 0,
    committed: 0,
    toCommit: 0,
    projected: 0,
    deviation: 0,
  };
}

export function summarizeSnapshotRows(rows = []) {
  const summaries = new Map();

  for (const row of rows) {
    const serviceKey = String(field(row, "serviceKey", "service_key") ?? "").trim();
    if (!serviceKey) continue;

    const previous = summaries.get(serviceKey) ?? emptySummary(serviceKey, row);
    const layer = String(row.layer ?? "");
    const amount = number(row.amount);
    const next = {
      ...previous,
      serviceId: previous.serviceId ?? field(row, "serviceId", "service_id"),
      code: previous.code || String(field(row, "serviceCode", "service_code") ?? ""),
      name: previous.name || String(field(row, "serviceName", "service_name") ?? "Serviço"),
      budget: Math.max(previous.budget, number(field(row, "serviceBudgetAmount", "service_budget_amount"))),
      actual: previous.actual + (layer === "actual" ? amount : 0),
      committed: previous.committed + (layer === "committed" ? amount : 0),
      toCommit: previous.toCommit + (layer === "to_commit" ? amount : 0),
    };
    next.projected = next.actual + next.committed + next.toCommit;
    next.deviation = next.projected - next.budget;
    summaries.set(serviceKey, next);
  }

  return [...summaries.values()].sort((a, b) => `${a.code}:${a.name}:${a.serviceKey}`.localeCompare(`${b.code}:${b.name}:${b.serviceKey}`, "pt-BR"));
}

function blankComparable(serviceKey, source) {
  return source ?? emptySummary(serviceKey);
}

export function compareSnapshots(rowsA = [], rowsB = []) {
  const aMap = new Map(summarizeSnapshotRows(rowsA).map((row) => [row.serviceKey, row]));
  const bMap = new Map(summarizeSnapshotRows(rowsB).map((row) => [row.serviceKey, row]));
  const keys = [...new Set([...aMap.keys(), ...bMap.keys()])];

  return keys.map((serviceKey) => {
    const a = blankComparable(serviceKey, aMap.get(serviceKey));
    const b = blankComparable(serviceKey, bMap.get(serviceKey));
    return {
      serviceKey,
      code: b.code || a.code,
      name: b.name || a.name,
      a,
      b,
      delta: {
        budget: b.budget - a.budget,
        actual: b.actual - a.actual,
        committed: b.committed - a.committed,
        toCommit: b.toCommit - a.toCommit,
        projected: b.projected - a.projected,
        deviation: b.deviation - a.deviation,
      },
    };
  }).sort((left, right) => `${left.code}:${left.name}:${left.serviceKey}`.localeCompare(`${right.code}:${right.name}:${right.serviceKey}`, "pt-BR"));
}

export function compareSnapshotToActual(snapshotRows = [], actualMonths = [], currentMonthKey) {
  const predicted = new Map();
  for (const row of snapshotRows) {
    const month = String(row.month ?? row.monthKey ?? row.month_key ?? "").slice(0, 7);
    if (!month) continue;
    predicted.set(month, number(predicted.get(month)) + number(row.amount));
  }

  const actual = new Map();
  for (const row of actualMonths) {
    const month = String(row.key ?? row.month ?? "").slice(0, 7);
    if (!month) continue;
    actual.set(month, number(actual.get(month)) + number(row.actual));
  }

  const keys = [...new Set([...predicted.keys(), ...actual.keys()])].sort();
  return keys.map((month) => {
    const predictedAmount = number(predicted.get(month));
    const actualAmount = number(actual.get(month));
    const deviation = actualAmount - predictedAmount;
    return {
      month,
      predicted: predictedAmount,
      actual: actualAmount,
      deviation,
      deviationPercent: predictedAmount === 0 ? null : deviation / predictedAmount * 100,
      closed: Boolean(currentMonthKey && month < currentMonthKey),
      current: month === currentMonthKey,
    };
  });
}

export function buildProjectionEvolution(snapshots = []) {
  return [...snapshots]
    .map((snapshot) => ({
      id: String(snapshot.id),
      capturedAt: String(snapshot.capturedAt ?? snapshot.captured_at ?? ""),
      referenceMonth: String(snapshot.referenceMonth ?? snapshot.reference_month ?? "").slice(0, 7),
      budget: number(snapshot.budgetTotal ?? snapshot.budget_total),
      projected: number(snapshot.projectedCostTotal ?? snapshot.projected_cost_total),
      deviation: number(snapshot.deviationTotal ?? snapshot.deviation_total),
    }))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}
