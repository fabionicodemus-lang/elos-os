import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  loadCostVsBudget,
  type CostVsBudgetRow,
  type CostVsBudgetStatus,
} from "@/lib/cost-vs-budget/server";
import { requireCompanyPermission } from "@/lib/workspace";
import { TraceabilityPanel } from "./traceability-panel";

const statusLabels: Record<CostVsBudgetStatus, string> = {
  ok: "Dentro do orçamento",
  attention: "Atenção",
  over: "Estourado",
  no_budget: "Sem orçamento",
  unallocated: "Sem apropriação",
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function percent(value: number | null | undefined) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0))}%`;
}

function statusBadge(status: CostVsBudgetStatus) {
  if (status === "ok") return <span className="cashflow-direction in">{statusLabels[status]}</span>;
  if (status === "over" || status === "no_budget") return <span className="cashflow-direction out">{statusLabels[status]}</span>;
  return (
    <span
      className="cashflow-direction"
      style={{
        color: status === "attention" ? "#8b5a15" : "#536164",
        background: status === "attention" ? "#fff4da" : "#edf2f1",
      }}
    >
      {statusLabels[status]}
    </span>
  );
}

function matchesFilter(row: CostVsBudgetRow, query: string, status: string) {
  if (status && row.status !== status) return false;
  if (!query) return true;
  return `${row.code} ${row.name}`.toLowerCase().includes(query);
}

export default async function CostVsBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ budget?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("budgets.view");
  const context = await loadCostVsBudget({
    supabase,
    companyId,
    projectId,
    budgetId: params.budget,
  });
  const query = (params.q ?? "").trim().toLowerCase();
  const status = Object.keys(statusLabels).includes(params.status ?? "") ? params.status! : "";
  const rows = context.rows.filter((row) => matchesFilter(row, query, status));
  const comparableRows = context.rows.filter((row) => row.status !== "unallocated");
  const projectLabel = context.project
    ? `${context.project.code ? `${context.project.code} · ` : ""}${context.project.name}`
    : "Selecione uma obra";
  const balanceIsNegative = context.totals.balance < -0.01;
  const purchaseOrderTotal = comparableRows.reduce((sum, row) => sum + row.purchaseOrderCost, 0);
  const materialTotal = comparableRows.reduce((sum, row) => sum + row.materialCost, 0);
  const serviceTotal = comparableRows.reduce((sum, row) => sum + row.serviceCost, 0);
  const directTotal = comparableRows.reduce((sum, row) => sum + row.directCost, 0);

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="cost-vs-budget"
      eyebrow="Engenharia · Gestão de Custos"
      title="Custo x Orçamento"
      description={`${company.name} · ${projectLabel} · orçamento, custo realizado e compromissos por serviço.`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/orcamentos">Abrir orçamentos</Link>
          <Link className="elos-button" href="/engenharia/previsao-financeira">Previsão financeira</Link>
        </>
      }
    >
      {context.errors.length ? (
        <div className="auth-message error workspace-message">
          Parte da base de custos não pôde ser carregada: {context.errors.join(" · ")}
        </div>
      ) : null}

      {!projectId ? (
        <div className="forecast-empty">
          <strong>Selecione uma obra no topo.</strong>
          <span>A comparação é sempre feita dentro de um empreendimento.</span>
        </div>
      ) : null}

      {projectId && !context.budget ? (
        <div className="forecast-empty">
          <strong>Esta obra ainda não possui orçamento.</strong>
          <span>Crie uma revisão do orçamento para iniciar o acompanhamento dos centros de custo.</span>
        </div>
      ) : null}

      {projectId && context.budget ? (
        <>
          <section className="forecast-reference-card">
            <div>
              <span>Orçamento comparado</span>
              <strong>{context.budget.code} · {context.budget.version} · {context.budget.name}</strong>
              <small>
                {context.budget.is_base ? "Orçamento base da obra" : "Revisão selecionada"} · situação calculada pelo custo total previsto
              </small>
            </div>
            {context.budgets.length > 1 ? (
              <form method="get">
                <select name="budget" defaultValue={context.budget.id}>
                  {context.budgets.map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.code} · {budget.version} · {budget.name}{budget.is_base ? " · BASE" : ""}
                    </option>
                  ))}
                </select>
                <button type="submit">Comparar</button>
              </form>
            ) : null}
          </section>

          <section className="forecast-kpis">
            <article>
              <span>Orçamento</span>
              <strong>{money(context.totals.budget)}</strong>
              <small>total da revisão selecionada</small>
            </article>
            <article className="actual">
              <span>Custo realizado</span>
              <strong>{money(context.totals.allocated)}</strong>
              <small>consumos, medições e despesas diretas</small>
            </article>
            <article className="committed">
              <span>Comprometido pendente</span>
              <strong>{money(context.totals.committed)}</strong>
              <small>saldo dos pedidos ainda não realizado</small>
            </article>
            <article className={context.totals.consumptionPercent > 100 ? "danger" : "committed"}>
              <span>Custo total previsto</span>
              <strong>{money(context.totals.forecast)}</strong>
              <small>{percent(context.totals.consumptionPercent)} do orçamento</small>
            </article>
            <article className={balanceIsNegative ? "danger" : "ok"}>
              <span>Saldo do orçamento</span>
              <strong>{money(context.totals.balance)}</strong>
              <small>{balanceIsNegative ? "previsão acima do orçamento" : "valor ainda disponível"}</small>
            </article>
            <article className={context.totals.unallocated > 0 ? "danger" : "ok"}>
              <span>Sem apropriação</span>
              <strong>{money(context.totals.unallocated)}</strong>
              <small>
                {context.totals.overBudgetCount + context.totals.withoutBudgetCount} centro(s) crítico(s)
              </small>
            </article>
          </section>

          <section className="forecast-formula-panel">
            <div>
              <span>Critério de comparação</span>
              <h2>Os pedidos importados do Koper entram no mesmo serviço do orçamento</h2>
            </div>
            <div className="forecast-formula">
              <span>Custo realizado</span><b>+</b><span>Comprometido pendente</span><b>=</b><strong>Custo total previsto</strong>
            </div>
            <p>
              Os pedidos confirmados, recebidos ou encerrados são agrupados pelo serviço gravado no item da compra. Quando já existe consumo de material no mesmo serviço, esse valor reduz o saldo comprometido do pedido para evitar dupla contagem. Pedidos cancelados e quantidades canceladas não entram na previsão.
            </p>
          </section>

          <TraceabilityPanel />

          <section className="registry-toolbar cashflow-toolbar">
            <form
              method="get"
              className="cashflow-filter"
              style={{ gridTemplateColumns: "minmax(280px, 1fr) 220px 190px auto auto" }}
            >
              <input type="hidden" name="budget" value={context.budget.id} />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar código ou nome do serviço" />
              <select name="status" defaultValue={status}>
                <option value="">Todas as situações</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                {rows.length} de {context.rows.length} centro(s)
              </div>
              <button type="submit">Filtrar</button>
              <Link href={`/engenharia/custo-orcamento?budget=${context.budget.id}`}>Limpar</Link>
            </form>
          </section>

          {context.totals.budgetWithoutService > 0 ? (
            <div className="auth-message error workspace-message">
              Existem {money(context.totals.budgetWithoutService)} no orçamento sem serviço vinculado. Esses itens não podem ser comparados corretamente com os centros de custo.
            </div>
          ) : null}

          <section className="registry-table-panel forecast-service-panel">
            <div className="section-heading">
              <div><span>Controle por centro de custo</span><h2>Serviços do orçamento</h2></div>
              <p>{rows.length} linha(s) exibida(s)</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table forecast-service-table" style={{ minWidth: 1780 }}>
                <thead>
                  <tr>
                    <th>Centro de custo · Serviço</th>
                    <th>Orçamento</th>
                    <th>Materiais realizados</th>
                    <th>Serviços medidos</th>
                    <th>Despesas diretas</th>
                    <th>Pedidos emitidos</th>
                    <th>Comprometido pendente</th>
                    <th>Custo previsto</th>
                    <th>Saldo</th>
                    <th>Consumo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const progressWidth = Math.max(0, Math.min(100, row.consumptionPercent));
                    return (
                      <tr key={row.id} className={row.status === "over" || row.status === "no_budget" ? "danger" : ""}>
                        <td><strong>{row.code} · {row.name}</strong></td>
                        <td>{money(row.budgetAmount)}</td>
                        <td>{money(row.materialCost)}</td>
                        <td>{money(row.serviceCost)}</td>
                        <td>{money(row.directCost)}</td>
                        <td>{money(row.purchaseOrderCost)}</td>
                        <td>{money(row.openCommitment)}</td>
                        <td><strong>{money(row.forecastCost)}</strong></td>
                        <td>
                          <strong className={row.balance < 0 ? "forecast-danger" : row.balance > 0 ? "forecast-positive" : ""}>
                            {money(row.balance)}
                          </strong>
                        </td>
                        <td>
                          <strong>{percent(row.consumptionPercent)}</strong>
                          <div style={{ width: 110, height: 7, marginTop: 7, overflow: "hidden", borderRadius: 999, background: "#e7eeed" }}>
                            <span
                              style={{
                                display: "block",
                                width: `${progressWidth}%`,
                                height: "100%",
                                borderRadius: 999,
                                background: row.status === "over" || row.status === "no_budget"
                                  ? "#b75d50"
                                  : row.status === "attention" ? "#c89236" : "#087f72",
                              }}
                            />
                          </div>
                        </td>
                        <td>{statusBadge(row.status)}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? (
                    <tr><td colSpan={11} className="budget-empty-state"><strong>Nenhum centro de custo encontrado.</strong><span>Revise os filtros aplicados.</span></td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total da obra</th>
                    <th>{money(context.totals.budget)}</th>
                    <th>{money(materialTotal)}</th>
                    <th>{money(serviceTotal)}</th>
                    <th>{money(directTotal)}</th>
                    <th>{money(purchaseOrderTotal)}</th>
                    <th>{money(context.totals.committed)}</th>
                    <th>{money(context.totals.forecast)}</th>
                    <th className={balanceIsNegative ? "forecast-danger" : ""}>{money(context.totals.balance)}</th>
                    <th>{percent(context.totals.consumptionPercent)}</th>
                    <th>—</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
