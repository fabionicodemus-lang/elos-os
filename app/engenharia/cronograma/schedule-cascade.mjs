// Elos OS — Cronograma: recálculo em cascata ao arrastar uma atividade no tempo.
//
// Ao mover uma atividade (novo início), as sucessoras são reposicionadas para
// respeitar as amarrações (FS, SS, FF, SF) com defasagem em dias úteis, como no
// prevision. A atividade movida é uma âncora (o usuário a posicionou de
// propósito); as demais nunca recuam antes de onde já estavam (piso), apenas são
// empurradas para frente pelas amarrações. Sem cascata, só a movida muda.

const DAY_MS = 86_400_000;

function parseDate(value) {
  return new Date(String(value).slice(0, 10) + "T12:00:00Z");
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function isWorkday(date, saturday) {
  const day = date.getUTCDay();
  return day !== 0 && (saturday || day !== 6);
}

function normalizeStart(date, saturday) {
  const current = new Date(date);
  while (!isWorkday(current, saturday)) current.setUTCDate(current.getUTCDate() + 1);
  return current;
}

// Move n dias úteis a partir de uma data (para frente se n>0, para trás se n<0).
// n = 0 devolve a própria data normalizada para o próximo dia útil.
function shiftWorkdays(date, n, saturday) {
  const current = normalizeStart(date, saturday);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  while (remaining > 0) {
    current.setUTCDate(current.getUTCDate() + step);
    if (isWorkday(current, saturday)) remaining -= 1;
  }
  return current;
}

// Fim inclusivo de uma atividade que começa em `start` e dura `duration` dias úteis.
export function finishFromStart(start, duration, saturday) {
  return shiftWorkdays(start, Math.max(1, Math.trunc(duration)) - 1, saturday);
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

// Início mínimo exigido a uma sucessora por uma amarração com sua predecessora.
function constraintStart(relation, predStart, predFinish, lag, duration, saturday) {
  const safeLag = Math.trunc(Number(lag) || 0);
  const dur = Math.max(1, Math.trunc(duration));
  switch (relation) {
    case "SS": // início-início: sucessora começa após o início da predecessora + defasagem
      return shiftWorkdays(predStart, safeLag, saturday);
    case "FF": { // término-término: término da sucessora após término da predecessora + defasagem
      const finish = shiftWorkdays(predFinish, safeLag, saturday);
      return shiftWorkdays(finish, -(dur - 1), saturday);
    }
    case "SF": { // início-término: término da sucessora após início da predecessora + defasagem
      const finish = shiftWorkdays(predStart, safeLag, saturday);
      return shiftWorkdays(finish, -(dur - 1), saturday);
    }
    case "FS": // término-início (padrão): sucessora começa no dia útil seguinte ao término + defasagem
    default:
      return shiftWorkdays(predFinish, safeLag + 1, saturday);
  }
}

function topoOrder(nodes, edges) {
  const indegree = new Map(nodes.map((id) => [id, 0]));
  const adjacency = new Map(nodes.map((id) => [id, []]));
  edges.forEach((edge) => {
    if (!indegree.has(edge.predecessor_id) || !indegree.has(edge.successor_id)) return;
    adjacency.get(edge.predecessor_id).push(edge.successor_id);
    indegree.set(edge.successor_id, indegree.get(edge.successor_id) + 1);
  });
  const queue = nodes.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    (adjacency.get(id) ?? []).forEach((next) => {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    });
  }
  // Em caso de ciclo, anexa os restantes numa ordem estável para não perder atividades.
  if (order.length < nodes.length) {
    nodes.forEach((id) => { if (!order.includes(id)) order.push(id); });
  }
  return order;
}

/**
 * Recalcula o cronograma a partir do movimento de uma atividade.
 * activities: [{ id, planned_start, planned_finish, duration_days }]
 * dependencies: [{ predecessor_id, successor_id, relation_type, lag_days }]
 * Retorna { activities: Map-like array com novas datas, changed: [ids] }.
 */
export function rescheduleFromMove({ activities, dependencies = [], movedId, newStart, workOnSaturday = false, cascade = true }) {
  const saturday = Boolean(workOnSaturday);
  const state = new Map();
  activities.forEach((activity) => {
    state.set(activity.id, {
      id: activity.id,
      duration: Math.max(1, Math.trunc(Number(activity.duration_days) || 1)),
      start: parseDate(activity.planned_start),
      finish: parseDate(activity.planned_finish),
      originalStart: String(activity.planned_start).slice(0, 10),
      originalFinish: String(activity.planned_finish).slice(0, 10),
    });
  });

  const moved = state.get(movedId);
  if (!moved) return { activities: [], changed: [] };

  const anchorStart = normalizeStart(parseDate(newStart), saturday);
  moved.start = anchorStart;
  moved.finish = finishFromStart(anchorStart, moved.duration, saturday);

  if (cascade) {
    const nodes = [...state.keys()];
    const incoming = new Map(nodes.map((id) => [id, []]));
    dependencies.forEach((dependency) => {
      if (state.has(dependency.predecessor_id) && state.has(dependency.successor_id)) {
        incoming.get(dependency.successor_id).push(dependency);
      }
    });

    topoOrder(nodes, dependencies).forEach((id) => {
      const node = state.get(id);
      const deps = incoming.get(id) ?? [];
      // O piso é a posição atual (âncora para a movida): sucessoras só avançam.
      let start = node.start;
      deps.forEach((dependency) => {
        const predecessor = state.get(dependency.predecessor_id);
        if (!predecessor) return;
        const required = constraintStart(dependency.relation_type, predecessor.start, predecessor.finish, dependency.lag_days, node.duration, saturday);
        start = maxDate(start, required);
      });
      // A movida permanece exatamente onde o usuário soltou (não é empurrada pelas suas predecessoras).
      if (id !== movedId) {
        node.start = normalizeStart(start, saturday);
        node.finish = finishFromStart(node.start, node.duration, saturday);
      }
    });
  }

  const result = [];
  const changed = [];
  state.forEach((node) => {
    const start = toIso(node.start);
    const finish = toIso(node.finish);
    result.push({ id: node.id, plannedStart: start, plannedFinish: finish, durationDays: node.duration });
    if (start !== node.originalStart || finish !== node.originalFinish) changed.push(node.id);
  });
  return { activities: result, changed };
}
