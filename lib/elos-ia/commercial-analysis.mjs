import { calculateDevelopmentResult } from "../commercial/development-result.mjs";

const DAY_MS = 86_400_000;
const MAX_INSTALLMENTS = 2_400;

function finite(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isCommercialIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Rates are effective. A monthly rate is compounded, never multiplied by 12. */
export function effectiveAnnualDiscount(ratePct, period) {
  if ((ratePct === null || ratePct === undefined) && (period === null || period === undefined)) return null;
  const rate = finite(ratePct);
  if (rate === null || rate < 0 || !["anual", "mensal"].includes(period)) {
    throw new Error("Informe a taxa de desconto não negativa e sua base: anual ou mensal. Não há taxa padrão.");
  }
  const annual = period === "mensal" ? ((1 + rate / 100) ** 12 - 1) * 100 : rate;
  if (!Number.isFinite(annual)) throw new Error("A taxa de desconto informada está fora do intervalo calculável.");
  return annual;
}

/** Calendar months preserve the original day, clamping only the target month. */
function installmentDate(firstDueDate, months) {
  const [year, month, day] = firstDueDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  const date = target.toISOString().slice(0, 10);
  if (!isCommercialIsoDate(date)) throw new Error("O cronograma de parcelas ultrapassa o intervalo de datas suportado.");
  return date;
}

export function expandCommercialPayments(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const payments = [];
  for (const item of items) {
    const count = finite(item.installment_count);
    const interval = finite(item.interval_months);
    const amount = finite(item.amount_per_installment);
    if (!Number.isInteger(count) || count < 1 || count > 240 || !Number.isInteger(interval) || interval < 0 || interval > 120 || amount === null || amount <= 0 || !isCommercialIsoDate(item.first_due_date)) {
      throw new Error("Cada condição precisa de valor positivo por parcela, quantidade de 1 a 240, primeiro vencimento válido e intervalo em meses de 0 a 120.");
    }
    if (payments.length + count > MAX_INSTALLMENTS) throw new Error("O cronograma excede 2.400 parcelas. Restrinja a comparação a uma unidade.");
    const declaredTotal = finite(item.total_amount);
    if (declaredTotal !== null && Math.abs(roundMoney(count * amount) - declaredTotal) > 0.011) {
      throw new Error("O total de uma condição diverge da quantidade multiplicada pelo valor das parcelas. Revise o plano de pagamento.");
    }
    for (let index = 0; index < count; index += 1) {
      payments.push({ date: installmentDate(item.first_due_date, index * interval), amount });
    }
  }
  return payments.sort((left, right) => left.date.localeCompare(right.date));
}

/** No rate, date or payment plan is inferred from a nominal proposal price. */
export function analyzeCommercialScenario({ label, nominalAmount = null, paymentItems = [], discountAnnualPct = null, valuationDate = null }) {
  const warnings = [];
  const assumptions = [];
  let nominal = finite(nominalAmount);
  if (nominal !== null && nominal <= 0) throw new Error("O valor nominal do cenário precisa ser positivo.");
  let payments = [];
  try {
    payments = expandCommercialPayments(paymentItems);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "O plano de pagamento não está completo.");
  }
  const planned = payments.length ? roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0)) : null;
  if (nominal === null && planned !== null) nominal = planned;
  if (nominal !== null) nominal = roundMoney(nominal);
  if (!payments.length) warnings.push("Falta um cronograma completo com quantidade, valor e vencimentos das parcelas.");
  const reconciled = nominal !== null && planned !== null && Math.abs(nominal - planned) <= 0.011;
  if (nominal !== null && planned !== null && !reconciled) warnings.push(`As parcelas somam R$ ${planned.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} e não fecham o valor nominal informado. Complete ou corrija o plano antes de calcular o valor presente.`);
  const indexed = paymentItems.some((item) => Boolean(String(item.adjustment_index ?? "").trim()) || (finite(item.interest_rate_monthly) ?? 0) > 0);
  if (indexed) warnings.push("Há correção monetária ou juros contratuais nas parcelas. Faltam os valores futuros corrigidos ou premissas explícitas para calcular o valor presente.");
  const validRate = finite(discountAnnualPct);
  if (validRate === null) warnings.push("Informe a taxa de desconto e se ela é efetiva anual ou mensal; nenhuma SELIC foi presumida.");
  else if (validRate < 0) throw new Error("A taxa de desconto deve ser não negativa.");
  const validDate = isCommercialIsoDate(valuationDate);
  if (!validDate) warnings.push("Informe a data-base da comparação no formato AAAA-MM-DD.");
  const hasPastPayments = validDate && payments.some((payment) => payment.date < valuationDate);
  if (hasPastPayments) warnings.push("Há vencimentos anteriores à data-base. Informe o que já foi recebido e o cronograma remanescente, ou use uma data-base anterior ao primeiro vencimento.");

  let presentValue = null;
  if (reconciled && !indexed && validRate !== null && validDate && !hasPastPayments) {
    const start = Date.parse(`${valuationDate}T00:00:00.000Z`);
    const value = payments.reduce((sum, payment) => {
      const years = (Date.parse(`${payment.date}T00:00:00.000Z`) - start) / DAY_MS / 365;
      return sum + payment.amount / ((1 + validRate / 100) ** years);
    }, 0);
    if (!Number.isFinite(value)) throw new Error("Não foi possível calcular o valor presente com essas premissas.");
    presentValue = roundMoney(value);
    assumptions.push("Desconto composto pela taxa efetiva anual, com dias corridos/365; datas mensais preservam o dia original ou o último dia do mês.");
    assumptions.push("Valores das parcelas tratados como fixos; sem projetar índices futuros, inadimplência ou custos da unidade.");
  }
  return { label, nominal, presentValue, marginPct: null, installmentCount: payments.length, planned, assumptions, warnings };
}

/** Reuses the official result engine, but does not publish missing costs as zero. */
export function analyzeDevelopmentResult({ input, baselineApproved, sourceErrors = [] }) {
  const calculated = calculateDevelopmentResult(input);
  const metrics = input.baselineMetrics ?? {};
  const costFields = ["total_cost", "construction_cost", "contingency_cost", "commission_cost", "tax_cost"];
  const missing = costFields.filter((field) => finite(metrics[field]) === null || finite(metrics[field]) < 0);
  const study = input.baselineStudy ?? {};
  const explicitRates = [study.commission_pct, study.tax_rate_pct].every((value) => finite(value) !== null && finite(value) >= 0);
  const rateCoverage = finite(metrics.available_vgv) > 0 || explicitRates;
  const componentCost = [metrics.construction_cost, metrics.contingency_cost, metrics.commission_cost, metrics.tax_cost].reduce((sum, value) => sum + (finite(value) ?? 0), 0);
  const costsReconcile = finite(metrics.total_cost) !== null && finite(metrics.total_cost) + 0.011 >= componentCost;
  const costCoverage = baselineApproved && missing.length === 0 && finite(metrics.total_cost) > 0 && rateCoverage && costsReconcile;
  const baselineAvailable = costCoverage && finite(metrics.available_vgv) > 0 && finite(metrics.profit) !== null && finite(metrics.margin_pct) !== null;
  const projectionAvailable = costCoverage && calculated.commercial.projectedVgv > 0 && sourceErrors.length === 0;
  const warnings = [...calculated.warnings];
  if (!baselineApproved) warnings.push("Falta o baseline econômico aprovado. Não é seguro afirmar lucro ou margem do empreendimento com os custos parciais disponíveis.");
  if (missing.length) warnings.push(`O baseline não informa todos os componentes de custo (${missing.join(", ")}). Custos, comissões e impostos ausentes não foram assumidos como zero.`);
  if (!rateCoverage) warnings.push("Faltam taxas explícitas de comissão/impostos ou um VGV de baseline para derivá-las dos custos aprovados. Não foram presumidas taxas zero.");
  if (!costsReconcile && !missing.length) warnings.push("Os componentes do baseline excedem o seu custo total; revise a referência aprovada antes de calcular lucro.");
  if (projectionAvailable && !baselineAvailable) warnings.push("Há base para a projeção atual, mas a comparação de lucro/margem com o baseline está incompleta e não deve ser apresentada.");
  if (sourceErrors.length) warnings.push("Uma ou mais fontes não puderam ser consultadas. O resultado não foi publicado para evitar totalizar dados incompletos.");
  if (calculated.commercial.projectedVgv <= 0) warnings.push("Não há receita de vendas/estoque com valor suficiente para calcular a projeção econômica.");
  return {
    resultado: projectionAvailable ? calculated : null,
    baseline_disponivel: baselineAvailable,
    projecao_disponivel: projectionAvailable,
    avisos: [...new Set(warnings)],
  };
}
