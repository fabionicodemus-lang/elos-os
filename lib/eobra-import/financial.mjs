/**
 * Pure financial checks for an authorized eObra snapshot. No clock, network or
 * database access: competencies, policy and completeness come from the source.
 * Money uses integer cents; index values use six decimal places, never Number.
 */
const MONEY_LIMIT = 9999999999999999n; // numeric(16,2), also covers existing receivables.
const MAX_EVENTS = 10000;
const STATUSES = new Set(["open", "partial", "paid", "cancelled"]);
const COMPONENT_KEYS = ["interest_amount", "penalty_amount", "other_accrual_amount", "discount_amount"];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = values => [...new Set(values)];

function decimal(units, scale = 2) {
  if (units === null) return null;
  const sign = units < 0n ? "-" : "";
  const magnitude = units < 0n ? -units : units;
  const divisor = 10n ** BigInt(scale);
  return `${sign}${magnitude / divisor}.${String(magnitude % divisor).padStart(scale, "0")}`;
}

function parseDecimal(value, { field, scale, signed = false, positive = false, limit }) {
  if (typeof value !== "string" || value.length > 80) throw new Error(`${field}: informe uma string decimal exata.`);
  const match = new RegExp(`^${signed ? "(-?)" : "()"}(\\d+)(?:\\.(\\d{1,${scale}}))?$`).exec(value);
  if (!match) throw new Error(`${field}: decimal inválido; use ponto e até ${scale} casas, sem notação científica.`);
  const units = (BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((match[3] ?? "").padEnd(scale, "0"))) * (match[1] === "-" ? -1n : 1n);
  if (positive && units <= 0n) throw new Error(`${field}: o índice deve ser maior que zero.`);
  if (units > limit || units < -limit) throw new Error(`${field}: valor excede a precisão suportada.`);
  return units;
}

function money(value, field, signed = false) {
  return parseDecimal(value, { field, scale: 2, signed, limit: MONEY_LIMIT });
}

function indexValue(value, field) {
  return parseDecimal(value, { field, scale: 6, positive: true, limit: 999999999999999999n });
}

function collect(errors, fn) {
  try { return fn(); } catch (error) { errors.push(error.message); return null; }
}

function month(value, field) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`${field}: informe a competência explícita em AAAA-MM.`);
  }
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
}

function monthLabel(value) {
  return `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;
}

function maximumPeriodReference(policy, baseMonth, referenceMonth) {
  if (!Array.isArray(policy.index_values) || policy.index_values.length === 0 || policy.index_values.length > 10000) {
    throw new Error("correction.index_values: máxima do período exige a série mensal completa da base até a referência (até 10.000 valores).");
  }
  const values = new Map();
  for (const [position, entry] of policy.index_values.entries()) {
    const key = month(entry?.reference_month, `correction.index_values[${position}].reference_month`);
    const value = indexValue(entry?.value, `correction.index_values[${position}].value`);
    if (values.has(key)) throw new Error(`correction.index_values: competência repetida ${entry.reference_month}.`);
    values.set(key, value);
  }
  const base = indexValue(policy.base_value, "correction.base_value");
  const reference = indexValue(policy.reference_value, "correction.reference_value");
  if (values.get(baseMonth) !== base) throw new Error("correction.base_value: base declarada não confere com a série da competência exata.");
  if (values.get(referenceMonth) !== reference) throw new Error("correction.reference_value: referência declarada não confere com a série da competência exata.");
  let maximum = null;
  let effectiveMonth = null;
  for (let cursor = baseMonth; cursor <= referenceMonth; cursor++) {
    const value = values.get(cursor);
    if (value === undefined) throw new Error(`correction.index_values: competência ausente ${monthLabel(cursor)}; não é possível conferir a máxima do período.`);
    // A tie uses the most recent occurrence, without changing the amount.
    if (maximum === null || value >= maximum) { maximum = value; effectiveMonth = cursor; }
  }
  return { reference_month: monthLabel(effectiveMonth), reference_value: decimal(maximum, 6) };
}

function civilDate(value, field) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field}: informe uma data civil em AAAA-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field}: data civil inválida.`);
  return value;
}

function sourceId(value, field) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 512 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${field}: informe o ID textual estável, sem espaços nas extremidades.`);
  }
  return value;
}

/** Exact ratio, with a single HALF_UP rounding of the final amount in cents. */
export function calculateIndexNumberAmount({ original_amount, base_value, reference_value }) {
  const principal = money(original_amount, "original_amount");
  const base = indexValue(base_value, "base_value");
  const reference = indexValue(reference_value, "reference_value");
  const numerator = principal * reference;
  const rounded = numerator / base + ((numerator % base) * 2n >= base ? 1n : 0n);
  if (rounded > MONEY_LIMIT) throw new Error("current_amount: valor calculado excede a precisão suportada.");
  return {
    original_amount: decimal(principal),
    adjusted_principal_amount: decimal(rounded),
    correction_amount: decimal(rounded - principal),
    rounding: "half_up",
  };
}

/**
 * Calculates one installment at explicit source competencies. It does not pick
 * an index, inherit the sale date, schedule readjustments or assume a grace/lag.
 * Paid/cancelled/locked amounts always come from the supplied snapshot.
 */
export function calculateInstallmentCorrection(input) {
  const data = isObject(input) ? input : {};
  const errors = [];
  const warnings = [];
  const original = collect(errors, () => money(data.original_amount, "original_amount"));
  const components = Object.fromEntries(COMPONENT_KEYS.map(key => [key, collect(errors, () => money(data[key], key))]));
  if (!STATUSES.has(data.status)) errors.push("status: situação desconhecida; não é possível decidir o tratamento financeiro.");
  if (data.correction_locked !== undefined && typeof data.correction_locked !== "boolean") errors.push("correction_locked: informe um booleano explícito.");
  const preserved = data.correction_locked === true || data.status === "paid" || data.status === "cancelled";
  let correction = null;
  let current = null;
  let effectiveReferenceMonth = null;
  let effectiveReferenceValue = null;

  if (preserved) {
    current = collect(errors, () => money(data.current_amount, "current_amount"));
    correction = collect(errors, () => money(data.correction_amount, "correction_amount", true));
    warnings.push("Snapshot preservado: a política de correção não foi aplicada nem validada para cálculos futuros.");
  } else if (!isObject(data.correction)) {
    errors.push("correction: informe a política desta parcela; ausência não significa sem correção.");
  } else if (data.correction.mode === "none") {
    if (["base_month", "base_value", "reference_month", "reference_value", "lag_months", "calculation_month", "negative_variation_policy", "index_values"].some(key => data.correction[key] !== undefined && data.correction[key] !== null)) {
      errors.push("correction: política sem correção não pode conter parâmetros de índice.");
    }
    correction = 0n;
  } else if (data.correction.mode === "index_number") {
    const policy = data.correction;
    const priorErrors = errors.length;
    const baseMonth = collect(errors, () => month(policy.base_month, "correction.base_month"));
    const referenceMonth = collect(errors, () => month(policy.reference_month, "correction.reference_month"));
    const calculationMonth = policy.calculation_month === undefined ? null : collect(errors, () => month(policy.calculation_month, "correction.calculation_month"));
    if (baseMonth !== null && referenceMonth !== null && referenceMonth < baseMonth) errors.push("correction.reference_month: competência anterior à base informada.");
    if (calculationMonth !== null && referenceMonth !== null && referenceMonth > calculationMonth) errors.push("correction.reference_month: competência posterior ao cálculo informado.");
    if (policy.lag_months !== undefined) {
      if (!Number.isSafeInteger(policy.lag_months) || policy.lag_months < 0) errors.push("correction.lag_months: defasagem deve ser um inteiro não negativo.");
      else if (calculationMonth === null) errors.push("correction.calculation_month: necessário para conferir a defasagem explicitamente informada.");
      else if (referenceMonth !== null && calculationMonth - policy.lag_months !== referenceMonth) errors.push("correction.reference_month: competência não corresponde à defasagem informada.");
    }
    if (policy.negative_variation_policy !== undefined && !["use_negative", "maximum_of_period"].includes(policy.negative_variation_policy)) {
      errors.push("correction.negative_variation_policy: política não suportada; não será inferida.");
    }
    let selected = { reference_month: policy.reference_month, reference_value: policy.reference_value };
    if (policy.negative_variation_policy === "maximum_of_period" && errors.length === priorErrors) {
      selected = collect(errors, () => maximumPeriodReference(policy, baseMonth, referenceMonth));
    }
    if (selected && errors.length === priorErrors) {
      const calculation = collect(errors, () => calculateIndexNumberAmount({ original_amount: data.original_amount, base_value: policy.base_value, reference_value: selected.reference_value }));
      if (calculation) {
        correction = money(calculation.correction_amount, "correction_amount", true);
        effectiveReferenceMonth = selected.reference_month;
        effectiveReferenceValue = decimal(indexValue(selected.reference_value, "reference_value"), 6);
      }
    }
  } else {
    errors.push("correction.mode: política não suportada; informe none ou index_number com evidência da origem.");
  }

  if (original !== null && correction !== null && Object.values(components).every(value => value !== null)) {
    const expected = original + correction + components.interest_amount + components.penalty_amount + components.other_accrual_amount - components.discount_amount;
    if (expected < 0n || expected > MONEY_LIMIT) errors.push("current_amount: soma dos componentes fora da faixa monetária suportada.");
    else if (preserved) {
      if (current !== null && current !== expected) errors.push("current_amount: snapshot não confere com original, correção, juros, multa, acréscimos e desconto.");
    } else current = expected;
  }

  return {
    ok: errors.length === 0,
    preserved,
    original_amount: decimal(original),
    current_amount: decimal(current),
    correction_amount: decimal(correction),
    effective_reference_month: effectiveReferenceMonth,
    effective_reference_value: effectiveReferenceValue,
    ...Object.fromEntries(Object.entries(components).map(([key, value]) => [key, decimal(value)])),
    rounding: preserved ? null : "half_up",
    errors: unique(errors),
    warnings,
  };
}

/**
 * Reconciles effective payments and explicit reversals for ONE installment.
 * Source IDs must already be scoped by the snapshot to source/tenant/title.
 * Identical replays count once; a changed event under the same ID blocks review.
 */
export function reconcilePaymentEvents(input) {
  const data = isObject(input) ? input : {};
  const errors = [];
  const warnings = [];
  const paid = collect(errors, () => money(data.paid_amount, "paid_amount"));
  const entries = new Map();
  let duplicateCount = 0;
  if (data.events_complete !== true) errors.push("events_complete: confirme a leitura completa do histórico de baixas e estornos.");
  const events = Array.isArray(data.events) ? data.events : [];
  if (!Array.isArray(data.events)) errors.push("events: informe a lista explícita de eventos, inclusive quando vazia.");
  if (events.length > MAX_EVENTS) errors.push(`events: limite de ${MAX_EVENTS} eventos por parcela excedido.`);

  for (const [position, raw] of events.slice(0, MAX_EVENTS).entries()) {
    const eventErrors = [];
    const value = isObject(raw) ? raw : {};
    const prefix = `events[${position}]`;
    const id = collect(eventErrors, () => sourceId(value.source_id, `${prefix}.source_id`));
    const amount = collect(eventErrors, () => money(value.amount, `${prefix}.amount`));
    const occurredOn = collect(eventErrors, () => civilDate(value.occurred_on, `${prefix}.occurred_on`));
    if (!["payment", "reversal", "voided_payment"].includes(value.kind)) eventErrors.push(`${prefix}.kind: informe payment, reversal ou voided_payment explícito; atualização monetária não é baixa.`);
    if (amount !== null && amount <= 0n) eventErrors.push(`${prefix}.amount: eventos devem ter valor positivo; o tipo define o sinal.`);
    const reverses = value.kind === "reversal" ? collect(eventErrors, () => sourceId(value.reverses_source_id, `${prefix}.reverses_source_id`)) : null;
    if (value.kind !== "reversal" && value.reverses_source_id != null) eventErrors.push(`${prefix}.reverses_source_id: uma baixa não pode referenciar estorno.`);
    const voidedBy = value.kind === "voided_payment" ? collect(eventErrors, () => sourceId(value.voided_by_source_id, `${prefix}.voided_by_source_id`)) : null;
    if (value.kind === "voided_payment" && value.voided_date_unknown !== true) eventErrors.push(`${prefix}.voided_date_unknown: a baixa anulada exige evidência explícita do estorno sem data válida arquivado na origem.`);
    if (value.kind !== "voided_payment" && (value.voided_by_source_id !== undefined || value.voided_date_unknown !== undefined)) eventErrors.push(`${prefix}: evidência de anulação não pode ser aplicada a uma baixa efetiva.`);
    if (value.medium !== undefined && !["bank", "cash", "non_cash", "unknown"].includes(value.medium)) eventErrors.push(`${prefix}.medium: meio de recebimento desconhecido.`);
    if (value.account_source_id !== undefined) collect(eventErrors, () => sourceId(value.account_source_id, `${prefix}.account_source_id`));
    if (eventErrors.length) { errors.push(...eventErrors); continue; }
    const normalized = {
      source_id: id, kind: value.kind, amount: decimal(amount), occurred_on: occurredOn,
      ...(reverses === null ? {} : { reverses_source_id: reverses }),
      ...(voidedBy === null ? {} : { voided_by_source_id: voidedBy, voided_date_unknown: true }),
      ...(value.medium === undefined ? {} : { medium: value.medium }),
      ...(value.account_source_id === undefined ? {} : { account_source_id: value.account_source_id }),
    };
    const existing = entries.get(id);
    if (existing) {
      if (JSON.stringify(existing.event) !== JSON.stringify(normalized)) errors.push(`Evento ${id}: mesmo source_id com conteúdo financeiro diferente.`);
      else { duplicateCount++; warnings.push(`Evento ${id}: repetição idêntica contada uma única vez.`); }
    } else entries.set(id, { event: normalized, cents: amount });
  }

  const reversed = new Map();
  let totalPayments = 0n;
  let totalReversals = 0n;
  let totalVoided = 0n;
  let voidedCount = 0;
  for (const { event, cents } of entries.values()) {
    if (event.kind === "payment") { totalPayments += cents; continue; }
    if (event.kind === "voided_payment") {
      totalVoided += cents; voidedCount++;
      warnings.push(`Baixa ${event.source_id}: anulação preservada com efeito líquido zero; o estorno ${event.voided_by_source_id} não tem data válida e o histórico por data está incompleto.`);
      continue;
    }
    totalReversals += cents;
    const payment = entries.get(event.reverses_source_id);
    if (!payment || payment.event.kind !== "payment") errors.push(`Estorno ${event.source_id}: baixa original ausente ou referência não é payment.`);
    else {
      if (event.occurred_on < payment.event.occurred_on) errors.push(`Estorno ${event.source_id}: data anterior à baixa original.`);
      reversed.set(event.reverses_source_id, (reversed.get(event.reverses_source_id) ?? 0n) + cents);
    }
  }
  for (const [id, amount] of reversed) {
    if (amount > entries.get(id).cents) errors.push(`Baixa ${id}: estornos acumulados excedem o valor recebido.`);
  }
  const complete = errors.length === 0;
  const net = totalPayments - totalReversals;
  if (complete && paid !== null && paid !== net) errors.push("paid_amount: valor pago não corresponde à soma das baixas menos os estornos.");
  return {
    ok: errors.length === 0,
    totals_complete: complete,
    history_dates_complete: complete && voidedCount === 0,
    source_event_count: events.length,
    event_count: entries.size,
    duplicate_event_count: duplicateCount,
    voided_event_count: voidedCount,
    voided_amount: complete ? decimal(totalVoided) : null,
    payment_amount: complete ? decimal(totalPayments) : null,
    reversal_amount: complete ? decimal(totalReversals) : null,
    net_amount: complete ? decimal(net) : null,
    events: [...entries.values()].map(entry => entry.event),
    errors: unique(errors),
    warnings: unique(warnings),
  };
}

/** Checks a source snapshot without changing it or creating a canonical title. */
export function reconcileInstallmentFinancials(input) {
  const data = isObject(input) ? input : {};
  const errors = [];
  const current = collect(errors, () => money(data.current_amount, "current_amount"));
  const paid = collect(errors, () => money(data.paid_amount, "paid_amount"));
  const balance = collect(errors, () => money(data.balance_amount, "balance_amount"));
  const sourceCorrection = collect(errors, () => money(data.correction_amount, "correction_amount", true));
  const calculation = calculateInstallmentCorrection(data);
  const payments = reconcilePaymentEvents(data);
  errors.push(...calculation.errors, ...payments.errors);
  const warnings = [...calculation.warnings, ...payments.warnings];
  if (!calculation.preserved) {
    if (current !== null && calculation.current_amount !== null && decimal(current) !== calculation.current_amount) errors.push("current_amount: valor da origem difere do cálculo com a política explícita da parcela.");
    if (sourceCorrection !== null && calculation.correction_amount !== null && decimal(sourceCorrection) !== calculation.correction_amount) errors.push("correction_amount: correção da origem difere da política explícita da parcela.");
  }
  let computedBalance = null;
  let settlementState = null;
  if (current !== null && paid !== null && balance !== null) {
    computedBalance = current - paid;
    if (computedBalance < 0n) errors.push("paid_amount: pagamento líquido excede o valor atualizado; crédito excedente exige tratamento explícito.");
    if (balance !== computedBalance) errors.push("balance_amount: saldo não corresponde a atualizado menos recebido líquido; cancelamentos ou abatimentos exigem composição explícita.");
    if (data.status === "cancelled") {
      settlementState = "cancelled";
      if (balance > 0n) warnings.push("Parcela cancelada conserva o saldo histórico da origem; o saldo exigível é zero e esse valor não deve gerar cobrança ou previsão.");
    } else if (computedBalance >= 0n) {
      settlementState = paid > 0n && balance > 0n ? "partial" : balance === 0n ? "paid" : "open";
      if (data.status === "paid" && balance !== 0n) errors.push("status: parcela quitada deve ter saldo zero.");
      if (data.status === "partial" && settlementState !== "partial") errors.push("status: parcial exige pagamento líquido e saldo ambos positivos.");
      if (data.status === "open" && settlementState === "paid") errors.push("status: parcela aberta consta integralmente liquidada nos valores da origem.");
    }
  }
  const requiresPartialSupport = settlementState === "partial";
  if (requiresPartialSupport) warnings.push("Parcial preservada: não usar RPC de quitação integral nem desdobrar principal sem evidência da origem; a promoção depende de suporte a baixas parciais e saldos.");
  return {
    ok: errors.length === 0,
    source_snapshot: structuredClone(data),
    expected_current_amount: calculation.current_amount,
    expected_correction_amount: calculation.correction_amount,
    effective_reference_month: calculation.effective_reference_month,
    effective_reference_value: calculation.effective_reference_value,
    computed_balance_amount: decimal(computedBalance),
    collectible_balance_amount: computedBalance !== null && computedBalance >= 0n && STATUSES.has(data.status) ? decimal(data.status === "cancelled" ? 0n : computedBalance) : null,
    canonical_status: STATUSES.has(data.status) ? data.status === "partial" ? "open" : data.status : null,
    settlement_state: settlementState,
    requires_partial_support: requiresPartialSupport,
    correction_preserved: calculation.preserved,
    payments,
    errors: unique(errors),
    warnings: unique(warnings),
  };
}
