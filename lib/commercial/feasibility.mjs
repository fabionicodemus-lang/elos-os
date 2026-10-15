function n(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function add(flow, month, key, value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return;
  while (flow.length <= month) {
    flow.push({ month: flow.length, sales: 0, receipts: 0, land: 0, projects: 0, construction: 0, commission: 0, taxes: 0, marketing: 0, centralOffice: 0, financial: 0, contingency: 0, net: 0, cumulative: 0 });
  }
  flow[month][key] += value;
}

function distribute(flow, startMonth, months, key, total) {
  const count = Math.max(1, Math.trunc(months));
  for (let index = 0; index < count; index += 1) add(flow, startMonth + index, key, total / count);
}

function constructionWeights(months) {
  const count = Math.max(1, Math.trunc(months));
  const raw = Array.from({ length: count }, (_, index) => 0.25 + Math.sin(Math.PI * (index + 1) / (count + 1)));
  const sum = raw.reduce((acc, value) => acc + value, 0) || 1;
  return raw.map((value) => value / sum);
}

function npv(rate, flows) {
  return flows.reduce((total, value, index) => total + value / ((1 + rate) ** index), 0);
}

function bisectIrrInLogSpace(flows, lowX, highX, lowValue, highValue, tolerance) {
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  let low = lowX;
  let high = highX;
  let lowNpv = lowValue;
  for (let index = 0; index < 120; index += 1) {
    const mid = (low + high) / 2;
    const rate = Math.exp(mid) - 1;
    const value = npv(rate, flows);
    if (!Number.isFinite(value)) {
      low = mid;
      continue;
    }
    if (Math.abs(value) <= tolerance) return rate;
    if (lowNpv * value <= 0) high = mid;
    else {
      low = mid;
      lowNpv = value;
    }
  }
  return Math.exp((low + high) / 2) - 1;
}

export function monthlyIrr(flows) {
  if (!Array.isArray(flows) || !flows.some((value) => value < 0) || !flows.some((value) => value > 0)) return null;

  const scale = Math.max(1, flows.reduce((sum, value) => sum + Math.abs(value), 0));
  const tolerance = scale * 1e-10;
  const minLog = Math.log(0.0001); // -99,99% a.m.
  const maxLog = Math.log(11); // +1000% a.m., mesmo teto usado anteriormente
  const steps = 4096;
  const roots = [];

  const addRoot = (rate) => {
    if (!Number.isFinite(rate) || rate <= -1) return;
    const duplicate = roots.some((existing) => Math.abs(existing - rate) <= 1e-7 * Math.max(1, Math.abs(rate)));
    if (!duplicate) roots.push(rate);
  };

  let previousX = minLog;
  let previousRate = Math.exp(previousX) - 1;
  let previousValue = npv(previousRate, flows);
  if (Number.isFinite(previousValue) && Math.abs(previousValue) <= tolerance) addRoot(previousRate);

  for (let index = 1; index <= steps; index += 1) {
    const x = minLog + (maxLog - minLog) * index / steps;
    const rate = Math.exp(x) - 1;
    const value = npv(rate, flows);

    if (Number.isFinite(value)) {
      if (Math.abs(value) <= tolerance) addRoot(rate);
      if (Number.isFinite(previousValue) && previousValue * value < 0) {
        addRoot(bisectIrrInLogSpace(flows, previousX, x, previousValue, value, tolerance));
      }
    }

    previousX = x;
    previousValue = value;
  }

  if (!roots.length) return null;
  roots.sort((a, b) => a - b);
  const nonNegative = roots.find((rate) => rate >= 0);
  if (nonNegative != null) return nonNegative;
  return roots.reduce((closest, rate) => Math.abs(rate) < Math.abs(closest) ? rate : closest, roots[0]);
}

function managedConstructionAreas(options) {
  const rows = options?.constructionAreas ?? options?.construction_areas ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "Área"),
    sourceKey: item.source_key == null ? null : String(item.source_key),
    areaM2: Math.max(0, n(item.area_m2 ?? item.areaM2)),
    costM2: Math.max(0, n(item.cost_m2 ?? item.costM2)),
    sortOrder: Math.trunc(n(item.sort_order ?? item.sortOrder)),
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function managedSalesVelocities(options) {
  const rows = options?.salesVelocities ?? options?.sales_velocities ?? [];
  if (!Array.isArray(rows)) return [];
  const mapped = rows.map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "Velocidade"),
    phaseKey: item.phase_key == null ? null : String(item.phase_key),
    startOffsetMonths: Math.trunc(n(item.start_offset_months ?? item.startOffsetMonths)),
    unitsPerMonth: Math.max(0.01, n(item.units_per_month ?? item.unitsPerMonth, 0.01)),
    targetPct: item.target_units_pct == null ? null : clamp(n(item.target_units_pct), 0, 100),
    appreciationPct: clamp(n(item.price_appreciation_pct), -90, 500),
    entryPct: item.entry_pct == null ? null : clamp(n(item.entry_pct), 0, 100),
    monthlyPct: item.monthly_pct == null ? null : clamp(n(item.monthly_pct), 0, 100),
    keysPct: item.keys_pct == null ? null : clamp(n(item.keys_pct), 0, 100),
    monthlyInstallments: item.monthly_installments == null ? null : Math.max(1, Math.trunc(n(item.monthly_installments, 1))),
    sortOrder: Math.trunc(n(item.sort_order ?? item.sortOrder)),
  }));
  const fixed = mapped.filter((item) => item.phaseKey);
  const selected = fixed.length ? fixed : mapped;
  return selected.sort((a, b) => a.startOffsetMonths - b.startOffsetMonths || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function buildLegacySalesPlan({ availableUnits, constructionStart, study, phases }) {
  const selected = phases.length ? phases : [{
    id: "legacy",
    name: "Velocidade padrão",
    phaseKey: null,
    startOffsetMonths: Math.trunc(n(study.sales_start_offset_months, -3)),
    unitsPerMonth: Math.max(0.01, n(study.sales_velocity_units_month, 2)),
    sortOrder: 0,
  }];

  const firstMonth = Math.max(0, constructionStart + selected[0].startOffsetMonths);
  const plan = [];
  let unitsLeft = availableUnits;
  let month = firstMonth;
  let guard = 0;

  while (unitsLeft > 1e-9 && guard < 2400) {
    const offset = month - constructionStart;
    let active = null;
    for (const phase of selected) {
      if (phase.startOffsetMonths <= offset) active = phase;
      else break;
    }

    if (active) {
      const soldUnits = Math.min(active.unitsPerMonth, unitsLeft);
      if (soldUnits > 0) {
        plan.push({ month, soldUnits, phaseId: active.id, phaseName: active.name, phaseKey: null, unitsPerMonth: active.unitsPerMonth, priceFactor: 1 });
        unitsLeft -= soldUnits;
      }
    }

    month += 1;
    guard += 1;
  }

  return plan;
}

function buildFixedSalesPlan({ availableUnits, constructionStart, phases }) {
  const ordered = [...phases].sort((a, b) => a.sortOrder - b.sortOrder || a.startOffsetMonths - b.startOffsetMonths);
  const rawTargetTotal = ordered.reduce((sum, item) => sum + Math.max(0, n(item.targetPct)), 0);
  const denominator = rawTargetTotal > 0 ? rawTargetTotal : ordered.length;
  let cumulativePriceFactor = 1;
  const enriched = ordered.map((item) => {
    cumulativePriceFactor *= 1 + clamp(n(item.appreciationPct), -90, 500) / 100;
    return { ...item, priceFactor: cumulativePriceFactor };
  });

  const plan = [];
  let unitsLeft = availableUnits;
  let carry = 0;
  let guard = 0;

  for (let index = 0; index < enriched.length && unitsLeft > 1e-9; index += 1) {
    const phase = enriched[index];
    const next = enriched[index + 1];
    const weight = rawTargetTotal > 0 ? Math.max(0, n(phase.targetPct)) / denominator : 1 / denominator;
    const baseTarget = index === enriched.length - 1 ? unitsLeft : availableUnits * weight;
    let demand = Math.min(unitsLeft, baseTarget + carry);
    const startMonth = Math.max(0, constructionStart + phase.startOffsetMonths);
    const nextStart = next ? Math.max(startMonth, constructionStart + next.startOffsetMonths) : Number.POSITIVE_INFINITY;
    let month = startMonth;

    while (demand > 1e-9 && unitsLeft > 1e-9 && month < nextStart && guard < 2400) {
      const soldUnits = Math.min(phase.unitsPerMonth, demand, unitsLeft);
      if (soldUnits > 0) {
        plan.push({
          month,
          soldUnits,
          phaseId: phase.id,
          phaseName: phase.name,
          phaseKey: phase.phaseKey,
          unitsPerMonth: phase.unitsPerMonth,
          priceFactor: phase.priceFactor,
          entryPct: phase.entryPct,
          monthlyPct: phase.monthlyPct,
          keysPct: phase.keysPct,
          monthlyInstallments: phase.monthlyInstallments,
        });
        demand -= soldUnits;
        unitsLeft -= soldUnits;
      }
      month += 1;
      guard += 1;
    }
    carry = demand;
  }

  if (unitsLeft > 1e-9 && enriched.length) {
    const phase = enriched.at(-1);
    let month = Math.max(0, constructionStart + phase.startOffsetMonths, (plan.at(-1)?.month ?? -1) + 1);
    while (unitsLeft > 1e-9 && guard < 2400) {
      const soldUnits = Math.min(phase.unitsPerMonth, unitsLeft);
      plan.push({
        month,
        soldUnits,
        phaseId: phase.id,
        phaseName: phase.name,
        phaseKey: phase.phaseKey,
        unitsPerMonth: phase.unitsPerMonth,
        priceFactor: phase.priceFactor,
        entryPct: phase.entryPct,
        monthlyPct: phase.monthlyPct,
        keysPct: phase.keysPct,
        monthlyInstallments: phase.monthlyInstallments,
      });
      unitsLeft -= soldUnits;
      month += 1;
      guard += 1;
    }
  }

  return plan;
}

function buildSalesPlan({ availableUnits, constructionStart, study, salesVelocities }) {
  if (availableUnits <= 0) return [];
  const fixed = salesVelocities.filter((item) => item.phaseKey);
  return fixed.length
    ? buildFixedSalesPlan({ availableUnits, constructionStart, phases: fixed })
    : buildLegacySalesPlan({ availableUnits, constructionStart, study, phases: salesVelocities });
}

function normalizePhasePayment(sale, study) {
  let entryPct = clamp(n(sale.entryPct, study.entry_pct ?? 10), 0, 100);
  let monthlyPct = clamp(n(sale.monthlyPct, 100 - entryPct - n(study.keys_pct, 20)), 0, 100);
  let keysPct = clamp(n(sale.keysPct, study.keys_pct ?? 20), 0, 100);
  const total = entryPct + monthlyPct + keysPct;
  if (total <= 0) return { entryPct:100, monthlyPct:0, keysPct:0, monthlyInstallments:1 };
  if (Math.abs(total - 100) > 1e-9) {
    const factor = 100 / total;
    entryPct *= factor;
    monthlyPct *= factor;
    keysPct *= factor;
  }
  return {
    entryPct,
    monthlyPct,
    keysPct,
    monthlyInstallments: Math.max(1, Math.trunc(n(sale.monthlyInstallments, study.post_keys_months ?? 24))),
  };
}

export function calculateFeasibility(study, unitTypes = [], options = {}) {
  const units = (unitTypes ?? []).map((item) => ({
    name: String(item.name ?? "Tipologia"),
    quantity: Math.max(0, Math.trunc(n(item.quantity))),
    privateAreaM2: Math.max(0, n(item.private_area_m2 ?? item.privateAreaM2)),
    salePriceM2: Math.max(0, n(item.sale_price_m2 ?? item.salePriceM2)),
    barterUnits: Math.max(0, Math.trunc(n(item.barter_units ?? item.barterUnits))),
  })).map((item) => ({ ...item, barterUnits: Math.min(item.quantity, item.barterUnits) }));

  const totalUnits = units.reduce((sum, item) => sum + item.quantity, 0);
  const barterUnits = units.reduce((sum, item) => sum + item.barterUnits, 0);
  const availableUnits = totalUnits - barterUnits;
  const apartmentAreaM2 = units.reduce((sum, item) => sum + item.quantity * item.privateAreaM2, 0);
  const barterAreaM2 = units.reduce((sum, item) => sum + item.barterUnits * item.privateAreaM2, 0);
  const baseGrossVgv = units.reduce((sum, item) => sum + item.quantity * item.privateAreaM2 * item.salePriceM2, 0);
  const barterVgv = units.reduce((sum, item) => sum + item.barterUnits * item.privateAreaM2 * item.salePriceM2, 0);
  const baseAvailableVgv = Math.max(0, baseGrossVgv - barterVgv);

  const constructionAreas = managedConstructionAreas(options);
  const hasManagedConstructionAreas = constructionAreas.length > 0;
  const garageArea = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "garage_stairs").reduce((sum, item) => sum + item.areaM2, 0)
    : Math.max(0, n(study.garage_stairs_area_m2));
  const lobbyArea = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "lobby").reduce((sum, item) => sum + item.areaM2, 0)
    : Math.max(0, n(study.lobby_area_m2));
  const decoratedArea = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "decorated_common").reduce((sum, item) => sum + item.areaM2, 0)
    : Math.max(0, n(study.decorated_common_area_m2));
  const managedAdditionalArea = constructionAreas.reduce((sum, item) => sum + item.areaM2, 0);
  const legacyAdditionalArea = garageArea + lobbyArea + decoratedArea;
  const additionalAreaM2 = hasManagedConstructionAreas ? managedAdditionalArea : legacyAdditionalArea;
  const builtAreaM2 = apartmentAreaM2 + additionalAreaM2;

  const apartmentConstructionCost = apartmentAreaM2 * Math.max(0, n(study.apartment_cost_m2));
  const garageConstructionCost = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "garage_stairs").reduce((sum, item) => sum + item.areaM2 * item.costM2, 0)
    : garageArea * Math.max(0, n(study.garage_stairs_cost_m2));
  const lobbyConstructionCost = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "lobby").reduce((sum, item) => sum + item.areaM2 * item.costM2, 0)
    : lobbyArea * Math.max(0, n(study.lobby_cost_m2));
  const decoratedConstructionCost = hasManagedConstructionAreas
    ? constructionAreas.filter((item) => item.sourceKey === "decorated_common").reduce((sum, item) => sum + item.areaM2 * item.costM2, 0)
    : decoratedArea * Math.max(0, n(study.decorated_common_cost_m2));
  const managedAdditionalConstructionCost = constructionAreas.reduce((sum, item) => sum + item.areaM2 * item.costM2, 0);
  const legacyAdditionalConstructionCost = garageConstructionCost + lobbyConstructionCost + decoratedConstructionCost;
  const additionalConstructionCost = hasManagedConstructionAreas ? managedAdditionalConstructionCost : legacyAdditionalConstructionCost;
  const constructionCost = apartmentConstructionCost + additionalConstructionCost;
  const designCost = builtAreaM2 * Math.max(0, n(study.design_cost_m2));
  const landCost = [study.land_cash_amount, study.iptu_amount, study.onerous_grant_amount, study.other_land_amount].reduce((sum, value) => sum + Math.max(0, n(value)), 0);
  const commissionRate = clamp(n(study.commission_pct), 0, 100) / 100;
  const taxRate = clamp(n(study.tax_rate_pct), 0, 100) / 100;
  const contingencyRate = clamp(n(study.contingency_pct), 0, 100) / 100;
  const contingencyCost = constructionCost * contingencyRate;
  const marketingCost = Math.max(0, n(study.marketing_amount));
  const centralOfficeCost = Math.max(0, n(study.central_office_amount));
  const financialCost = Math.max(0, n(study.financial_cost_amount));

  const preconstructionMonths = Math.max(0, Math.trunc(n(study.preconstruction_months, 6)));
  const constructionMonths = Math.max(1, Math.trunc(n(study.construction_duration_months, 36)));
  const constructionStart = preconstructionMonths;
  const deliveryMonth = constructionStart + constructionMonths - 1;
  const salesVelocities = managedSalesVelocities(options);
  const salesPlan = buildSalesPlan({ availableUnits, constructionStart, study, salesVelocities });
  const legacySalesStart = Math.max(0, constructionStart + Math.trunc(n(study.sales_start_offset_months, -3)));
  const salesStart = salesPlan[0]?.month ?? legacySalesStart;
  const salesEnd = salesPlan.at(-1)?.month ?? salesStart;
  const salesMonths = availableUnits > 0 ? Math.max(1, salesEnd - salesStart + 1) : 1;
  const postKeysMonths = Math.max(1, Math.trunc(n(study.post_keys_months, 24)));
  const avgBaseUnitValue = availableUnits > 0 ? baseAvailableVgv / availableUnits : 0;
  const projectedAvailableVgv = salesPlan.length
    ? salesPlan.reduce((sum, sale) => sum + sale.soldUnits * avgBaseUnitValue * n(sale.priceFactor, 1), 0)
    : baseAvailableVgv;
  const availableVgv = Math.max(0, projectedAvailableVgv);
  const grossVgv = barterVgv + availableVgv;
  const commissionCost = availableVgv * commissionRate;
  const taxCost = availableVgv * taxRate;
  const totalCost = landCost + designCost + constructionCost + commissionCost + taxCost + marketingCost + centralOfficeCost + financialCost + contingencyCost;
  const profit = availableVgv - totalCost;
  const marginPct = availableVgv > 0 ? profit / availableVgv * 100 : 0;

  let entryPct = clamp(n(study.entry_pct, 10), 0, 100);
  let duringPct = clamp(n(study.during_construction_pct, 40), 0, 100);
  let keysPct = clamp(n(study.keys_pct, 20), 0, 100);
  let postPct = clamp(n(study.post_keys_pct, 30), 0, 100);
  const paymentTotal = entryPct + duringPct + keysPct + postPct;
  if (paymentTotal <= 0) {
    entryPct = 100; duringPct = 0; keysPct = 0; postPct = 0;
  } else if (Math.abs(paymentTotal - 100) > 1e-9) {
    const factor = 100 / paymentTotal;
    entryPct *= factor; duringPct *= factor; keysPct *= factor; postPct *= factor;
  }

  const flow = [];
  add(flow, 0, "land", landCost);
  if (designCost > 0) distribute(flow, 0, Math.max(1, preconstructionMonths || Math.min(6, constructionMonths)), "projects", designCost);
  const weights = constructionWeights(constructionMonths);
  weights.forEach((weight, index) => {
    add(flow, constructionStart + index, "construction", constructionCost * weight);
    add(flow, constructionStart + index, "contingency", contingencyCost * weight);
  });
  if (centralOfficeCost > 0) distribute(flow, 0, preconstructionMonths + constructionMonths, "centralOffice", centralOfficeCost);
  if (financialCost > 0) distribute(flow, constructionStart, constructionMonths, "financial", financialCost);
  if (marketingCost > 0) distribute(flow, Math.max(0, salesStart - 2), salesMonths + 2, "marketing", marketingCost);

  for (const sale of salesPlan) {
    const saleValue = sale.soldUnits * avgBaseUnitValue * n(sale.priceFactor, 1);
    const saleMonth = sale.month;
    add(flow, saleMonth, "sales", saleValue);
    add(flow, saleMonth, "commission", saleValue * commissionRate);

    if (sale.phaseKey) {
      const phasePayment = normalizePhasePayment(sale, study);
      add(flow, saleMonth, "receipts", saleValue * phasePayment.entryPct / 100);
      if (phasePayment.monthlyPct > 0) distribute(flow, saleMonth + 1, phasePayment.monthlyInstallments, "receipts", saleValue * phasePayment.monthlyPct / 100);
      add(flow, Math.max(deliveryMonth, saleMonth), "receipts", saleValue * phasePayment.keysPct / 100);
      continue;
    }

    add(flow, saleMonth, "receipts", saleValue * entryPct / 100);
    const duringValue = saleValue * duringPct / 100;
    if (duringValue > 0) {
      if (saleMonth < deliveryMonth) {
        const monthsAvailable = Math.max(1, deliveryMonth - saleMonth);
        distribute(flow, saleMonth + 1, monthsAvailable, "receipts", duringValue);
      } else add(flow, saleMonth, "receipts", duringValue);
    }
    const keysMonth = Math.max(deliveryMonth, saleMonth);
    add(flow, keysMonth, "receipts", saleValue * keysPct / 100);
    if (postPct > 0) distribute(flow, keysMonth + 1, postKeysMonths, "receipts", saleValue * postPct / 100);
  }

  for (let index = 0; index < flow.length; index += 1) {
    const row = flow[index];
    row.taxes = row.receipts * taxRate;
    const outflows = row.land + row.projects + row.construction + row.commission + row.taxes + row.marketing + row.centralOffice + row.financial + row.contingency;
    row.net = row.receipts - outflows;
    row.cumulative = row.net + (index > 0 ? flow[index - 1].cumulative : 0);
  }

  const netFlows = flow.map((row) => row.net);
  const monthlyRate = monthlyIrr(netFlows);
  const irrAnnualPct = monthlyRate === null ? null : (((1 + monthlyRate) ** 12) - 1) * 100;
  const minimumCash = flow.reduce((min, row) => Math.min(min, row.cumulative), 0);
  const exposureMax = Math.abs(Math.min(0, minimumCash));
  const exposureMonth = flow.findIndex((row) => Math.abs(row.cumulative - minimumCash) < 0.01);
  const paybackMonth = flow.findIndex((row, index) => index > exposureMonth && row.cumulative >= 0);
  const discountAnnual = Math.max(-99, n(study.discount_rate_annual_pct, 15)) / 100;
  const discountMonthly = ((1 + discountAnnual) ** (1 / 12)) - 1;
  const netPresentValue = npv(discountMonthly, netFlows);

  return {
    total_units: totalUnits,
    barter_units: barterUnits,
    available_units: availableUnits,
    apartment_area_m2: apartmentAreaM2,
    barter_area_m2: barterAreaM2,
    additional_area_m2: additionalAreaM2,
    built_area_m2: builtAreaM2,
    gross_vgv: grossVgv,
    barter_vgv: barterVgv,
    available_vgv: availableVgv,
    base_available_vgv: baseAvailableVgv,
    sales_price_multiplier_avg: baseAvailableVgv > 0 ? availableVgv / baseAvailableVgv : 1,
    land_cost: landCost,
    design_cost: designCost,
    construction_cost: constructionCost,
    apartment_construction_cost: apartmentConstructionCost,
    additional_construction_cost: additionalConstructionCost,
    garage_construction_cost: garageConstructionCost,
    lobby_construction_cost: lobbyConstructionCost,
    decorated_construction_cost: decoratedConstructionCost,
    commission_cost: commissionCost,
    tax_cost: taxCost,
    marketing_cost: marketingCost,
    central_office_cost: centralOfficeCost,
    financial_cost: financialCost,
    contingency_cost: contingencyCost,
    total_cost: totalCost,
    profit,
    margin_pct: marginPct,
    exposure_max: exposureMax,
    exposure_month: exposureMonth,
    irr_monthly_pct: monthlyRate === null ? null : monthlyRate * 100,
    irr_annual_pct: irrAnnualPct,
    npv: netPresentValue,
    payback_month: paybackMonth >= 0 ? paybackMonth : null,
    delivery_month: deliveryMonth,
    sales_start_month: salesStart,
    sales_end_month: salesEnd,
    sales_months: salesMonths,
    sales_velocity_phases: salesVelocities.length || 1,
    cashflow: flow,
  };
}
