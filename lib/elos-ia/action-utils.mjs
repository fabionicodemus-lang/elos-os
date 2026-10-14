export function normalizeActionText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchUniqueCandidate(requested, candidates, keySelector) {
  const wanted = normalizeActionText(requested);
  if (!wanted) return { match: null, reason: "empty" };
  const scored = [];
  for (const candidate of candidates ?? []) {
    const keys = (keySelector(candidate) ?? []).map(normalizeActionText).filter(Boolean);
    if (keys.includes(wanted)) scored.push({ candidate, score: 3 });
    else if (keys.some((key) => key.includes(wanted) || wanted.includes(key))) scored.push({ candidate, score: 2 });
    else {
      const words = wanted.split(" ").filter((word) => word.length > 2);
      const overlap = Math.max(0, ...keys.map((key) => words.filter((word) => key.includes(word)).length));
      if (words.length && overlap === words.length) scored.push({ candidate, score: 1 });
    }
  }
  if (!scored.length) return { match: null, reason: "not_found" };
  const best = Math.max(...scored.map((item) => item.score));
  const winners = scored.filter((item) => item.score === best);
  if (winners.length !== 1) return { match: null, reason: "ambiguous", candidates: winners.map((item) => item.candidate) };
  return { match: winners[0].candidate, reason: "ok" };
}

export function allocateSharedAmount(total, weights) {
  const amount = Math.max(0, Number(total ?? 0) || 0);
  const clean = (weights ?? []).map((value) => Math.max(0, Number(value ?? 0) || 0));
  if (!clean.length) return [];
  if (amount === 0) return clean.map(() => 0);
  const weightTotal = clean.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) {
    const equal = Math.floor((amount / clean.length) * 100) / 100;
    const result = clean.map(() => equal);
    result[result.length - 1] = Math.round((amount - result.slice(0, -1).reduce((sum, value) => sum + value, 0)) * 100) / 100;
    return result;
  }
  let used = 0;
  return clean.map((weight, index) => {
    if (index === clean.length - 1) return Math.round((amount - used) * 100) / 100;
    const part = Math.round((amount * weight / weightTotal) * 100) / 100;
    used += part;
    return part;
  });
}

export function buildMeasurementPreview({ contract, items, taxWithholding = 0, advanceDeduction = 0, otherDiscount = 0 }) {
  const rows = [];
  let gross = 0;
  let overItem = false;
  for (const item of items ?? []) {
    const current = Math.max(0, Number(item.current_quantity ?? item.currentQuantity ?? 0) || 0);
    const contracted = Math.max(0, Number(item.contracted_quantity ?? item.contractedQuantity ?? 0) || 0);
    const previous = Math.max(0, Number(item.measured_quantity ?? item.previousQuantity ?? 0) || 0);
    const unitPrice = Math.max(0, Number(item.unit_price ?? item.unitPrice ?? 0) || 0);
    const currentAmount = Math.round(current * unitPrice * 100) / 100;
    const accumulated = previous + current;
    if (accumulated > contracted + 0.000001) overItem = true;
    gross += currentAmount;
    rows.push({ ...item, currentQuantity: current, previousQuantity: previous, accumulatedQuantity: accumulated, contractedQuantity: contracted, unitPrice, currentAmount, overContract: accumulated > contracted + 0.000001 });
  }
  gross = Math.round(gross * 100) / 100;
  const retentionPercent = Math.max(0, Number(contract?.retention_percent ?? contract?.retentionPercent ?? 0) || 0);
  const guaranteePercent = Math.max(0, Number(contract?.guarantee_percent ?? contract?.guaranteePercent ?? 0) || 0);
  const contractualRetention = Math.round(gross * retentionPercent) / 100;
  const guaranteeRetention = Math.round(gross * guaranteePercent) / 100;
  const tax = Math.max(0, Number(taxWithholding ?? 0) || 0);
  const advance = Math.max(0, Number(advanceDeduction ?? 0) || 0);
  const other = Math.max(0, Number(otherDiscount ?? 0) || 0);
  const deductions = Math.round((contractualRetention + guaranteeRetention + tax + advance + other) * 100) / 100;
  const net = Math.round((gross - deductions) * 100) / 100;
  const currentValue = Math.max(0, Number(contract?.current_value ?? contract?.currentValue ?? 0) || 0);
  const measuredValue = Math.max(0, Number(contract?.measured_value ?? contract?.measuredValue ?? 0) || 0);
  const overContract = overItem || measuredValue + gross > currentValue + 0.01;
  return { rows, gross, contractualRetention, guaranteeRetention, deductions, net, overContract, overItem, overValue: measuredValue + gross > currentValue + 0.01 };
}
