export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function sumContractItems(items) {
  return roundMoney(items.reduce((sum, item) => sum + Number(item.total_value || 0), 0));
}

export function contractCurrentValue(originalValue, amendments) {
  return roundMoney(Number(originalValue || 0) + amendments.reduce((sum, item) => sum + Number(item.value_change || 0), 0));
}

export function contractBalance(currentValue, measurements) {
  const measured = measurements
    .filter((item) => ["approved", "invoiced", "paid"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.gross_amount || 0), 0);
  return roundMoney(Number(currentValue || 0) - measured);
}

export function retainedBalance(measurements) {
  return roundMoney(measurements
    .filter((item) => ["approved", "invoiced", "paid"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.contractual_retention_amount || 0) + Number(item.guarantee_retention_amount || 0), 0));
}

export function dueDateFromApproval(approvalDate, paymentDays) {
  const date = new Date(`${String(approvalDate).slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(paymentDays || 0)));
  return date.toISOString().slice(0, 10);
}

export function requiresOverContractConfirmation(currentValue, measuredValue, nextGross) {
  return roundMoney(Number(measuredValue || 0) + Number(nextGross || 0)) > roundMoney(currentValue) + 0.01;
}

export function serviceDeviation(budgetedValue, committedValue) {
  const deviation = roundMoney(Number(committedValue || 0) - Number(budgetedValue || 0));
  return { deviation, overBudget: deviation > 0.01 };
}

export function contractItemsMatchOriginal(originalValue, items, tolerance = 0.01) {
  return Math.abs(sumContractItems(items) - roundMoney(originalValue)) <= tolerance;
}
