import { performance } from "node:perf_hooks";
import { buildUnifiedForecast } from "../../lib/forecast/engine.mjs";

const TARGET_COMPANY_ID = "company-primary";
const FOREIGN_COMPANY_IDS = ["company-secondary", "company-tertiary"];
const AS_OF_DATE = "2026-01-15";
const MONTH_WINDOW = 240;
const MEASUREMENTS_PER_ACTIVITY = 10;

function monthDate(index, day = 1) {
  const date = new Date(Date.UTC(2026, index, Math.min(day, 28), 12));
  return date.toISOString().slice(0, 10);
}

function heapUsed() {
  return process.memoryUsage().heapUsed;
}

function forceGc() {
  if (typeof global.gc === "function") global.gc();
}

function latestProgressByActivity(measurements) {
  const latest = new Map();
  for (const measurement of measurements) {
    const previous = latest.get(measurement.activity_id);
    const currentKey = `${measurement.measurement_date}:${measurement.created_at}:${measurement.id}`;
    const previousKey = previous
      ? `${previous.measurement_date}:${previous.created_at}:${previous.id}`
      : "";
    if (!previous || currentKey > previousKey) latest.set(measurement.activity_id, measurement);
  }
  return latest;
}

function generateScenario(mode) {
  const full = mode !== "half";
  const serviceCount = full ? 100 : 50;
  const activityCount = full ? 10_000 : 5_000;
  const payableCount = full ? 50_000 : 25_000;
  const extremeDates = mode === "extreme";

  const services = Array.from({ length: serviceCount }, (_, index) => ({
    id: `${TARGET_COMPANY_ID}:service:${index}`,
    companyId: TARGET_COMPANY_ID,
    code: String(index + 1).padStart(3, "0"),
    name: `Serviço sintético ${index + 1}`,
    budgetAmount: 100_000,
  }));

  const activities = Array.from({ length: activityCount }, (_, index) => {
    const monthIndex = index % (MONTH_WINDOW - 2);
    let plannedStart = monthDate(monthIndex, 1);
    let plannedFinish = monthDate(monthIndex, 28);

    if (extremeDates && index === 0) plannedFinish = "9999-12-31";
    if (extremeDates && index === 1) plannedStart = "1990-01-01";
    if (extremeDates && index === 2) plannedStart = "2026-02-30";

    return {
      id: `${TARGET_COMPANY_ID}:activity:${index}`,
      companyId: TARGET_COMPANY_ID,
      serviceId: services[index % serviceCount].id,
      plannedStart,
      plannedFinish,
      currentStart: plannedStart,
      currentFinish: plannedFinish,
      progressPercent: 0,
      assignedCost: 1_000,
    };
  });

  const progressMeasurements = Array.from(
    { length: activityCount * MEASUREMENTS_PER_ACTIVITY },
    (_, index) => {
      const activityIndex = Math.floor(index / MEASUREMENTS_PER_ACTIVITY);
      const sequence = index % MEASUREMENTS_PER_ACTIVITY;
      const date = monthDate(sequence, sequence + 1);
      return {
        id: `${TARGET_COMPANY_ID}:measurement:${index}`,
        companyId: TARGET_COMPANY_ID,
        activity_id: `${TARGET_COMPANY_ID}:activity:${activityIndex}`,
        measurement_date: date,
        created_at: `${date}T${String(sequence).padStart(2, "0")}:00:00.000Z`,
        progress_percent: sequence * 5,
      };
    },
  );

  const openPayables = Array.from({ length: payableCount }, (_, index) => ({
    id: `${TARGET_COMPANY_ID}:payable:${index}`,
    companyId: TARGET_COMPANY_ID,
    serviceId: services[index % serviceCount].id,
    amount: 1,
    dueDate: monthDate(index % MONTH_WINDOW, 20),
  }));

  const commitments = services.map((service, index) => ({
    id: `${TARGET_COMPANY_ID}:commitment:${index}`,
    companyId: TARGET_COMPANY_ID,
    kind: "contract",
    serviceId: service.id,
    amount: 10_000,
    paymentDays: 30,
  }));

  for (const companyId of FOREIGN_COMPANY_IDS) {
    const serviceId = `${companyId}:service:sentinel`;
    services.push({
      id: serviceId,
      companyId,
      code: "FOREIGN",
      name: "Registro sentinela de outra empresa",
      budgetAmount: 777_777,
    });
    activities.push({
      id: `${companyId}:activity:sentinel`,
      companyId,
      serviceId,
      plannedStart: "2026-01-01",
      plannedFinish: "2026-01-31",
      currentStart: "2026-01-01",
      currentFinish: "2026-01-31",
      progressPercent: 0,
      assignedCost: 777_777,
    });
    progressMeasurements.push({
      id: `${companyId}:measurement:sentinel`,
      companyId,
      activity_id: `${companyId}:activity:sentinel`,
      measurement_date: "2026-01-31",
      created_at: "2026-01-31T23:59:59.000Z",
      progress_percent: 99,
    });
    openPayables.push({
      id: `${companyId}:payable:sentinel`,
      companyId,
      serviceId,
      amount: 123_456,
      dueDate: "2026-01-31",
    });
    commitments.push({
      id: `${companyId}:commitment:sentinel`,
      companyId,
      kind: "contract",
      serviceId,
      amount: 654_321,
      paymentDays: 30,
    });
  }

  return {
    expected: {
      activities: activityCount,
      measurements: activityCount * MEASUREMENTS_PER_ACTIVITY,
      payables: payableCount,
      services: serviceCount,
      budget: serviceCount * 100_000,
      sourceCompanies: 1 + FOREIGN_COMPANY_IDS.length,
    },
    services,
    activities,
    progressMeasurements,
    openPayables,
    commitments,
  };
}

function selectCompany(rows, companyId) {
  return rows.filter((row) => row.companyId === companyId);
}

function run(mode) {
  forceGc();
  const heapBefore = heapUsed();
  const startedAt = performance.now();

  const generationStartedAt = performance.now();
  const source = generateScenario(mode);
  const generationMs = performance.now() - generationStartedAt;
  const heapAfterGeneration = heapUsed();

  const selectionStartedAt = performance.now();
  const services = selectCompany(source.services, TARGET_COMPANY_ID);
  const activities = selectCompany(source.activities, TARGET_COMPANY_ID);
  const measurements = selectCompany(source.progressMeasurements, TARGET_COMPANY_ID);
  const openPayables = selectCompany(source.openPayables, TARGET_COMPANY_ID);
  const commitments = selectCompany(source.commitments, TARGET_COMPANY_ID);
  const selectionMs = performance.now() - selectionStartedAt;

  const progressStartedAt = performance.now();
  const latestProgress = latestProgressByActivity(measurements);
  const activitiesWithProgress = activities.map((activity) => ({
    ...activity,
    progressPercent: latestProgress.get(activity.id)?.progress_percent ?? activity.progressPercent,
  }));
  const progressReductionMs = performance.now() - progressStartedAt;
  const heapAfterPreparation = heapUsed();

  const forecastStartedAt = performance.now();
  const result = buildUnifiedForecast({
    asOfDate: AS_OF_DATE,
    defaultPaymentDays: 30,
    workOnSaturday: false,
    services,
    activities: activitiesWithProgress,
    actualPayments: [],
    openPayables,
    commitments,
  });
  const forecastMs = performance.now() - forecastStartedAt;
  const heapAfterForecast = heapUsed();

  const serializationStartedAt = performance.now();
  const serialized = JSON.stringify({
    services: result.services,
    months: result.months,
    totals: result.totals,
    warnings: result.warnings,
    boundaries: result.boundaries,
  });
  const serializationMs = performance.now() - serializationStartedAt;
  const heapAfterSerialization = heapUsed();

  const companyIds = new Set([
    ...source.services.map((row) => row.companyId),
    ...source.activities.map((row) => row.companyId),
    ...source.openPayables.map((row) => row.companyId),
  ]);
  const foreignRowsInSelection = [services, activities, measurements, openPayables, commitments]
    .flat()
    .filter((row) => row.companyId !== TARGET_COMPANY_ID)
    .length;
  const foreignServicesInResult = result.services
    .filter((service) => !String(service.id).startsWith(`${TARGET_COMPANY_ID}:`))
    .length;
  const cells = result.services.reduce((sum, service) => sum + service.monthly.length, 0);
  const nonZeroCells = result.services.reduce(
    (sum, service) => sum + service.monthly.filter((month) => (
      Math.abs(month.actual)
      + Math.abs(month.committedPayable)
      + Math.abs(month.committedFuture)
      + Math.abs(month.toCommit)
    ) > 1e-9).length,
    0,
  );
  const peakHeap = Math.max(
    heapAfterGeneration,
    heapAfterPreparation,
    heapAfterForecast,
    heapAfterSerialization,
  );

  return {
    mode,
    counts: {
      activities: activities.length,
      progressMeasurements: measurements.length,
      latestProgressMeasurements: latestProgress.size,
      payables: openPayables.length,
      services: services.length,
      sourceCompanies: companyIds.size,
    },
    expected: source.expected,
    output: {
      months: result.months.length,
      cells,
      nonZeroCells,
      payloadBytes: Buffer.byteLength(serialized),
      budget: result.totals.budget,
      projectedCost: result.totals.projectedCost,
      warnings: result.warnings.map((warning) => warning.code),
    },
    isolation: {
      selectedCompanyId: TARGET_COMPANY_ID,
      foreignRowsInSelection,
      foreignServicesInResult,
    },
    timingMs: {
      generation: generationMs,
      selection: selectionMs,
      progressReduction: progressReductionMs,
      forecast: forecastMs,
      serialization: serializationMs,
      total: performance.now() - startedAt,
    },
    memory: {
      heapBeforeBytes: heapBefore,
      peakHeapBytes: peakHeap,
      peakGrowthBytes: Math.max(0, peakHeap - heapBefore),
    },
  };
}

const mode = process.argv[2] ?? "full";
process.stdout.write(`${JSON.stringify(run(mode))}\n`);
