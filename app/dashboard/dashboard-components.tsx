import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type DashboardTone = "neutral" | "positive" | "warning" | "danger" | "brand";

export type DashboardAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  value?: string;
  href: string;
};

export type DashboardActivity = {
  id: string;
  icon: string;
  kind: string;
  title: string;
  description: string;
  date: string;
  href: string;
};

export type CashMonth = {
  key: string;
  label: string;
  receivable: number;
  payable: number;
  balance: number;
};

export function ExecutiveKpi({
  label,
  value,
  detail,
  href,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  tone?: DashboardTone;
  icon: string;
}) {
  const content = (
    <>
      <div className={`executive-kpi-icon ${tone}`}>{icon}</div>
      <div className="executive-kpi-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {href ? <b aria-hidden="true">→</b> : null}
    </>
  );

  return href ? <Link className={`executive-kpi ${tone}`} href={href}>{content}</Link> : <article className={`executive-kpi ${tone}`}>{content}</article>;
}

export function DashboardSection({
  eyebrow,
  title,
  description,
  action,
  className = "",
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`executive-panel ${className}`.trim()}>
      <header className="executive-panel-head">
        <div><span>{eyebrow}</span><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
        {action ? <div className="executive-panel-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function CashForecast({ rows, money }: { rows: CashMonth[]; money: (value: number) => string }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.receivable, row.payable]));
  const totalReceivable = rows.reduce((sum, row) => sum + row.receivable, 0);
  const totalPayable = rows.reduce((sum, row) => sum + row.payable, 0);
  const projected = totalReceivable - totalPayable;

  return (
    <>
      <div className="cash-summary-line">
        <div><span>Entradas previstas</span><strong>{money(totalReceivable)}</strong></div>
        <div><span>Saídas previstas</span><strong>{money(totalPayable)}</strong></div>
        <div className={projected >= 0 ? "positive" : "negative"}><span>Saldo projetado</span><strong>{money(projected)}</strong></div>
      </div>
      <div className="cash-chart" role="img" aria-label="Previsão mensal de entradas e saídas">
        {rows.map((row) => {
          const receivableHeight = Math.max(row.receivable > 0 ? 4 : 0, row.receivable / max * 100);
          const payableHeight = Math.max(row.payable > 0 ? 4 : 0, row.payable / max * 100);
          return (
            <article key={row.key}>
              <div className="cash-bars">
                <div className="cash-bar receivable" style={{ height: `${receivableHeight}%` }}><span>{money(row.receivable)}</span></div>
                <div className="cash-bar payable" style={{ height: `${payableHeight}%` }}><span>{money(row.payable)}</span></div>
              </div>
              <strong>{row.label}</strong>
              <small className={row.balance >= 0 ? "positive" : "negative"}>{row.balance >= 0 ? "+" : ""}{money(row.balance)}</small>
            </article>
          );
        })}
      </div>
      <div className="cash-legend"><span><i className="receivable" />Entradas</span><span><i className="payable" />Saídas</span></div>
    </>
  );
}

export function PhysicalProgress({
  planned,
  actual,
  delayed,
  forecast,
  baseline,
}: {
  planned: number;
  actual: number;
  delayed: number;
  forecast: string;
  baseline: string;
}) {
  const plannedWidth = Math.min(100, Math.max(0, planned));
  const actualWidth = Math.min(100, Math.max(0, actual));
  const deviation = actual - planned;

  return (
    <div className="physical-dashboard">
      <div className="physical-dashboard-main">
        <div className="physical-dashboard-score">
          <span>Realizado</span><strong>{actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong>
          <small className={deviation >= 0 ? "positive" : "negative"}>{deviation >= 0 ? "+" : ""}{deviation.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.</small>
        </div>
        <div className="physical-dashboard-bars">
          <div><span><b>Previsto</b><em>{planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</em></span><div className="physical-track"><i className="planned" style={{ width: `${plannedWidth}%` }} /></div></div>
          <div><span><b>Realizado</b><em>{actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</em></span><div className="physical-track"><i className={deviation >= 0 ? "actual ahead" : "actual behind"} style={{ width: `${actualWidth}%` }} /></div></div>
        </div>
      </div>
      <div className="physical-dashboard-meta">
        <div><span>Atividades atrasadas</span><strong>{delayed}</strong></div>
        <div><span>Conclusão atual</span><strong>{forecast}</strong></div>
        <div><span>Linha de base</span><strong>{baseline}</strong></div>
      </div>
    </div>
  );
}

export function UnitInventory({
  available,
  reserved,
  sold,
  inactive,
  stockValue,
  money,
}: {
  available: number;
  reserved: number;
  sold: number;
  inactive: number;
  stockValue: number;
  money: (value: number) => string;
}) {
  const total = Math.max(1, available + reserved + sold + inactive);
  const availablePct = available / total * 100;
  const reservedPct = reserved / total * 100;
  const soldPct = sold / total * 100;
  const style = {
    "--available": `${availablePct}%`,
    "--reserved": `${availablePct + reservedPct}%`,
    "--sold": `${availablePct + reservedPct + soldPct}%`,
  } as CSSProperties;

  return (
    <div className="inventory-dashboard">
      <div className="inventory-donut" style={style}>
        <div><strong>{available + reserved + sold}</strong><span>unidades</span></div>
      </div>
      <div className="inventory-copy">
        <div className="inventory-value"><span>Estoque disponível</span><strong>{money(stockValue)}</strong></div>
        <ul>
          <li><i className="available" /><span>Disponíveis</span><strong>{available}</strong></li>
          <li><i className="reserved" /><span>Reservadas</span><strong>{reserved}</strong></li>
          <li><i className="sold" /><span>Vendidas</span><strong>{sold}</strong></li>
          {inactive ? <li><i className="inactive" /><span>Inativas</span><strong>{inactive}</strong></li> : null}
        </ul>
      </div>
    </div>
  );
}

export function CommercialPipeline({
  draft,
  pipeline,
  approved,
  converted,
  amount,
  money,
}: {
  draft: number;
  pipeline: number;
  approved: number;
  converted: number;
  amount: number;
  money: (value: number) => string;
}) {
  const max = Math.max(1, draft, pipeline, approved, converted);
  const rows = [
    { label: "Rascunhos", value: draft, key: "draft" },
    { label: "Em negociação", value: pipeline, key: "pipeline" },
    { label: "Aprovadas", value: approved, key: "approved" },
    { label: "Convertidas", value: converted, key: "converted" },
  ];

  return (
    <div className="pipeline-dashboard">
      <div className="pipeline-total"><span>Valor em negociação</span><strong>{money(amount)}</strong></div>
      <div className="pipeline-rows">
        {rows.map((row) => <div key={row.key}><span>{row.label}</span><div><i className={row.key} style={{ width: `${Math.max(row.value ? 7 : 0, row.value / max * 100)}%` }} /></div><strong>{row.value}</strong></div>)}
      </div>
    </div>
  );
}

export function AttentionList({ alerts }: { alerts: DashboardAlert[] }) {
  return alerts.length ? (
    <div className="attention-list">
      {alerts.map((alert) => (
        <Link key={alert.id} href={alert.href} className={`attention-item ${alert.severity}`}>
          <i aria-hidden="true">{alert.severity === "critical" ? "!" : alert.severity === "warning" ? "△" : "i"}</i>
          <div><strong>{alert.title}</strong><span>{alert.description}</span></div>
          {alert.value ? <b>{alert.value}</b> : null}
          <em aria-hidden="true">→</em>
        </Link>
      ))}
    </div>
  ) : <div className="dashboard-empty-good"><strong>Nenhuma pendência crítica no momento.</strong><span>Os módulos disponíveis estão dentro dos critérios monitorados.</span></div>;
}

export function RecentActivity({ activities }: { activities: DashboardActivity[] }) {
  return activities.length ? (
    <div className="activity-list">
      {activities.map((activity) => (
        <Link key={activity.id} href={activity.href} className="activity-item">
          <i>{activity.icon}</i>
          <div><span>{activity.kind}</span><strong>{activity.title}</strong><small>{activity.description}</small></div>
          <time>{activity.date}</time>
        </Link>
      ))}
    </div>
  ) : <div className="dashboard-empty"><span>Ainda não há movimentações recentes nos módulos disponíveis.</span></div>;
}
