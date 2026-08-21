import { Fragment } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  loadCostVsBudget,
  type CostVsBudgetRow,
  type CostVsBudgetStatus,
} from "@/lib/cost-vs-budget/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { TraceabilityPanel } from "./traceability-panel";

const statusLabels: Record<CostVsBudgetStatus, string> = {
  ok: "Dentro do orçamento",
  attention: "Atenção",
  over: "Estourado",
  no_budget: "Sem orçamento",
  unallocated: "Sem apropriação",
};

type BudgetGroup = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
};

type BudgetHierarchyItem = {
  service_id: string | null;
  group_id: string | null;
  code: string | null;
  description: string;
  sort_order: number;
};

type DisplayRow = CostVsBudgetRow & {
  displayCode: string;
  displayName: string;
  groupId: string | null;
  groupCode: string | null;
  groupName: string | null;
  groupSortOrder: number;
  itemSortOrder: number;
};

type GroupSummary = {
  id: string;
  code: string;
  name: string;
  budgetAmount: number;
  materialCost: number;
  serviceCost: number;
  directCost: number;
  payablePaidCost: number;
  payableOpenCost: number;
  purchaseOrderCost: number;
  openCommitment: number;
  forecastCost: number;
  balance: number;
  consumptionPercent: number;
  status: CostVsBudgetStatus;
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

function compareCodes(left: string, right: string) {
  return left.localeCompare(right, "pt-BR", { numeric: true, sensitivity: "base" });
}

function matchesFilter(row: DisplayRow, query: string, status: string) {
  if (status && row.status !== status) return false;
  if (!query) return true;
  return `${row.displayCode} ${row.displayName} ${row.groupCode ?? ""} ${row.groupName ?? ""}`
    .toLowerCase()
    .includes(query);
}

function classifySummary(budgetAmount: number, forecastCost: number): CostVsBudgetStatus {
  if (budgetAmount <= 0 && forecastCost > 0.01) return "no_budget";
  if (forecastCost > budgetAmount + 0.01) return "over";
  if (budgetAmount > 0 && forecastCost / budgetAmount >= 0.9) return "attention";
  return "ok";
}

function summarizeGroup(group: BudgetGroup, children: DisplayRow[]): GroupSummary {
  const totals = children.reduce(
    (summary, row) => {
      summary.budgetAmount += row.budgetAmount;
      summary.materialCost += row.materialCost;
      summary.serviceCost += row.serviceCost;
      summary.directCost += row.directCost;
      summary.payablePaidCost += row.payablePaidCost;
      summary.payableOpenCost += row.payableOpenCost;
      summary.purchaseOrderCost += row.purchaseOrderCost;
      summary.openCommitment += row.openCommitment;
      summary.forecastCost += row.forecastCost;
      return summary;
    },
    {
      budgetAmount: 0,
      materialCost: 0,
      serviceCost: 0,
      directCost: 0,
      payablePaidCost: 0,
      payableOpenCost: 0,
      purchaseOrderCost: 0,
      openCommitment: 0,
      forecastCost: 0,
    },
  );
  const balance = totals.budgetAmount - totals.forecastCost;
  const consumptionPercent = totals.budgetAmount > 0
    ? totals.forecastCost / totals.budgetAmount * 100
    : totals.forecastCost > 0 ? 100 : 0;

  return {
    id: group.id,
    code: group.code,
    name: group.name,
    ...totals,
    balance,
    consumptionPercent,
    status: classifySummary(totals.budgetAmount, totals.forecastCost),
  };
}

function consumptionBar(status: CostVsBudgetStatus, consumptionPercent: number) {
  const progressWidth = Math.max(0, Math.min(100, consumptionPercent));
  return (
    <>
      <strong>{percent(consumptionPercent)}</strong>
      <div style={{ width: 110, height: 7, marginTop: 7, overflow: "hidden", borderRadius: 999, background: "#e7eeed" }}>
        <span
          style={{
            display: "block",
            width: `${progressWidth}%`,
            height: "100%",
            borderRadius: 999,
            background: status === "over" || status === "no_budget"
              ? "#b75d50"
              : status === "attention" ? "#c89236" : "#087f72",
          }}
        />
      </div>
    </>
  );
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

  let budgetGroups: BudgetGroup[] = [];
  let budgetHierarchyItems: BudgetHierarchyItem[] = [];
  const hierarchyErrors: string[] = [];

  if (projectId && context.budget) {
    const [groupsResult, itemsResult] = await Promise.all([
      fetchAllRows<BudgetGroup>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_budget_groups")
          .select("id,code,name,sort_order")
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .eq("budget_id", context.budget!.id)
          .eq("status", "active")
          .order("sort_order")
          .order("code")
          .range(from, to);
        return { data: (data ?? []) as BudgetGroup[], error };
      }),
      fetchAllRows<BudgetHierarchyItem>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_budget_items")
          .select("service_id,group_id,code,description,sort_order")
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .eq("budget_id", context.budget!.id)
          .eq("status", "active")
          .order("sort_order")
          .order("code")
          .range(from, to);
        return { data: (data ?? []) as BudgetHierarchyItem[], error };
      }),
    ]);
    budgetGroups = groupsResult.data;
    budgetHierarchyItems = itemsResult.data;
    if (groupsResult.error?.message) hierarchyErrors.push(groupsResult.error.message);
    if (itemsResult.error?.message) hierarchyErrors.push(itemsResult.error.message);
  }

  const groupById = new Map(budgetGroups.map((group) => [group.id, group]));
  const itemByServiceId = new Map<string, BudgetHierarchyItem>();
  budgetHierarchyItems
    .filter((item) => item.service_id)
    .sort((a, b) => a.sort_order - b.sort_order || compareCodes(a.code ?? "", b.code ?? ""))
    .forEach((item) => {
      if (item.service_id && !itemByServiceId.has(item.service_id)) itemByServiceId.set(item.service_id, item);
    });

  const displayRows = context.rows
    .map<DisplayRow>((row) => {
      const rowWithService = row as CostVsBudgetRow & { serviceId: string | null };
      const budgetItem = rowWithService.serviceId ? itemByServiceId.get(rowWithService.serviceId) : null;
      const group = budgetItem?.group_id ? groupById.get(budgetItem.group_id) : null;
      return {
        ...row,
        displayCode: budgetItem?.code?.trim() || row.code,
        displayName: budgetItem?.description?.trim() || row.name,
        groupId: group?.id ?? null,
        groupCode: group?.code ?? null,
        groupName: group?.name ?? null,
        groupSortOrder: group?.sort_order ?? Number.MAX_SAFE_INTEGER,
        itemSortOrder: budgetItem?.sort_order ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.groupSortOrder - b.groupSortOrder
      || compareCodes(a.groupCode ?? "999999", b.groupCode ?? "999999")
      || a.itemSortOrder - b.itemSortOrder
      || compareCodes(a.displayCode, b.displayCode));

  const query = (params.q ?? "").trim().toLowerCase();
  const status = Object.keys(statusLabels).includes(params.status ?? "") ? params.status! : "";
  const rows = displayRows.filter((row) => matchesFilter(row, query, status));
  const visibleGroups = budgetGroups
    .sort((a, b) => a.sort_order - b.sort_order || compareCodes(a.code, b.code))
    .map((group) => {
      const children = rows.filter((row) => row.groupId === group.id);
      return { group, children, summary: summarizeGroup(group, children) };
    })
    .filter((entry) => entry.children.length > 0);
  const ungroupedRows = rows.filter((row) => !row.groupId);

  const comparableRows = context.rows.filter((row) => row.status !== "unallocated");
  const projectLabel = context.project
    ? `${context.project.code ? `${context.project.code} · ` : ""}${context.project.name}`
    : "Selecione uma obra";
  const balanceIsNegative = context.totals.balance < -0.01;
  const purchaseOrderTotal = comparableRows.reduce((sum, row) => sum + row.purchaseOrderCost, 0);
  const materialTotal = comparableRows.reduce((sum, row) => sum + row.materialCost, 0);
  const serviceTotal = comparableRows.reduce((sum, row) => sum + row.serviceCost, 0);
  const directTotal = comparableRows.reduce((sum, row) => sum + row.directCost, 0);
  const allErrors = [...context.errors, ...hierarchyErrors];
  const stickyHeaderStyle = {
    position: "sticky" as const,
    top: 0,
    zIndex: 5,
    background: "#f8fbfa",
    boxShadow: "inset 0 -1px 0 #dfe7e6",
  };

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="cost-vs-budget"
      eyebrow="Controle · Custos"
      title="Custos x Orçamento"
      description={`${company.name} · ${projectLabel}`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/orcamentos">Abrir orçamentos</Link>
          <Link className="elos-button" href="/engenharia/previsao-financeira">Previsão financeira</Link>
        </>
      }
    >
      {allErrors.length ? (
        <div className="auth-message error workspace-message">
          Parte da base de custos não pôde ser carregada: {allErrors.join(" · ")}
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
          <section className="forecast-kpis">
            <article>
              <span>Orçamento</span>
              <strong>{money(context.totals.budget)}</strong>
              <small>total da revisão selecionada</small>
            </article>
            <article className="actual">
              <span>Títulos apropriados</span>
              <strong>{money(context.totals.payableAllocated)}</strong>
              <small>{money(context.totals.payablePaid)} pagos · {money(context.totals.payableOpen)} em aberto</small>
            </article>
            <article className="actual">
              <span>Custo realizado</span>
              <strong>{money(context.totals.allocated)}</strong>
              <small>inclui títulos pagos, consumos, medições e despesas diretas</small>
            </article>
            <article className="committed">
              <span>Comprometido pendente</span>
              <strong>{money(context.totals.committed)}</strong>
              <small>títulos em aberto e saldo dos pedidos ainda não realizado</small>
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
              <span>Sem apropriação operacional</span>
              <strong>{money(context.totals.unallocated)}</strong>
              <small>
                {context.totals.overBudgetCount + context.totals.withoutBudgetCount} centro(s) crítico(s)
              </small>
            </article>
            <article className={context.totals.payableUnallocated > 0 ? "danger" : "ok"}>
              <span>Títulos sem apropriação</span>
              <strong>{money(context.totals.payableUnallocated)}</strong>
              <small>contas do Koper pendentes para tratamento manual</small>
            </article>
          </section>

          <TraceabilityPanel />

          <section className="registry-toolbar cashflow-toolbar">
            <form
              method="get"
              className="cashflow-filter"
              style={{
                gridTemplateColumns: context.budgets.length > 1
                  ? "250px minmax(280px, 1fr) 220px 190px auto auto"
                  : "minmax(280px, 1fr) 220px 190px auto auto",
              }}
            >
              {context.budgets.length > 1 ? (
                <select name="budget" defaultValue={context.budget.id} aria-label="Revisão do orçamento">
                  {context.budgets.map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.code} · {budget.version} · {budget.name}{budget.is_base ? " · BASE" : ""}
                    </option>
                  ))}
                </select>
              ) : <input type="hidden" name="budget" value={context.budget.id} />}
              <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar grupo, código ou serviço" />
              <select name="status" defaultValue={status}>
                <option value="">Todas as situações</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                {rows.length} serviço(s) · {visibleGroups.length} grupo(s)
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
              <div><span>Controle por grupos e centros de custo</span><h2>Estrutura do orçamento</h2></div>
              <p>{visibleGroups.length} grupo(s) · {rows.length} serviço(s)</p>
            </div>
            <div
              className="registry-table-wrap"
              style={{ maxHeight: "calc(100vh - 140px)", overflow: "auto", position: "relative" }}
            >
              <table className="registry-table forecast-service-table" style={{ minWidth: 2060 }}>
                <thead>
                  <tr>
                    <th style={stickyHeaderStyle}>Grupo / Centro de custo · Serviço</th>
                    <th style={stickyHeaderStyle}>Orçamento</th>
                    <th style={stickyHeaderStyle}>Materiais realizados</th>
                    <th style={stickyHeaderStyle}>Serviços medidos</th>
                    <th style={stickyHeaderStyle}>Despesas diretas</th>
                    <th style={stickyHeaderStyle}>Títulos pagos</th>
                    <th style={stickyHeaderStyle}>Títulos em aberto</th>
                    <th style={stickyHeaderStyle}>Pedidos emitidos</th>
                    <th style={stickyHeaderStyle}>Comprometido pendente</th>
                    <th style={stickyHeaderStyle}>Custo previsto</th>
                    <th style={stickyHeaderStyle}>Saldo</th>
                    <th style={stickyHeaderStyle}>Consumo</th>
                    <th style={stickyHeaderStyle}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    className={balanceIsNegative ? "danger" : ""}
                    style={{ background: "#dfeeea", borderBottom: "2px solid #b8d5d0" }}
                  >
                    <td>
                      <strong style={{ display: "block", fontSize: 13 }}>TOTAL DA OBRA</strong>
                      <small style={{ color: "var(--muted)", fontWeight: 700 }}>
                        {context.budget.code} · {context.budget.version} · {context.budget.name}
                      </small>
                    </td>
                    <td><strong>{money(context.totals.budget)}</strong></td>
                    <td><strong>{money(materialTotal)}</strong></td>
                    <td><strong>{money(serviceTotal)}</strong></td>
                    <td><strong>{money(directTotal)}</strong></td>
                    <td><strong>{money(context.totals.payablePaid)}</strong></td>
                    <td><strong>{money(context.totals.payableOpen)}</strong></td>
                    <td><strong>{money(purchaseOrderTotal)}</strong></td>
                    <td><strong>{money(context.totals.committed)}</strong></td>
                    <td><strong>{money(context.totals.forecast)}</strong></td>
                    <td>
                      <strong className={balanceIsNegative ? "forecast-danger" : context.totals.balance > 0 ? "forecast-positive" : ""}>
                        {money(context.totals.balance)}
                      </strong>
                    </td>
                    <td>{consumptionBar(classifySummary(context.totals.budget, context.totals.forecast), context.totals.consumptionPercent)}</td>
                    <td>{statusBadge(classifySummary(context.totals.budget, context.totals.forecast))}</td>
                  </tr>

                  {visibleGroups.map(({ group, children, summary }) => (
                    <Fragment key={group.id}>
                      <tr
                        className={summary.status === "over" || summary.status === "no_budget" ? "danger" : ""}
                        style={{ background: "#edf6f4", borderTop: "2px solid #c9ddda" }}
                      >
                        <td>
                          <strong style={{ display: "block", fontSize: 13 }}>{summary.code} - {summary.name}</strong>
                          <small style={{ color: "var(--muted)", fontWeight: 700 }}>{children.length} serviço(s)</small>
                        </td>
                        <td><strong>{money(summary.budgetAmount)}</strong></td>
                        <td><strong>{money(summary.materialCost)}</strong></td>
                        <td><strong>{money(summary.serviceCost)}</strong></td>
                        <td><strong>{money(summary.directCost)}</strong></td>
                        <td><strong>{money(summary.payablePaidCost)}</strong></td>
                        <td><strong>{money(summary.payableOpenCost)}</strong></td>
                        <td><strong>{money(summary.purchaseOrderCost)}</strong></td>
                        <td><strong>{money(summary.openCommitment)}</strong></td>
                        <td><strong>{money(summary.forecastCost)}</strong></td>
                        <td>
                          <strong className={summary.balance < 0 ? "forecast-danger" : summary.balance > 0 ? "forecast-positive" : ""}>
                            {money(summary.balance)}
                          </strong>
                        </td>
                        <td>{consumptionBar(summary.status, summary.consumptionPercent)}</td>
                        <td>{statusBadge(summary.status)}</td>
                      </tr>
                      {children.map((row) => (
                        <tr key={row.id} className={row.status === "over" || row.status === "no_budget" ? "danger" : ""}>
                          <td style={{ paddingLeft: 30 }}><strong>{row.displayCode} · {row.displayName}</strong></td>
                          <td>{money(row.budgetAmount)}</td>
                          <td>{money(row.materialCost)}</td>
                          <td>{money(row.serviceCost)}</td>
                          <td>{money(row.directCost)}</td>
                          <td>{money(row.payablePaidCost)}</td>
                          <td>{money(row.payableOpenCost)}</td>
                          <td>{money(row.purchaseOrderCost)}</td>
                          <td>{money(row.openCommitment)}</td>
                          <td><strong>{money(row.forecastCost)}</strong></td>
                          <td>
                            <strong className={row.balance < 0 ? "forecast-danger" : row.balance > 0 ? "forecast-positive" : ""}>
                              {money(row.balance)}
                            </strong>
                          </td>
                          <td>{consumptionBar(row.status, row.consumptionPercent)}</td>
                          <td>{statusBadge(row.status)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}

                  {ungroupedRows.length > 0 ? (
                    <tr style={{ background: "#f5f7f7", borderTop: "2px solid #dfe6e5" }}>
                      <td colSpan={13}><strong>Sem grupo no orçamento</strong></td>
                    </tr>
                  ) : null}
                  {ungroupedRows.map((row) => (
                    <tr key={row.id} className={row.status === "over" || row.status === "no_budget" ? "danger" : ""}>
                      <td style={{ paddingLeft: 30 }}><strong>{row.displayCode} · {row.displayName}</strong></td>
                      <td>{money(row.budgetAmount)}</td>
                      <td>{money(row.materialCost)}</td>
                      <td>{money(row.serviceCost)}</td>
                      <td>{money(row.directCost)}</td>
                      <td>{money(row.payablePaidCost)}</td>
                      <td>{money(row.payableOpenCost)}</td>
                      <td>{money(row.purchaseOrderCost)}</td>
                      <td>{money(row.openCommitment)}</td>
                      <td><strong>{money(row.forecastCost)}</strong></td>
                      <td>
                        <strong className={row.balance < 0 ? "forecast-danger" : row.balance > 0 ? "forecast-positive" : ""}>
                          {money(row.balance)}
                        </strong>
                      </td>
                      <td>{consumptionBar(row.status, row.consumptionPercent)}</td>
                      <td>{statusBadge(row.status)}</td>
                    </tr>
                  ))}

                  {rows.length === 0 ? (
                    <tr><td colSpan={13} className="budget-empty-state"><strong>Nenhum centro de custo encontrado.</strong><span>Revise os filtros aplicados.</span></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
