// Elos IA — resumos puros dos dados da obra.
//
// Estas funções não acessam Supabase, React nem a OpenAI. Elas recebem linhas
// já carregadas e devolvem resumos compactos, para que a IA receba poucos
// tokens e nunca precise somar listas grandes sozinha.

import { calculateDashboardActivityWeights } from "../dashboard-physical-curve.mjs";

const DAY_MS = 86_400_000;

export function round2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function isoDate(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
}

function parseDate(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(fromIso, toIso) {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function addDaysIso(value, days) {
  const date = parseDate(value);
  if (!date) return "";
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function addMonthsKey(monthKey, months) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return date.toISOString().slice(0, 7);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function clampLimit(value, fallback, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function inPeriod(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function topGroups(rows, keyOf, valueOf, limit) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || "Não informado";
    const current = groups.get(key) ?? { nome: key, quantidade: 0, valor: 0 };
    current.quantidade += 1;
    current.valor += valueOf(row);
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit)
    .map((group) => ({ ...group, valor: round2(group.valor) }));
}

function total(rows, valueOf) {
  return { quantidade: rows.length, valor: round2(rows.reduce((sum, row) => sum + valueOf(row), 0)) };
}

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

function payableValue(row) {
  return row.status === "paid" ? Number(row.paidAmount ?? row.amount ?? 0) : Number(row.amount ?? 0);
}

export function summarizePayables(rows, options = {}) {
  const today = isoDate(options.today);
  const from = isoDate(options.from);
  const to = isoDate(options.to);
  const situation = ["em_aberto", "vencidas", "pagas", "todas"].includes(options.situation) ? options.situation : "em_aberto";
  const supplierText = normalizeText(options.supplierText);
  const limit = clampLimit(options.limit, 10, 25);

  const scoped = rows
    .filter((row) => row.status === "open" || row.status === "paid")
    .filter((row) => !supplierText || normalizeText(row.supplier).includes(supplierText));

  const open = scoped.filter((row) => row.status === "open");
  const paid = scoped.filter((row) => row.status === "paid");
  const overdue = open.filter((row) => isoDate(row.dueDate) < today);
  const next7 = open.filter((row) => inPeriod(isoDate(row.dueDate), today, addDaysIso(today, 7)));
  const next30 = open.filter((row) => inPeriod(isoDate(row.dueDate), today, addDaysIso(today, 30)));
  const paidInPeriod = from || to ? paid.filter((row) => inPeriod(isoDate(row.paidAt), from, to)) : paid;

  let selected;
  if (situation === "vencidas") selected = overdue;
  else if (situation === "pagas") selected = paidInPeriod;
  else if (situation === "em_aberto") selected = open;
  else selected = scoped;

  if (situation !== "pagas" && (from || to)) {
    selected = selected.filter((row) => inPeriod(isoDate(row.status === "paid" ? row.paidAt : row.dueDate), from, to));
  }

  const ordered = [...selected].sort((a, b) => {
    if (situation === "pagas") return isoDate(b.paidAt).localeCompare(isoDate(a.paidAt));
    return isoDate(a.dueDate).localeCompare(isoDate(b.dueDate));
  });

  return {
    filtro: { situacao: situation, de: from || null, ate: to || null, fornecedor: options.supplierText || null },
    resumo_geral: {
      em_aberto: total(open, payableValue),
      vencidas: total(overdue, payableValue),
      // Janelas contadas de hoje até a data "ate", inclusive.
      vencem_em_7_dias: { ...total(next7, payableValue), ate: addDaysIso(today, 7) },
      vencem_em_30_dias: { ...total(next30, payableValue), ate: addDaysIso(today, 30) },
      pagas: { ...total(paidInPeriod, payableValue), periodo: from || to ? "no período filtrado" : "desde o início" },
    },
    selecao: total(selected, payableValue),
    maiores_fornecedores_da_selecao: topGroups(selected, (row) => row.supplier, payableValue, 8),
    itens: ordered.slice(0, limit).map((row) => ({
      fornecedor: row.supplier || "Fornecedor",
      documento: row.document || null,
      parcela: row.installment || null,
      vencimento: isoDate(row.dueDate),
      pago_em: row.status === "paid" ? isoDate(row.paidAt) || null : null,
      valor: round2(payableValue(row)),
      situacao: row.status === "paid" ? "paga" : isoDate(row.dueDate) < today ? "vencida" : "em aberto",
      dias_de_atraso: row.status === "open" && isoDate(row.dueDate) < today ? daysBetween(row.dueDate, today) : 0,
    })),
    itens_omitidos: Math.max(0, ordered.length - limit),
  };
}

// ---------------------------------------------------------------------------
// Contas a receber
// ---------------------------------------------------------------------------

const RECEIVABLE_CATEGORY_LABELS = {
  entry: "Entrada",
  monthly: "Mensal",
  reinforcement: "Reforço",
  keys: "Chaves",
  post_keys: "Pós-chaves",
  other: "Outra",
};

function receivableValue(row) {
  const adjusted = Number(row.adjustedAmount ?? row.amount ?? 0);
  return row.status === "paid" ? Number(row.paidAmount ?? adjusted) : adjusted;
}

export function summarizeReceivables(rows, options = {}) {
  const today = isoDate(options.today);
  const from = isoDate(options.from);
  const to = isoDate(options.to);
  const situation = ["em_aberto", "vencidas", "recebidas", "todas"].includes(options.situation) ? options.situation : "em_aberto";
  const clientText = normalizeText(options.clientText);
  const limit = clampLimit(options.limit, 10, 25);

  const scoped = rows
    .filter((row) => row.status === "open" || row.status === "paid")
    .filter((row) => !clientText || normalizeText(`${row.client} ${row.unit}`).includes(clientText));

  const open = scoped.filter((row) => row.status === "open");
  const paid = scoped.filter((row) => row.status === "paid");
  const overdue = open.filter((row) => isoDate(row.dueDate) < today);
  const next30 = open.filter((row) => inPeriod(isoDate(row.dueDate), today, addDaysIso(today, 30)));
  const paidInPeriod = from || to ? paid.filter((row) => inPeriod(isoDate(row.paidAt), from, to)) : paid;

  let selected;
  if (situation === "vencidas") selected = overdue;
  else if (situation === "recebidas") selected = paidInPeriod;
  else if (situation === "em_aberto") selected = open;
  else selected = scoped;

  if (situation !== "recebidas" && (from || to)) {
    selected = selected.filter((row) => inPeriod(isoDate(row.status === "paid" ? row.paidAt : row.dueDate), from, to));
  }

  const ordered = [...selected].sort((a, b) => {
    if (situation === "recebidas") return isoDate(b.paidAt).localeCompare(isoDate(a.paidAt));
    return isoDate(a.dueDate).localeCompare(isoDate(b.dueDate));
  });

  const debtors = new Map();
  for (const row of overdue) {
    const key = row.client || "Cliente";
    const current = debtors.get(key) ?? { cliente: key, unidades: new Set(), parcelas: 0, valor: 0, maior_atraso_dias: 0 };
    if (row.unit) current.unidades.add(row.unit);
    current.parcelas += 1;
    current.valor += receivableValue(row);
    current.maior_atraso_dias = Math.max(current.maior_atraso_dias, daysBetween(row.dueDate, today));
    debtors.set(key, current);
  }

  const openValue = open.reduce((sum, row) => sum + receivableValue(row), 0);
  const overdueValue = overdue.reduce((sum, row) => sum + receivableValue(row), 0);

  return {
    filtro: { situacao: situation, de: from || null, ate: to || null, cliente_ou_unidade: options.clientText || null },
    resumo_geral: {
      carteira_em_aberto: total(open, receivableValue),
      vencidas: { ...total(overdue, receivableValue), clientes: debtors.size },
      percentual_da_carteira_vencido: openValue > 0 ? round2(overdueValue / openValue * 100) : 0,
      vencem_em_30_dias: { ...total(next30, receivableValue), ate: addDaysIso(today, 30) },
      recebidas: { ...total(paidInPeriod, receivableValue), periodo: from || to ? "no período filtrado" : "desde o início" },
    },
    observacao: "Valores em aberto usam o valor corrigido pelo índice (ex.: CUB) quando existe; valores recebidos usam o valor efetivamente pago.",
    selecao: total(selected, receivableValue),
    carteira_em_aberto_por_categoria: topGroups(open, (row) => RECEIVABLE_CATEGORY_LABELS[row.category] ?? row.category, receivableValue, 6),
    maiores_inadimplentes: [...debtors.values()]
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)
      .map((debtor) => ({ ...debtor, unidades: [...debtor.unidades].sort(), valor: round2(debtor.valor) })),
    itens: ordered.slice(0, limit).map((row) => ({
      cliente: row.client || "Cliente",
      unidade: row.unit || null,
      parcela: `${RECEIVABLE_CATEGORY_LABELS[row.category] ?? row.category} ${row.sequenceNumber ?? 1}/${row.sequenceTotal ?? 1}`,
      vencimento: isoDate(row.dueDate),
      recebido_em: row.status === "paid" ? isoDate(row.paidAt) || null : null,
      valor: round2(receivableValue(row)),
      situacao: row.status === "paid" ? "recebida" : isoDate(row.dueDate) < today ? "vencida" : "em aberto",
      dias_de_atraso: row.status === "open" && isoDate(row.dueDate) < today ? daysBetween(row.dueDate, today) : 0,
    })),
    itens_omitidos: Math.max(0, ordered.length - limit),
  };
}

// ---------------------------------------------------------------------------
// Fluxo de caixa mensal (mesma regra da tela Financeiro › Fluxo de Caixa)
// ---------------------------------------------------------------------------

export function buildCashflowMonths({ payables = [], receivables = [], engineeringMonths = [], today, monthsBack = 3, monthsAhead = 6 }) {
  const todayIso = isoDate(today);
  const currentMonth = todayIso.slice(0, 7);
  // null/vazio = "use o padrão" (é o que a IA envia quando não quer filtrar);
  // zero é um valor válido e significa "só o mês atual".
  const monthsArg = (value, fallback, max) => {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.min(Math.max(number, 0), max) : fallback;
  };
  const back = monthsArg(monthsBack, 3, 24);
  const ahead = monthsArg(monthsAhead, 6, 36);
  const firstKey = addMonthsKey(currentMonth, -back);
  const lastKey = addMonthsKey(currentMonth, ahead);

  const buckets = new Map();
  const bucket = (key) => {
    const current = buckets.get(key) ?? { mes: key, recebido: 0, a_receber: 0, pago: 0, a_pagar: 0, projetado_engenharia: 0 };
    buckets.set(key, current);
    return current;
  };

  for (const row of receivables) {
    if (row.status !== "open" && row.status !== "paid") continue;
    const date = isoDate(row.status === "paid" ? row.paidAt : row.dueDate);
    if (!date) continue;
    if (row.status === "paid") bucket(date.slice(0, 7)).recebido += receivableValue(row);
    else bucket(date.slice(0, 7)).a_receber += receivableValue(row);
  }
  for (const row of payables) {
    if (row.status !== "open" && row.status !== "paid") continue;
    const date = isoDate(row.status === "paid" ? row.paidAt : row.dueDate);
    if (!date) continue;
    if (row.status === "paid") bucket(date.slice(0, 7)).pago += payableValue(row);
    else bucket(date.slice(0, 7)).a_pagar += payableValue(row);
  }
  for (const month of engineeringMonths) {
    const value = Number(month.engineeringProjected ?? 0);
    if (!month.key || !value) continue;
    bucket(String(month.key).slice(0, 7)).projetado_engenharia += value;
  }

  let accumulated = 0;
  let accumulatedComplete = 0;
  let firstNegativeMonth = null;
  let negativeBeforeCurrentMonth = false;
  let reachedCurrentMonth = false;
  // O acumulado pode já chegar negativo ao mês atual, mesmo sem lançamento nele.
  const enterCurrentMonth = () => {
    if (reachedCurrentMonth) return;
    reachedCurrentMonth = true;
    if (accumulatedComplete < 0) {
      negativeBeforeCurrentMonth = true;
      firstNegativeMonth = currentMonth;
    }
  };
  const before = { meses: 0, saldo_acumulado: 0, saldo_acumulado_completo: 0 };
  const after = { meses: 0, a_receber: 0, a_pagar: 0, projetado_engenharia: 0 };
  const months = [];
  const totals = { recebido: 0, a_receber: 0, pago: 0, a_pagar: 0, projetado_engenharia: 0 };

  for (const row of [...buckets.values()].sort((a, b) => a.mes.localeCompare(b.mes))) {
    if (row.mes >= currentMonth) enterCurrentMonth();
    const periodBalance = row.recebido + row.a_receber - row.pago - row.a_pagar;
    accumulated += periodBalance;
    accumulatedComplete += periodBalance - row.projetado_engenharia;
    for (const key of Object.keys(totals)) totals[key] += row[key];
    if (!firstNegativeMonth && row.mes >= currentMonth && accumulatedComplete < 0) firstNegativeMonth = row.mes;

    if (row.mes < firstKey) {
      before.meses += 1;
      before.saldo_acumulado = accumulated;
      before.saldo_acumulado_completo = accumulatedComplete;
    } else if (row.mes > lastKey) {
      after.meses += 1;
      after.a_receber += row.a_receber;
      after.a_pagar += row.a_pagar;
      after.projetado_engenharia += row.projetado_engenharia;
    } else {
      months.push({
        mes: row.mes,
        mes_atual: row.mes === currentMonth,
        recebido: round2(row.recebido),
        a_receber: round2(row.a_receber),
        pago: round2(row.pago),
        a_pagar: round2(row.a_pagar),
        projetado_engenharia: round2(row.projetado_engenharia),
        saldo_do_mes: round2(periodBalance),
        saldo_acumulado: round2(accumulated),
        saldo_acumulado_completo: round2(accumulatedComplete),
      });
    }
  }

  enterCurrentMonth();

  const currentBalance = totals.recebido - totals.pago;
  const projectedBalance = currentBalance + totals.a_receber - totals.a_pagar;

  return {
    janela: { de: firstKey, ate: lastKey, mes_atual: currentMonth },
    totais_de_toda_a_obra: {
      recebido: round2(totals.recebido),
      a_receber: round2(totals.a_receber),
      pago: round2(totals.pago),
      a_pagar: round2(totals.a_pagar),
      projetado_engenharia: round2(totals.projetado_engenharia),
      saldo_atual: round2(currentBalance),
      saldo_projetado: round2(projectedBalance),
      saldo_projetado_completo: round2(projectedBalance - totals.projetado_engenharia),
    },
    primeiro_mes_com_saldo_acumulado_completo_negativo: firstNegativeMonth,
    saldo_acumulado_completo_ja_negativo_antes_do_mes_atual: negativeBeforeCurrentMonth,
    antes_da_janela: { meses: before.meses, saldo_acumulado: round2(before.saldo_acumulado), saldo_acumulado_completo: round2(before.saldo_acumulado_completo) },
    meses: months,
    depois_da_janela: { meses: after.meses, a_receber: round2(after.a_receber), a_pagar: round2(after.a_pagar), projetado_engenharia: round2(after.projetado_engenharia) },
    observacao: "saldo_do_mes = recebido + a_receber − pago − a_pagar. saldo_acumulado_completo desconta também o Projetado Engenharia (contratos ainda não faturados + saldo a comprometer do orçamento). Contas em aberto já vencidas aparecem no mês do vencimento original.",
  };
}

// ---------------------------------------------------------------------------
// Cronograma físico
// ---------------------------------------------------------------------------

function plannedProgress(activity, selectedDate) {
  const date = parseDate(selectedDate);
  const start = parseDate(activity.planned_start);
  const rawFinish = parseDate(activity.planned_finish);
  if (!date || !start || !rawFinish) return 0;
  const finish = rawFinish < start ? start : rawFinish;
  if (date < start) return 0;
  if (date >= finish) return 100;
  const totalDays = Math.max(1, Math.round((finish.getTime() - start.getTime()) / DAY_MS) + 1);
  const elapsedDays = Math.max(0, Math.round((date.getTime() - start.getTime()) / DAY_MS) + 1);
  return Math.min(100, elapsedDays / totalDays * 100);
}

export function summarizeSchedule({ activities = [], measurements = [], serviceWeights = [], serviceNames = new Map(), locationNames = new Map(), today, limit, searchText = "" }) {
  const todayIso = isoDate(today);
  const max = clampLimit(limit, 8, 20);
  const search = normalizeText(searchText);

  const active = activities
    .filter((activity) => activity.record_status === "active")
    .filter((activity) => parseDate(activity.planned_start) && parseDate(activity.planned_finish));

  const latest = new Map();
  [...measurements]
    .filter((measurement) => isoDate(measurement.measurement_date) && isoDate(measurement.measurement_date) <= todayIso)
    .sort((a, b) => isoDate(a.measurement_date).localeCompare(isoDate(b.measurement_date)) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .forEach((measurement) => latest.set(measurement.activity_id, measurement));

  const weights = calculateDashboardActivityWeights(active, serviceWeights);
  let plannedWeighted = 0;
  let actualWeighted = 0;
  let totalWeight = 0;
  let lastMeasurementDate = "";

  const rows = active.map((activity) => {
    const measurement = latest.get(activity.id) ?? null;
    const progress = Math.max(0, Math.min(100, Number(measurement?.progress_percent ?? 0)));
    const planned = plannedProgress(activity, todayIso);
    const weight = Number(weights.get(activity.id) ?? 0);
    plannedWeighted += planned * weight;
    actualWeighted += progress * weight;
    totalWeight += weight;
    if (measurement && isoDate(measurement.measurement_date) > lastMeasurementDate) lastMeasurementDate = isoDate(measurement.measurement_date);
    const currentFinish = isoDate(measurement?.current_finish) || isoDate(activity.planned_finish);
    return {
      activity,
      progress,
      planned,
      gap: planned - progress,
      weight,
      currentStart: isoDate(measurement?.current_start) || isoDate(activity.planned_start),
      currentFinish,
      delayed: progress + 0.5 < planned,
      finishSlipDays: Math.max(0, daysBetween(activity.planned_finish, currentFinish)),
      overdueDays: progress < 100 && isoDate(activity.planned_finish) < todayIso ? daysBetween(activity.planned_finish, todayIso) : 0,
    };
  });

  const describe = (row) => ({
    atividade: [row.activity.code, row.activity.name].filter(Boolean).join(" · "),
    servico: serviceNames.get(row.activity.service_id ?? "") ?? null,
    local: locationNames.get(row.activity.location_id ?? "") ?? null,
    inicio_previsto: isoDate(row.activity.planned_start),
    termino_previsto: isoDate(row.activity.planned_finish),
    termino_atual: row.currentFinish,
    avanco_real_pct: round2(row.progress),
    avanco_previsto_hoje_pct: round2(row.planned),
    dias_vencidos_sem_concluir: row.overdueDays,
    peso_no_fisico_pct: round2(row.weight),
  });

  const matches = (row) => !search || normalizeText(`${row.activity.code} ${row.activity.name} ${serviceNames.get(row.activity.service_id ?? "") ?? ""} ${locationNames.get(row.activity.location_id ?? "") ?? ""}`).includes(search);

  const delayed = rows.filter((row) => row.delayed);
  const finished = rows.filter((row) => row.progress >= 100);
  const inProgress = rows.filter((row) => row.progress > 0 && row.progress < 100);
  const notStarted = rows.filter((row) => row.progress <= 0);
  const upcoming = notStarted.filter((row) => inPeriod(isoDate(row.activity.planned_start), todayIso, addDaysIso(todayIso, 30)));
  const delayedMatches = delayed.filter(matches).sort((a, b) => b.gap * b.weight - a.gap * a.weight);
  const inProgressMatches = inProgress.filter((row) => !row.delayed).filter(matches).sort((a, b) => a.currentFinish.localeCompare(b.currentFinish));
  const upcomingMatches = upcoming.filter(matches).sort((a, b) => isoDate(a.activity.planned_start).localeCompare(isoDate(b.activity.planned_start)));

  const baselineFinish = active.reduce((value, activity) => (isoDate(activity.planned_finish) > value ? isoDate(activity.planned_finish) : value), "");
  const forecastFinish = rows.reduce((value, row) => (row.currentFinish > value ? row.currentFinish : value), "");
  const divisor = totalWeight || 100;
  const plannedTotal = plannedWeighted / divisor;
  const actualTotal = actualWeighted / divisor;

  return {
    data_de_referencia: todayIso,
    ultima_medicao_de_avanco: lastMeasurementDate || null,
    fisico_geral: {
      previsto_ate_hoje_pct: round2(plannedTotal),
      realizado_pct: round2(actualTotal),
      diferenca_pontos_percentuais: round2(actualTotal - plannedTotal),
      situacao: !lastMeasurementDate ? "sem medição de avanço lançada" : actualTotal + 0.5 < plannedTotal ? "atrasado em relação à linha de base" : "em dia ou adiantado",
    },
    prazo: {
      termino_linha_de_base: baselineFinish || null,
      termino_projetado: forecastFinish || null,
      desvio_de_prazo_dias: baselineFinish && forecastFinish ? daysBetween(baselineFinish, forecastFinish) : 0,
    },
    atividades: {
      total: rows.length,
      concluidas: finished.length,
      em_andamento: inProgress.length,
      nao_iniciadas: notStarted.length,
      atrasadas: delayed.length,
      iniciam_nos_proximos_30_dias: upcoming.length,
    },
    filtro_de_texto: searchText || null,
    atrasadas_mais_relevantes: delayedMatches.slice(0, max).map(describe),
    atrasadas_omitidas: Math.max(0, delayedMatches.length - max),
    em_andamento_no_prazo: inProgressMatches.slice(0, max).map(describe),
    proximas_a_iniciar: upcomingMatches.slice(0, max).map(describe),
    observacao: "Atividade atrasada = avanço real abaixo do avanço previsto para hoje na linha de base (mesma regra da tela Controle do Cronograma). As listas trazem só as mais relevantes; os totais consideram todas.",
  };
}
