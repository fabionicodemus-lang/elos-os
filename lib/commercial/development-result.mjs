function n(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sum(rows, selector) {
  return (rows ?? []).reduce((total, row) => total + Math.max(0, n(selector(row))), 0);
}

function pct(part, total) {
  return total > 0 ? part / total * 100 : 0;
}

function activeSales(sales) {
  return (sales ?? []).filter((sale) => sale?.status === "active");
}

function paidReceivables(receivables) {
  return (receivables ?? []).filter((item) => item?.status === "paid");
}

function openReceivables(receivables) {
  return (receivables ?? []).filter((item) => item?.status === "open");
}

function paidPayables(payables) {
  return (payables ?? []).filter((item) => item?.status === "paid");
}

function openPayables(payables) {
  return (payables ?? []).filter((item) => item?.status === "open");
}

function activeSaleCommission(sale, fallbackRate) {
  const amount = Math.max(0, n(sale?.commission_amount));
  if (amount > 0) return amount;
  const rate = Math.max(0, n(sale?.commission_pct, fallbackRate));
  return Math.max(0, n(sale?.total_amount)) * rate / 100;
}

function forecastTotals(forecast) {
  const services = Array.isArray(forecast?.services) ? forecast.services : [];
  const classified = services.filter((service) => service?.id !== "__unallocated__");
  const unallocated = services.filter((service) => service?.id === "__unallocated__");
  return {
    budget: sum(classified, (row) => row.budgetAmount),
    actual: sum(classified, (row) => row.actual),
    committed: sum(classified, (row) => row.committed),
    toCommit: sum(classified, (row) => row.toCommit),
    projected: sum(classified, (row) => row.projectedCost),
    unallocatedActual: sum(unallocated, (row) => row.actual),
    unallocatedCommitted: sum(unallocated, (row) => row.committed),
    unallocatedProjected: sum(unallocated, (row) => row.projectedCost),
  };
}

function buildInventoryProjection(units, baselineUnits, soldUnits, baselineAverageTicket) {
  const availableRows = (units ?? []).filter((unit) => unit?.status === "available");
  const baselineRemaining = baselineUnits > 0 ? Math.max(0, baselineUnits - soldUnits) : availableRows.length;
  const pricedRows = availableRows.filter((unit) => Math.max(0, n(unit?.list_price)) > 0);
  const currentAverage = pricedRows.length > 0
    ? sum(pricedRows, (unit) => unit.list_price) / pricedRows.length
    : baselineAverageTicket;

  if (baselineUnits <= 0) {
    const inventoryVgv = availableRows.reduce((total, unit) => {
      const listPrice = Math.max(0, n(unit?.list_price));
      return total + (listPrice > 0 ? listPrice : baselineAverageTicket);
    }, 0);
    return {
      availableUnits: availableRows.length,
      inventoryVgv,
      estimatedUnits: availableRows.filter((unit) => Math.max(0, n(unit?.list_price)) <= 0).length,
      extraUnits: 0,
      missingUnits: 0,
    };
  }

  const extraUnits = Math.max(0, availableRows.length - baselineRemaining);
  if (extraUnits > 0) {
    return {
      availableUnits: baselineRemaining,
      inventoryVgv: baselineRemaining * currentAverage,
      estimatedUnits: pricedRows.length > 0 ? 0 : baselineRemaining,
      extraUnits,
      missingUnits: 0,
    };
  }

  let inventoryVgv = 0;
  let estimatedUnits = 0;
  for (const unit of availableRows) {
    const listPrice = Math.max(0, n(unit?.list_price));
    if (listPrice > 0) inventoryVgv += listPrice;
    else {
      inventoryVgv += baselineAverageTicket;
      estimatedUnits += 1;
    }
  }

  const missingUnits = Math.max(0, baselineRemaining - availableRows.length);
  if (missingUnits > 0) {
    inventoryVgv += missingUnits * baselineAverageTicket;
    estimatedUnits += missingUnits;
  }

  return {
    availableUnits: baselineRemaining,
    inventoryVgv,
    estimatedUnits,
    extraUnits: 0,
    missingUnits,
  };
}

export function calculateDevelopmentResult({
  baselineMetrics = {},
  baselineStudy = {},
  project = {},
  sales = [],
  units = [],
  receivables = [],
  payables = [],
  forecast = null,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const baselineVgv = Math.max(0, n(baselineMetrics.available_vgv));
  const baselineUnits = Math.max(0, Math.trunc(n(baselineMetrics.available_units, project?.total_units)));
  const baselineProfit = n(baselineMetrics.profit);
  const baselineMargin = n(baselineMetrics.margin_pct);
  const baselineTotalCost = Math.max(0, n(baselineMetrics.total_cost));
  const baselineConstruction = Math.max(0, n(baselineMetrics.construction_cost));
  const baselineContingency = Math.max(0, n(baselineMetrics.contingency_cost));
  const baselineCommission = Math.max(0, n(baselineMetrics.commission_cost));
  const baselineTaxes = Math.max(0, n(baselineMetrics.tax_cost));
  const baselineOtherCost = Math.max(0, baselineTotalCost - baselineConstruction - baselineContingency - baselineCommission - baselineTaxes);

  const commissionRate = Math.max(0, n(
    baselineStudy.commission_pct,
    baselineVgv > 0 ? baselineCommission / baselineVgv * 100 : 0,
  ));
  const taxRate = Math.max(0, n(
    baselineStudy.tax_rate_pct,
    baselineVgv > 0 ? baselineTaxes / baselineVgv * 100 : 0,
  ));

  const salesRows = activeSales(sales);
  const soldVgv = sum(salesRows, (sale) => sale.total_amount);
  const soldUnitIds = new Set(salesRows.map((sale) => sale.unit_id).filter(Boolean));
  const soldUnits = soldUnitIds.size || salesRows.length;
  const baselineAverageTicket = baselineUnits > 0 ? baselineVgv / baselineUnits : 0;
  const inventory = buildInventoryProjection(units, baselineUnits, soldUnits, baselineAverageTicket);
  const availableUnits = inventory.availableUnits;
  const inventoryVgv = inventory.inventoryVgv;

  const projectedVgv = soldVgv + inventoryVgv;
  const vgvDeviation = projectedVgv - baselineVgv;
  const salesProgressPct = baselineUnits > 0 ? Math.min(100, pct(soldUnits, baselineUnits)) : pct(soldUnits, soldUnits + availableUnits);
  const averageSoldTicket = soldUnits > 0 ? soldVgv / soldUnits : 0;

  const received = sum(paidReceivables(receivables), (item) => item.paid_amount ?? item.adjusted_amount ?? item.amount);
  const receivableOpen = sum(openReceivables(receivables), (item) => item.adjusted_amount ?? item.amount);
  const overdueRows = openReceivables(receivables).filter((item) => String(item?.due_date ?? "") < today);
  const overdue = sum(overdueRows, (item) => item.adjusted_amount ?? item.amount);
  const overdueCount = overdueRows.length;

  const paidOut = sum(paidPayables(payables), (item) => item.paid_amount ?? item.amount);
  const payableOpen = sum(openPayables(payables), (item) => item.amount);
  const cashBalance = received - paidOut;

  const forecastCost = forecastTotals(forecast);
  const hasEngineeringForecast = forecastCost.projected > 0 || forecastCost.budget > 0;
  const projectedEngineeringCost = hasEngineeringForecast
    ? forecastCost.projected
    : baselineConstruction + baselineContingency;

  const projectedCommission = sum(salesRows, (sale) => activeSaleCommission(sale, commissionRate))
    + inventoryVgv * commissionRate / 100;
  const projectedTaxes = projectedVgv * taxRate / 100;

  // Payables sem serviço podem ser terreno, projetos, marketing, administrativo ou custos de obra ainda não classificados.
  // Para não duplicar tudo que já existia no baseline, eles substituem o bloco de "demais custos" somente quando o superam.
  const projectedOtherCost = Math.max(baselineOtherCost, forecastCost.unallocatedProjected);
  const unallocatedExcess = Math.max(0, forecastCost.unallocatedProjected - baselineOtherCost);
  const projectedTotalCost = projectedOtherCost
    + projectedEngineeringCost
    + projectedCommission
    + projectedTaxes;
  const projectedProfit = projectedVgv - projectedTotalCost;
  const projectedMargin = pct(projectedProfit, projectedVgv);
  const profitDeviation = projectedProfit - baselineProfit;
  const marginDeviation = projectedMargin - baselineMargin;

  const warnings = [];
  if (!baselineVgv || !baselineTotalCost) warnings.push("Baseline econômico da viabilidade ausente ou incompleto.");
  if (inventory.estimatedUnits > 0) warnings.push(`${inventory.estimatedUnits} unidade(s) do estoque sem preço atual/cadastro completo; o valor faltante foi estimado pelo ticket médio do baseline.`);
  if (inventory.extraUnits > 0) warnings.push(`Há ${inventory.extraUnits} unidade(s) disponível(is) além do estoque comercializável do baseline. O VGV foi limitado à quantidade prevista para evitar contar permutas ou unidades extras duas vezes.`);
  if (baselineUnits > 0 && soldUnits > baselineUnits) warnings.push("Há mais unidades vendidas do que o estoque comercializável do baseline; revise permutas e cadastro de unidades.");
  if (!hasEngineeringForecast) warnings.push("Sem previsão financeira atual da obra; o resultado mantém o custo de construção do baseline.");
  if (forecastCost.unallocatedProjected > 0) {
    warnings.push(unallocatedExcess > 0
      ? `Há ${Math.round(unallocatedExcess)} em custos sem serviço/centro acima do bloco de demais custos do baseline; o excesso foi incorporado ao resultado.`
      : "Existem custos sem serviço/centro vinculado. Eles estão cobertos pelo bloco de demais custos do baseline para evitar dupla contagem.");
  }
  if (inventory.missingUnits > 0) warnings.push("O cadastro de unidades ainda não representa todo o estoque comercializável previsto no baseline.");

  const health = projectedProfit >= baselineProfit
    ? "above"
    : projectedProfit >= baselineProfit * 0.9
      ? "attention"
      : "below";

  return {
    baseline: {
      vgv: baselineVgv,
      units: baselineUnits,
      totalCost: baselineTotalCost,
      engineeringCost: baselineConstruction + baselineContingency,
      profit: baselineProfit,
      marginPct: baselineMargin,
      commission: baselineCommission,
      taxes: baselineTaxes,
      otherCost: baselineOtherCost,
      averageTicket: baselineAverageTicket,
    },
    commercial: {
      soldVgv,
      inventoryVgv,
      projectedVgv,
      vgvDeviation,
      soldUnits,
      availableUnits,
      salesProgressPct,
      averageSoldTicket,
    },
    cash: {
      received,
      receivableOpen,
      overdue,
      overdueCount,
      paidOut,
      payableOpen,
      cashBalance,
    },
    cost: {
      engineeringBudget: forecastCost.budget,
      engineeringActual: forecastCost.actual,
      engineeringCommitted: forecastCost.committed,
      engineeringToCommit: forecastCost.toCommit,
      engineeringProjected: projectedEngineeringCost,
      unallocatedActual: forecastCost.unallocatedActual,
      unallocatedCommitted: forecastCost.unallocatedCommitted,
      unallocatedProjected: forecastCost.unallocatedProjected,
      unallocatedExcess,
      projectedOtherCost,
      projectedCommission,
      projectedTaxes,
      projectedTotalCost,
    },
    result: {
      projectedProfit,
      projectedMarginPct: projectedMargin,
      profitDeviation,
      marginDeviationPct: marginDeviation,
      health,
    },
    rates: { commissionRate, taxRate },
    warnings,
  };
}
