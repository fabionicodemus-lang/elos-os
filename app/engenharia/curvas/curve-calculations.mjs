const DAY_MS = 86_400_000;
const MAX_CURVE_MONTHS = 240;

function parseDate(value) {
  const clean = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const date = new Date(`${clean}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean) return null;
  return date;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date).replace(" de ", "/");
}

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function monthEnd(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12));
}

function maxDate(first, second) {
  return first > second ? first : second;
}

function minDate(first, second) {
  return first < second ? first : second;
}

function activityRange(startValue, finishValue) {
  const start = parseDate(startValue);
  if (!start) return null;
  const finishCandidate = parseDate(finishValue);
  const rawFinish = !finishCandidate || finishCandidate < start ? start : finishCandidate;
  const maximumFinish = monthEnd(addMonths(monthStart(start), MAX_CURVE_MONTHS));
  return {
    start,
    finish: rawFinish > maximumFinish ? maximumFinish : rawFinish,
    clamped: rawFinish > maximumFinish,
  };
}

function countWorkdays(start, finish, workOnSaturday) {
  if (!start || !finish || finish < start) return 0;
  const totalDays = Math.floor((finish.getTime() - start.getTime()) / DAY_MS) + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  let total = fullWeeks * (workOnSaturday ? 6 : 5);
  const remainder = totalDays % 7;
  for (let offset = 0; offset < remainder; offset += 1) {
    const day = (start.getUTCDay() + offset) % 7;
    if (day !== 0 && (workOnSaturday || day !== 6)) total += 1;
  }
  return total;
}

function serviceDisplay(serviceId, services) {
  const service = services.get(serviceId);
  if (!service) return `Serviço ${serviceId}`;
  return service.code ? `${service.code} · ${service.description}` : service.description;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Number(value ?? 0)));
}

function addToMap(map, key, value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

function buildPhysicalWeights(activities, assignedCosts) {
  const assignedTotal = activities.reduce(
    (sum, activity) => sum + Math.max(0, Number(assignedCosts.get(activity.id) ?? 0)),
    0,
  );
  const usesEqualPhysicalWeights = assignedTotal <= 0;
  const physicalWeights = new Map();
  activities.forEach((activity) => {
    const cost = Math.max(0, Number(assignedCosts.get(activity.id) ?? 0));
    physicalWeights.set(
      activity.id,
      usesEqualPhysicalWeights ? 100 / Math.max(1, activities.length) : cost / assignedTotal * 100,
    );
  });
  return { physicalWeights, usesEqualPhysicalWeights };
}

function distributeAmountByWorkdays({ startValue, finishValue, financialValue, physicalValue, workOnSaturday, financialMap, physicalMap, zeroWorkdayActivityIds, clampedActivityIds, activityId }) {
  const range = activityRange(startValue, finishValue);
  if (!range) return;
  const { start, finish, clamped } = range;
  if (clamped) clampedActivityIds?.add(activityId);
  const totalWorkdays = countWorkdays(start, finish, workOnSaturday);
  if (totalWorkdays === 0) {
    zeroWorkdayActivityIds.add(activityId);
    addToMap(financialMap, monthKey(start), financialValue);
    addToMap(physicalMap, monthKey(start), physicalValue);
    return;
  }
  for (let period = monthStart(start), index = 0; period <= monthStart(finish) && index <= MAX_CURVE_MONTHS; period = addMonths(period, 1), index += 1) {
    const overlapStart = maxDate(start, period);
    const overlapFinish = minDate(finish, monthEnd(period));
    const workdays = countWorkdays(overlapStart, overlapFinish, workOnSaturday);
    if (workdays <= 0) continue;
    const fraction = workdays / totalWorkdays;
    addToMap(financialMap, monthKey(period), financialValue * fraction);
    addToMap(physicalMap, monthKey(period), physicalValue * fraction);
  }
}

export function assignActivityCosts(activities, items) {
  const assigned = new Map();
  const serviceTotals = new Map();
  const activitiesByService = new Map();

  items.forEach((item) => {
    if (item.status !== "active" || !item.service_id) return;
    serviceTotals.set(item.service_id, (serviceTotals.get(item.service_id) ?? 0) + Number(item.total_direct_cost ?? 0));
  });

  activities.forEach((activity) => {
    if (!activity.service_id) {
      assigned.set(activity.id, Math.max(0, Number(activity.planned_cost ?? 0)));
      return;
    }
    const group = activitiesByService.get(activity.service_id) ?? [];
    group.push(activity);
    activitiesByService.set(activity.service_id, group);
  });

  activitiesByService.forEach((serviceActivities, serviceId) => {
    const serviceTotal = Math.max(0, serviceTotals.get(serviceId) ?? 0);
    const explicit = serviceActivities.filter((activity) => Number(activity.planned_cost) > 0);
    const fallback = serviceActivities.filter((activity) => Number(activity.planned_cost) <= 0);
    const explicitTotal = explicit.reduce((sum, activity) => sum + Number(activity.planned_cost), 0);

    explicit.forEach((activity) => assigned.set(activity.id, Number(activity.planned_cost)));

    const remaining = Math.max(0, serviceTotal - explicitTotal);
    const quantityTotal = fallback.reduce((sum, activity) => sum + Math.max(0, Number(activity.quantity_snapshot ?? 0)), 0);
    fallback.forEach((activity) => {
      const weight = quantityTotal > 0
        ? Math.max(0, Number(activity.quantity_snapshot ?? 0)) / quantityTotal
        : 1 / Math.max(1, fallback.length);
      assigned.set(activity.id, remaining * weight);
    });
  });

  return assigned;
}

export function buildCurves(activities, assignedCosts, budgetTotal, workOnSaturday) {
  const validActivities = activities
    .map((activity) => ({ activity, range: activityRange(activity.planned_start, activity.planned_finish) }))
    .filter((entry) => entry.range);
  if (!validActivities.length) {
    return { rows: [], usesEqualPhysicalWeights: false, zeroWorkdayActivityIds: [], clampedActivityIds: [] };
  }

  const earliest = validActivities.reduce((current, entry) => minDate(current, entry.range.start), validActivities[0].range.start);
  const latest = validActivities.reduce((current, entry) => maxDate(current, entry.range.finish), validActivities[0].range.finish);
  const normalizedActivities = validActivities.map((entry) => entry.activity);
  const { physicalWeights, usesEqualPhysicalWeights } = buildPhysicalWeights(normalizedActivities, assignedCosts);
  const zeroWorkdayActivityIds = new Set();
  const clampedActivityIds = new Set(validActivities.filter((entry) => entry.range.clamped).map((entry) => entry.activity.id));
  const financialMap = new Map();
  const physicalMap = new Map();

  validActivities.forEach(({ activity, range }) => {
    distributeAmountByWorkdays({
      startValue: range.start.toISOString().slice(0, 10),
      finishValue: range.finish.toISOString().slice(0, 10),
      financialValue: Math.max(0, Number(assignedCosts.get(activity.id) ?? 0)),
      physicalValue: Math.max(0, Number(physicalWeights.get(activity.id) ?? 0)),
      workOnSaturday,
      financialMap,
      physicalMap,
      zeroWorkdayActivityIds,
      clampedActivityIds,
      activityId: activity.id,
    });
  });

  const periods = [];
  for (let current = monthStart(earliest), index = 0; current <= monthStart(latest) && index <= MAX_CURVE_MONTHS; current = addMonths(current, 1), index += 1) {
    periods.push(current);
  }

  let physicalAccumulated = 0;
  let financialAccumulated = 0;
  const rows = periods.map((period) => {
    const key = monthKey(period);
    const physicalMonth = physicalMap.get(key) ?? 0;
    const financialMonth = financialMap.get(key) ?? 0;
    physicalAccumulated = Math.min(100, physicalAccumulated + physicalMonth);
    financialAccumulated += financialMonth;
    return {
      key,
      label: monthLabel(period),
      physicalMonth,
      physicalAccumulated,
      financialMonth,
      financialAccumulated,
      financialPercent: budgetTotal > 0 ? financialAccumulated / budgetTotal * 100 : 0,
    };
  });

  return {
    rows,
    usesEqualPhysicalWeights,
    zeroWorkdayActivityIds: [...zeroWorkdayActivityIds],
    clampedActivityIds: [...clampedActivityIds],
  };
}

export function buildLiveCurves(activities, assignedCosts, budgetTotal, workOnSaturday, measurements, asOfDate) {
  const baseline = buildCurves(activities, assignedCosts, budgetTotal, workOnSaturday);
  const activityIds = new Set(activities.map((activity) => activity.id));
  const asOf = parseDate(asOfDate) ?? new Date();
  const historyMinimum = addMonths(monthStart(asOf), -MAX_CURVE_MONTHS);
  const executionMeasurements = measurements
    .filter((measurement) => {
      const date = parseDate(measurement.measurement_date);
      return activityIds.has(measurement.activity_id) && date && date >= historyMinimum && date <= asOf;
    })
    .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")));

  if (executionMeasurements.length === 0) {
    return {
      ...baseline,
      hasExecutionData: false,
      lateActualCostWarnings: [],
    };
  }

  const validActivities = activities.filter((activity) => activityRange(activity.planned_start, activity.planned_finish));
  const { physicalWeights, usesEqualPhysicalWeights } = buildPhysicalWeights(validActivities, assignedCosts);
  const measurementsByActivity = new Map();
  executionMeasurements.forEach((measurement) => {
    const group = measurementsByActivity.get(measurement.activity_id) ?? [];
    group.push(measurement);
    measurementsByActivity.set(measurement.activity_id, group);
  });

  const currentFinancial = new Map();
  const actualFinancial = new Map();
  const currentPhysical = new Map();
  const actualPhysical = new Map();
  const zeroWorkdayActivityIds = new Set(baseline.zeroWorkdayActivityIds);
  const clampedActivityIds = new Set(baseline.clampedActivityIds ?? []);
  const lateActualCostWarnings = [];

  validActivities.forEach((activity) => {
    const activityCost = Math.max(0, Number(assignedCosts.get(activity.id) ?? 0));
    const activityPhysicalWeight = Math.max(0, Number(physicalWeights.get(activity.id) ?? 0));
    const history = measurementsByActivity.get(activity.id) ?? [];
    let previousProgress = 0;
    let previousActualCost = 0;
    let recognizedFinancial = 0;
    let actualCostTracking = false;
    let progressWithoutActualCost = false;

    history.forEach((measurement) => {
      const progress = clampPercent(measurement.progress_percent);
      const deltaProgress = progress - previousProgress;
      const key = measurement.measurement_date.slice(0, 7);
      const physicalDelta = activityPhysicalWeight * deltaProgress / 100;
      addToMap(actualPhysical, key, physicalDelta);
      addToMap(currentPhysical, key, physicalDelta);

      const cumulativeActualCost = Math.max(0, Number(measurement.actual_cost ?? 0));
      const startsActualCostTracking = !actualCostTracking && cumulativeActualCost > 0;
      if (startsActualCostTracking && progressWithoutActualCost) {
        lateActualCostWarnings.push({ activityId: activity.id, measurementDate: measurement.measurement_date });
      }

      let financialDelta = 0;
      if (startsActualCostTracking) {
        actualCostTracking = true;
        financialDelta = cumulativeActualCost - recognizedFinancial;
      } else if (actualCostTracking) {
        financialDelta = cumulativeActualCost - previousActualCost;
      } else {
        financialDelta = activityCost * deltaProgress / 100;
      }

      addToMap(actualFinancial, key, financialDelta);
      addToMap(currentFinancial, key, financialDelta);
      recognizedFinancial += financialDelta;
      if (!actualCostTracking && progress > 0) progressWithoutActualCost = true;
      previousProgress = progress;
      if (actualCostTracking) previousActualCost = cumulativeActualCost;
    });

    const latest = history.at(-1) ?? null;
    const completed = Boolean(latest && (clampPercent(latest.progress_percent) >= 100 || latest.actual_finish));
    if (completed && previousProgress < 100 && latest) {
      const completionDelta = 100 - previousProgress;
      const key = latest.measurement_date.slice(0, 7);
      const physicalDelta = activityPhysicalWeight * completionDelta / 100;
      addToMap(actualPhysical, key, physicalDelta);
      addToMap(currentPhysical, key, physicalDelta);
      if (!actualCostTracking) {
        const financialDelta = activityCost * completionDelta / 100;
        addToMap(actualFinancial, key, financialDelta);
        addToMap(currentFinancial, key, financialDelta);
        recognizedFinancial += financialDelta;
      }
      previousProgress = 100;
    }

    if (completed) return;

    const remainingFraction = Math.max(0, 1 - previousProgress / 100);
    if (remainingFraction <= 0) return;
    const plannedRange = activityRange(activity.planned_start, activity.planned_finish);
    const currentStart = parseDate(latest?.current_start || latest?.actual_start || activity.planned_start) ?? plannedRange?.start ?? asOf;
    const currentFinish = parseDate(latest?.current_finish || activity.planned_finish) ?? plannedRange?.finish ?? currentStart;
    const futureStart = currentStart > asOf && previousProgress <= 0 ? currentStart : asOf;
    const maximumFinish = monthEnd(addMonths(monthStart(futureStart), MAX_CURVE_MONTHS));
    const futureFinishCandidate = currentFinish > futureStart ? currentFinish : futureStart;
    const futureFinish = futureFinishCandidate > maximumFinish ? maximumFinish : futureFinishCandidate;
    if (futureFinishCandidate > maximumFinish) clampedActivityIds.add(activity.id);

    distributeAmountByWorkdays({
      startValue: futureStart.toISOString().slice(0, 10),
      finishValue: futureFinish.toISOString().slice(0, 10),
      financialValue: activityCost * remainingFraction,
      physicalValue: activityPhysicalWeight * remainingFraction,
      workOnSaturday,
      financialMap: currentFinancial,
      physicalMap: currentPhysical,
      zeroWorkdayActivityIds,
      clampedActivityIds,
      activityId: activity.id,
    });
  });

  const baselineByKey = new Map(baseline.rows.map((row) => [row.key, row]));
  const allKeys = new Set(baseline.rows.map((row) => row.key));
  for (const map of [currentFinancial, actualFinancial, currentPhysical, actualPhysical]) {
    for (const key of map.keys()) allKeys.add(key);
  }
  allKeys.add(asOfDate.slice(0, 7));
  const sortedKeys = [...allKeys].filter(Boolean).sort();
  if (sortedKeys.length === 0) {
    return {
      ...baseline,
      hasExecutionData: true,
      lateActualCostWarnings,
    };
  }

  const firstPeriod = parseDate(`${sortedKeys[0]}-01`);
  const lastCandidate = parseDate(`${sortedKeys.at(-1)}-01`);
  if (!firstPeriod || !lastCandidate) {
    return {
      ...baseline,
      hasExecutionData: true,
      lateActualCostWarnings,
    };
  }
  const maximumPeriod = addMonths(firstPeriod, MAX_CURVE_MONTHS);
  const lastPeriod = lastCandidate > maximumPeriod ? maximumPeriod : lastCandidate;
  const periods = [];
  for (let current = firstPeriod, index = 0; current <= lastPeriod && index <= MAX_CURVE_MONTHS; current = addMonths(current, 1), index += 1) {
    periods.push(current);
  }

  let baselinePhysicalAccumulated = 0;
  let baselineFinancialAccumulated = 0;
  let currentPhysicalAccumulated = 0;
  let actualPhysicalAccumulated = 0;
  let currentFinancialAccumulated = 0;
  let actualFinancialAccumulated = 0;

  const rows = periods.map((period) => {
    const key = monthKey(period);
    const baselineRow = baselineByKey.get(key);
    const physicalMonth = baselineRow?.physicalMonth ?? 0;
    const financialMonth = baselineRow?.financialMonth ?? 0;
    baselinePhysicalAccumulated = Math.min(100, Math.max(0, baselinePhysicalAccumulated + physicalMonth));
    baselineFinancialAccumulated += financialMonth;

    const currentPhysicalMonth = currentPhysical.get(key) ?? 0;
    const actualPhysicalMonth = actualPhysical.get(key) ?? 0;
    const currentFinancialMonth = currentFinancial.get(key) ?? 0;
    const actualFinancialMonth = actualFinancial.get(key) ?? 0;
    currentPhysicalAccumulated = Math.min(100, Math.max(0, currentPhysicalAccumulated + currentPhysicalMonth));
    actualPhysicalAccumulated = Math.min(100, Math.max(0, actualPhysicalAccumulated + actualPhysicalMonth));
    currentFinancialAccumulated += currentFinancialMonth;
    actualFinancialAccumulated += actualFinancialMonth;

    return {
      key,
      label: monthLabel(period),
      physicalMonth,
      physicalAccumulated: baselinePhysicalAccumulated,
      financialMonth,
      financialAccumulated: baselineFinancialAccumulated,
      financialPercent: budgetTotal > 0 ? baselineFinancialAccumulated / budgetTotal * 100 : 0,
      currentPhysicalMonth,
      currentPhysicalAccumulated,
      actualPhysicalMonth,
      actualPhysicalAccumulated,
      currentFinancialMonth,
      currentFinancialAccumulated,
      currentFinancialPercent: budgetTotal > 0 ? currentFinancialAccumulated / budgetTotal * 100 : 0,
      actualFinancialMonth,
      actualFinancialAccumulated,
      actualFinancialPercent: budgetTotal > 0 ? actualFinancialAccumulated / budgetTotal * 100 : 0,
    };
  });

  return {
    rows,
    hasExecutionData: true,
    usesEqualPhysicalWeights,
    zeroWorkdayActivityIds: [...zeroWorkdayActivityIds],
    clampedActivityIds: [...clampedActivityIds],
    lateActualCostWarnings,
  };
}

export function calculateCurveDeviations(rows, currentMonthKey) {
  if (!rows.length || !rows.some((row) => row.currentPhysicalAccumulated !== undefined)) {
    return {
      delayAt50Months: null,
      finishDelayMonths: null,
      baselineFinancialToDate: 0,
      actualFinancialToDate: 0,
      financialDeviationToDate: 0,
    };
  }
  const monthDifference = (fromKey, toKey) => {
    if (!fromKey || !toKey) return null;
    const [fromYear, fromMonth] = fromKey.split("-").map(Number);
    const [toYear, toMonth] = toKey.split("-").map(Number);
    return (toYear - fromYear) * 12 + toMonth - fromMonth;
  };
  const firstAt = (field, threshold) => rows.find((row) => Number(row[field] ?? 0) >= threshold)?.key ?? null;
  const rowToDate = [...rows].reverse().find((row) => row.key <= currentMonthKey) ?? null;
  const baseline50 = firstAt("physicalAccumulated", 50);
  const current50 = firstAt("currentPhysicalAccumulated", 50);
  const baselineFinish = firstAt("physicalAccumulated", 99.999);
  const currentFinish = firstAt("currentPhysicalAccumulated", 99.999);
  const baselineFinancialToDate = Number(rowToDate?.financialAccumulated ?? 0);
  const actualFinancialToDate = Number(rowToDate?.actualFinancialAccumulated ?? 0);
  return {
    delayAt50Months: monthDifference(baseline50, current50),
    finishDelayMonths: monthDifference(baselineFinish, currentFinish),
    baselineFinancialToDate,
    actualFinancialToDate,
    financialDeviationToDate: actualFinancialToDate - baselineFinancialToDate,
  };
}

export function detectIntegrityAlerts(activities, items, services) {
  const activeItems = items.filter((item) => item.status === "active");
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const budgetTotals = new Map();

  activeItems.forEach((item) => {
    if (!item.service_id) return;
    budgetTotals.set(item.service_id, (budgetTotals.get(item.service_id) ?? 0) + Number(item.total_direct_cost ?? 0));
  });

  const activitiesByService = new Map();
  activities.forEach((activity) => {
    if (!activity.service_id) return;
    const group = activitiesByService.get(activity.service_id) ?? [];
    group.push(activity);
    activitiesByService.set(activity.service_id, group);
  });

  const servicesWithoutActivities = [...budgetTotals.entries()]
    .filter(([serviceId]) => (activitiesByService.get(serviceId)?.length ?? 0) === 0)
    .map(([serviceId, budgetValue]) => ({
      serviceId,
      serviceLabel: serviceDisplay(serviceId, serviceMap),
      budgetValue,
    }))
    .sort((a, b) => a.serviceLabel.localeCompare(b.serviceLabel, "pt-BR"));

  const overprogrammedServices = [...budgetTotals.entries()]
    .map(([serviceId, budgetValue]) => {
      const programmedValue = (activitiesByService.get(serviceId) ?? [])
        .filter((activity) => Number(activity.planned_cost) > 0)
        .reduce((sum, activity) => sum + Number(activity.planned_cost), 0);
      return {
        serviceId,
        serviceLabel: serviceDisplay(serviceId, serviceMap),
        budgetValue,
        programmedValue,
        excessValue: programmedValue - budgetValue,
      };
    })
    .filter((alert) => alert.excessValue > 0)
    .sort((a, b) => b.excessValue - a.excessValue);

  const activitiesWithoutBudgetService = activities
    .filter((activity) => activity.service_id && !budgetTotals.has(activity.service_id))
    .map((activity) => ({
      activityId: activity.id,
      activityLabel: activity.code ? `${activity.code} · ${activity.name}` : activity.name,
      serviceId: activity.service_id,
      serviceLabel: serviceDisplay(activity.service_id, serviceMap),
    }))
    .sort((a, b) => a.activityLabel.localeCompare(b.activityLabel, "pt-BR"));

  const budgetItemsWithoutService = activeItems
    .filter((item) => !item.service_id)
    .map((item) => ({
      itemId: item.id,
      itemLabel: item.code
        ? `${item.code} · ${item.description || "Item sem descrição"}`
        : item.description || `Item ${item.id}`,
      budgetValue: Number(item.total_direct_cost ?? 0),
    }))
    .sort((a, b) => a.itemLabel.localeCompare(b.itemLabel, "pt-BR"));

  return {
    servicesWithoutActivities,
    overprogrammedServices,
    activitiesWithoutBudgetService,
    budgetItemsWithoutService,
  };
}
