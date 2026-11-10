"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  ElosIaCashflowVisual,
  ElosIaCostVisual,
  ElosIaProposalVisual,
  ElosIaResultVisual,
  ElosIaScheduleVisual,
  ElosIaVisual,
  ElosIaVisualMetric,
} from "@/lib/elos-ia/visuals.mjs";
import { ElosIaMarkdown } from "./elos-ia-markdown";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const colors = { ink: "#103c42", teal: "#648b87", gold: "#9b7f58", gray: "#ced0cb", alert: "#bc6d56", grid: "#dedbd3" };

function compactNumber(value: number) {
  const size = Math.abs(value);
  if (size >= 1_000_000_000) return `${decimal.format(value / 1_000_000_000)} bi`;
  if (size >= 1_000_000) return `${decimal.format(value / 1_000_000)} mi`;
  if (size >= 1_000) return `${decimal.format(value / 1_000)} mil`;
  return decimal.format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "Não informado";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function queryTimestamp(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function metricValue(metric: ElosIaVisualMetric) {
  if (metric.value === null) return "Não informado";
  if (metric.format === "money") return `R$ ${compactNumber(metric.value)}`;
  if (metric.format === "percent") return `${decimal.format(metric.value)}%`;
  if (metric.format === "days") return `${decimal.format(metric.value)} dias`;
  return decimal.format(metric.value);
}

function exactMetricValue(metric: ElosIaVisualMetric) {
  return metric.format === "money" && metric.value !== null ? money.format(metric.value) : metricValue(metric);
}

function Plot({ title, height = 230, children }: { title: string; height?: number; children: (width: number, id: string) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const id = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="elos-ia-plot" ref={ref}>
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{title}</title>
      {children(width, id)}
    </svg>
  </div>;
}

function Legend({ items }: { items: Array<{ label: string; color: string; line?: boolean; dashed?: boolean }> }) {
  return <ul className="elos-ia-visual-legend" aria-label="Legenda">{items.map((item) => <li key={item.label}>
    <i className={`${item.line ? "line" : ""} ${item.dashed ? "dashed" : ""}`} style={{ "--legend-color": item.color } as CSSProperties} aria-hidden="true" />
    <span>{item.label}</span>
  </li>)}</ul>;
}

function DataTable({ columns, rows, label = "Ver valores do gráfico" }: { columns: string[]; rows: ReactNode[][]; label?: string }) {
  return <details className="elos-ia-visual-data">
    <summary>{label}</summary>
    <div className="elos-ia-table-scroll" tabIndex={0} role="region" aria-label="Valores usados no gráfico">
      <table><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}

const costColors: Record<ElosIaCostVisual["segments"][number]["key"], string> = {
  paid: colors.gray, payable: colors.ink, unbilled: colors.teal, toCommit: colors.gold,
};
const costDescriptions = {
  paid: "Já saiu do caixa",
  payable: "Contas a pagar em aberto",
  unbilled: "Contratos ainda não faturados",
  toCommit: "Previsto, ainda sem compromisso",
};

function CostComposition({ visual }: { visual: ElosIaCostVisual }) {
  const total = visual.segments.reduce((sum, segment) => sum + segment.value, 0);
  const paid = visual.segments.filter((segment) => segment.key === "paid").reduce((sum, segment) => sum + segment.value, 0);
  return <>
    <Plot height={96} title={`Composição do custo projetado. ${money.format(paid)} pagos; ${money.format(visual.remaining)} restantes.`}>{(width) => {
      const plotWidth = width - 2;
      let offset = 1;
      const start = total > 0 ? 1 + paid / total * plotWidth : 1;
      return <>
        {visual.remaining > 0 && total > 0 ? <>
          <text x={width - 1} y={18} textAnchor="end" className="elos-ia-plot-callout">Ainda a pagar · R$ {compactNumber(visual.remaining)}</text>
          <path d={`M ${start} 36 V 29 H ${width - 1} V 36`} fill="none" stroke={colors.alert} strokeWidth={1.2} />
        </> : <text x={1} y={22} className="elos-ia-plot-label">{total > 0 ? "Custo projetado integralmente pago" : "Sem valores na composição"}</text>}
        {visual.segments.map((segment) => {
          const segmentWidth = total > 0 ? segment.value / total * plotWidth : 0;
          const x = offset;
          offset += segmentWidth;
          return <rect key={segment.key} x={x} y={43} width={segmentWidth} height={30} fill={costColors[segment.key]} stroke="#f3ede4" strokeWidth={0.8}><title>{segment.label}: {money.format(segment.value)}</title></rect>;
        })}
        <rect x={1} y={43} width={plotWidth} height={30} fill="none" stroke="#6d807b" strokeWidth={0.8} />
      </>;
    }}</Plot>
    <dl className="elos-ia-cost-legend">{visual.segments.map((segment) => <div key={segment.key}>
      <dt><i style={{ background: costColors[segment.key] }} aria-hidden="true" /><span>{segment.label}<small>{costDescriptions[segment.key]}</small></span></dt>
      <dd>{money.format(segment.value)}</dd>
    </div>)}</dl>
    <DataTable columns={["Composição", "Valor"]} rows={[
      ...visual.segments.map((segment) => [segment.label, money.format(segment.value)]),
      ["Custo final projetado", money.format(visual.projected)],
      ["Orçamento", money.format(visual.budget)],
      ["Ainda a pagar", money.format(visual.remaining)],
    ]} />
  </>;
}

function linePath<T>(points: T[], value: (point: T) => number | null, x: (index: number) => number, y: (number: number) => number) {
  let connected = false;
  return points.map((point, index) => {
    const amount = value(point);
    if (amount === null) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${x(index).toFixed(2)},${y(amount).toFixed(2)}`;
  }).join(" ");
}

function labelIndexes(count: number, width: number) {
  const slots = Math.max(2, Math.floor(width / 75));
  const stride = Math.max(1, Math.ceil((count - 1) / (slots - 1)));
  return new Set(Array.from({ length: count }, (_, i) => i).filter((i) => i === 0 || i === count - 1 || i % stride === 0));
}

function Schedule({ visual }: { visual: ElosIaScheduleVisual }) {
  const hasProjection = visual.points.some((point) => point.projected !== null);
  const hasActual = visual.points.some((point) => point.actual !== null);
  return <>
    <Legend items={[
      { label: "Planejado", color: colors.teal, line: true },
      { label: "Realizado", color: colors.ink, line: true },
      ...(hasProjection ? [{ label: "Reprogramado", color: colors.alert, line: true, dashed: true }] : []),
    ]} />
    <Plot title="Avanço físico acumulado: planejado e realizado ao longo do cronograma.">{(width) => {
      const left = 37, right = width - 16, top = 20, bottom = 194;
      const monthDate = (key: string) => /^\d{4}-\d{2}$/.test(key) ? Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0) : Date.parse(key);
      const dates = visual.points.map((point) => monthDate(point.key));
      const firstDate = dates[0], lastDate = dates[dates.length - 1];
      const dated = dates.length > 1 && dates.every((date, index) => Number.isFinite(date) && (index === 0 || date > dates[index - 1]));
      const x = (i: number) => dated ? left + (dates[i] - firstDate) / (lastDate - firstDate) * (right - left) : visual.points.length <= 1 ? (left + right) / 2 : left + i / (visual.points.length - 1) * (right - left);
      const y = (value: number) => bottom - value / 100 * (bottom - top);
      const labels = new Set([0, visual.points.length - 1]);
      let previousLabelX = left;
      for (let i = 1; i < visual.points.length - 1; i += 1) {
        if (x(i) - previousLabelX >= 75 && right - x(i) >= 75) { labels.add(i); previousLabelX = x(i); }
      }
      const today = Date.parse(visual.asOfDate);
      const todayX = dated && today >= firstDate && today <= lastDate ? left + (today - firstDate) / (lastDate - firstDate) * (right - left) : null;
      const actualLast = visual.points.findLastIndex((point) => point.actual !== null);
      return <>
        {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke={colors.grid} /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="elos-ia-plot-label">{tick}%</text></g>)}
        {todayX !== null ? <g><line x1={todayX} x2={todayX} y1={top} y2={bottom} stroke="#9a9f96" strokeDasharray="3 4" /><text x={todayX} y={12} textAnchor="middle" className="elos-ia-plot-label">Hoje</text></g> : null}
        <path d={linePath(visual.points, (p) => p.planned, x, y)} fill="none" stroke={colors.teal} strokeWidth={2} />
        <path d={linePath(visual.points, (p) => p.actual, x, y)} fill="none" stroke={colors.ink} strokeWidth={2.5} />
        {hasProjection ? <path d={linePath(visual.points, (p) => p.projected, x, y)} fill="none" stroke={colors.alert} strokeWidth={2} strokeDasharray="5 4" /> : null}
        {actualLast >= 0 ? <circle cx={x(actualLast)} cy={y(visual.points[actualLast].actual!)} r={3.5} fill={colors.ink} /> : null}
        {visual.points.map((point, i) => labels.has(i) ? <text key={point.key} x={x(i)} y={bottom + 22} textAnchor={i === 0 ? "start" : i === visual.points.length - 1 ? "end" : "middle"} className="elos-ia-plot-label">{point.label}</text> : null)}
      </>;
    }}</Plot>
    {!hasActual ? <p className="elos-ia-visual-note">Sem medições físicas para desenhar o realizado.</p> : null}
    <dl className="elos-ia-visual-dates"><div><dt>Término planejado</dt><dd>{dateLabel(visual.plannedFinish)}</dd></div><div><dt>Término reprogramado</dt><dd>{dateLabel(visual.projectedFinish)}</dd></div></dl>
    <DataTable columns={["Período", "Planejado", "Realizado", ...(hasProjection ? ["Reprogramado"] : [])]} rows={visual.points.map((point) => [point.label, point.planned === null ? "—" : `${decimal.format(point.planned)}%`, point.actual === null ? "—" : `${decimal.format(point.actual)}%`, ...(hasProjection ? [point.projected === null ? "—" : `${decimal.format(point.projected)}%`] : [])])} />
  </>;
}

function axisDomain(values: number[]) {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const rawStep = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= rawStep) ?? 10) * magnitude;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step || step;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + step * i);
  return { low, high, ticks };
}

function Cashflow({ visual }: { visual: ElosIaCashflowVisual }) {
  const amounts = visual.points.map((point) => ({ ...point, inflow: point.received + point.receivable, outflow: point.paid + point.payable + point.engineering }));
  const minimum = amounts.reduce<typeof amounts[number] | null>((lowest, point) => !lowest || point.cumulative < lowest.cumulative ? point : lowest, null);
  return <>
    <Legend items={[{ label: "Entradas", color: colors.teal }, { label: "Saídas", color: colors.ink }, { label: "Saldo acumulado", color: colors.gold, line: true }]} />
    <Plot height={244} title="Entradas e saídas mensais em barras, com o saldo acumulado em linha. Todos usam a mesma escala em reais.">{(width) => {
      const left = 51, right = width - 12, top = 22, bottom = 207;
      const { low, high, ticks } = axisDomain(amounts.flatMap((point) => [point.inflow, point.outflow, point.cumulative]));
      const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
      const step = (right - left) / Math.max(1, amounts.length);
      const bar = Math.min(28, step * 0.32);
      const x = (i: number) => left + step * (i + 0.5);
      const labels = labelIndexes(amounts.length, right - left);
      return <>
        <text x={left - 8} y={12} textAnchor="end" className="elos-ia-plot-label">R$</text>
        {ticks.map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#aab8b1" : colors.grid} strokeDasharray={tick < 0 ? "3 4" : undefined} /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="elos-ia-plot-label">{compactNumber(tick)}</text></g>)}
        {amounts.map((point, i) => <g key={point.key}>
          <rect x={x(i) - bar - 1} y={Math.min(y(point.inflow), y(0))} width={bar} height={Math.abs(y(point.inflow) - y(0))} fill={colors.teal}><title>{point.label}, entradas: {money.format(point.inflow)}</title></rect>
          <rect x={x(i) + 1} y={Math.min(y(point.outflow), y(0))} width={bar} height={Math.abs(y(point.outflow) - y(0))} fill={colors.ink}><title>{point.label}, saídas: {money.format(point.outflow)}</title></rect>
          {labels.has(i) ? <text x={x(i)} y={bottom + 23} textAnchor="middle" className="elos-ia-plot-label">{point.label}</text> : null}
        </g>)}
        <path d={linePath(amounts, (point) => point.cumulative, x, y)} fill="none" stroke="#f3ede4" strokeWidth={5} />
        <path d={linePath(amounts, (point) => point.cumulative, x, y)} fill="none" stroke={colors.gold} strokeWidth={2.3} />
        {amounts.map((point, i) => <circle key={point.key} cx={x(i)} cy={y(point.cumulative)} r={point === minimum ? 4.3 : amounts.length > 24 ? 1.6 : 2.5} fill={point === minimum ? colors.alert : colors.gold} stroke="#f3ede4" strokeWidth={1.3}><title>{point.label}, saldo acumulado: {money.format(point.cumulative)}</title></circle>)}
      </>;
    }}</Plot>
    {minimum ? <div className={`elos-ia-visual-insight ${minimum.cumulative < 0 ? "negative" : ""}`}><span>Menor saldo do período</span><strong>{money.format(minimum.cumulative)} <small>em {minimum.label}</small></strong></div> : null}
    <DataTable columns={["Mês", "Recebido", "A receber", "Pago", "A pagar", ...(visual.engineeringIncluded ? ["Engenharia"] : []), "Saldo acumulado"]} rows={visual.points.map((point) => [point.label, money.format(point.received), money.format(point.receivable), money.format(point.paid), money.format(point.payable), ...(visual.engineeringIncluded ? [money.format(point.engineering)] : []), money.format(point.cumulative)])} />
  </>;
}

function ResultWaterfall({ visual }: { visual: ElosIaResultVisual }) {
  const steps = visual.steps.reduce<Array<ElosIaResultVisual["steps"][number] & {from:number;to:number}>>((previous, step) => {
    const balance = previous[previous.length - 1]?.to ?? 0;
    const from = step.kind === "total" ? 0 : balance;
    const to = step.kind === "total" ? step.value : balance + step.value;
    return [...previous, { ...step, from, to }];
  }, []);
  const low = Math.min(0, ...steps.flatMap((step) => [step.from, step.to]));
  const high = Math.max(0, ...steps.flatMap((step) => [step.from, step.to]));
  const position = (value: number) => (value - low) / (high - low || 1) * 100;
  return <>
    <div className="elos-ia-waterfall" role="group" aria-label="Formação do resultado: receitas, deduções de custo e lucro projetado, em reais.">
      {steps.map((step, index) => <div className={`elos-ia-waterfall-row ${step.kind}`} key={`${step.label}-${index}`}>
        <div className="elos-ia-waterfall-label"><span>{step.label}</span><strong>{step.kind === "delta" && step.value > 0 ? "+ " : ""}{money.format(step.value)}</strong></div>
        <div className="elos-ia-waterfall-track" aria-hidden="true">
          <i className="elos-ia-waterfall-zero" style={{ left: `${position(0)}%` }} />
          {step.kind === "delta" ? <i className="elos-ia-waterfall-connector" style={{ left: `${position(step.from)}%` }} /> : null}
          <span className="elos-ia-waterfall-bar" style={{ left: `${position(Math.min(step.from, step.to))}%`, width: `${Math.abs(position(step.to) - position(step.from))}%`, background: step.kind === "total" ? index === steps.length - 1 ? step.value < 0 ? colors.alert : colors.gold : colors.ink : step.value < 0 ? colors.alert : colors.teal }} />
        </div>
      </div>)}
    </div>
    <DataTable columns={["Etapa", "Valor", "Resultado acumulado"]} rows={steps.map((step) => [step.label, money.format(step.value), money.format(step.to)])} />
  </>;
}

function ProposalComparison({ visual }: { visual: ElosIaProposalVisual }) {
  const maximum = Math.max(1, ...visual.scenarios.flatMap((scenario) => [scenario.nominal, scenario.presentValue ?? 0]));
  const hasPresentValue = visual.scenarios.some((scenario) => scenario.presentValue !== null);
  const comparablePresentValue = visual.scenarios.every((scenario) => scenario.presentValue !== null);
  return <>
    <div className="elos-ia-proposal-premise"><span>{visual.discountAnnualPct === null ? "Comparação de valores nominais" : `Taxa de desconto: ${decimal.format(visual.discountAnnualPct)}% a.a.`}</span><span>Data-base: {dateLabel(visual.valuationDate)}</span></div>
    {hasPresentValue && !comparablePresentValue ? <p className="elos-ia-visual-note">Valor presente indisponível em um dos cenários. A comparação entre eles considera os valores nominais.</p> : null}
    <div className="elos-ia-proposal-bars" role="group" aria-label={hasPresentValue ? "Valores nominais e valores presentes disponíveis por cenário." : "Comparação dos valores nominais dos cenários."}>
      {visual.scenarios.map((scenario, index) => <div className="elos-ia-proposal-scenario" key={`${scenario.label}-${index}`}>
        <div className="elos-ia-proposal-title"><strong>{scenario.label}</strong>{scenario.marginPct !== null ? <span>Margem {decimal.format(scenario.marginPct)}%</span> : null}</div>
        <div className="elos-ia-proposal-bar-label"><span>Nominal</span><strong>{money.format(scenario.nominal)}</strong></div>
        <div className="elos-ia-proposal-track" aria-hidden="true"><i style={{ width: `${scenario.nominal / maximum * 100}%`, background: colors.gray }} /></div>
        {scenario.presentValue !== null ? <>
          <div className="elos-ia-proposal-bar-label"><span>Valor presente</span><strong>{money.format(scenario.presentValue)}</strong></div>
          <div className="elos-ia-proposal-track" aria-hidden="true"><i style={{ width: `${scenario.presentValue / maximum * 100}%`, background: index === 0 ? colors.ink : colors.gold }} /></div>
        </> : null}
      </div>)}
    </div>
    {visual.assumptions.length ? <ul className="elos-ia-visual-notes">{visual.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul> : null}
    <DataTable columns={["Cenário", "Nominal", "Valor presente", "Margem"]} rows={visual.scenarios.map((scenario) => [scenario.label, money.format(scenario.nominal), scenario.presentValue === null ? "Não calculado" : money.format(scenario.presentValue), scenario.marginPct === null ? "Não calculada" : `${decimal.format(scenario.marginPct)}%`])} />
  </>;
}

function VisualCard({ visual }: { visual: ElosIaVisual }) {
  const id = useId();
  const timestamp = queryTimestamp(visual.generatedAt);
  return <section className={`elos-ia-visual elos-ia-visual-${visual.type}`} aria-labelledby={`${id}-heading`}>
    <div className="elos-ia-visual-heading"><h3 id={`${id}-heading`}>{visual.title}</h3><span>{visual.projectLabel}</span></div>
    {visual.periodLabel ? <p className="elos-ia-visual-period">{visual.periodLabel}</p> : null}
    {visual.metrics.length ? <dl className="elos-ia-visual-metrics">{visual.metrics.map((metric, index) => <div key={`${metric.label}-${index}`} className={metric.tone ?? "neutral"}>
      <dt>{metric.label}</dt><dd title={exactMetricValue(metric)}>{metricValue(metric)}</dd>
    </div>)}</dl> : null}
    {visual.type === "cost-composition" ? <CostComposition visual={visual} /> : visual.type === "schedule" ? <Schedule visual={visual} /> : visual.type === "cashflow" ? <Cashflow visual={visual} /> : visual.type === "result-waterfall" ? <ResultWaterfall visual={visual} /> : <ProposalComparison visual={visual} />}
    {visual.notes?.length ? <ul className="elos-ia-visual-notes">{visual.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
    {visual.warnings.length ? <div className="elos-ia-visual-warnings"><strong>Sobre estes dados</strong><ul>{visual.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    <div className="elos-ia-visual-source"><span>Fonte: {visual.sourceLabel}</span><span>Referência: {dateLabel(visual.asOfDate)}</span>{timestamp ? <span>Consultado em {timestamp} · Brasília</span> : null}</div>
  </section>;
}

export function ElosIaVisuals({ visuals }: { visuals: ElosIaVisual[] }) {
  return <div className="elos-ia-visuals">{visuals.map((visual) => <VisualCard key={visual.id} visual={visual} />)}</div>;
}

/** The conclusion comes first; structured evidence sits before longer explanations. */
export function ElosIaAnswer({ text, visuals }: { text: string; visuals?: ElosIaVisual[] }) {
  if (!visuals?.length) return <ElosIaMarkdown text={text} />;
  const paragraphs = text.trim().replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  let lead = paragraphs.shift() ?? "";
  if (/^#{1,4}\s+[^\n]+$/.test(lead) && paragraphs.length) lead += `\n\n${paragraphs.shift()}`;
  const detail = paragraphs.join("\n\n");
  return <div className="elos-ia-answer">
    <div className="elos-ia-answer-lead"><span className="elos-ia-answer-eyebrow">Resposta · Elos IA</span><ElosIaMarkdown text={lead} /></div>
    <ElosIaVisuals visuals={visuals} />
    {detail ? <div className="elos-ia-answer-detail"><ElosIaMarkdown text={detail} /></div> : null}
  </div>;
}
