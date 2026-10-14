function dependencyOffset(edge, durations) {
  const pred = Math.max(1, Number(durations.get(edge.predecessor_id) ?? 1));
  const succ = Math.max(1, Number(durations.get(edge.successor_id) ?? 1));
  const lag = Number(edge.lag_days ?? 0);
  switch (edge.relation_type) {
    case "SS": return lag;
    case "FF": return pred - succ + lag;
    case "SF": return -succ + lag;
    case "FS":
    default: return pred + lag;
  }
}

export function calculateCpm(activities, dependencies) {
  const active = activities.filter((item) => item.record_status !== "inactive");
  const ids = new Set(active.map((item) => item.id));
  const durations = new Map(active.map((item) => [item.id, Math.max(1, Number(item.duration_days ?? 1))]));
  const edges = dependencies.filter((edge) => ids.has(edge.predecessor_id) && ids.has(edge.successor_id));
  const outgoing = new Map(active.map((item) => [item.id, []]));
  const incoming = new Map(active.map((item) => [item.id, []]));
  const indegree = new Map(active.map((item) => [item.id, 0]));

  for (const edge of edges) {
    outgoing.get(edge.predecessor_id).push(edge);
    incoming.get(edge.successor_id).push(edge);
    indegree.set(edge.successor_id, (indegree.get(edge.successor_id) ?? 0) + 1);
  }

  const queue = active.filter((item) => (indegree.get(item.id) ?? 0) === 0).map((item) => item.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const next = edge.successor_id;
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if ((indegree.get(next) ?? 0) === 0) queue.push(next);
    }
  }

  if (order.length !== active.length) {
    return { rows: [], projectDuration: 0, criticalCount: 0, cycleDetected: true };
  }

  const es = new Map(active.map((item) => [item.id, 0]));
  for (const id of order) {
    const current = es.get(id) ?? 0;
    for (const edge of outgoing.get(id) ?? []) {
      const candidate = current + dependencyOffset(edge, durations);
      es.set(edge.successor_id, Math.max(es.get(edge.successor_id) ?? 0, candidate));
    }
  }
  const ef = new Map(active.map((item) => [item.id, (es.get(item.id) ?? 0) + (durations.get(item.id) ?? 1)]));
  const projectDuration = Math.max(0, ...ef.values());

  const ls = new Map(active.map((item) => [item.id, projectDuration - (durations.get(item.id) ?? 1)]));
  for (const id of [...order].reverse()) {
    const nextEdges = outgoing.get(id) ?? [];
    if (!nextEdges.length) {
      ls.set(id, projectDuration - (durations.get(id) ?? 1));
      continue;
    }
    let latest = Number.POSITIVE_INFINITY;
    for (const edge of nextEdges) {
      latest = Math.min(latest, (ls.get(edge.successor_id) ?? 0) - dependencyOffset(edge, durations));
    }
    if (Number.isFinite(latest)) ls.set(id, latest);
  }

  const rows = active.map((activity) => {
    const earlyStart = es.get(activity.id) ?? 0;
    const duration = durations.get(activity.id) ?? 1;
    const lateStart = ls.get(activity.id) ?? earlyStart;
    const totalFloat = Math.max(0, lateStart - earlyStart);
    const successorFloats = (outgoing.get(activity.id) ?? []).map((edge) => {
      const successorStart = es.get(edge.successor_id) ?? 0;
      return successorStart - (earlyStart + dependencyOffset(edge, durations));
    });
    const freeFloat = successorFloats.length ? Math.max(0, Math.min(...successorFloats)) : Math.max(0, projectDuration - (earlyStart + duration));
    return {
      ...activity,
      earlyStart,
      earlyFinish: earlyStart + duration,
      lateStart,
      lateFinish: lateStart + duration,
      totalFloat,
      freeFloat,
      critical: totalFloat === 0,
      predecessorCount: (incoming.get(activity.id) ?? []).length,
      successorCount: (outgoing.get(activity.id) ?? []).length,
    };
  }).sort((a, b) => a.earlyStart - b.earlyStart || String(a.code ?? "").localeCompare(String(b.code ?? "")));

  return {
    rows,
    projectDuration,
    criticalCount: rows.filter((row) => row.critical).length,
    cycleDetected: false,
  };
}