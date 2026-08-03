const DAY_MS = 86_400_000;
export const UNALLOCATED_SERVICE_ID = "__unallocated__";

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const clean = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  return new Date(`${clean}T12:00:00Z`);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? date.toISOString().slice(0, 7) : "";
}

function addDays(value, days) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  return new Date(date.getTime() + number(days) * DAY_MS);
}

function isWorkday(date, workOnSaturday) {
  const day = date.getUTCDay();
  return day !== 0 && (workOnSaturday || day !== 6);
}

function enumerateWorkdays(startValue, finishValue, workOnSaturday) {
  const start = parseDate(startValue);
  const finishCandidate = parseDate(finishValue);
  if (!start) return [];
  const finish = !finishCandidate || finishCandidate < start ? start : finishCandidate;
  const days = [];
  for (let current = start; current <= finish; current = new Date(current.getTime() + DAY_MS)) {
    if (isWorkday(current, workOnSaturday)) days.push(dateKey(current));
  }
  return days.length ? days : [dateKey(start)];
}

function addToNestedMap(map, serviceId, key, value) {
  const amount = number(value);
  if (Math.abs(amount) < 1e-9 || !key) return;
  const serviceMap = map.get(serviceId) ?? new Map();
  serviceMap.set(key, number(serviceMap.get(key)) + amount);
  map.set(serviceId, serviceMap);
}

function addToMap(map, key, value) {
  const amount = number(value);
  if (Math.abs(amount) < 1e-9 || !key) return;
  map.set(key, number(map.get(key)) + amount);
}

function sumMap(map) {
  let total = 0;
  for (const value of map?.values?.() ?? []) total += number(value);
  return total;
}

function clampProgress(value) {
  return Math.min(100, Math.max(0, number(value)));
}

function distributeFixed(map, serviceId, amount, dueDate) {
  const key = monthKey(dueDate);
  if (!key) return false;
  addToNestedMap(map, serviceId, key, amount);
  return true;
}

function distributeByProfile(map, serviceId, amount, profile, paymentDays, fallbackDate) {
  const total = number(amount);
  if (total <= 0) return;
  if (!profile || profile.size === 0) {
    const shifted = addDays(fallbackDate, paymentDays) ?? parseDate(fallbackDate);
    if (shifted) addToNestedMap(map, serviceId, monthKey(shifted), total);
    return;
  }
  for (const [executionDate, weight] of profile.entries()) {
    const shifted = addDays(executionDate, paymentDays);
    if (!shifted) continue;
    addToNestedMap(map, serviceId, monthKey(shifted), total * number(weight));
  }
}

export function buildServiceScheduleProfiles(activities, asOfDate, workOnSaturday = false) {
  const rawProfiles = new Map();
  const activityRowsByService = new Map();
  const asOf = parseDate(asOfDate);

  for (const activity of activities ?? []) {
    const serviceId = activity.serviceId ?? activity.service_id;
    if (!serviceId) continue;
    const progress = clampProgress(activity.progressPercent ?? activity.progress_percent);
    const completed = progress >= 100 || Boolean(activity.actualFinish ?? activity.actual_finish);
    if (completed) continue;
    const remaining = Math.max(0, 1 - progress / 100);
    if (remaining <= 0) continue;

    const startValue = activity.currentStart ?? activity.current_start ?? activity.actualStart ?? activity.actual_start ?? activity.plannedStart ?? activity.planned_start;
    const finishValue = activity.currentFinish ?? activity.current_finish ?? activity.plannedFinish ?? activity.planned_finish ?? startValue;
    const start = parseDate(startValue);
    if (!start) continue;
    const effectiveStart = asOf && asOf > start ? asOf : start;
    const finish = parseDate(finishValue);
    const effectiveFinish = finish && finish > effectiveStart ? finish : effectiveStart;
    const assignedCost = Math.max(0, number(activity.assignedCost ?? activity.assigned_cost));
    const row = {
      serviceId,
      start: dateKey(effectiveStart),
      finish: dateKey(effectiveFinish),
      remaining,
      assignedCost,
    };
    const rows = activityRowsByService.get(serviceId) ?? [];
    rows.push(row);
    activityRowsByService.set(serviceId, rows);
  }

  for (const [serviceId, rows] of activityRowsByService.entries()) {
    const costWeightTotal = rows.reduce((sum, row) => sum + row.assignedCost * row.remaining, 0);
    const fallbackWeightTotal = rows.reduce((sum, row) => sum + row.remaining, 0);
    const profile = new Map();

    for (const row of rows) {
      const activityWeight = costWeightTotal > 0
        ? row.assignedCost * row.remaining / costWeightTotal
        : row.remaining / Math.max(fallbackWeightTotal, 1);
      const workdays = enumerateWorkdays(row.start, row.finish, workOnSaturday);
      const dayWeight = activityWeight / Math.max(1, workdays.length);
      for (const day of workdays) addToMap(profile, day, dayWeight);
    }

    const profileTotal = sumMap(profile);
    if (profileTotal > 0) {
      for (const [day, weight] of profile.entries()) profile.set(day, weight / profileTotal);
    }
    rawProfiles.set(serviceId, profile);
  }

  return rawProfiles;
}

function normalizeServices(services) {
  const map = new Map();
  for (const service of services ?? []) {
    const id = service.id ?? service.serviceId ?? service.service_id;
    if (!id) continue;
    map.set(id, {
      id,
      code: service.code ?? "",
      name: service.name ?? service.description ?? "Serviço",
      budgetAmount: Math.max(0, number(service.budgetAmount ?? service.budget_amount)),
    });
  }
  return map;
}

function ensureService(services, serviceId) {
  const id = serviceId || UNALLOCATED_SERVICE_ID;
  if (!services.has(id)) {
    services.set(id, {
      id,
      code: id === UNALLOCATED_SERVICE_ID ? "SEM-SERVIÇO" : "",
      name: id === UNALLOCATED_SERVICE_ID ? "Sem serviço vinculado" : "Serviço não encontrado",
      budgetAmount: 0,
    });
  }
  return id;
}

function aggregateDatedSources(sources, services, targetMap, dateField) {
  for (const source of sources ?? []) {
    const serviceId = ensureService(services, source.serviceId ?? source.service_id ?? null);
    const date = source[dateField] ?? source.date;
    distributeFixed(targetMap, serviceId, source.amount, date);
  }
}

export function buildUnifiedForecast(input) {
  const asOfDate = String(input?.asOfDate ?? input?.as_of_date ?? "").slice(0, 10);
  const defaultPaymentDays = Math.max(0, Math.min(365, Math.trunc(number(input?.defaultPaymentDays ?? input?.default_payment_days ?? 30))));
  const workOnSaturday = Boolean(input?.workOnSaturday ?? input?.work_on_saturday);
  const services = normalizeServices(input?.services ?? []);
  const profiles = buildServiceScheduleProfiles(input?.activities ?? [], asOfDate, workOnSaturday);

  const actualByServiceMonth = new Map();
  const payableByServiceMonth = new Map();
  const futureCommittedByServiceMonth = new Map();
  const toCommitByServiceMonth = new Map();

  aggregateDatedSources(input?.actualPayments ?? input?.actual_payments, services, actualByServiceMonth, "paidAt");
  aggregateDatedSources(input?.openPayables ?? input?.open_payables, services, payableByServiceMonth, "dueDate");

  for (const commitment of input?.commitments ?? []) {
    const serviceId = ensureService(services, commitment.serviceId ?? commitment.service_id ?? null);
    const amount = Math.max(0, number(commitment.amount));
    if (amount <= 0) continue;
    if (commitment.dueDate ?? commitment.due_date) {
      distributeFixed(futureCommittedByServiceMonth, serviceId, amount, commitment.dueDate ?? commitment.due_date);
      continue;
    }
    const configuredPaymentDays = commitment.paymentDays ?? commitment.payment_days;
    const paymentDays = configuredPaymentDays == null
      ? defaultPaymentDays
      : Math.max(0, Math.min(365, Math.trunc(number(configuredPaymentDays))));
    const fallbackDate = commitment.fallbackDate ?? commitment.fallback_date ?? asOfDate;
    distributeByProfile(
      futureCommittedByServiceMonth,
      serviceId,
      amount,
      profiles.get(serviceId),
      paymentDays,
      fallbackDate,
    );
  }

  const serviceRows = [];
  const allMonthKeys = new Set();
  const warnings = [];

  for (const service of services.values()) {
    const actualMonths = actualByServiceMonth.get(service.id) ?? new Map();
    const payableMonths = payableByServiceMonth.get(service.id) ?? new Map();
    const futureMonths = futureCommittedByServiceMonth.get(service.id) ?? new Map();
    const actual = sumMap(actualMonths);
    const committedPayable = sumMap(payableMonths);
    const committedFuture = sumMap(futureMonths);
    const committed = committedPayable + committedFuture;
    const toCommit = Math.max(0, service.budgetAmount - actual - committed);
    const projectedCost = actual + committed + toCommit;
    const deviation = projectedCost - service.budgetAmount;
    const deviationPercent = service.budgetAmount > 0 ? deviation / service.budgetAmount * 100 : deviation > 0 ? 100 : 0;

    if (toCommit > 0) {
      const profile = profiles.get(service.id);
      distributeByProfile(toCommitByServiceMonth, service.id, toCommit, profile, defaultPaymentDays, asOfDate);
      if (!profile || profile.size === 0) {
        warnings.push({
          code: "service_without_future_schedule",
          serviceId: service.id,
          message: `${service.code ? `${service.code} · ` : ""}${service.name} não possui cronograma futuro; o saldo foi concentrado na data de corte.`,
        });
      }
    }

    for (const map of [actualMonths, payableMonths, futureMonths, toCommitByServiceMonth.get(service.id)]) {
      for (const key of map?.keys?.() ?? []) allMonthKeys.add(key);
    }

    serviceRows.push({
      ...service,
      actual,
      committedPayable,
      committedFuture,
      committed,
      toCommit,
      projectedCost,
      deviation,
      deviationPercent,
      monthly: [],
    });
  }

  const sortedMonthKeys = [...allMonthKeys].filter(Boolean).sort();
  let cumulativeActual = 0;
  let cumulativeCommitted = 0;
  let cumulativeToCommit = 0;
  let cumulativeProjected = 0;
  let cumulativeEngineeringProjected = 0;

  const months = sortedMonthKeys.map((key) => {
    let actual = 0;
    let committedPayable = 0;
    let committedFuture = 0;
    let toCommit = 0;
    for (const service of services.values()) {
      actual += number(actualByServiceMonth.get(service.id)?.get(key));
      committedPayable += number(payableByServiceMonth.get(service.id)?.get(key));
      committedFuture += number(futureCommittedByServiceMonth.get(service.id)?.get(key));
      toCommit += number(toCommitByServiceMonth.get(service.id)?.get(key));
    }
    const committed = committedPayable + committedFuture;
    const projected = actual + committed + toCommit;
    const engineeringProjected = committedFuture + toCommit;
    cumulativeActual += actual;
    cumulativeCommitted += committed;
    cumulativeToCommit += toCommit;
    cumulativeProjected += projected;
    cumulativeEngineeringProjected += engineeringProjected;
    return {
      key,
      actual,
      committedPayable,
      committedFuture,
      committed,
      toCommit,
      projected,
      engineeringProjected,
      cumulativeActual,
      cumulativeCommitted,
      cumulativeToCommit,
      cumulativeProjected,
      cumulativeEngineeringProjected,
    };
  });

  for (const serviceRow of serviceRows) {
    serviceRow.monthly = sortedMonthKeys.map((key) => {
      const actual = number(actualByServiceMonth.get(serviceRow.id)?.get(key));
      const committedPayable = number(payableByServiceMonth.get(serviceRow.id)?.get(key));
      const committedFuture = number(futureCommittedByServiceMonth.get(serviceRow.id)?.get(key));
      const toCommit = number(toCommitByServiceMonth.get(serviceRow.id)?.get(key));
      return {
        key,
        actual,
        committedPayable,
        committedFuture,
        committed: committedPayable + committedFuture,
        toCommit,
        projected: actual + committedPayable + committedFuture + toCommit,
        engineeringProjected: committedFuture + toCommit,
      };
    });
  }

  serviceRows.sort((a, b) => {
    if (a.id === UNALLOCATED_SERVICE_ID) return 1;
    if (b.id === UNALLOCATED_SERVICE_ID) return -1;
    return `${a.code} ${a.name}`.localeCompare(`${b.code} ${b.name}`, "pt-BR");
  });

  const totals = serviceRows.reduce((total, service) => {
    total.budget += service.budgetAmount;
    total.actual += service.actual;
    total.committedPayable += service.committedPayable;
    total.committedFuture += service.committedFuture;
    total.committed += service.committed;
    total.toCommit += service.toCommit;
    total.projectedCost += service.projectedCost;
    total.deviation += service.deviation;
    return total;
  }, {
    budget: 0,
    actual: 0,
    committedPayable: 0,
    committedFuture: 0,
    committed: 0,
    toCommit: 0,
    projectedCost: 0,
    deviation: 0,
    deviationPercent: 0,
    engineeringProjected: 0,
  });
  totals.deviationPercent = totals.budget > 0 ? totals.deviation / totals.budget * 100 : totals.deviation > 0 ? 100 : 0;
  totals.engineeringProjected = totals.committedFuture + totals.toCommit;

  const unallocated = serviceRows.find((service) => service.id === UNALLOCATED_SERVICE_ID);
  if (unallocated && (unallocated.actual > 0 || unallocated.committedPayable > 0 || unallocated.committedFuture > 0)) {
    warnings.push({
      code: "unallocated_financial_sources",
      serviceId: UNALLOCATED_SERVICE_ID,
      message: "Existem pagamentos ou compromissos da obra sem serviço vinculado. Eles aparecem separadamente e não reduzem o saldo dos serviços orçados.",
    });
  }

  return {
    asOfDate,
    defaultPaymentDays,
    services: serviceRows,
    months,
    totals,
    warnings,
    profiles,
    boundaries: {
      openPayablesIncludedInCommitted: true,
      openPayablesExcludedFromEngineeringProjected: true,
      engineeringProjectedFormula: "committedFuture + toCommit",
    },
  };
}
