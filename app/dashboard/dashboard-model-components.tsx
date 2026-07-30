import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type DashboardRisk = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  href?: string;
};

export type PhysicalMonth = {
  key: string;
  label: string;
  planned: number;
  actual: number | null;
  current?: boolean;
};

export type CashFlowMonth = {
  key: string;
  label: string;
  received: number;
  receivable: number;
  paid: number;
  payable: number;
  cumulative: number;
};

export type StageProgressRow = {
  key: string;
  label: string;
  planned: number;
  actual: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}R$ ${(absolute / 1_000_000_000).toFixed(1).replace(".", ",")} bi`;
  if (absolute >= 1_000_000) return `${sign}R$ ${(absolute / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (absolute >= 1_000) return `${sign}R$ ${(absolute / 1_000).toFixed(0)} mil`;
  return `${sign}R$ ${absolute.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

export function ModelKpi({
  icon,
  tone,
  label,
  value,
  detail,
  href,
}: {
  icon: string;
  tone: "green" | "blue" | "amber" | "red" | "purple";
  label: string;
  value: ReactNode;
  detail: ReactNode;
  href?: string;
}) {
  const content = <>
    <div className="v20-kpi-top"><span className={`v20-kpi-icon ${tone}`}>{icon}</span><span className="v20-kpi-label">{label}</span></div>
    <div className="v20-kpi-value">{value}</div>
    <div className="v20-kpi-foot">{detail}</div>
  </>;

  return href
    ? <Link className="v20-kpi v20-span2" href={href}>{content}</Link>
    : <article className="v20-kpi v20-span2">{content}</article>;
}

export function ModelCard({
  title,
  subtitle,
  href,
  linkLabel,
  span,
  children,
}: {
  title: string;
  subtitle: string;
  href?: string;
  linkLabel?: string;
  span: 3 | 4 | 5 | 8 | 12;
  children: ReactNode;
}) {
  return <section className={`v20-card v20-span${span}`}>
    <header className="v20-card-head">
      <div><h3>{title}</h3><small>{subtitle}</small></div>
      {href ? <Link className="v20-link" href={href}>{linkLabel ?? "Abrir módulo"}</Link> : null}
    </header>
    {children}
  </section>;
}

export function PhysicalCurve({ rows }: { rows: PhysicalMonth[] }) {
  if (!rows.length) return <div className="v20-empty">O gráfico aparecerá quando houver uma linha de base com atividades.</div>;

  const width = Math.max(820, rows.length * 68 + 86);
  const height = 220;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (rows.length === 1 ? plotWidth / 2 : plotWidth * index / (rows.length - 1));
  const y = (value: number) => top + plotHeight * (1 - clamp(value) / 100);
  const plannedPoints = rows.map((row, index) => `${x(index).toFixed(1)},${y(row.planned).toFixed(1)}`).join(" ");
  const actualRows = rows.map((row, index) => ({ row, index })).filter((item) => item.row.actual !== null);
  const actualPoints = actualRows.map(({ row, index }) => `${x(index).toFixed(1)},${y(Number(row.actual)).toFixed(1)}`).join(" ");
  const currentIndex = rows.findIndex((row) => row.current);

  return <>
    <div className="v20-legend"><span><i />Realizado</span><span><i className="planned" />Previsto</span><span><i className="today" />Posição atual</span></div>
    <div className="v20-curve-scroll">
      <div className="v20-curve-chart" style={{ minWidth: width }}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Curva S de avanço físico previsto e realizado">
          {[0, 25, 50, 75, 100].map((value) => <g key={value}>
            <line x1={left} y1={y(value)} x2={width - right} y2={y(value)} className="v20-chart-grid-line" />
            <text x={left - 7} y={y(value) + 3} textAnchor="end" className="v20-chart-axis-label">{value}%</text>
          </g>)}
          {currentIndex >= 0 ? <line x1={x(currentIndex)} y1={top} x2={x(currentIndex)} y2={height - bottom} className="v20-chart-today-line" /> : null}
          <polyline points={plannedPoints} className="v20-curve-planned" />
          {actualPoints ? <polyline points={actualPoints} className="v20-curve-actual" /> : null}
          {actualRows.map(({ row, index }) => <circle key={row.key} cx={x(index)} cy={y(Number(row.actual))} r="3.2" className="v20-curve-point"><title>{row.label} · realizado {Number(row.actual).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</title></circle>)}
          {rows.map((row, index) => <text key={row.key} x={x(index)} y={height - 8} textAnchor="middle" className="v20-chart-month-label">{row.label}</text>)}
        </svg>
      </div>
      <table className="v20-curve-table">
        <tbody>
          <tr><th>Previsto</th>{rows.map((row) => <td key={row.key} className={row.current ? "today" : ""}>{row.planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</td>)}</tr>
          <tr><th>Realizado</th>{rows.map((row) => <td key={row.key} className={row.current ? "today" : ""}>{row.actual === null ? "—" : `${row.actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</td>)}</tr>
        </tbody>
      </table>
    </div>
  </>;
}

export function CashFlowChart({ rows, money }: { rows: CashFlowMonth[]; money: (value: number) => string }) {
  if (!rows.length) return <div className="v20-empty">Cadastre contas a pagar e a receber para visualizar o fluxo.</div>;

  const width = Math.max(680, rows.length * 78 + 80);
  const height = 270;
  const left = 48;
  const right = 20;
  const mid = 128;
  const topRoom = 93;
  const bottomRoom = 83;
  const maxFlow = Math.max(1, ...rows.flatMap((row) => [row.received + row.receivable, row.paid + row.payable]));
  const maxCumulative = Math.max(1, ...rows.map((row) => Math.abs(row.cumulative)));
  const groupWidth = (width - left - right) / rows.length;
  const barWidth = Math.min(25, groupWidth * 0.48);
  const x = (index: number) => left + groupWidth * index + groupWidth / 2;
  const cumulativeY = (value: number) => mid - value / maxCumulative * 67;
  const linePoints = rows.map((row, index) => `${x(index).toFixed(1)},${cumulativeY(row.cumulative).toFixed(1)}`).join(" ");

  return <>
    <div className="v20-legend">
      <span><i style={{ borderColor: "#0f8b72" }} />Recebido</span>
      <span><i style={{ borderColor: "#83c5bc" }} />A receber</span>
      <span><i style={{ borderColor: "#bf4b4b" }} />Realizado</span>
      <span><i style={{ borderColor: "#e2a44e" }} />A realizar</span>
      <span><i style={{ borderColor: "#20333d" }} />Saldo acumulado</span>
    </div>
    <div className="v20-cash-scroll">
      <div className="v20-cash-svg" style={{ minWidth: width }}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Fluxo de caixa mensal">
          <line x1={left} y1={mid} x2={width - right} y2={mid} className="v20-cash-axis" />
          <text x={left - 7} y={mid - 6} textAnchor="end" className="v20-chart-axis-label">Entradas</text>
          <text x={left - 7} y={mid + 15} textAnchor="end" className="v20-chart-axis-label">Saídas</text>
          {rows.map((row, index) => {
            const receivedHeight = row.received / maxFlow * topRoom;
            const receivableHeight = row.receivable / maxFlow * topRoom;
            const paidHeight = row.paid / maxFlow * bottomRoom;
            const payableHeight = row.payable / maxFlow * bottomRoom;
            const xx = x(index);
            return <g key={row.key}>
              <rect x={xx - barWidth / 2} y={mid - receivedHeight} width={barWidth} height={receivedHeight} rx="3" className="v20-bar-received"><title>{row.label} · recebido {money(row.received)}</title></rect>
              <rect x={xx - barWidth / 2} y={mid - receivedHeight - receivableHeight} width={barWidth} height={receivableHeight} rx="3" className="v20-bar-receivable"><title>{row.label} · a receber {money(row.receivable)}</title></rect>
              <rect x={xx - barWidth / 2} y={mid} width={barWidth} height={paidHeight} rx="3" className="v20-bar-paid"><title>{row.label} · realizado {money(row.paid)}</title></rect>
              <rect x={xx - barWidth / 2} y={mid + paidHeight} width={barWidth} height={payableHeight} rx="3" className="v20-bar-payable"><title>{row.label} · a realizar {money(row.payable)}</title></rect>
              <text x={xx} y={height - 11} textAnchor="middle" className="v20-chart-month-label">{row.label}</text>
            </g>;
          })}
          <polyline points={linePoints} className="v20-cumulative-line" />
          {rows.map((row, index) => <circle key={row.key} cx={x(index)} cy={cumulativeY(row.cumulative)} r="3.2" className="v20-cumulative-point"><title>{row.label} · saldo acumulado {money(row.cumulative)}</title></circle>)}
        </svg>
      </div>
    </div>
  </>;
}

export function CommercialSummary({
  sold,
  total,
  vgvSold,
  vgvAvailable,
  money,
}: {
  sold: number;
  total: number;
  vgvSold: number;
  vgvAvailable: number;
  money: (value: number) => string;
}) {
  if (!total) return <div className="v20-empty">Cadastre as unidades privativas para acompanhar vendas e VGV.</div>;
  const ratio = clamp(sold / total * 100);
  const style = { background: `conic-gradient(#0f8b72 0 ${ratio}%,#dfe6e8 ${ratio}% 100%)` } as CSSProperties;

  return <div className="v20-commercial">
    <div className="v20-donut" style={style}><div className="v20-donut-center"><b>{Math.round(ratio)}%</b><small>vendido</small></div></div>
    <div className="v20-stat-list">
      <div className="v20-stat"><span>Unidades</span><b>{sold} / {total}</b></div>
      <div className="v20-stat"><span>Estoque</span><b>{Math.max(0, total - sold)} un.</b></div>
      <div className="v20-stat"><span>VGV vendido</span><b>{money(vgvSold)}</b></div>
      <div className="v20-stat"><span>VGV disponível</span><b>{money(vgvAvailable)}</b></div>
    </div>
  </div>;
}

export function StageProgress({ rows }: { rows: StageProgressRow[] }) {
  return rows.length ? <div className="v20-stage-list">{rows.map((row) => <div className="v20-stage" key={row.key}>
    <div className="v20-stage-top"><span>{row.label}</span><b className={row.actual + 2 < row.planned ? "v20-down" : ""}>{row.actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></div>
    <div className="v20-rail"><div className="v20-fill" style={{ width: `${clamp(row.actual)}%` }} /><div className="v20-marker" style={{ left: `${clamp(row.planned)}%` }} title={`Previsto ${row.planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} /></div>
  </div>)}</div> : <div className="v20-empty">As etapas aparecerão quando o cronograma tiver atividades e medições.</div>;
}

export function BudgetSummary({
  total,
  paid,
  committed,
  remaining,
  money,
}: {
  total: number;
  paid: number;
  committed: number;
  remaining: number;
  money: (value: number) => string;
}) {
  if (!total) return <div className="v20-empty">Consolide o orçamento da obra para acompanhar custos.</div>;
  const base = Math.max(1, total);
  const paidPct = clamp(paid / base * 100);
  const committedPct = clamp(committed / base * 100);
  const remainingPct = clamp(100 - paidPct - committedPct);

  return <>
    <div className="v20-budget-line"><span>Total atualizado</span><b>{money(total)}</b></div>
    <div className="v20-budget-line"><span>Pago</span><b>{money(paid)}</b></div>
    <div className="v20-budget-line"><span>Comprometido</span><b>{money(committed)}</b></div>
    <div className="v20-budget-line"><span>A contratar</span><b>{money(remaining)}</b></div>
    <div className="v20-budget-stack">
      <i className="paid" style={{ width: `${paidPct}%` }}>{paidPct > 8 ? `${Math.round(paidPct)}%` : ""}</i>
      <i className="committed" style={{ width: `${committedPct}%` }}>{committedPct > 8 ? `${Math.round(committedPct)}%` : ""}</i>
      <i className="remaining" style={{ width: `${remainingPct}%` }}>{remainingPct > 8 ? `${Math.round(remainingPct)}%` : ""}</i>
    </div>
    <div className="v20-legend"><span><i style={{ borderColor: "#0f8b72" }} />Pago</span><span><i style={{ borderColor: "#d79a2b" }} />Comprometido</span><span><i style={{ borderColor: "#cbd4d8" }} />A contratar</span></div>
  </>;
}

export function CriticalPoints({ risks }: { risks: DashboardRisk[] }) {
  const rows = risks.length ? risks : [{ id: "healthy", severity: "low" as const, title: "Nenhum ponto crítico automático", description: "Os indicadores atuais não apontam desvios relevantes ou pendências vencidas." }];
  return <div>{rows.slice(0, 4).map((risk) => {
    const content = <div className={`v20-risk ${risk.severity}`}>
      <div className="v20-risk-head"><b>{risk.title}</b><span className="v20-risk-tag">{risk.severity === "high" ? "Alto" : risk.severity === "medium" ? "Atenção" : "Ok"}</span></div>
      <p>{risk.description}</p>
    </div>;
    return risk.href ? <Link className="v20-risk-link" key={risk.id} href={risk.href}>{content}</Link> : <div key={risk.id}>{content}</div>;
  })}</div>;
}

export function compactDashboardMoney(value: number) {
  return compactMoney(value);
}
