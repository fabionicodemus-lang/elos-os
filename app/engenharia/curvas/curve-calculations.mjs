const DAY_MS = 86_400_000;

function parseDate(value) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
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

function isWorkday(date, workOnSaturday) {
  const day = date.getUTCDay();
  return day !== 0 && (workOnSaturday || day !== 6);
}

function countWorkdays(start, finish, workOnSaturday) {
  if (finish < start) return 0;
  let total = 0;
  for (let current = new Date(start); current <= finish; current = new Date(current.getTime() + DAY_MS)) {
    if (isWorkday(current, workOnSaturday)) total += 1;
  }
  return total;
}

function serviceDisplay(serviceId, services) {
  const service = services.get(serviceId);
  if (!service) return `Serviço ${serviceId}`;
  return service.code ? `${service.code} · ${service.description}` : service.description;
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
  if (!activities.length) {
    return { rows: [], usesEqualPhysicalWeights: false, zeroWorkdayActivityIds: [] };
  }

  const earliest = activities.reduce((current, activity) => {
    const value = parseDate(activity.planned_start);
    return value < current ? value : current;
  }, parseDate(activities[0].planned_start));
  const latest = activities.reduce((current, activity) => {
    const start = parseDate(activity.planned_start);
    const finish = parseDate(activity.planned_finish);
    const value = finish > start ? finish : start;
    return value > current ? value : current;
  }, parseDate(activities[0].planned_start));

  const periods = [];
  for (let current = monthStart(earliest); current <= monthStart(latest); current = addMonths(current, 1)) {
    periods.push(current);
  }

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
      usesEqualPhysicalWeights ? 100 / activities.length : cost / assignedTotal * 100,
    );
  });

  const zeroWorkdayActivityIds = new Set();
  let physicalAccumulated = 0;
  let financialAccumulated = 0;

  const rows = periods.map((period) => {
    const periodFinish = monthEnd(period);
    let physicalMonth = 0;
    let financialMonth = 0;

    activities.forEach((activity) => {
      const start = parseDate(activity.planned_start);
      const finish = parseDate(activity.planned_finish);
      const totalWorkdays = countWorkdays(start, finish, workOnSaturday);
      let fraction = 0;

      if (totalWorkdays === 0) {
        zeroWorkdayActivityIds.add(activity.id);
        fraction = monthKey(start) === monthKey(period) ? 1 : 0;
      } else {
        const overlapStart = start > period ? start : period;
        const overlapFinish = finish < periodFinish ? finish : periodFinish;
        const overlapWorkdays = countWorkdays(overlapStart, overlapFinish, workOnSaturday);
        fraction = overlapWorkdays / totalWorkdays;
      }

      if (fraction <= 0) return;
      physicalMonth += (physicalWeights.get(activity.id) ?? 0) * fraction;
      financialMonth += Math.max(0, Number(assignedCosts.get(activity.id) ?? 0)) * fraction;
    });

    physicalAccumulated = Math.min(100, physicalAccumulated + physicalMonth);
    financialAccumulated += financialMonth;

    return {
      key: monthKey(period),
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
