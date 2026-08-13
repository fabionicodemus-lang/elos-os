const DAY_MS = 86_400_000;

function isoDate(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function parseDate(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthStart(value) {
  const date = parseDate(value);
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12)).toISOString().slice(0, 10);
}

function addMonths(value, months) {
  const date = parseDate(value);
  if (!date) return value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12)).toISOString().slice(0, 10);
}

function monthEnd(value) {
  const date = parseDate(value);
  if (!date) return value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
}

function monthKey(value) {
  return String(value).slice(0, 7);
}

function monthLabel(value) {
  const date = parseDate(value);
  if (!date) return monthKey(value);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date).replace(".", "");
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function activityDuration(activity) {
  const start = parseDate(activity.planned_start);
  const finish = parseDate(activity.planned_finish);
  if (!start || !finish) return positive(activity.duration_days) || 1;
  return Math.max(1, Math.round((Math.max(start.getTime(), finish.getTime()) - start.getTime()) / DAY_MS) + 1);
}

function activityFallbackBase(activity, mode) {
  if (mode === "cost") return positive(activity.planned_cost);
  if (mode === "quantity") return positive(activity.quantity_snapshot);
  if (mode === "duration") return activityDuration(activity);
  return 1;
}

function chooseBaseMode(rows) {
  if (rows.some((row) => positive(row.planned_cost) > 0)) return "cost";
  if (rows.some((row) => positive(row.duration_days) > 0)) return "duration";
  if (rows.some((row) => positive(row.quantity_snapshot) > 0)) return "quantity";
  return "equal";
}

function normalizeMap(values) {
  const total = [...values.values()].reduce((sum, value) => sum + positive(value), 0);
  if (total <= 0) return values;
  const normalized = new Map();
  for (const [key, value] of values) normalized.set(key, positive(value) / total * 100);
  return normalized;
}

export function calculateDashboardActivityWeights(activities, serviceWeights = []) {
  const active = activities.filter((activity) => activity.record_status === "active" && parseDate(activity.planned_start) && parseDate(activity.planned_finish));
  if (!active.length) return new Map();

  const configured = new Map();
  for (const row of serviceWeights) {
    if (!row?.service_id) continue;
    const weight = positive(row.physical_weight_percent);
    if (weight > 0) configured.set(row.service_id, weight);
  }

  const groups = new Map();
  for (const activity of active) {
    const key = activity.service_id ? `service:${activity.service_id}` : `activity:${activity.id}`;
    groups.set(key, [...(groups.get(key) ?? []), activity]);
  }

  const groupWeights = new Map();
  const unconfigured = [];
  let explicitTotal = 0;

  for (const [key, rows] of groups) {
    const serviceId = rows[0]?.service_id ?? null;
    const explicit = serviceId ? positive(configured.get(serviceId)) : 0;
    if (explicit > 0) {
      groupWeights.set(key, explicit);
      explicitTotal += explicit;
    } else {
      unconfigured.push([key, rows]);
    }
  }

  if (explicitTotal >= 100 && groupWeights.size) {
    const scaled = normalizeMap(groupWeights);
    groupWeights.clear();
    for (const [key, value] of scaled) groupWeights.set(key, value);
  } else if (unconfigured.length) {
    const remaining = Math.max(0, 100 - explicitTotal);
    const flatRows = unconfigured.flatMap(([, rows]) => rows);
    const mode = chooseBaseMode(flatRows);
    const groupBases = unconfigured.map(([key, rows]) => [key, rows.reduce((sum, row) => sum + activityFallbackBase(row, mode), 0)]);
    const totalBase = groupBases.reduce((sum, [, base]) => sum + positive(base), 0) || unconfigured.length;
    for (const [key, base] of groupBases) {
      groupWeights.set(key, remaining * (positive(base) || 1) / totalBase);
    }
  } else if (groupWeights.size && explicitTotal > 0 && explicitTotal < 100) {
    const scaled = normalizeMap(groupWeights);
    groupWeights.clear();
    for (const [key, value] of scaled) groupWeights.set(key, value);
  }

  if (!groupWeights.size) {
    const equal = 100 / groups.size;
    for (const key of groups.keys()) groupWeights.set(key, equal);
  }

  const activityWeights = new Map();
  for (const [key, rows] of groups) {
    const groupWeight = positive(groupWeights.get(key));
    const mode = chooseBaseMode(rows);
    const bases = rows.map((row) => activityFallbackBase(row, mode));
    const totalBase = bases.reduce((sum, value) => sum + positive(value), 0) || rows.length;
    rows.forEach((row, index) => {
      activityWeights.set(row.id, groupWeight * (positive(bases[index]) || 1) / totalBase);
    });
  }

  return normalizeMap(activityWeights);
}

function plannedProgress(activity, selectedDate) {
  const date = parseDate(selectedDate);
  const start = parseDate(activity.planned_start);
  const rawFinish = parseDate(activity.planned_finish);
  if (!date || !start || !rawFinish) return 0;
  const finish = rawFinish < start ? start : rawFinish;
  if (date < start) return 0;
  if (date >= finish) return 100;
  const totalDays = Math.max(1, Math.round((finish.getTime() - start.getTime()) / DAY_MS) + 1);
  const elapsedDays = Math.max(0, Math.round((date.getTime() - start.getTime()) / DAY_MS) + 1);
  return clamp(elapsedDays / totalDays * 100);
}

function physicalAtDate(activities, measurements, weights, selectedDate) {
  const relevantMeasurements = measurements
    .filter((item) => isoDate(item.measurement_date) && item.measurement_date.slice(0, 10) <= selectedDate)
    .sort((a, b) => {
      const byDate = String(a.measurement_date).localeCompare(String(b.measurement_date));
      if (byDate) return byDate;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });

  const latest = new Map();
  for (const measurement of relevantMeasurements) latest.set(measurement.activity_id, measurement);

  let planned = 0;
  let actual = 0;
  let totalWeight = 0;
  for (const activity of activities) {
    const weight = positive(weights.get(activity.id));
    if (!weight) continue;
    totalWeight += weight;
    planned += plannedProgress(activity, selectedDate) * weight;
    actual += clamp(latest.get(activity.id)?.progress_percent ?? 0) * weight;
  }

  const divisor = totalWeight || 100;
  return {
    planned: clamp(planned / divisor),
    actual: clamp(actual / divisor),
    hasMeasurement: relevantMeasurements.some((item) => weights.has(item.activity_id)),
  };
}

export function buildDashboardPhysicalMonths({
  activities,
  measurements = [],
  serviceWeights = [],
  today,
  maxMonths = 72,
}) {
  const todayIso = isoDate(today) ?? new Date().toISOString().slice(0, 10);
  const active = activities
    .filter((activity) => activity.record_status === "active")
    .filter((activity) => parseDate(activity.planned_start) && parseDate(activity.planned_finish));
  if (!active.length) return [];

  const weights = calculateDashboardActivityWeights(active, serviceWeights);
  const starts = active.map((item) => isoDate(item.planned_start)).filter(Boolean).sort();
  const finishes = active.map((item) => isoDate(item.planned_finish)).filter(Boolean).sort();
  if (!starts.length || !finishes.length) return [];

  const firstMonth = monthStart(starts[0]);
  const lastMonth = monthStart(finishes.at(-1));
  const currentMonth = monthStart(todayIso);
  if (!firstMonth || !lastMonth || !currentMonth) return [];

  let cursor = firstMonth < currentMonth && lastMonth < currentMonth ? firstMonth : (currentMonth < firstMonth ? currentMonth : firstMonth);
  const limit = lastMonth > currentMonth ? lastMonth : currentMonth;
  const rows = [];
  let previousPlanned = 0;
  let previousActual = 0;
  let guard = 0;

  while (cursor <= limit && guard < maxMonths) {
    const key = monthKey(cursor);
    const current = key === monthKey(todayIso);
    const monthEndIso = monthEnd(cursor);
    const actualCutoff = current && todayIso < monthEndIso ? todayIso : monthEndIso;
    const snapshot = physicalAtDate(active, measurements, weights, monthEndIso);
    const actualSnapshot = physicalAtDate(active, measurements, weights, actualCutoff);

    const planned = Math.max(previousPlanned, snapshot.planned);
    const isFuture = key > monthKey(todayIso);
    const actual = !isFuture && actualSnapshot.hasMeasurement
      ? Math.max(previousActual, actualSnapshot.actual)
      : null;

    rows.push({
      key,
      label: monthLabel(cursor),
      planned,
      actual,
      current,
    });

    previousPlanned = planned;
    if (actual !== null) previousActual = actual;
    cursor = addMonths(cursor, 1);
    guard += 1;
  }

  if (rows.length && monthKey(lastMonth) <= rows.at(-1).key) {
    rows[rows.length - 1].planned = Math.max(rows.at(-1).planned, 100);
  }

  return rows;
}
