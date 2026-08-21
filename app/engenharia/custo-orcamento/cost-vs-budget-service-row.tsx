"use client";

import { createContext, useContext, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CostVsBudgetRow, CostVsBudgetStatus } from "@/lib/cost-vs-budget/server";
import type { CostVsBudgetTitle } from "@/lib/cost-vs-budget/title-details";

type ServiceDisplayRow = CostVsBudgetRow & {
  displayCode: string;
  displayName: string;
};

type ExpansionContextValue = {
  expandedRowId: string | null;
  toggle: (rowId: string) => void;
};

const ExpansionContext = createContext<ExpansionContextValue | null>(null);

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

function detailMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const clean = value.slice(0, 10);
  const [year, month, day] = clean.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
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

export function CostVsBudgetExpansionProvider({ children }: { children: ReactNode }) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  return (
    <ExpansionContext.Provider
      value={{
        expandedRowId,
        toggle: (rowId) => setExpandedRowId((current) => current === rowId ? null : rowId),
      }}
    >
      {children}
    </ExpansionContext.Provider>
  );
}

function TitleStatus({ status }: { status: CostVsBudgetTitle["status"] }) {
  return (
    <span className={`status-badge ${status}`}>
      {status === "paid" ? "Pago" : "Em aberto"}
    </span>
  );
}

function TitlesDetail({ row, titles }: { row: ServiceDisplayRow; titles: CostVsBudgetTitle[] }) {
  const allocatedTotal = titles.reduce((sum, title) => sum + title.allocatedAmount, 0);
  return (
    <tr style={{ background: "#f8fbfa" }}>
      <td colSpan={13} style={{ padding: "0 16px 18px 46px", borderTop: 0 }}>
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            border: "1px solid #d8e4e2",
            borderRadius: 10,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: "12px 14px", background: "#f3f8f7", borderBottom: "1px solid #e0e9e7" }}>
            <div>
              <strong style={{ display: "block", fontSize: 13 }}>Títulos vinculados</strong>
              <small style={{ color: "var(--muted)" }}>{row.displayCode} · {row.displayName}</small>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong style={{ display: "block", fontSize: 13 }}>{titles.length} título(s)</strong>
              <small style={{ color: "var(--muted)" }}>Apropriado: {detailMoney(allocatedTotal)}</small>
            </div>
          </div>

          {titles.length === 0 ? (
            <div style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>
              Nenhum título vinculado a esta linha.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="registry-table finance-table" style={{ minWidth: 1180, margin: 0 }}>
                <thead>
                  <tr>
                    <th>Título / documento</th>
                    <th>Favorecido</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                    <th>Valor do título</th>
                    <th>Valor nesta linha</th>
                    <th>Pago nesta linha</th>
                    <th>Em aberto nesta linha</th>
                    <th>Pagamento</th>
                    <th>Pedido Koper</th>
                  </tr>
                </thead>
                <tbody>
                  {titles.map((title) => (
                    <tr key={title.id}>
                      <td>
                        <strong>{title.document}</strong>
                        <small>{[title.installmentLabel, title.notes].filter(Boolean).join(" · ")}</small>
                      </td>
                      <td>{title.supplierName}</td>
                      <td>{dateBR(title.dueDate)}</td>
                      <td><TitleStatus status={title.status} /></td>
                      <td><strong>{detailMoney(title.titleAmount)}</strong></td>
                      <td><strong>{detailMoney(title.allocatedAmount)}</strong></td>
                      <td>{detailMoney(title.paidAllocatedAmount)}</td>
                      <td>{detailMoney(title.openAllocatedAmount)}</td>
                      <td>
                        <span>{dateBR(title.paidAt)}</span>
                        <small>{title.paidAmount === null ? "" : detailMoney(title.paidAmount)}</small>
                      </td>
                      <td>{title.purchaseOrderRefs.length ? title.purchaseOrderRefs.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function CostVsBudgetServiceRow({
  row,
  titles,
}: {
  row: ServiceDisplayRow;
  titles: CostVsBudgetTitle[];
}) {
  const expansion = useContext(ExpansionContext);
  if (!expansion) throw new Error("CostVsBudgetServiceRow requires CostVsBudgetExpansionProvider");

  const expanded = expansion.expandedRowId === row.id;
  const toggle = () => expansion.toggle(row.id);
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  };

  return (
    <>
      <tr
        className={row.status === "over" || row.status === "no_budget" ? "danger" : ""}
        onClick={toggle}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        style={{ cursor: "pointer" }}
        title="Clique para ver os títulos vinculados"
      >
        <td style={{ paddingLeft: 30 }}>
          <strong>
            <span aria-hidden="true" style={{ display: "inline-block", width: 18 }}>{expanded ? "▾" : "▸"}</span>
            {row.displayCode} · {row.displayName}
          </strong>
          <small style={{ marginLeft: 18, color: "var(--muted)" }}>
            {titles.length ? `${titles.length} título(s) vinculado(s)` : "sem títulos vinculados"}
          </small>
        </td>
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
      {expanded ? <TitlesDetail row={row} titles={titles} /> : null}
    </>
  );
}
