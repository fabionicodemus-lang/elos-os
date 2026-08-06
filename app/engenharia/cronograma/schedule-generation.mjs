// Elos OS — Cronograma: geração de atividades ancorada no valor do orçamento.
//
// Regra de negócio (fundação): todo serviço do orçamento vira atividade(s) no
// cronograma e a soma dos valores das partes de um serviço é SEMPRE igual ao
// valor daquele serviço no orçamento. Quando o serviço é dividido por
// pavimento/local, o valor é rateado proporcionalmente à quantidade levantada
// em cada local. Os cálculos monetários rodam em centavos inteiros para
// garantir conservação exata (planned_cost é numeric(18,2)).

const GENERAL_LOCATION_KEY = "__general__";

function toCents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function sanitizeCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Distribui um total (em centavos inteiros) entre partes, proporcionalmente às
 * quantidades, usando o método do maior resto para que a soma feche exatamente.
 * Se todas as quantidades forem zero, divide igualmente. A sobra é sempre
 * atribuída de forma determinística (maiores restos primeiro; empate pela ordem).
 */
export function distributeByQuantity(totalCents, quantities) {
  const total = Math.round(Number(totalCents) || 0);
  const count = quantities.length;
  if (count === 0) return [];
  if (count === 1) return [total];

  const positive = quantities.map((quantity) => Math.max(0, Number(quantity) || 0));
  const quantitySum = positive.reduce((sum, quantity) => sum + quantity, 0);
  const weights = quantitySum > 0 ? positive : positive.map(() => 1);
  const weightSum = quantitySum > 0 ? quantitySum : count;

  const exact = weights.map((weight) => (total * weight) / weightSum);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = floors.slice();
  for (let position = 0; position < order.length && remainder > 0; position += 1) {
    result[order[position].index] += 1;
    remainder -= 1;
  }
  // Se por algum motivo sobrou resto negativo (total negativo), devolve à última parte.
  if (remainder !== 0) result[count - 1] += remainder;
  return result;
}

/**
 * Monta as atividades do cronograma a partir do orçamento e do levantamento.
 * Retorna atividades (com custo já conservado), a cadeia de predecessoras FS por
 * serviço e um resumo de conservação por serviço para validação/exibição.
 */
export function planScheduleFromBudget({ services = [], budgetItems = [], takeoffCells = [], locations = [] }) {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));

  // Valor do orçamento por serviço (em centavos), somando itens ativos.
  const serviceBudgetCents = new Map();
  budgetItems.forEach((item) => {
    if (item.status && item.status !== "active") return;
    if (!item.service_id) return;
    serviceBudgetCents.set(item.service_id, (serviceBudgetCents.get(item.service_id) ?? 0) + toCents(item.total_direct_cost));
  });

  // Células do levantamento agrupadas por serviço → local.
  const cellsByService = new Map();
  takeoffCells.forEach((cell) => {
    if (!cell.service_id) return;
    const group = cellsByService.get(cell.service_id) ?? [];
    group.push(cell);
    cellsByService.set(cell.service_id, group);
  });

  // Serviços a considerar: todos do orçamento + os que têm levantamento.
  const serviceIds = new Set([...serviceBudgetCents.keys(), ...cellsByService.keys()]);

  const orderedServiceIds = [...serviceIds].sort((a, b) => {
    const codeA = serviceMap.get(a)?.code ?? "";
    const codeB = serviceMap.get(b)?.code ?? "";
    return codeA.localeCompare(codeB, "pt-BR") || String(a).localeCompare(String(b));
  });

  const activities = [];
  const dependencies = [];
  const conservation = [];
  const codeOccurrences = new Map();

  orderedServiceIds.forEach((serviceId) => {
    const service = serviceMap.get(serviceId);
    const budgetCents = serviceBudgetCents.get(serviceId) ?? 0;

    // Partes do serviço: uma por local levantado. Sem levantamento → parte geral.
    const rawCells = cellsByService.get(serviceId) ?? [];
    const byLocation = new Map();
    rawCells.forEach((cell) => {
      const key = cell.location_id ?? GENERAL_LOCATION_KEY;
      const current = byLocation.get(key) ?? { locationId: cell.location_id ?? null, quantity: 0, unit: cell.unit_snapshot };
      current.quantity += Math.max(0, Number(cell.total_quantity) || 0);
      if (!current.unit && cell.unit_snapshot) current.unit = cell.unit_snapshot;
      byLocation.set(key, current);
    });

    let parts = [...byLocation.values()];
    if (parts.length === 0) {
      parts = [{ locationId: null, quantity: 0, unit: service?.unit ?? "un" }];
    }

    parts.sort((a, b) => {
      const orderA = a.locationId ? Number(locationMap.get(a.locationId)?.sort_order ?? 0) : -1;
      const orderB = b.locationId ? Number(locationMap.get(b.locationId)?.sort_order ?? 0) : -1;
      if (orderA !== orderB) return orderA - orderB;
      const codeA = a.locationId ? locationMap.get(a.locationId)?.code ?? "" : "";
      const codeB = b.locationId ? locationMap.get(b.locationId)?.code ?? "" : "";
      return codeA.localeCompare(codeB, "pt-BR");
    });

    const centsPerPart = distributeByQuantity(budgetCents, parts.map((part) => part.quantity));

    let previousCode = null;
    let scheduledCents = 0;
    parts.forEach((part, index) => {
      const location = part.locationId ? locationMap.get(part.locationId) : null;
      const baseCode = sanitizeCode(`${service?.code ?? "SRV"}-${location?.code ?? "GERAL"}`).slice(0, 54) || "SRV";
      const occurrence = (codeOccurrences.get(baseCode) ?? 0) + 1;
      codeOccurrences.set(baseCode, occurrence);
      const code = occurrence === 1 ? baseCode : `${baseCode}-${occurrence}`;
      const plannedCost = centsPerPart[index] / 100;
      scheduledCents += centsPerPart[index];

      activities.push({
        serviceId,
        locationId: part.locationId ?? null,
        code,
        name: `${service?.description ?? "Serviço"}${location ? ` · ${location.name}` : ""}`,
        unit: part.unit || service?.unit || "un",
        quantity: part.quantity,
        plannedCost,
      });

      if (previousCode) dependencies.push({ predecessorCode: previousCode, successorCode: code });
      previousCode = code;
    });

    conservation.push({
      serviceId,
      serviceCode: service?.code ?? null,
      budgetValue: budgetCents / 100,
      scheduledValue: scheduledCents / 100,
      delta: (scheduledCents - budgetCents) / 100,
      partCount: parts.length,
    });
  });

  const budgetTotalCents = [...serviceBudgetCents.values()].reduce((sum, value) => sum + value, 0);
  const scheduledTotalCents = conservation.reduce((sum, entry) => sum + toCents(entry.scheduledValue), 0);

  return {
    activities,
    dependencies,
    conservation,
    totals: {
      budgetValue: budgetTotalCents / 100,
      scheduledValue: scheduledTotalCents / 100,
      serviceCount: orderedServiceIds.length,
    },
  };
}
