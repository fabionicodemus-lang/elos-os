// Conciliação auditável do cronograma standalone Flow de 12/10/2026.
// A linha de base continua imutável. 395 atividades originais ocupam as
// posições 1..395; lançamentos de mão de obra e custos são adicionais.
const CUTOFF = "2026-10-06";
const FIRST_NEW_MEASUREMENT = "2026-09-01";
const SOURCE = "Flow standalone · revisão 12/10/2026";

function validIso(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(value + "T12:00:00Z").getTime());
}

function extractJsonObject(html, startIndex) {
  let depth = 0, quoted = false, escaped = false;
  const start = html.indexOf("{", startIndex);
  if (start < 0) throw new Error("Bloco INITIAL_DATA não encontrado.");
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("Dados INITIAL_DATA incompletos.");
}

export function extractFlowSnapshot(html) {
  if (typeof html !== "string" || html.length > 8 * 1024 * 1024)
    throw new Error("HTML inválido ou maior que 8 MB.");
  const marker = /\bconst\s+INITIAL_DATA\s*=\s*\{/g.exec(html);
  if (!marker) throw new Error("Este não é o HTML standalone com INITIAL_DATA.");
  const state = extractJsonObject(html, marker.index);
  if (state?.project?.name !== "Flow Aptos"
      || state?.project?.scheduleRevision?.date !== CUTOFF
      || !Array.isArray(state.tasks) || state.tasks.length !== 395)
    throw new Error("A fonte não corresponde à revisão Flow de 06/10/2026 (395 atividades).");
  const ids = new Set();
  for (const task of state.tasks) {
    if (!/^T\d{3}$/.test(task.id) || ids.has(task.id)
        || !validIso(task.start) || !validIso(task.baselineStart)
        || !Array.isArray(task.measurements) || !Number.isFinite(Number(task.actualPercent))
        || Number(task.actualPercent) < 0 || Number(task.actualPercent) > 100)
      throw new Error("Identificador, data ou percentual inválido na fonte.");
    ids.add(task.id);
    for (const m of task.measurements) {
      if (!validIso(m.date) || m.date > CUTOFF
          || !Number.isFinite(Number(m.percent)) || m.percent < 0 || m.percent > 100)
        throw new Error("Medição histórica inválida ou posterior a 06/10/2026.");
    }
  }
  return state;
}

export function finishWorkday(start, durationDays, options = {}) {
  if (!validIso(start)) throw new Error("Data de início inválida.");
  if (options.milestone || Number(durationDays) === 0) return start;
  const d = new Date(start + "T12:00:00Z");
  const holidays = new Set((options.holidays ?? []).map(h => h.date));
  const recesses = options.recesses ?? [];
  const works = date => {
    const iso = date.toISOString().slice(0, 10), dow = date.getUTCDay();
    if (dow === 0) return false;
    if (holidays.has(iso) && !options.worksHolidays && !options.globalHolidays) return false;
    if (recesses.some(r => r.start <= iso && r.end >= iso)
        && !options.worksRecesses && !options.globalRecesses) return false;
    return dow !== 6 || !!(options.worksSaturday || options.globalSaturday);
  };
  let guard = 0;
  while (!works(d) && guard++ < 370) d.setUTCDate(d.getUTCDate() + 1);
  let remaining = Math.max(1, Number(durationDays) || 1) - 1;
  while (remaining > 0 && guard++ < 3000) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (works(d)) remaining--;
  }
  if (guard >= 3000) throw new Error("Calendário de trabalho inválido.");
  return d.toISOString().slice(0, 10);
}

export function prepareFlowImport(state, activities, existingMeasurements) {
  // No banco real, os códigos são "RBI-T", "ELE_INST-5" etc.
  // As tarefas originais estão na ordem do HTML em sort_order 1..395.
  // Ignorar SOMENTE as atividades adicionais MO-* e os custos >395.
  const originals = activities.filter(a => Number.isInteger(a.sort_order)
    && a.sort_order >= 1 && a.sort_order <= 395 && !String(a.code).startsWith("MO-"));
  const byPosition = new Map();
  for (const a of originals) {
    if (byPosition.has(a.sort_order))
      throw new Error("Duas atividades originais na posição " + a.sort_order + ".");
    byPosition.set(a.sort_order, a);
  }
  if (originals.length !== 395 || byPosition.size !== 395)
    throw new Error("Importação suspensa: faltam atividades originais do cronograma Flow (esperadas 395).");
  const ordered = state.tasks.map((t, i) => {
    const a = byPosition.get(i + 1);
    if (!a || a.planned_start !== t.baselineStart
        || !String(a.code).startsWith(t.code))
      throw new Error("Atividade divergente na posição " + (i + 1)
        + " (" + t.id + "): baseline ou serviço diferente. Nada foi alterado.");
    return a;
  });

  const occupied = new Set(existingMeasurements.map(m => m.activity_id + "|" + m.measurement_date));
  const byActivity = new Map();
  for (const m of existingMeasurements) {
    if (m.voided_at) continue;
    if (!byActivity.has(m.activity_id)) byActivity.set(m.activity_id, []);
    byActivity.get(m.activity_id).push(m);
  }
  for (const rows of byActivity.values())
    rows.sort((a, b) => a.measurement_date.localeCompare(b.measurement_date));

  const rows = [];
  let skipped = 0, historicalCount = 0, reprogrammed = 0;
  for (let i = 0; i < state.tasks.length; i++) {
    const task = state.tasks[i], activity = ordered[i];
    const prior = byActivity.get(activity.id) ?? [];
    // Agosto já possui medições no Elos e fica intocado.
    const history = task.measurements
      .filter(m => m.date >= FIRST_NEW_MEASUREMENT && m.date <= CUTOFF)
      .sort((a, b) => a.date.localeCompare(b.date));
    const replanned = task.start !== task.baselineStart && task.actualPercent < 100;
    const additions = history.map(m => ({ date: m.date, percent: Number(m.percent),
      notes: m.notes || task.actualNotes || "", isReplan: false }));
    if (replanned && !additions.some(m => m.date === CUTOFF)) {
      const latestHistory = [...task.measurements].filter(m => m.date <= CUTOFF)
        .sort((a,b) => a.date.localeCompare(b.date)).at(-1);
      additions.push({ date: CUTOFF, percent: Number(latestHistory?.percent ?? task.actualPercent),
        notes: "Reprogramação 06/10/2026 — sem nova medição física.", isReplan: true });
    }
    for (const row of additions.sort((a,b) => a.date.localeCompare(b.date))) {
      const key = activity.id + "|" + row.date;
      if (occupied.has(key)) { skipped++; continue; }
      const previous = prior.filter(m => m.measurement_date <= row.date).at(-1);
      if (previous && Number(previous.progress_percent) > row.percent)
        throw new Error("Avanço retrocederia na atividade " + activity.code + " em "
          + row.date + " (" + previous.progress_percent + "% → " + row.percent + "%). Nada foi alterado.");
      const start = row.date < CUTOFF ? task.baselineStart : task.start;
      const finish = start === task.baselineStart ? activity.planned_finish
        : finishWorkday(start, task.durationDays, {
          ...task, ...(state.settings ?? {}), holidays: state.holidays, recesses: state.recesses
        });
      const quantity = Number(activity.quantity_snapshot ?? 0);
      const actualStart = validIso(task.actualStart) && task.actualStart <= row.date
        ? task.actualStart : (previous?.actual_start ?? (row.percent > 0 ? row.date : null));
      const actualFinish = row.percent === 100
        ? (validIso(task.actualEnd) && task.actualEnd <= row.date
          ? task.actualEnd : (previous?.actual_finish ?? row.date)) : null;
      const incoming = {
        activity_id: activity.id, measurement_date: row.date,
        progress_percent: row.percent,
        // Mesma regra de equivalência usada no controle de avanço físico:
        // quantidade acumulada teórica = quantitativo-base × % da medição.
        actual_quantity: Number.isFinite(quantity) ? Math.round(quantity * row.percent * 10000) / 1000000 : 0,
        actual_cost: Number(previous?.actual_cost ?? 0),
        team_count: previous?.team_count ?? null,
        current_start: start, current_finish: finish,
        actual_start: actualStart, actual_finish: actualFinish,
        notes: SOURCE + " · " + row.notes,
      };
      rows.push(incoming);
      occupied.add(key);
      prior.push({ ...incoming });
      prior.sort((a,b) => a.measurement_date.localeCompare(b.measurement_date));
      if (row.isReplan) reprogrammed++; else historicalCount++;
    }
  }
  rows.sort((a,b) => a.measurement_date.localeCompare(b.measurement_date)
    || a.activity_id.localeCompare(b.activity_id));
  return { rows, summary: {
    matchedActivities: state.tasks.length,
    importedMeasurements: historicalCount, newReplans: reprogrammed,
    existingPreserved: skipped, sourceMeasuredThrough: CUTOFF
  }};
}
