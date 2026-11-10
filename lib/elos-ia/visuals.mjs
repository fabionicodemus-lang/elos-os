// Elos IA — charts derived only from authorized, server-side tool results.
// This module is pure: no SQL, credentials, model output parsing or extra calls.

export const ELOS_IA_MAX_VISUALS = 3;
export const ELOS_IA_MAX_VISUAL_POINTS = 72;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_NOTES = 8;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const FORMATS = new Set(["money", "percent", "days", "number"]);
const TONES = new Set(["neutral", "positive", "warning", "danger"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value, max = 220) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_AMOUNT ? value : null;
}
function nonnegative(value) {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}
function percent(value) {
  const number = finite(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function month(value) { return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null; }
function monthLabel(value) { return `${MONTHS[Number(value.slice(5, 7)) - 1]}/${value.slice(2, 4)}`; }
function monthEnd(value) { return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0, 12)).toISOString().slice(0, 10); }
function pointKey(value) { return month(value) || date(value); }
function futurePoint(key, asOfDate) { return key.length === 10 ? key > asOfDate : key > asOfDate.slice(0, 7); }
function dateLabel(value) { return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ""; }
function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : "";
}
function strings(value, max = MAX_NOTES) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, 400)).filter(Boolean))].slice(0, max) : [];
}
function failed(value) { return !object(value) || "erro" in value || "indisponivel" in value; }
function scopeLabel(value) {
  if (typeof value === "string") return text(value);
  const scope = object(value);
  return scope ? [text(scope.codigo, 50), text(scope.nome, 160)].filter(Boolean).join(" · ") : "";
}
function uniquePoints(rows) {
  const keys = new Set();
  for (const row of rows) {
    if (keys.has(row.key)) return false;
    keys.add(row.key);
  }
  return true;
}
function metric(label, value, format = "money", tone = "neutral") {
  return { label, value, format, tone };
}
function base(result, today, generatedAt, title, sourceLabel) {
  const projectLabel = scopeLabel(result.obra);
  const asOfDate = date(result.data_de_referencia) || date(result.data_de_hoje) || date(today);
  if (!projectLabel || !asOfDate) return null;
  return {
    id: "pending", title, projectLabel, asOfDate, sourceLabel,
    warnings: [], metrics: [], notes: [],
    ...(timestamp(generatedAt) ? { generatedAt: timestamp(generatedAt) } : {}),
  };
}
function costVisual(result, today, generatedAt) {
  const common = base(result, today, generatedAt, "Quanto falta desembolsar", "Orçamento · contas a pagar · contratos");
  const totals = object(result.totais);
  if (!common || failed(totals)) return null;
  const fields = ["orcamento", "realizado_pago", "comprometido_em_contas_a_pagar_abertas", "comprometido_em_contratos_ainda_nao_faturados", "a_comprometer", "custo_projetado_final"];
  const amounts = fields.map((field) => nonnegative(totals[field]));
  if (amounts.some((value) => value === null)) return null;
  const [budget, paid, payable, unbilled, toCommit, projected] = amounts;
  // Refuse a composition that does not reconcile with the official forecast.
  if (Math.abs(paid + payable + unbilled + toCommit - projected) > 0.05 || projected < paid) return null;
  const remaining = round(projected - paid);
  const deviation = finite(totals.estouro_sobre_o_orcamento);
  return {
    ...common, type: "cost-composition", budget, projected, remaining,
    sourceLabel: [common.sourceLabel, text(result.orcamento_usado, 150), text(result.linha_de_base, 150)].filter(Boolean).join(" · "),
    segments: [
      { key: "paid", label: "Pago", value: paid },
      { key: "payable", label: "Contas em aberto", value: payable },
      { key: "unbilled", label: "Contratado a faturar", value: unbilled },
      { key: "toCommit", label: "A comprometer", value: toCommit },
    ],
    metrics: [metric("Falta desembolsar", remaining), metric("Custo final projetado", projected), metric("Orçamento", budget), ...(deviation !== null ? [metric("Desvio do orçamento", deviation, "money", deviation > 0 ? "danger" : "neutral")] : [])],
    warnings: strings(result.avisos_do_motor?.exemplos),
    notes: ["Falta desembolsar inclui contas em aberto, contratos ainda não faturados e orçamento a comprometer. Não é apenas o saldo das contas a pagar.", ...(text(result.filtro_de_servico) ? [`O gráfico e os totais representam a obra inteira. O filtro “${text(result.filtro_de_servico, 120)}” restringe somente a lista de serviços consultada.`] : [])],
  };
}
function scheduleVisual(result, today, generatedAt) {
  const common = base(result, today, generatedAt, "Prazo e avanço físico", "Cronograma · medições de avanço");
  const physical = object(result.fisico_geral);
  const term = object(result.prazo);
  if (!common || failed(physical) || failed(term) || !Array.isArray(result.curva_fisica) || !result.curva_fisica.length) return null;
  const hasMeasurement = Boolean(date(result.ultima_medicao_de_avanco));
  // Oversized histories are not silently clipped: a shortened S curve changes meaning.
  if (result.curva_fisica.length > ELOS_IA_MAX_VISUAL_POINTS) return null;
  const points = [];
  for (const raw of result.curva_fisica) {
    const row = object(raw);
    const key = row && pointKey(row.key);
    if (!row || !key) return null;
    const planned = row.planned === null ? null : percent(row.planned);
    const actual = row.actual === null ? null : percent(row.actual);
    if (row.planned !== null && planned === null || row.actual !== null && actual === null) return null;
    const closingDate = month(key) ? monthEnd(key) : key;
    if (month(key) && key === common.asOfDate.slice(0, 7)) {
      // The monthly engine's actual uses today's cutoff. Place that point at
      // today, not at month-end, and compare with the matching planned-to-date.
      points.push({ key: common.asOfDate, label: "Hoje", planned: percent(physical.previsto_ate_hoje_pct), actual: hasMeasurement ? percent(physical.realizado_pct) : null, projected: null });
      if (closingDate > common.asOfDate) points.push({ key: closingDate, label: monthLabel(key), planned, actual: null, projected: null });
    } else {
      // There is deliberately no extrapolation or model-authored future series.
      points.push({ key: closingDate, label: text(row.label, 50) || monthLabel(key.slice(0, 7)), planned, actual: futurePoint(closingDate, common.asOfDate) ? null : actual, projected: null });
    }
  }
  if (!uniquePoints(points) || points.length > ELOS_IA_MAX_VISUAL_POINTS) return null;
  const plannedFinish = date(term.termino_linha_de_base);
  const projectedFinish = date(term.termino_projetado);
  const delayDays = plannedFinish && projectedFinish ? finite(term.desvio_de_prazo_dias) : null;
  const warnings = hasMeasurement ? [] : ["Ainda não há medição de avanço registrada. A série realizada não representa um avanço confirmado."];
  return {
    ...common, type: "schedule", plannedFinish, projectedFinish, delayDays,
    sourceLabel: [common.sourceLabel, text(result.linha_de_base, 150)].filter(Boolean).join(" · "),
    points: points.sort((a, b) => a.key.localeCompare(b.key)).map((row) => hasMeasurement ? row : { ...row, actual: null }),
    metrics: [metric("Previsto até hoje", percent(physical.previsto_ate_hoje_pct), "percent"), metric("Realizado registrado", hasMeasurement ? percent(physical.realizado_pct) : null, "percent"), metric("Desvio das datas registradas", delayDays, "days", delayDays !== null && delayDays > 0 ? "danger" : "neutral")],
    warnings,
    notes: ["A curva usa os mesmos pesos físicos do cronograma. O ponto Hoje compara previsto e realizado na mesma data; os demais pontos representam fechamentos mensais.", "O término informado segue as datas cadastradas/reprogramadas. Não é uma extrapolação do ritmo da obra; não há projeção futura inventada.", ...(text(result.filtro_de_texto) ? [`O gráfico e os indicadores representam a obra inteira. O filtro “${text(result.filtro_de_texto, 120)}” restringe somente as listas de atividades.`] : [])],
    ...(plannedFinish ? { periodLabel: `Linha de base: ${dateLabel(plannedFinish)}${projectedFinish ? ` · término registrado: ${dateLabel(projectedFinish)}` : ""}` } : {}),
  };
}
function cashflowVisual(result, today, generatedAt) {
  const common = base(result, today, generatedAt, "Entradas, saídas e saldo projetado", "Contas a receber · contas a pagar · previsão de custos");
  const window = object(result.janela);
  if (!common || !window || !month(window.de) || !month(window.ate) || window.de > window.ate || !Array.isArray(result.meses) || !result.meses.length || result.meses.length > ELOS_IA_MAX_VISUAL_POINTS) return null;
  const engineeringIncluded = result.projecao_da_engenharia === "incluída";
  const points = [];
  for (const raw of result.meses) {
    const row = object(raw);
    const key = row && month(row.mes);
    if (!row || !key || key < window.de || key > window.ate) return null;
    const fields = ["recebido", "a_receber", "pago", "a_pagar", "projetado_engenharia"];
    const amounts = fields.map((field) => nonnegative(row[field]));
    const cumulative = finite(row[engineeringIncluded ? "saldo_acumulado_completo" : "saldo_acumulado"]);
    if (amounts.some((value) => value === null) || cumulative === null) return null;
    const [received, receivable, paid, payable, engineering] = amounts;
    if (!engineeringIncluded && engineering !== 0) return null;
    points.push({ key, label: monthLabel(key), received, receivable, paid, payable, engineering, cumulative });
  }
  if (!uniquePoints(points)) return null;
  points.sort((a, b) => a.key.localeCompare(b.key));
  const minimum = points.reduce((smallest, row) => row.cumulative < smallest.cumulative ? row : smallest);
  const received = round(points.reduce((sum, row) => sum + row.received + row.receivable, 0));
  const outgoing = round(points.reduce((sum, row) => sum + row.paid + row.payable + row.engineering, 0));
  return {
    ...common, type: "cashflow", engineeringIncluded, points,
    periodLabel: `${monthLabel(window.de)} a ${monthLabel(window.ate)}`,
    metrics: [metric("Entradas no período", received), metric("Saídas no período", outgoing), metric(`Menor saldo · ${minimum.label}`, minimum.cumulative, "money", minimum.cumulative < 0 ? "danger" : "neutral")],
    warnings: engineeringIncluded ? [] : [text(result.projecao_da_engenharia, 400) || "Projeção de Engenharia não incluída neste fluxo."],
    notes: ["Saldo calculado pelos lançamentos e pela previsão da obra; não representa saldo bancário conciliado.", "Recebimentos e pagamentos previstos permanecem projeções. Títulos vencidos ficam no mês do vencimento original."],
  };
}
function resultVisual(result, today, generatedAt) {
  const common = base(result, today, generatedAt, "Resultado econômico projetado", "Vendas e estoque · previsão de custos · incorporação");
  const engine = object(result.resultado);
  const commercial = object(engine?.commercial);
  const costs = object(engine?.cost);
  const profit = object(engine?.result);
  if (!common || result.projecao_disponivel !== true || !commercial || !costs || !profit) return null;
  const revenue = nonnegative(commercial.projectedVgv);
  const labels = [
    ["Obra", "engineeringProjected"], ["Comissões", "projectedCommission"],
    ["Tributos", "projectedTaxes"], ["Demais custos", "projectedOtherCost"], ["Distratos", "projectedCancellations"],
  ];
  const values = labels.map(([, key]) => nonnegative(costs[key]));
  const projectedProfit = finite(profit.projectedProfit);
  const margin = finite(profit.projectedMarginPct);
  if (revenue === null || values.some((value) => value === null) || projectedProfit === null || margin === null) return null;
  if (Math.abs(revenue - values.reduce((sum, value) => sum + value, 0) - projectedProfit) > 0.05) return null;
  const baseline = result.baseline_disponivel === true ? object(engine.baseline) : null;
  const baselineMargin = baseline ? finite(baseline.marginPct) : null;
  return {
    ...common, type: "result-waterfall",
    steps: [
      { label: "VGV projetado", kind: "total", value: revenue },
      ...labels.map(([label], index) => ({ label, kind: "delta", value: -values[index] })),
      { label: "Lucro projetado", kind: "total", value: projectedProfit },
    ],
    metrics: [metric("Lucro projetado", projectedProfit, "money", projectedProfit < 0 ? "danger" : "positive"), metric("Margem projetada", margin, "percent"), ...(baselineMargin !== null ? [metric("Margem da viabilidade", baselineMargin, "percent")] : [])],
    warnings: strings([...(Array.isArray(result.avisos) ? result.avisos : []), ...(Array.isArray(engine.warnings) ? engine.warnings : [])]),
    notes: ["Margem econômica projetada da incorporação, não resultado contábil. A composição preserva os cálculos oficiais, sem atribuir impactos de prazo ou desconto que não foram calculados."],
  };
}
function proposalVisual(result, today, generatedAt) {
  const unit = text(result.unidade, 50);
  const proposalNumber = text(result.numero_proposta, 70);
  const common = base(result, today, generatedAt, "Comparação da proposta", ["Propostas e condições de pagamento", proposalNumber].filter(Boolean).join(" · "));
  if (!common || !Array.isArray(result.cenarios) || result.cenarios.length < 2 || result.cenarios.length > 6) return null;
  const rate = result.taxa_desconto_anual_pct === null ? null : finite(result.taxa_desconto_anual_pct);
  if (result.taxa_desconto_anual_pct !== null && rate === null || rate !== null && rate <= -100) return null;
  const valuationDate = date(result.data_base);
  const scenarios = [];
  for (const raw of result.cenarios) {
    const row = object(raw);
    const label = row && text(row.nome, 100);
    const nominal = row && nonnegative(row.valor_nominal);
    const presentValue = row?.valor_presente === null ? null : nonnegative(row?.valor_presente);
    const marginPct = row?.margem_pct === null ? null : finite(row?.margem_pct);
    if (!row || !label || nominal === null || row.valor_presente !== null && presentValue === null || row.margem_pct !== null && marginPct === null) return null;
    if ((rate === null || valuationDate === null) && presentValue !== null) return null;
    scenarios.push({ label, nominal, presentValue, marginPct });
  }
  const comparable = scenarios.every((row) => row.presentValue !== null);
  return {
    ...common, type: "proposal-comparison", discountAnnualPct: rate, valuationDate, scenarios,
    title: `${comparable ? "Comparação em valor presente" : "Comparação nominal da proposta"}${unit ? ` · ${unit}` : ""}`,
    assumptions: strings(result.premissas),
    warnings: strings(result.avisos),
    metrics: scenarios.slice(0, 4).map((row) => metric(`${row.label} · ${comparable ? "valor presente" : "nominal"}`, comparable ? row.presentValue : row.nominal)),
    notes: ["Valor presente e margem só aparecem quando o cálculo possui os dados e as premissas necessárias.", ...(rate === null ? ["Taxa de desconto não definida; valores apresentados sem cálculo de valor presente."] : [])],
    periodLabel: valuationDate === null ? "Data-base não informada" : `Data-base: ${dateLabel(valuationDate)}`,
  };
}

function idFor(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return `elos-visual-${(hash >>> 0).toString(36)}`;
}
function identity(visual) {
  return JSON.stringify([visual.type, visual.projectLabel, visual.asOfDate, visual.periodLabel ?? "", visual.points?.map((point) => point.key) ?? [], visual.scenarios ? [visual.title, visual.discountAnnualPct, visual.valuationDate, visual.scenarios] : []]);
}

/** No model-generated text or history is accepted as chart evidence. */
export function buildElosIaVisuals({ observations, today, generatedAt } = {}) {
  if (!Array.isArray(observations) || !date(today)) return [];
  const visuals = new Map();
  const ordered = observations.filter((item) => object(item) && Number.isSafeInteger(item.sequence) && item.sequence >= 0).sort((a, b) => a.sequence - b.sequence).slice(-64);
  for (const observation of ordered) {
    const result = object(observation.result);
    if (failed(result)) continue;
    let candidates = [];
    if (observation.name === "custos_e_orcamento") candidates = [costVisual(result, today, generatedAt)];
    else if (observation.name === "cronograma_fisico") candidates = [scheduleVisual(result, today, generatedAt)];
    else if (observation.name === "fluxo_de_caixa") candidates = [cashflowVisual(result, today, generatedAt)];
    else if (observation.name === "resultado_do_empreendimento") candidates = [resultVisual(result, today, generatedAt)];
    else if (observation.name === "comparar_proposta_unidade") candidates = [proposalVisual(result, today, generatedAt)];
    else if (observation.name === "resumo_da_obra") {
      const scope = { obra: result.obra, data_de_hoje: result.data_de_hoje };
      if (!failed(result.custos_x_orcamento)) candidates.push(costVisual({ ...scope, totais: result.custos_x_orcamento, orcamento_usado: result.custos_x_orcamento.orcamento_usado, linha_de_base: result.custos_x_orcamento.linha_de_base, avisos_do_motor: result.custos_x_orcamento.avisos_do_motor }, today, generatedAt));
      if (!failed(result.fisico_e_prazo)) candidates.push(scheduleVisual({ ...scope, ...result.fisico_e_prazo }, today, generatedAt));
      if (!failed(result.fluxo_de_caixa)) candidates.push(cashflowVisual({ ...scope, ...result.fluxo_de_caixa }, today, generatedAt));
    }
    for (const visual of candidates.filter(Boolean)) {
      const key = identity(visual);
      visuals.delete(key);
      visuals.set(key, { ...visual, id: idFor(key) });
    }
  }
  return sanitizeElosIaVisuals([...visuals.values()].slice(-ELOS_IA_MAX_VISUALS));
}

function sanitizedBase(raw) {
  const id = text(raw.id, 100), title = text(raw.title, 160), projectLabel = text(raw.projectLabel), asOfDate = date(raw.asOfDate), sourceLabel = text(raw.sourceLabel, 360);
  if (!id || !title || !projectLabel || !asOfDate || !sourceLabel || !Array.isArray(raw.metrics) || !Array.isArray(raw.warnings)) return null;
  const metrics = [];
  for (const candidate of raw.metrics.slice(0, 8)) {
    const row = object(candidate);
    if (!row || !text(row.label, 100) || !FORMATS.has(row.format) || row.value !== null && finite(row.value) === null) continue;
    metrics.push({ label: text(row.label, 100), value: row.value, format: row.format, ...(TONES.has(row.tone) ? { tone: row.tone } : {}) });
  }
  return {
    id, title, projectLabel, asOfDate, sourceLabel, metrics, warnings: strings(raw.warnings), notes: strings(raw.notes),
    ...(timestamp(raw.generatedAt) ? { generatedAt: timestamp(raw.generatedAt) } : {}),
    ...(text(raw.periodLabel, 160) ? { periodLabel: text(raw.periodLabel, 160) } : {}),
  };
}

/** Same allowlist validates server output and untrusted browser session storage. */
export function sanitizeElosIaVisuals(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const ids = new Set();
  for (const candidate of value.slice(0, 32)) {
    const raw = object(candidate);
    if (!raw) continue;
    const common = sanitizedBase(raw);
    if (!common || ids.has(common.id)) continue;
    let visual = null;
    if (raw.type === "cost-composition") {
      const keys = ["paid", "payable", "unbilled", "toCommit"];
      if ([raw.budget, raw.projected, raw.remaining].some((amount) => nonnegative(amount) === null) || !Array.isArray(raw.segments) || raw.segments.length !== keys.length) continue;
      const segments = raw.segments.map((row) => object(row) && keys.includes(row.key) && text(row.label, 100) && nonnegative(row.value) !== null ? { key: row.key, label: text(row.label, 100), value: row.value } : null);
      if (segments.some((row) => !row) || new Set(segments.map((row) => row.key)).size !== keys.length) continue;
      if (Math.abs(segments.reduce((sum, row) => sum + row.value, 0) - raw.projected) > 0.05 || Math.abs(raw.projected - segments.find((row) => row.key === "paid").value - raw.remaining) > 0.05) continue;
      visual = { ...common, type: raw.type, budget: raw.budget, projected: raw.projected, remaining: raw.remaining, segments };
    } else if (raw.type === "schedule") {
      if (!Array.isArray(raw.points) || !raw.points.length || raw.points.length > ELOS_IA_MAX_VISUAL_POINTS) continue;
      if (raw.plannedFinish !== null && !date(raw.plannedFinish) || raw.projectedFinish !== null && !date(raw.projectedFinish) || raw.delayDays !== null && finite(raw.delayDays) === null) continue;
      const points = raw.points.map((row) => object(row) && pointKey(row.key) && [row.planned, row.actual, row.projected].every((number) => number === null || percent(number) !== null) ? { key: row.key, label: text(row.label, 50) || monthLabel(row.key.slice(0, 7)), planned: row.planned, actual: futurePoint(row.key, common.asOfDate) ? null : row.actual, projected: row.projected } : null);
      if (points.some((row) => !row) || !uniquePoints(points)) continue;
      visual = { ...common, type: raw.type, plannedFinish: raw.plannedFinish, projectedFinish: raw.projectedFinish, delayDays: raw.delayDays, points };
    } else if (raw.type === "cashflow") {
      if (typeof raw.engineeringIncluded !== "boolean" || !Array.isArray(raw.points) || !raw.points.length || raw.points.length > ELOS_IA_MAX_VISUAL_POINTS) continue;
      const points = raw.points.map((row) => object(row) && month(row.key) && [row.received, row.receivable, row.paid, row.payable, row.engineering].every((amount) => nonnegative(amount) !== null) && finite(row.cumulative) !== null && (raw.engineeringIncluded || row.engineering === 0) ? { key: row.key, label: text(row.label, 50) || monthLabel(row.key), received: row.received, receivable: row.receivable, paid: row.paid, payable: row.payable, engineering: row.engineering, cumulative: row.cumulative } : null);
      if (points.some((row) => !row) || !uniquePoints(points)) continue;
      visual = { ...common, type: raw.type, engineeringIncluded: raw.engineeringIncluded, points };
    } else if (raw.type === "result-waterfall") {
      if (!Array.isArray(raw.steps) || raw.steps.length < 2 || raw.steps.length > 12) continue;
      const steps = raw.steps.map((row) => object(row) && text(row.label, 100) && ["total", "delta"].includes(row.kind) && finite(row.value) !== null ? { label: text(row.label, 100), kind: row.kind, value: row.value } : null);
      if (steps.some((row) => !row) || steps[0].kind !== "total" || steps.at(-1).kind !== "total" || steps.slice(1, -1).some((row) => row.kind !== "delta")) continue;
      if (Math.abs(steps[0].value + steps.slice(1, -1).reduce((sum, row) => sum + row.value, 0) - steps.at(-1).value) > 0.05) continue;
      visual = { ...common, type: raw.type, steps };
    } else if (raw.type === "proposal-comparison") {
      if (raw.discountAnnualPct !== null && (finite(raw.discountAnnualPct) === null || raw.discountAnnualPct <= -100) || raw.valuationDate !== null && !date(raw.valuationDate) || !Array.isArray(raw.scenarios) || raw.scenarios.length < 2 || raw.scenarios.length > 6) continue;
      const scenarios = raw.scenarios.map((row) => object(row) && text(row.label, 100) && nonnegative(row.nominal) !== null && (row.presentValue === null || nonnegative(row.presentValue) !== null) && (row.marginPct === null || finite(row.marginPct) !== null) && (raw.discountAnnualPct !== null && raw.valuationDate !== null || row.presentValue === null) ? { label: text(row.label, 100), nominal: row.nominal, presentValue: row.presentValue, marginPct: row.marginPct } : null);
      if (scenarios.some((row) => !row)) continue;
      visual = { ...common, type: raw.type, discountAnnualPct: raw.discountAnnualPct, valuationDate: raw.valuationDate, assumptions: strings(raw.assumptions), scenarios };
    }
    if (visual) {
      ids.add(common.id);
      result.push(visual);
      if (result.length >= ELOS_IA_MAX_VISUALS) break;
    }
  }
  return result;
}
