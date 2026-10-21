// Importação controlada do cronograma standalone do Flow (12/10/2026).
// Funções puras: nenhuma escrita, nenhuma execução de código contido no HTML.
// O cronograma-base/orçamento não deve ser alterado: somente medições e
// reprogramações em 06/10/2026 são preparadas para a camada de execução.

const CUTOFF = "2026-10-06";
const SOURCE = "Flow standalone · histórico 12/10/2026";

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
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("Dados INITIAL_DATA incompletos.");
}

export function extractFlowSnapshot(html) {
  if (typeof html !== "string" || html.length > 8 * 1024 * 1024) throw new Error("HTML inválido ou maior que 8 MB.");
  const marker = /\bconst\s+INITIAL_DATA\s*=\s*\{/g.exec(html);
  if (!marker) throw new Error("Este não é o HTML standalone com INITIAL_DATA.");
  const state = extractJsonObject(html, marker.index);
  if (state?.project?.name !== "Flow Aptos"
      || state?.project?.scheduleRevision?.date !== CUTOFF
      || !Array.isArray(state.tasks)
      || state.tasks.length !== 395) {
    throw new Error("A fonte não corresponde à revisão controlada Flow Aptos de 06/10/2026 (395 atividades).");
  }
  const ids = new Set();
  for (const task of state.tasks) {
    if (!/^T\d{3}$/.test(task.id) || ids.has(task.id) || !validIso(task.start)
        || !validIso(task.baselineStart) || !Array.isArray(task.measurements)
        || !Number.isFinite(Number(task.actualPercent))) {
      throw new Error("Atividade com identificador, datas ou avanço inválidos na fonte.");
    }
    ids.add(task.id);
    for (const m of task.measurements) {
      if (!validIso(m.date) || m.date > CUTOFF || !Number.isFinite(Number(m.percent))
          || Number(m.percent) < 0 || Number(m.percent) > 100) {
        throw new Error("Medição histórica inválida ou posterior a 06/10/2026.");
      }
    }
  }
  return state;
}

export function finishWorkday(start, durationDays) {
  if (!validIso(start)) throw new Error("Data de início inválida.");
  const date = new Date(start + "T12:00:00Z");
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  let remaining = Math.max(1, Number(durationDays) || 1) - 1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function prepareFlowImport(state, activities, existingMeasurements) {
  // Correspondência rigorosa por código Txxx, não por nome/pavimento ou ordem.
  const activityByCode = new Map();
  for (const a of activities) {
    if (activityByCode.has(a.code)) throw new Error("Código duplicado no Elos OS: " + a.code);
    activityByCode.set(a.code, a);
  }
  const missing = state.tasks.filter((t) => !activityByCode.has(t.id)).map((t) => t.id);
  if (missing.length) throw new Error("Importação suspensa: " + missing.length + " atividades sem correspondência: " + missing.slice(0, 15).join(", ") + ".");
  const occupied = new Set(existingMeasurements.filter((m) => !m.voided_at)
    .map((m) => m.activity_id + "|" + m.measurement_date));
  const incoming = [];
  let skipped = 0, historicalCount = 0, reprogrammed = 0;
  for (const task of state.tasks) {
    const activity = activityByCode.get(task.id);
    const active = task.measurements.filter((m) => m.date <= CUTOFF).sort((a, b) => a.date.localeCompare(b.date));
    const replanned = task.start !== task.baselineStart && Number(task.actualPercent) < 100;
    const additions = active.map((m) => ({ date: m.date, percent: Number(m.percent), notes: m.notes || task.actualNotes || "",
      isReplan: false }));
    if (replanned && !additions.some((m) => m.date === CUTOFF)) {
      const last = active.filter((m) => m.date < CUTOFF).at(-1);
      additions.push({ date: CUTOFF, percent: last ? last.percent : Number(task.actualPercent) || 0,
        notes: "Reprogramação de 06/10/2026 (sem nova medição física).", isReplan: true });
    }
    for (const row of additions.sort((a, b) => a.date.localeCompare(b.date))) {
      const key = activity.id + "|" + row.date;
      if (occupied.has(key)) { skipped += 1; continue; } // Nunca altera medições existentes.
      occupied.add(key);
      const start = row.date < CUTOFF ? task.baselineStart : task.start;
      const currentStart = start;
      const currentFinish = finishWorkday(start, task.durationDays);
      incoming.push({
        activity_id: activity.id,
        measurement_date: row.date,
        progress_percent: row.percent,
        actual_quantity: 0, // Não inferir quantitativos e custos que o HTML não contém.
        actual_cost: 0,
        team_count: null,
        current_start: currentStart,
        current_finish: currentFinish,
        actual_start: validIso(task.actualStart) ? task.actualStart : null,
        actual_finish: row.percent === 100 && validIso(task.actualEnd) ? task.actualEnd : null,
        notes: SOURCE + " · " + row.notes,
      });
      if (row.isReplan) reprogrammed += 1;
      else historicalCount += 1;
    }
  }
  incoming.sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || a.activity_id.localeCompare(b.activity_id));
  return { rows: incoming, summary: { matchedActivities: state.tasks.length,
    importedMeasurements: historicalCount, newReplans: reprogrammed,
    existingPreserved: skipped, sourceMeasuredThrough: CUTOFF } };
}
