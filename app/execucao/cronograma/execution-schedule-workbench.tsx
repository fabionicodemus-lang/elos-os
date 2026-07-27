"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import {
  ScheduleProgressDialog,
  type ExecutionScheduleActivity,
  type ExecutionScheduleMeasurement,
} from "./progress-dialog";

export type ExecutionScheduleBaseline = {
  id: string;
  code: string;
  name: string;
  version: string;
  start_date: string;
  status: "draft" | "review" | "approved" | "archived";
};

export type ExecutionScheduleService = {
  id: string;
  code: string;
  description: string;
};

export type ExecutionScheduleLocation = {
  id: string;
  code: string;
  name: string;
};

type ServiceVisualReference = {
  abbreviation: string;
  color: string;
  textColor: "#111827" | "#ffffff";
  codes: string[];
  terms: string[];
};

const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const serviceVisualReferences: ServiceVisualReference[] = [
  { abbreviation: "ALV", color: "#e0e0e0", textColor: "#111827", codes: ["ALV"], terms: ["alvenaria interna", "alvenaria"] },
  { abbreviation: "ELE", color: "#ffd54f", textColor: "#111827", codes: ["ELE"], terms: ["inst eletricas", "instalacoes eletricas", "acabamento eletrico"] },
  { abbreviation: "HID", color: "#4fc3f7", textColor: "#111827", codes: ["HID"], terms: ["hidrossanit", "inst hidraul"] },
  { abbreviation: "CPI", color: "#bcaaa4", textColor: "#111827", codes: ["CPI"], terms: ["contrapiso"] },
  { abbreviation: "RBI", color: "#ffb74d", textColor: "#111827", codes: ["RBI"], terms: ["reboco interno"] },
  { abbreviation: "CER", color: "#d7bc8a", textColor: "#111827", codes: ["CER"], terms: ["revestimento ceramico"] },
  { abbreviation: "FRG", color: "#ce93d8", textColor: "#111827", codes: ["FRG"], terms: ["forro de gesso", "forro gesso"] },
  { abbreviation: "PPO", color: "#595959", textColor: "#ffffff", codes: ["PPO"], terms: ["piso porcelanato", "porcelanato"] },
  { abbreviation: "PII", color: "#aed581", textColor: "#111827", codes: ["PII"], terms: ["pintura interna"] },
  { abbreviation: "ESQ", color: "#80deea", textColor: "#111827", codes: ["ESQ"], terms: ["esquadrias", "esquadria"] },
  { abbreviation: "POR", color: "#f48fb1", textColor: "#111827", codes: ["POR"], terms: ["portas e rodapes", "porta e rodape"] },
  { abbreviation: "UDP", color: "#a5d6a7", textColor: "#111827", codes: ["UDP"], terms: ["ultima demao de pintura", "ultima demao"] },
  { abbreviation: "LMP", color: "#bdbdbd", textColor: "#111827", codes: ["LMP"], terms: ["limpeza final"] },
  { abbreviation: "RBE", color: "#bf360c", textColor: "#ffffff", codes: ["RBE"], terms: ["reboco externo"] },
  { abbreviation: "PIE", color: "#1b5e20", textColor: "#ffffff", codes: ["PIE"], terms: ["pintura externa"] },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function fallbackColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 300 + 20} 52% 43%)`;
}

function serviceVisual(service: ExecutionScheduleService | null | undefined, fallbackValue = "") {
  const code = normalize(service?.code ?? "").replace(/\s/g, "").toUpperCase();
  const description = normalize(`${service?.description ?? ""} ${fallbackValue}`);
  const reference = serviceVisualReferences.find((item) => item.codes.includes(code) || item.terms.some((term) => description.includes(term)));
  const fallbackLabel = normalize(service?.code || service?.description || fallbackValue).replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase() || "SRV";
  return {
    abbreviation: reference?.abbreviation ?? fallbackLabel,
    color: reference?.color ?? fallbackColor(service?.id || fallbackValue || fallbackLabel),
    textColor: reference?.textColor ?? "#ffffff",
  };
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfWeek(value: Date) {
  const result = new Date(value);
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function daysBetween(start: Date, finish: Date) {
  return Math.round((finish.getTime() - start.getTime()) / 86_400_000);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateBR(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(typeof value === "string" ? parseDate(value) : value);
}

function numberBR(value: number | string | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function plannedProgress(activity: ExecutionScheduleActivity, selectedDate: string) {
  const date = parseDate(selectedDate);
  const start = parseDate(activity.planned_start);
  const finish = parseDate(activity.planned_finish);
  if (date < start) return 0;
  if (date >= finish) return 100;
  const total = Math.max(1, daysBetween(start, finish) + 1);
  const elapsed = Math.max(0, daysBetween(start, date) + 1);
  return Math.min(100, elapsed / total * 100);
}

function buildTimeline(
  activities: ExecutionScheduleActivity[],
  selectedMeasurements: Map<string, ExecutionScheduleMeasurement>,
  baseline: ExecutionScheduleBaseline | null,
) {
  const defaultStart = baseline?.start_date ? parseDate(baseline.start_date) : new Date();
  let minimum = defaultStart;
  let maximum = addDays(defaultStart, 84);
  for (const activity of activities) {
    const measurement = selectedMeasurements.get(activity.id);
    for (const value of [activity.planned_start, measurement?.current_start].filter(Boolean) as string[]) {
      const date = parseDate(value);
      if (date < minimum) minimum = date;
    }
    for (const value of [activity.planned_finish, measurement?.current_finish].filter(Boolean) as string[]) {
      const date = parseDate(value);
      if (date > maximum) maximum = date;
    }
  }
  const start = startOfWeek(minimum);
  const finish = addDays(startOfWeek(addDays(maximum, 28)), 6);
  const weeks: Date[] = [];
  for (let current = new Date(start); current <= finish; current = addDays(current, 7)) weeks.push(current);
  return { start, finish, weeks };
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function ExecutionScheduleWorkbench({
  projectName,
  baselines,
  selectedBaseline,
  activities,
  measurements,
  services,
  locations,
  selectedDate,
  canManage,
}: {
  projectName: string;
  baselines: ExecutionScheduleBaseline[];
  selectedBaseline: ExecutionScheduleBaseline | null;
  activities: ExecutionScheduleActivity[];
  measurements: ExecutionScheduleMeasurement[];
  services: ExecutionScheduleService[];
  locations: ExecutionScheduleLocation[];
  selectedDate: string;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"gantt" | "history">("gantt");
  const [query, setQuery] = useState("");
  const [groupMode, setGroupMode] = useState<"location" | "service">("location");
  const [serviceFilter, setServiceFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [weekWidth, setWeekWidth] = useState(34);

  const activeActivities = useMemo(() => activities.filter((activity) => activity.record_status === "active"), [activities]);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const selectedMeasurements = useMemo(() => {
    const map = new Map<string, ExecutionScheduleMeasurement>();
    measurements
      .filter((measurement) => measurement.measurement_date <= selectedDate)
      .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || a.created_at.localeCompare(b.created_at))
      .forEach((measurement) => map.set(measurement.activity_id, measurement));
    return map;
  }, [measurements, selectedDate]);

  const timeline = useMemo(() => buildTimeline(activeActivities, selectedMeasurements, selectedBaseline), [activeActivities, selectedMeasurements, selectedBaseline]);
  const timelineWidth = Math.max(952, timeline.weeks.length * weekWidth);
  const totalDays = Math.max(1, daysBetween(timeline.start, timeline.finish));
  const measurementX = daysBetween(timeline.start, parseDate(selectedDate)) / totalDays * timelineWidth;

  const filtered = useMemo(() => activeActivities.filter((activity) => {
    if (serviceFilter && activity.service_id !== serviceFilter) return false;
    if (!query.trim()) return true;
    const haystack = [activity.code, activity.name, serviceMap.get(activity.service_id ?? "")?.description ?? "", locationMap.get(activity.location_id ?? "")?.name ?? ""].join(" ").toLocaleLowerCase("pt-BR");
    return haystack.includes(query.trim().toLocaleLowerCase("pt-BR"));
  }), [activeActivities, serviceFilter, query, serviceMap, locationMap]);

  const groupEntries = useMemo(() => {
    if (groupMode === "service") {
      return services.map((service) => ({ key: service.id, label: `${serviceVisual(service).abbreviation} · ${service.description}`, items: filtered.filter((activity) => activity.service_id === service.id) })).filter((entry) => entry.items.length);
    }
    const entries = locations.map((location) => ({ key: location.id, label: `${location.code} · ${location.name}`, items: filtered.filter((activity) => activity.location_id === location.id) })).filter((entry) => entry.items.length);
    const general = filtered.filter((activity) => !activity.location_id);
    if (general.length) entries.unshift({ key: "general", label: "GER · Geral da obra", items: general });
    return entries;
  }, [groupMode, services, locations, filtered]);

  const weightsUseCost = activeActivities.some((activity) => Number(activity.planned_cost) > 0);
  const activityWeight = (activity: ExecutionScheduleActivity) => weightsUseCost ? Math.max(0, Number(activity.planned_cost)) : Math.max(1, Number(activity.duration_days));
  const totalWeight = activeActivities.reduce((sum, activity) => sum + activityWeight(activity), 0) || 1;
  const plannedTotal = activeActivities.reduce((sum, activity) => sum + plannedProgress(activity, selectedDate) * activityWeight(activity), 0) / totalWeight;
  const actualTotal = activeActivities.reduce((sum, activity) => sum + Number(selectedMeasurements.get(activity.id)?.progress_percent ?? 0) * activityWeight(activity), 0) / totalWeight;
  const delayedCount = activeActivities.filter((activity) => Number(selectedMeasurements.get(activity.id)?.progress_percent ?? 0) + 0.5 < plannedProgress(activity, selectedDate)).length;
  const forecastFinish = activeActivities.reduce((latest, activity) => {
    const finish = selectedMeasurements.get(activity.id)?.current_finish ?? activity.planned_finish;
    return !latest || finish > latest ? finish : latest;
  }, "");

  const barStyle = (startValue: string, finishValue: string): CSSProperties => {
    const left = Math.max(0, daysBetween(timeline.start, parseDate(startValue)) / totalDays * timelineWidth);
    const width = Math.max(7, (daysBetween(parseDate(startValue), parseDate(finishValue)) + 1) / totalDays * timelineWidth);
    return { left, width };
  };

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function changeQueryParam(key: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    window.location.href = `${window.location.pathname}?${params.toString()}`;
  }

  function exportProgress() {
    const rows = [["Atividade", "Local", "Serviço", "Início base", "Fim base", "Início atual", "Fim atual", "Previsto %", "Realizado %", "Quantidade realizada", "Data da medição"]];
    for (const activity of filtered) {
      const measurement = selectedMeasurements.get(activity.id);
      rows.push([
        `${activity.code} · ${activity.name}`,
        locationMap.get(activity.location_id ?? "")?.name ?? "Geral da obra",
        serviceMap.get(activity.service_id ?? "")?.description ?? "Sem serviço",
        activity.planned_start,
        activity.planned_finish,
        measurement?.current_start ?? activity.planned_start,
        measurement?.current_finish ?? activity.planned_finish,
        numberBR(plannedProgress(activity, selectedDate), 2),
        numberBR(measurement?.progress_percent ?? 0, 2),
        numberBR(measurement?.actual_quantity ?? 0, 4),
        measurement?.measurement_date ?? "",
      ]);
    }
    downloadCsv(`avanco-cronograma-${selectedDate}.csv`, rows);
  }

  return (
    <section className="prevision-workbench execution-schedule-workbench">
      <div className="prevision-modebar execution-modebar">
        <div><span>Execução · Controle da obra</span><div><strong>Medições, controle e reprogramações</strong><small>A linha cinza é a base aprovada; a barra colorida é o cronograma atual e a faixa escura mostra o avanço realizado.</small></div></div>
        <div className={`prevision-baseline-state ${selectedBaseline?.status ?? "empty"}`}><i />{selectedBaseline?.status === "approved" ? "Linha de base ativa" : "Linha de base não aprovada"}</div>
      </div>

      <header className="prevision-appbar">
        <div className="prevision-brand"><b>E</b><div><strong>Controle do Cronograma</strong><small>{projectName} · previsto, realizado e desvios</small></div></div>
        <nav><button type="button" className={tab === "gantt" ? "active" : ""} onClick={() => setTab("gantt")}>Cronograma</button><button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Histórico de medições</button></nav>
        <div className="prevision-top-actions"><button type="button" onClick={exportProgress}>Exportar avanço</button><Link href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Abrir planejamento</Link></div>
      </header>

      <section className="execution-schedule-kpis">
        <article><span>Avanço previsto</span><strong>{numberBR(plannedTotal, 1)}%</strong><small>até {dateBR(selectedDate)}</small></article>
        <article><span>Avanço realizado</span><strong>{numberBR(actualTotal, 1)}%</strong><small>{actualTotal - plannedTotal >= 0 ? "+" : ""}{numberBR(actualTotal - plannedTotal, 1)} p.p. de desvio</small></article>
        <article><span>Atividades atrasadas</span><strong>{delayedCount}</strong><small>abaixo do avanço previsto</small></article>
        <article><span>Conclusão atual</span><strong>{dateBR(forecastFinish)}</strong><small>última data reprogramada</small></article>
      </section>

      {selectedBaseline?.status !== "approved" ? <div className="auth-message error workspace-message">A execução só aceita medições em uma linha de base aprovada. Abra o planejamento e aprove a revisão oficial.</div> : null}

      {tab === "gantt" ? (
        <div className="prevision-gantt-view">
          <div className="prevision-toolbar execution-schedule-toolbar">
            <label><span>Data de controle</span><input type="date" value={selectedDate} onChange={(event) => changeQueryParam("date", event.target.value)} /></label>
            <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pavimento, serviço ou código" /></label>
            <label><span>Agrupar</span><select value={groupMode} onChange={(event) => setGroupMode(event.target.value as "location" | "service")}><option value="location">Por pavimento/local</option><option value="service">Por serviço</option></select></label>
            <label><span>Serviço</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">Todos</option>{services.map((service) => <option key={service.id} value={service.id}>{serviceVisual(service).abbreviation} · {service.description}</option>)}</select></label>
            <label><span>Linha de base</span><select value={selectedBaseline?.id ?? ""} onChange={(event) => changeQueryParam("baseline", event.target.value)}>{baselines.filter((baseline) => baseline.status !== "archived").map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version}{baseline.status === "approved" ? " · ativa" : ""}</option>)}</select></label>
            <label><span>Zoom</span><input type="range" min="24" max="52" step="2" value={weekWidth} onChange={(event) => setWeekWidth(Number(event.target.value))} /></label>
            <div className="prevision-toolbar-spacer" />
            <div className="prevision-kpi-mini"><span>Atividades</span><strong>{filtered.length}</strong></div>
            <div className="prevision-kpi-mini"><span>Medidas</span><strong>{filtered.filter((activity) => selectedMeasurements.has(activity.id)).length}</strong></div>
          </div>

          <div className="prevision-gantt-shell">
            <div className="prevision-gantt-content execution-gantt-content" style={{ "--meta": "720px", "--rowh": "42px", "--week": `${weekWidth}px`, width: 720 + timelineWidth } as CSSProperties}>
              <div className="prevision-gantt-head">
                <div className="execution-meta-head"><div>ID</div><div>Local</div><div>Serviço</div><div>Base</div><div>Atual</div><div>Avanço</div><div>Ação</div></div>
                <div className="prevision-timeline-head" style={{ width: timelineWidth }}>
                  <div className="prevision-month-band">{timeline.weeks.map((week, index) => {
                    const previous = timeline.weeks[index - 1];
                    if (previous && previous.getUTCMonth() === week.getUTCMonth()) return null;
                    let span = 1;
                    while (timeline.weeks[index + span] && timeline.weeks[index + span].getUTCMonth() === week.getUTCMonth()) span += 1;
                    return <div key={isoDate(week)} className="prevision-month-label" style={{ left: index * weekWidth, width: span * weekWidth }}>{monthNames[week.getUTCMonth()]} {week.getUTCFullYear()}</div>;
                  })}</div>
                  <div className="prevision-week-band">{timeline.weeks.map((week) => <div key={isoDate(week)} className="prevision-week-cell" style={{ width: weekWidth }}>{dateBR(week).slice(0, 5)}</div>)}</div>
                  {measurementX >= 0 && measurementX <= timelineWidth ? <div className="execution-control-line" style={{ left: measurementX }}><span>CONTROLE</span></div> : null}
                </div>
              </div>

              {groupEntries.map((entry) => {
                const isExpanded = expanded.has(entry.key);
                return <div key={entry.key}>
                  <div className="prevision-location-summary-row">
                    <button type="button" className="prevision-location-summary-meta" onClick={() => toggleExpanded(entry.key)}><b>{isExpanded ? "▾" : "▸"}</b><span>{entry.label}</span><i>{entry.items.length}</i></button>
                    <div className="prevision-location-summary-timeline" style={{ width: timelineWidth }}>{entry.items.map((activity) => {
                      const measurement = selectedMeasurements.get(activity.id);
                      const currentStart = measurement?.current_start ?? activity.planned_start;
                      const currentFinish = measurement?.current_finish ?? activity.planned_finish;
                      const visual = serviceVisual(serviceMap.get(activity.service_id ?? ""), `${activity.code} ${activity.name}`);
                      return <div key={activity.id} className="execution-summary-current" style={{ ...barStyle(currentStart, currentFinish), background: visual.color }} title={`${activity.name} · ${numberBR(measurement?.progress_percent ?? 0)}%`}><i style={{ width: `${Math.min(100, Number(measurement?.progress_percent ?? 0))}%` }} /></div>;
                    })}{measurementX >= 0 && measurementX <= timelineWidth ? <div className="execution-control-line" style={{ left: measurementX }} /> : null}</div>
                  </div>
                  {isExpanded ? entry.items.map((activity) => {
                    const measurement = selectedMeasurements.get(activity.id) ?? null;
                    const currentStart = measurement?.current_start ?? activity.planned_start;
                    const currentFinish = measurement?.current_finish ?? activity.planned_finish;
                    const planned = plannedProgress(activity, selectedDate);
                    const actual = Number(measurement?.progress_percent ?? 0);
                    const variance = actual - planned;
                    const visual = serviceVisual(serviceMap.get(activity.service_id ?? ""), `${activity.code} ${activity.name}`);
                    const location = locationMap.get(activity.location_id ?? "");
                    return <div className="prevision-gantt-row execution-gantt-row" key={activity.id}>
                      <div className="execution-task-meta">
                        <div>{activity.code}</div>
                        <div title={location?.name}>{location?.name ?? "Geral da obra"}</div>
                        <div title={activity.name}><strong>{activity.name}</strong><small>{visual.abbreviation}</small></div>
                        <div>{dateBR(activity.planned_start)}<small>{dateBR(activity.planned_finish)}</small></div>
                        <div>{dateBR(currentStart)}<small>{dateBR(currentFinish)}</small></div>
                        <div><strong className={variance < -0.5 ? "negative" : variance > 0.5 ? "positive" : "neutral"}>{numberBR(actual, 1)}%</strong><small>prev. {numberBR(planned, 1)}%</small></div>
                        <div>{canManage && selectedBaseline?.status === "approved" ? <ScheduleProgressDialog baselineId={selectedBaseline.id} activity={activity} measurement={measurement} selectedDate={selectedDate} /> : "—"}</div>
                      </div>
                      <div className="prevision-timeline-row execution-timeline-row" style={{ width: timelineWidth }}>
                        <div className="execution-baseline-bar" style={barStyle(activity.planned_start, activity.planned_finish)} />
                        <div className="execution-current-bar" style={{ ...barStyle(currentStart, currentFinish), background: visual.color, color: visual.textColor }}><i style={{ width: `${Math.min(100, actual)}%` }} /><span>{visual.abbreviation} · {numberBR(actual, 0)}%</span></div>
                        {measurementX >= 0 && measurementX <= timelineWidth ? <div className="execution-control-line" style={{ left: measurementX }} /> : null}
                      </div>
                    </div>;
                  }) : null}
                </div>;
              })}
              {groupEntries.length === 0 ? <div className="prevision-empty">Nenhuma atividade encontrada na linha de base selecionada.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="execution-history-card">
          <header><div><h2>Histórico de medições</h2><p>Registro cronológico e auditável de todas as atualizações do avanço.</p></div><strong>{measurements.length} registro(s)</strong></header>
          <div className="execution-history-wrap"><table><thead><tr><th>Data</th><th>Atividade</th><th>Local</th><th>Avanço</th><th>Quantidade</th><th>Período atual</th><th>Equipes</th><th>Custo realizado</th><th>Observações</th></tr></thead><tbody>{[...measurements].sort((a, b) => b.measurement_date.localeCompare(a.measurement_date) || b.created_at.localeCompare(a.created_at)).map((measurement) => {
            const activity = activeActivities.find((item) => item.id === measurement.activity_id);
            return <tr key={measurement.id}><td>{dateBR(measurement.measurement_date)}</td><td><strong>{activity?.code ?? "—"}</strong><span>{activity?.name ?? "Atividade removida"}</span></td><td>{locationMap.get(activity?.location_id ?? "")?.name ?? "Geral da obra"}</td><td><b>{numberBR(measurement.progress_percent, 1)}%</b></td><td>{numberBR(measurement.actual_quantity, 4)} {activity?.unit_snapshot ?? ""}</td><td>{dateBR(measurement.current_start)} a {dateBR(measurement.current_finish)}</td><td>{numberBR(measurement.team_count, 2)}</td><td>{money(measurement.actual_cost)}</td><td>{measurement.notes || "—"}</td></tr>;
          })}{measurements.length === 0 ? <tr><td colSpan={9} className="execution-history-empty">Nenhuma medição registrada.</td></tr> : null}</tbody></table></div>
        </div>
      ) : null}
    </section>
  );
}
