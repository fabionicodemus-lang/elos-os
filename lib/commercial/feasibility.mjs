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

export function monthlyIrr(flows) {
  if (!Array.isArray(flows) || !flows.some((value) => value < 0) || !flows.some((value) => value > 0)) return null;
  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low, flows);
  let highValue = npv(high, flows);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let index = 0; index < 180; index += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid, flows);
    if (Math.abs(value) < 1e-7) return mid;
    if (lowValue * value <= 0) {
      high = mid;
      highValue = value;
    } else {
      low = mid;
      lowValue = value;
    }
  }
  return (low + high) / 2;
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
  return rows.map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "Velocidade"),
    startOffsetMonths: Math.trunc(n(item.start_offset_months ?? item.startOffsetMonths)),
    unitsPerMonth: Math.max(0.01, n(item.units_per_month ?? item.unitsPerMonth, 0.01)),
    sortOrder: Math.trunc(n(item.sort_order ?? item.sortOrder)),
  })).sort((a, b) => a.startOffsetMonths - b.startOffsetMonths || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function buildSalesPlan({ availableUnits, constructionStart, study, salesVelocities }) {
  if (availableUnits <= 0) return [];

  const phases = salesVelocities.length ? salesVelocities : [{
    id: "legacy",
    name: "Velocidade padrão",
    startOffsetMonths: Math.trunc(n(study.sales_start_offset_months, -3)),
    unitsPerMonth: Math.max(0.01, n(study.sales_velocity_units_month, 2)),
    sortOrder: 0,
  }];

  const firstMonth = Math.max(0, constructionStart + phases[0].startOffsetMonths);
  const plan = [];
  let unitsLeft = availableUnits;
  let month = firstMonth;
  let guard = 0;

  while (unitsLeft > 1e-9 && guard < 2400) {
    const offset = month - constructionStart;
    let active = null;
    for (const phase of phases) {
      if (phase.startOffsetMonths <= offset) active = phase;
      else break;
    }

    if (active) {
      const soldUnits = Math.min(active.unitsPerMonth, unitsLeft);
      if (soldUnits > 0) {
        plan.push({ month, soldUnits, phaseId: active.id, phaseName: active.name, unitsPerMonth: active.unitsPerMonth });
        unitsLeft -= soldUnits;
      }
    }

    month += 1;
    guard += 1;
  }

  return plan;
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
  const grossVgv = units.reduce((sum, item) => sum + item.quantity * item.privateAreaM2 * item.salePriceM2, 0);
  const barterVgv = units.reduce((sum, item) => sum + item.barterUnits * item.privateAreaM2 * item.salePriceM2, 0);
  const availableVgv = Math.max(0, grossVgv - barterVgv);

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
  const commissionCost = availableVgv * commissionRate;
  const taxCost = availableVgv * taxRate;
  const contingencyCost = constructionCost * contingencyRate;
  const marketingCost = Math.max(0, n(study.marketing_amount));
  const centralOfficeCost = Math.max(0, n(study.central_office_amount));
  const financialCost = Math.max(0, n(study.financial_cost_amount));
  const totalCost = landCost + designCost + constructionCost + commissionCost + taxCost + marketingCost + centralOfficeCost + financialCost + contingencyCost;
  const profit = availableVgv - totalCost;
  const marginPct = availableVgv > 0 ? profit / availableVgv * 100 : 0;

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

  const avgUnitValue = availableUnits > 0 ? availableVgv / availableUnits : 0;
  for (const sale of salesPlan) {
    const saleValue = sale.soldUnits * avgUnitValue;
    const saleMonth = sale.month;
    add(flow, saleMonth, "sales", saleValue);
    add(flow, saleMonth, "commission", saleValue * commissionRate);
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
    const postStart = keysMonth + 1;
    if (postPct > 0) distribute(flow, postStart, postKeysMonths, "receipts", saleValue * postPct / 100);
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