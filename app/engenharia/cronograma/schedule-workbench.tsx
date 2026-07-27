"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import {
  generateScheduleFromTakeoffs,
  updateScheduleBaselineStatus,
} from "./actions";
import {
  ScheduleActivityCreateDialog,
  ScheduleActivityEditDialog,
  ScheduleBaselineCreateDialog,
  type ScheduleActivityData,
  type ScheduleBudgetOption,
  type ScheduleDependencyData,
  type ScheduleLocationOption,
  type ScheduleServiceOption,
} from "./schedule-dialogs";

export type ScheduleWorkbenchBaseline = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  version: string;
  start_date: string;
  work_on_saturday: boolean;
  status: "draft" | "review" | "approved" | "archived";
  notes: string | null;
  updated_at: string;
};

export type ScheduleWorkbenchActivity = ScheduleActivityData & { baseline_id: string };
export type ScheduleWorkbenchDependency = ScheduleDependencyData & { baseline_id: string };

type ServiceVisualReference = {
  abbreviation: string;
  color: string;
  textColor: "#111827" | "#ffffff";
  codes: string[];
  terms: string[];
};

const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const baselineStatusLabels: Record<ScheduleWorkbenchBaseline["status"], string> = {
  draft: "Planejamento aberto",
  review: "Em revisão",
  approved: "Linha de base ativa",
  archived: "Arquivada",
};

const serviceVisualReferences: ServiceVisualReference[] = [
  { abbreviation: "ALV", color: "#e0e0e0", textColor: "#111827", codes: ["ALV"], terms: ["alvenaria interna", "alvenaria"] },
  { abbreviation: "ELE", color: "#ffd54f", textColor: "#111827", codes: ["ELE"], terms: ["inst eletricas", "instalacoes eletricas", "instalacao eletrica", "acabamento eletrico", "acabamento eletrica"] },
  { abbreviation: "HID", color: "#4fc3f7", textColor: "#111827", codes: ["HID"], terms: ["hidrossanit", "inst hidraul", "instalacoes hidraul"] },
  { abbreviation: "CPI", color: "#bcaaa4", textColor: "#111827", codes: ["CPI"], terms: ["contrapiso"] },
  { abbreviation: "RBI", color: "#ffb74d", textColor: "#111827", codes: ["RBI"], terms: ["reboco interno"] },
  { abbreviation: "CER", color: "#d7bc8a", textColor: "#111827", codes: ["CER"], terms: ["revestimento ceramico"] },
  { abbreviation: "FRG", color: "#ce93d8", textColor: "#111827", codes: ["FRG"], terms: ["forro de gesso", "forro gesso"] },
  { abbreviation: "PPO", color: "#595959", textColor: "#ffffff", codes: ["PPO"], terms: ["piso porcelanato", "porcelanato"] },
  { abbreviation: "PII", color: "#aed581", textColor: "#111827", codes: ["PII"], terms: ["pintura interna"] },
  { abbreviation: "ESQ", color: "#80deea", textColor: "#111827", codes: ["ESQ"], terms: ["esquadrias", "esquadria"] },
  { abbreviation: "POR", color: "#f48fb1", textColor: "#111827", codes: ["POR"], terms: ["portas e rodapes", "portas rodapes", "porta e rodape"] },
  { abbreviation: "UDP", color: "#a5d6a7", textColor: "#111827", codes: ["UDP"], terms: ["ultima demao de pintura", "ultima demao", "demao final"] },
  { abbreviation: "LMP", color: "#bdbdbd", textColor: "#111827", codes: ["LMP"], terms: ["limpeza final"] },
  { abbreviation: "RBE", color: "#bf360c", textColor: "#ffffff", codes: ["RBE"], terms: ["reboco externo"] },
  { abbreviation: "PIE", color: "#1b5e20", textColor: "#ffffff", codes: ["PIE"], terms: ["pintura externa"] },
];

function normalizeServiceText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fallbackServiceColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 300 + 20} 52% 43%)`;
}

function serviceVisual(service: ScheduleServiceOption | null | undefined, fallbackValue = "") {
  const code = normalizeServiceText(service?.code ?? "").replace(/\s/g, "").toUpperCase();
  const description = normalizeServiceText(`${service?.description ?? ""} ${fallbackValue}`);
  const reference = serviceVisualReferences.find((item) => item.codes.includes(code) || item.terms.some((term) => description.includes(term)));
  const fallbackLabel = normalizeServiceText(service?.code || service?.description || fallbackValue)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "SRV";

  return {
    abbreviation: reference?.abbreviation ?? fallbackLabel,
    color: reference?.color ?? fallbackServiceColor(service?.id || fallbackValue || fallbackLabel),
    textColor: reference?.textColor ?? "#ffffff",
  };
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
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

function dateBR(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function buildTimeline(activities: ScheduleWorkbenchActivity[], baseline: ScheduleWorkbenchBaseline | null) {
  const active = activities.filter((activity) => activity.record_status === "active");
  const defaultStart = baseline?.start_date ? parseDate(baseline.start_date) : new Date();
  const minDate = active.reduce((minimum, activity) => {
    const current = parseDate(activity.planned_start);
    return current < minimum ? current : minimum;
  }, defaultStart);
  const maxDate = active.reduce((maximum, activity) => {
    const current = parseDate(activity.planned_finish);
    return current > maximum ? current : maximum;
  }, addDays(defaultStart, 84));
  const start = startOfWeek(minDate);
  const finish = addDays(startOfWeek(maxDate), 6);
  const weeks: Date[] = [];
  for (let current = new Date(start); current <= finish; current = addDays(current, 7)) weeks.push(current);
  return { start, finish, weeks };
}

function TeamView({ activities, services, timeline }: {
  activities: ScheduleWorkbenchActivity[];
  services: ScheduleServiceOption[];
  timeline: ReturnType<typeof buildTimeline>;
}) {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const active = activities.filter((activity) => activity.record_status === "active" && activity.service_id);
  const rows = [...new Set(active.map((activity) => activity.service_id!))].map((serviceId) => {
    const tasks = active.filter((activity) => activity.service_id === serviceId);
    const weekly = timeline.weeks.map((week) => {
      let maximum = 0;
      for (let offset = 0; offset < 7; offset += 1) {
        const day = addDays(week, offset);
        const simultaneous = tasks.filter((task) => parseDate(task.planned_start) <= day && parseDate(task.planned_finish) >= day)
          .reduce((sum, task) => sum + Number(task.team_count || 1), 0);
        maximum = Math.max(maximum, simultaneous);
      }
      return maximum;
    });
    return { serviceId, service: serviceMap.get(serviceId), weekly, peak: Math.max(0, ...weekly) };
  }).sort((a, b) => (b.peak - a.peak) || (a.service?.code ?? "").localeCompare(b.service?.code ?? ""));
  const busyTotals = timeline.weeks.map((_, index) => rows.reduce((sum, row) => sum + row.weekly[index], 0));
  const busyPeak = Math.max(0, ...busyTotals);
  const busyIndex = Math.max(0, busyTotals.indexOf(busyPeak));

  return (
    <div className="prevision-panel-page">
      <div className="prevision-card prevision-span-12">
        <div className="prevision-big-kpis">
          <div><span>Serviços planejados</span><strong>{rows.length}</strong></div>
          <div><span>Maior pico de um serviço</span><strong>{Math.max(0, ...rows.map((row) => row.peak))} equipes</strong></div>
          <div><span>Semana mais carregada</span><strong>{timeline.weeks[busyIndex] ? dateBR(timeline.weeks[busyIndex]) : "—"}</strong></div>
          <div><span>Total de equipes no pico</span><strong>{busyPeak}</strong></div>
        </div>
      </div>
      <div className="prevision-card prevision-span-12">
        <h2>Dimensionamento semanal de equipes</h2>
        <div className="prevision-teams-wrap">
          <table>
            <thead><tr><th>Serviço</th>{timeline.weeks.map((week) => <th key={isoDate(week)}>{dateBR(week)}</th>)}</tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.serviceId}><td><strong>{serviceVisual(row.service).abbreviation}</strong><span>{row.service?.description ?? "Sem serviço"}</span></td>
                {row.weekly.map((value, index) => <td key={`${row.serviceId}-${index}`} className={value > 0 ? "active" : ""}>{value || "—"}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FinanceView({ activities }: { activities: ScheduleWorkbenchActivity[] }) {
  const monthly = new Map<string, number>();
  const valued = activities.filter((activity) => activity.record_status === "active" && Number(activity.planned_cost) > 0);
  valued.forEach((activity) => {
    const start = parseDate(activity.planned_start);
    const finish = parseDate(activity.planned_finish);
    const days = Math.max(1, daysBetween(start, finish) + 1);
    const daily = Number(activity.planned_cost) / days;
    for (let day = new Date(start); day <= finish; day = addDays(day, 1)) {
      const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}`;
      monthly.set(key, (monthly.get(key) ?? 0) + daily);
    }
  });
  const rows = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  const peak = Math.max(0, ...rows.map(([, value]) => value));
  let accumulated = 0;

  return (
    <div className="prevision-panel-page">
      <div className="prevision-card prevision-span-12">
        <div className="prevision-big-kpis">
          <div><span>Valor programado</span><strong>{money(total)}</strong></div>
          <div><span>Maior desembolso mensal</span><strong>{money(peak)}</strong></div>
          <div><span>Mês de pico</span><strong>{rows.find(([, value]) => value === peak)?.[0] ?? "—"}</strong></div>
          <div><span>Atividades com valor</span><strong>{valued.length}</strong></div>
        </div>
      </div>
      <div className="prevision-card prevision-span-12">
        <h2>Cronograma financeiro mensal</h2>
        {rows.length === 0 ? <div className="prevision-empty">As atividades ainda não possuem custo planejado distribuído.</div> : (
          <div className="prevision-finance-layout">
            <div className="prevision-bar-chart">{rows.map(([key, value]) => (
              <div key={key}><span style={{ height: `${peak ? Math.max(3, value / peak * 100) : 0}%` }} /><small>{key.slice(5)}/{key.slice(2, 4)}</small></div>
            ))}</div>
            <table className="prevision-table"><thead><tr><th>Mês</th><th>Previsto</th><th>Acumulado</th><th>% acumulado</th></tr></thead><tbody>
              {rows.map(([key, value]) => { accumulated += value; return <tr key={key}><td>{key}</td><td>{money(value)}</td><td>{money(accumulated)}</td><td>{total ? (accumulated / total * 100).toFixed(1) : "0"}%</td></tr>; })}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

function BalanceLineView({ activities, services, locations, timeline }: {
  activities: ScheduleWorkbenchActivity[];
  services: ScheduleServiceOption[];
  locations: ScheduleLocationOption[];
  timeline: ReturnType<typeof buildTimeline>;
}) {
  const width = Math.max(1050, timeline.weeks.length * 34 + 190);
  const rowHeight = 32;
  const top = 54;
  const labelWidth = 170;
  const height = Math.max(420, top + locations.length * rowHeight + 48);
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const locationIndex = new Map(locations.map((location, index) => [location.id, index]));
  const timelineWidth = width - labelWidth - 30;
  const totalDays = Math.max(1, daysBetween(timeline.start, timeline.finish));
  const x = (date: string) => labelWidth + (daysBetween(timeline.start, parseDate(date)) / totalDays) * timelineWidth;
  const y = (locationId: string | null) => top + ((locations.length - 1 - (locationIndex.get(locationId ?? "") ?? 0)) * rowHeight) + rowHeight / 2;
  const serviceRows = [...new Set(activities.filter((activity) => activity.record_status === "active" && activity.service_id && activity.location_id).map((activity) => activity.service_id!))];

  return (
    <div className="prevision-panel-page">
      <div className="prevision-card prevision-span-12">
        <h2>Linha de Balanço — Visão Geral de Todos os Serviços</h2>
        <p className="prevision-note">Uma linha por serviço, conectando o avanço planejado entre pavimentos e locais ao longo das semanas.</p>
        <div className="prevision-lob-wrap">
          <svg width={width} height={height} role="img" aria-label="Linha de balanço do cronograma">
            <rect x="0" y="0" width={width} height={height} fill="white" />
            {locations.map((location, index) => {
              const rowY = top + (locations.length - 1 - index) * rowHeight;
              return <g key={location.id}><line x1={labelWidth} x2={width - 20} y1={rowY} y2={rowY} className="prevision-lob-grid" /><text x="8" y={rowY + 20} className="prevision-lob-location">{location.code} · {location.name}</text></g>;
            })}
            {timeline.weeks.map((week, index) => {
              const weekX = labelWidth + index * (timelineWidth / Math.max(1, timeline.weeks.length - 1));
              return <g key={isoDate(week)}><line x1={weekX} x2={weekX} y1={top - 20} y2={height - 30} className="prevision-lob-week" /><text x={weekX + 3} y="20" className="prevision-lob-date">{dateBR(week)}</text></g>;
            })}
            {serviceRows.map((serviceId) => {
              const points = activities.filter((activity) => activity.record_status === "active" && activity.service_id === serviceId && activity.location_id)
                .sort((a, b) => (locationIndex.get(a.location_id ?? "") ?? 0) - (locationIndex.get(b.location_id ?? "") ?? 0))
                .map((activity) => `${x(activity.planned_start)},${y(activity.location_id)}`).join(" ");
              const visual = serviceVisual(serviceMap.get(serviceId), serviceId);
              return <g key={serviceId}><polyline points={points} fill="none" stroke={visual.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.86" />
                {activities.filter((activity) => activity.record_status === "active" && activity.service_id === serviceId && activity.location_id).map((activity) => <circle key={activity.id} cx={x(activity.planned_start)} cy={y(activity.location_id)} r="3.2" fill={visual.color}><title>{serviceMap.get(serviceId)?.description} · {dateBR(activity.planned_start)}</title></circle>)}
              </g>;
            })}
          </svg>
        </div>
        <div className="prevision-lob-legend">{serviceRows.map((serviceId) => {
          const service = serviceMap.get(serviceId);
          const visual = serviceVisual(service, serviceId);
          return <span key={serviceId}><i style={{ background: visual.color }} />{visual.abbreviation} · {service?.description ?? "Serviço"}</span>;
        })}</div>
      </div>
    </div>
  );
}

function CalendarView({ baseline }: { baseline: ScheduleWorkbenchBaseline | null }) {
  return (
    <div className="prevision-panel-page">
      <div className="prevision-card prevision-span-12">
        <h2>Calendário da obra</h2>
        <div className="prevision-calendar-options">
          <label><input type="checkbox" checked={baseline?.work_on_saturday ?? false} readOnly /> Todos os serviços trabalham aos sábados</label>
          <label><input type="checkbox" readOnly /> Trabalhar nos feriados cadastrados</label>
          <label><input type="checkbox" readOnly /> Trabalhar durante recessos cadastrados</label>
        </div>
        <p className="prevision-note">Domingos permanecem não trabalháveis. O calendário da linha de base atual é {baseline?.work_on_saturday ? "de segunda a sábado" : "de segunda a sexta"}.</p>
      </div>
      <div className="prevision-card prevision-span-6"><h3>Feriados</h3><div className="prevision-empty">Nenhum feriado específico cadastrado nesta linha de base.</div></div>
      <div className="prevision-card prevision-span-6"><h3>Recessos e paralisações</h3><div className="prevision-empty">Nenhum recesso específico cadastrado nesta linha de base.</div></div>
    </div>
  );
}

export function SchedulePrevisionWorkbench({
  projectName,
  baselines,
  selectedBaseline,
  budgets,
  activities,
  dependencies,
  services,
  locations,
  canManage,
}: {
  projectName: string;
  baselines: ScheduleWorkbenchBaseline[];
  selectedBaseline: ScheduleWorkbenchBaseline | null;
  budgets: ScheduleBudgetOption[];
  activities: ScheduleWorkbenchActivity[];
  dependencies: ScheduleWorkbenchDependency[];
  services: ScheduleServiceOption[];
  locations: ScheduleLocationOption[];
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"gantt" | "lob" | "teams" | "finance" | "calendar">("gantt");
  const [query, setQuery] = useState("");
  const [groupMode, setGroupMode] = useState<"location" | "service">("location");
  const [serviceFilter, setServiceFilter] = useState("");
  const [locationView, setLocationView] = useState<"compact" | "expanded">("compact");
  const [weekWidth, setWeekWidth] = useState(34);
  const [cascade, setCascade] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const activeActivities = useMemo(() => activities.filter((activity) => activity.record_status === "active"), [activities]);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const dependencyMap = useMemo(() => new Map(dependencies.map((dependency) => [dependency.successor_id, dependency])), [dependencies]);
  const timeline = useMemo(() => buildTimeline(activeActivities, selectedBaseline), [activeActivities, selectedBaseline]);
  const timelineWidth = Math.max(952, timeline.weeks.length * weekWidth);
  const totalDays = Math.max(1, daysBetween(timeline.start, timeline.finish));
  const today = new Date();
  const todayX = daysBetween(timeline.start, today) / totalDays * timelineWidth;

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
    return locations.map((location) => ({ key: location.id, label: `${location.code} · ${location.name}`, items: filtered.filter((activity) => activity.location_id === location.id) })).filter((entry) => entry.items.length);
  }, [groupMode, services, locations, filtered]);

  const activityVisual = (activity: ScheduleWorkbenchActivity) => serviceVisual(serviceMap.get(activity.service_id ?? ""), `${activity.code} ${activity.name}`);

  const barStyle = (activity: ScheduleWorkbenchActivity): CSSProperties => {
    const left = Math.max(0, daysBetween(timeline.start, parseDate(activity.planned_start)) / totalDays * timelineWidth);
    const width = Math.max(7, (daysBetween(parseDate(activity.planned_start), parseDate(activity.planned_finish)) + 1) / totalDays * timelineWidth);
    const visual = activityVisual(activity);
    return { left, width, "--bar": visual.color, color: visual.textColor } as CSSProperties;
  };

  const summaryBars = (items: ScheduleWorkbenchActivity[]) => items.map((activity) => activity.duration_days <= 0 ? (
    <button type="button" className="prevision-summary-milestone" key={activity.id} style={barStyle(activity)} title={`${activity.name} · ${dateBR(activity.planned_start)}`} />
  ) : (
    <button type="button" className="prevision-summary-task-bar" key={activity.id} style={barStyle(activity)} title={`${activity.name} · ${dateBR(activity.planned_start)} a ${dateBR(activity.planned_finish)}`}>{activityVisual(activity).abbreviation}</button>
  ));

  const latestFinish = activeActivities.reduce((latest, activity) => !latest || activity.planned_finish > latest ? activity.planned_finish : latest, "");
  const draftCount = activeActivities.filter((activity) => activity.planning_status === "draft").length;
  const baselineStatus = selectedBaseline ? baselineStatusLabels[selectedBaseline.status] : "Nenhuma linha de base";

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function printGantt() {
    document.body.classList.add("printing-prevision-gantt");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-prevision-gantt"), 500);
  }

  return (
    <section className="prevision-workbench">
      <div className="prevision-modebar">
        <div><span>Planejamento</span><div><strong>Linha de base da obra</strong><small>Monte o cronograma e mantenha a linha de base oficial do empreendimento.</small></div></div>
        <div className={`prevision-baseline-state ${selectedBaseline?.status ?? "empty"}`}><i />{baselineStatus}</div>
      </div>

      <header className="prevision-appbar">
        <div className="prevision-brand"><b>E</b><div><strong>Cronograma Físico</strong><small>{projectName} · planejamento, equipes e linha de balanço</small></div></div>
        <nav>{(["gantt", "lob", "teams", "finance", "calendar"] as const).map((item) => (
          <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "gantt" ? "Cronograma" : item === "lob" ? "Linha de Balanço" : item === "teams" ? "Equipes" : item === "finance" ? "Financeiro" : "Calendário"}</button>
        ))}</nav>
        <div className="prevision-top-actions">
          {canManage && selectedBaseline ? <form action={generateScheduleFromTakeoffs}><input type="hidden" name="baseline_id" value={selectedBaseline.id} /><button type="submit">Importar</button></form> : null}
          <button type="button" onClick={() => downloadJson(`cronograma-${selectedBaseline?.code ?? "elos"}.json`, { baseline: selectedBaseline, activities, dependencies, locations, services })}>Exportar</button>
          {canManage && selectedBaseline && selectedBaseline.status !== "approved" ? <form action={updateScheduleBaselineStatus}><input type="hidden" name="baseline_id" value={selectedBaseline.id} /><input type="hidden" name="status" value="approved" /><button type="submit">Salvar linha de base</button></form> : null}
          <Link href={selectedBaseline ? `?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Restaurar linha de base</Link>
        </div>
      </header>

      {tab === "gantt" ? (
        <div className="prevision-gantt-view">
          <div className="prevision-toolbar">
            <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pavimento, serviço ou código" /></label>
            <label><span>Agrupar</span><select value={groupMode} onChange={(event) => setGroupMode(event.target.value as "location" | "service")}><option value="location">Por pavimento/local</option><option value="service">Por serviço</option></select></label>
            <label><span>Serviço</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">Todos</option>{services.map((service) => <option key={service.id} value={service.id}>{serviceVisual(service).abbreviation} · {service.description}</option>)}</select></label>
            <label><span>Visualização</span><select value={locationView} onChange={(event) => setLocationView(event.target.value as "compact" | "expanded")}><option value="compact">Só pavimentos</option><option value="expanded">Pavimentos + serviços</option></select></label>
            <Link className="prevision-button prominent" href="/engenharia/levantamento">＋ Novo pavimento</Link>
            {canManage && selectedBaseline ? <ScheduleActivityCreateDialog baselineId={selectedBaseline.id} services={services} locations={locations} activities={activities} /> : null}
            <button className="prevision-button" type="button" onClick={printGantt}>Imprimir A1</button>
            <span className="prevision-divider" />
            <label><span>Linha de base</span><select value={selectedBaseline?.id ?? ""} onChange={(event) => { window.location.href = `?baseline=${event.target.value}`; }}>{baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version}</option>)}</select></label>
            <label className="prevision-switch"><input type="checkbox" checked={cascade} onChange={(event) => setCascade(event.target.checked)} /> mover cadeia dependente</label>
            <label><span>Zoom</span><input type="range" min="24" max="52" step="2" value={weekWidth} onChange={(event) => setWeekWidth(Number(event.target.value))} /></label>
            <div className="prevision-toolbar-spacer" />
            <div className="prevision-kpi-mini"><span>Atividades</span><strong>{filtered.length}</strong></div>
            <div className="prevision-kpi-mini"><span>Fim atual</span><strong>{dateBR(latestFinish)}</strong></div>
            <div className="prevision-kpi-mini"><span>A revisar</span><strong>{draftCount}</strong></div>
          </div>

          <div className="prevision-print-title">{projectName} — Cronograma de Obras<small>A1 paisagem · período completo {dateBR(timeline.start)} a {dateBR(timeline.finish)}</small></div>
          <div className="prevision-gantt-shell">
            <div className="prevision-gantt-content" style={{ "--meta": "650px", "--rowh": "38px", "--week": `${weekWidth}px`, width: 650 + timelineWidth } as CSSProperties}>
              <div className="prevision-gantt-head">
                <div className="prevision-meta-head"><div>ID</div><div>Local</div><div>Serviço</div><div>Início</div><div>Duração</div><div>Valor</div></div>
                <div className="prevision-timeline-head" style={{ width: timelineWidth }}>
                  <div className="prevision-month-band">{timeline.weeks.map((week, index) => {
                    const previous = timeline.weeks[index - 1];
                    if (previous && previous.getUTCMonth() === week.getUTCMonth()) return null;
                    let span = 1;
                    while (timeline.weeks[index + span] && timeline.weeks[index + span].getUTCMonth() === week.getUTCMonth()) span += 1;
                    return <div key={isoDate(week)} className="prevision-month-label" style={{ left: index * weekWidth, width: span * weekWidth }}>{monthNames[week.getUTCMonth()]} {week.getUTCFullYear()}</div>;
                  })}</div>
                  <div className="prevision-week-band">{timeline.weeks.map((week) => <div key={isoDate(week)} className="prevision-week-cell" style={{ width: weekWidth }}>{dateBR(week).slice(0, 5)}</div>)}</div>
                  {todayX >= 0 && todayX <= timelineWidth ? <div className="prevision-today-line" style={{ left: todayX }}><span>HOJE</span></div> : null}
                </div>
              </div>

              {groupEntries.map((entry) => {
                const isExpanded = locationView === "expanded" || expanded.has(entry.key);
                return <div key={entry.key}>
                  <div className="prevision-location-summary-row">
                    <button type="button" className="prevision-location-summary-meta" onClick={() => toggleExpanded(entry.key)}><b>{isExpanded ? "▾" : "▸"}</b><span>{entry.label}</span><i>{entry.items.length}</i></button>
                    <div className="prevision-location-summary-timeline" style={{ width: timelineWidth }}>{summaryBars(entry.items)}{todayX >= 0 && todayX <= timelineWidth ? <div className="prevision-today-line" style={{ left: todayX }} /> : null}</div>
                  </div>
                  {isExpanded ? entry.items.map((activity) => {
                    const service = serviceMap.get(activity.service_id ?? "");
                    const location = locationMap.get(activity.location_id ?? "");
                    const dependency = dependencyMap.get(activity.id) ?? null;
                    const visual = activityVisual(activity);
                    return <div className="prevision-gantt-row" key={activity.id}>
                      <div className="prevision-task-meta"><div>{activity.code}</div><div title={location?.name}>{location?.name ?? "Geral da obra"}</div><div title={activity.name}><strong>{activity.name}</strong>{canManage && selectedBaseline ? <ScheduleActivityEditDialog baselineId={selectedBaseline.id} activity={activity} services={services} locations={locations} activities={activities} dependency={dependency} /> : null}</div><div>{dateBR(activity.planned_start)}</div><div>{activity.duration_days}d</div><div>{money(activity.planned_cost)}</div></div>
                      <div className="prevision-timeline-row" style={{ width: timelineWidth }}><div className="prevision-baseline-bar" style={barStyle(activity)} /><div className={`prevision-task-bar ${activity.planning_status}`} style={barStyle(activity)} title={`${visual.abbreviation} · ${service?.description ?? activity.name}`}><span>{visual.abbreviation}</span></div>{todayX >= 0 && todayX <= timelineWidth ? <div className="prevision-today-line" style={{ left: todayX }} /> : null}</div>
                    </div>;
                  }) : null}
                </div>;
              })}
              {groupEntries.length === 0 ? <div className="prevision-empty">Nenhum pavimento ou atividade encontrado.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "lob" ? <BalanceLineView activities={activeActivities} services={services} locations={locations} timeline={timeline} /> : null}
      {tab === "teams" ? <TeamView activities={activeActivities} services={services} timeline={timeline} /> : null}
      {tab === "finance" ? <FinanceView activities={activeActivities} /> : null}
      {tab === "calendar" ? <CalendarView baseline={selectedBaseline} /> : null}

      {!selectedBaseline ? (
        <div className="prevision-empty-state"><strong>Nenhuma linha de base cadastrada.</strong><span>Crie a primeira linha de base para iniciar o planejamento.</span>{canManage ? <ScheduleBaselineCreateDialog budgets={budgets} /> : null}</div>
      ) : null}
    </section>
  );
}
