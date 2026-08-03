const DAY_MS = 86_400_000;
const MAX_FORECAST_MONTHS = 240;
export const UNALLOCATED_SERVICE_ID = "__unallocated__";

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const clean = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const date = new Date(`${clean}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean) return null;
  return date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? date.toISOString().slice(0, 7) : "";
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

function addDays(value, days) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  return new Date(date.getTime() + number(days) * DAY_MS);
}

function maxDate(first, second) {
  return first > second ? first : second;
}

function minDate(first, second) {
  return first < second ? first : second;
}

function forecastHorizon(asOfDate) {
  const anchor = parseDate(asOfDate) ?? new Date();
  const anchorMonth = monthStart(anchor);
  return {
    min: addMonths(anchorMonth, -MAX_FORECAST_MONTHS),
    max: monthEnd(addMonths(anchorMonth, MAX_FORECAST_MONTHS)),
  };
}

function boundDate(value, horizon) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return { date: null, clamped: false };
  if (date < horizon.min) return { date: horizon.min, clamped: true };
  if (date > horizon.max) return { date: horizon.max, clamped: true };
  return { date, clamped: false };
}

function countWorkdays(startValue, finishValue, workOnSaturday) {
  const start = startValue instanceof Date ? startValue : parseDate(startValue);
  const finish = finishValue instanceof Date ? finishValue : parseDate(finishValue);
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

function encodeProfileRow(row) {
  return `${row.start}|${row.finish}|${row.workOnSaturday ? 1 : 0}|${row.id}`;
}

function decodeProfileRow(value) {
  const [start, finish, workOnSaturday] = String(value).split("|");
  return { start, finish, workOnSaturday: workOnSaturday === "1" };
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

function distributeFixed(map, serviceId, amount, dueDate, horizon) {
  const bounded = boundDate(dueDate, horizon);
  const key = bounded.date ? monthKey(bounded.date) : "";
  if (!key) return { distributed: false, clamped: false };
  addToNestedMap(map, serviceId, key, amount);
  return { distributed: true, clamped: bounded.clamped };
}

function distributeByProfile(map, serviceId, amount, profile, paymentDays, fallbackDate, horizon) {
  const total = number(amount);
  if (total <= 0) return false;
  if (!profile || profile.size === 0) {
    const shifted = addDays(fallbackDate, paymentDays) ?? parseDate(fallbackDate);
    const bounded = boundDate(shifted, horizon);
    if (bounded.date) addToNestedMap(map, serviceId, monthKey(bounded.date), total);
    return bounded.clamped;
  }

  const monthWeights = new Map();
  let clamped = false;

  for (const [encodedRow, rawActivityWeight] of profile.entries()) {
    const row = decodeProfileRow(encodedRow);
    const activityWeight = Math.max(0, number(rawActivityWeight));
    const rawStart = parseDate(row.start);
    const rawFinish = parseDate(row.finish);
    if (!rawStart || !rawFinish || activityWeight <= 0) continue;

    const startResult = boundDate(rawStart, horizon);
    const finishResult = boundDate(rawFinish, horizon);
    const start = startResult.date;
    const finish = finishResult.date && start ? maxDate(finishResult.date, start) : start;
    clamped ||= startResult.clamped || finishResult.clamped;
    if (!start || !finish) continue;

    const totalWorkdays = countWorkdays(start, finish, row.workOnSaturday);
    if (totalWorkdays <= 0) {
      const shifted = boundDate(addDays(start, paymentDays), horizon);
      if (shifted.date) addToMap(monthWeights, monthKey(shifted.date), activityWeight);
      clamped ||= shifted.clamped;
      continue;
    }

    const shiftedStart = boundDate(addDays(start, paymentDays), horizon);
    const shiftedFinish = boundDate(addDays(finish, paymentDays), horizon);
    clamped ||= shiftedStart.clamped || shiftedFinish.clamped;
    if (!shiftedStart.date || !shiftedFinish.date) continue;

    for (
      let paymentMonth = monthStart(shiftedStart.date), index = 0;
      paymentMonth <= monthStart(shiftedFinish.date) && index <= MAX_FORECAST_MONTHS * 2 + 1;
      paymentMonth = addMonths(paymentMonth, 1), index += 1
    ) {
      const executionWindowStart = addDays(monthStart(paymentMonth), -paymentDays);
      const executionWindowFinish = addDays(monthEnd(paymentMonth), -paymentDays);
      if (!executionWindowStart || !executionWindowFinish) continue;
      const overlapStart = maxDate(start, executionWindowStart);
      const overlapFinish = minDate(finish, executionWindowFinish);
      const workdays = countWorkdays(overlapStart, overlapFinish, row.workOnSaturday);
      if (workdays <= 0) continue;
      addToMap(monthWeights, monthKey(paymentMonth), activityWeight * workdays / totalWorkdays);
    }
  }

  const weightTotal = sumMap(monthWeights);
  if (weightTotal <= 0) {
    const shifted = boundDate(addDays(fallbackDate, paymentDays) ?? parseDate(fallbackDate), horizon);
    if (shifted.date) addToNestedMap(map, serviceId, monthKey(shifted.date), total);
    return clamped || shifted.clamped;
  }

  let allocated = 0;
  const entries = [...monthWeights.entries()];
  entries.forEach(([key, weight], index) => {
    const value = index === entries.length - 1 ? total - allocated : total * weight / weightTotal;
    allocated += value;
    addToNestedMap(map, serviceId, key, value);
  });
  return clamped;
}

export function buildServiceScheduleProfiles(activities, asOfDate, workOnSaturday = false) {
  const rawProfiles = new Map();
  const activityRowsByService = new Map();
  const asOf = parseDate(asOfDate);
  const horizon = forecastHorizon(asOfDate);

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
    const parsedStart = parseDate(startValue);
    if (!parsedStart) continue;
    const effectiveStart = asOf && asOf > parsedStart ? asOf : parsedStart;
    const parsedFinish = parseDate(finishValue);
    const effectiveFinish = parsedFinish && parsedFinish > effectiveStart ? parsedFinish : effectiveStart;
    const start = boundDate(effectiveStart, horizon).date;
    const finishBound = boundDate(effectiveFinish, horizon).date;
    const finish = start && finishBound ? maxDate(start, finishBound) : start;
    if (!start || !finish) continue;

    const assignedCost = Math.max(0, number(activity.assignedCost ?? activity.assigned_cost));
    const row = {
      id: String(activity.id ?? `${serviceId}:${activityRowsByService.get(serviceId)?.length ?? 0}`),
      serviceId,
      start: dateKey(start),
      finish: dateKey(finish),
      remaining,
      assignedCost,
      workOnSaturday,
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
      profile.set(encodeProfileRow(row), activityWeight);
    }

    const profileTotal = sumMap(profile);
    if (profileTotal > 0) {
      for (const [key, weight] of profile.entries()) profile.set(key, weight / profileTotal);
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

function aggregateDatedSources(sources, services, targetMap, dateField, horizon) {
  let clamped = false;
  for (const source of sources ?? []) {
    const serviceId = ensureService(services, source.serviceId ?? source.service_id ?? null);
    const date = source[dateField] ?? source.date;
    const result = distributeFixed(targetMap, serviceId, source.amount, date, horizon);
    clamped ||= result.clamped;
  }
  return clamped;
}

function scheduleExceedsHorizon(activities, asOfDate, horizon) {
  const asOf = parseDate(asOfDate);
  for (const activity of activities ?? []) {
    const start = parseDate(activity.currentStart ?? activity.current_start ?? activity.actualStart ?? activity.actual_start ?? activity.plannedStart ?? activity.planned_start);
    const finish = parseDate(activity.currentFinish ?? activity.current_finish ?? activity.plannedFinish ?? activity.planned_finish);
    const effectiveStart = start && asOf && start < asOf ? asOf : start;
    if ((effectiveStart && (effectiveStart < horizon.min || effectiveStart > horizon.max)) || (finish && (finish < horizon.min || finish > horizon.max))) return true;
  }
  return false;
}

export function buildUnifiedForecast(input) {
  const asOfDate = String(input?.asOfDate ?? input?.as_of_date ?? "").slice(0, 10);
  const defaultPaymentDays = Math.max(0, Math.min(365, Math.trunc(number(input?.defaultPaymentDays ?? input?.default_payment_days ?? 30))));
  const workOnSaturday = Boolean(input?.workOnSaturday ?? input?.work_on_saturday);
  const services = normalizeServices(input?.services ?? []);
  const horizon = forecastHorizon(asOfDate);
  const profiles = buildServiceScheduleProfiles(input?.activities ?? [], asOfDate, workOnSaturday);
  const warnings = [];

  const actualByServiceMonth = new Map();
  const payableByServiceMonth = new Map();
  const futureCommittedByServiceMonth = new Map();
  const toCommitByServiceMonth = new Map();

  let clampedFinancialDate = aggregateDatedSources(input?.actualPayments ?? input?.actual_payments, services, actualByServiceMonth, "paidAt", horizon);
  clampedFinancialDate ||= aggregateDatedSources(input?.openPayables ?? input?.open_payables, services, payableByServiceMonth, "dueDate", horizon);

  for (const commitment of input?.commitments ?? []) {
    const serviceId = ensureService(services, commitment.serviceId ?? commitment.service_id ?? null);
    const amount = Math.max(0, number(commitment.amount));
    if (amount <= 0) continue;
    if (commitment.dueDate ?? commitment.due_date) {
      const result = distributeFixed(futureCommittedByServiceMonth, serviceId, amount, commitment.dueDate ?? commitment.due_date, horizon);
      clampedFinancialDate ||= result.clamped;
      continue;
    }
    const configuredPaymentDays = commitment.paymentDays ?? commitment.payment_days;
    const paymentDays = configuredPaymentDays == null
      ? defaultPaymentDays
      : Math.max(0, Math.min(365, Math.trunc(number(configuredPaymentDays))));
    const fallbackDate = commitment.fallbackDate ?? commitment.fallback_date ?? asOfDate;
    clampedFinancialDate ||= distributeByProfile(
      futureCommittedByServiceMonth,
      serviceId,
      amount,
      profiles.get(serviceId),
      paymentDays,
      fallbackDate,
      horizon,
    );
  }

  if (scheduleExceedsHorizon(input?.activities ?? [], asOfDate, horizon)) {
    warnings.push({
      code: "schedule_horizon_clamped",
      serviceId: "__schedule__",
      message: `Há datas de cronograma fora do horizonte de ${MAX_FORECAST_MONTHS} meses; elas foram limitadas para manter a previsão calculável.`,
    });
  }
  if (clampedFinancialDate) {
    warnings.push({
      code: "financial_date_horizon_clamped",
      serviceId: UNALLOCATED_SERVICE_ID,
      message: `Há datas financeiras fora do horizonte de ${MAX_FORECAST_MONTHS} meses; elas foram concentradas no limite do período.`,
    });
  }

  const serviceRows = [];
  const allMonthKeys = new Set();

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
      distributeByProfile(toCommitByServiceMonth, service.id, toCommit, profile, defaultPaymentDays, asOfDate, horizon);
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
