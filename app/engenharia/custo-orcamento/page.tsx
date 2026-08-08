import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  loadCostVsBudget,
  type CostVsBudgetRow,
  type CostVsBudgetStatus,
} from "@/lib/cost-vs-budget/server";
import { requireCompanyPermission } from "@/lib/workspace";

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
  const projectLabel = context.project
    ? `${context.project.code ? `${context.project.code} · ` : ""}${context.project.name}`
    : "Selecione uma obra";
  const balanceIsNegative = context.totals.balance < -0.01;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="cost-vs-budget"
      eyebrow="Engenharia · Gestão de Custos"
      title="Custo x Orçamento"
      description={`${company.name} · ${projectLabel} · comparação do orçamento com o custo apropriado em cada serviço.`}
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
                {context.budget.is_base ? "Orçamento base da obra" : "Revisão selecionada"} · {statusLabels.ok.toLowerCase()} até 89,9%
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
              <span>Custo alocado</span>
              <strong>{money(context.totals.allocated)}</strong>
              <small>materiais, medições e despesas diretas</small>
            </article>
            <article className={balanceIsNegative ? "danger" : "ok"}>
              <span>Saldo do orçamento</span>
              <strong>{money(context.totals.balance)}</strong>
              <small>{balanceIsNegative ? "custo acima do orçamento" : "valor ainda disponível"}</small>
            </article>
            <article className={context.totals.consumptionPercent > 100 ? "danger" : "committed"}>
              <span>Orçamento consumido</span>
              <strong>{percent(context.totals.consumptionPercent)}</strong>
              <small>custo alocado ÷ orçamento</small>
            </article>
            <article className={context.totals.unallocated > 0 ? "danger" : "ok"}>
              <span>Custo sem apropriação</span>
              <strong>{money(context.totals.unallocated)}</strong>
              <small>precisa ser vinculado a um serviço</small>
            </article>
            <article className={context.totals.overBudgetCount + context.totals.withoutBudgetCount > 0 ? "danger" : "ok"}>
              <span>Centros críticos</span>
              <strong>{context.totals.overBudgetCount + context.totals.withoutBudgetCount}</strong>
              <small>{context.totals.overBudgetCount} estourado(s) · {context.totals.withoutBudgetCount} sem orçamento</small>
            </article>
          </section>

          <section className="forecast-formula-panel">
            <div>
              <span>Critério de apropriação</span>
              <h2>O custo entra no serviço somente quando está efetivamente apropriado</h2>
            </div>
            <div className="forecast-formula">
              <span>Materiais consumidos</span><b>+</b><span>Medições aprovadas</span><b>+</b><span>Despesas diretas</span><b>=</b><strong>Custo alocado</strong>
            </div>
            <p>
              Materiais são reconhecidos pelas saídas do estoque e devoluções reduzem o custo. Serviços entram pelas medições aprovadas, faturadas ou pagas. Notas diretas entram somente quando não estão ligadas a medição, pedido ou recebimento, evitando dupla contagem.
            </p>
          </section>

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
              <table className="registry-table forecast-service-table" style={{ minWidth: 1380 }}>
                <thead>
                  <tr>
                    <th>Centro de custo · Serviço</th>
                    <th>Orçamento</th>
                    <th>Materiais</th>
                    <th>Serviços medidos</th>
                    <th>Despesas diretas</th>
                    <th>Custo alocado</th>
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
                        <td><strong>{money(row.allocatedCost)}</strong></td>
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
                    <tr><td colSpan={9} className="budget-empty-state"><strong>Nenhum centro de custo encontrado.</strong><span>Revise os filtros aplicados.</span></td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total da obra</th>
                    <th>{money(context.totals.budget)}</th>
                    <th>{money(context.rows.reduce((sum, row) => sum + row.materialCost, 0))}</th>
                    <th>{money(context.rows.reduce((sum, row) => sum + row.serviceCost, 0))}</th>
                    <th>{money(context.rows.reduce((sum, row) => sum + row.directCost, 0))}</th>
                    <th>{money(context.totals.recognized)}</th>
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
