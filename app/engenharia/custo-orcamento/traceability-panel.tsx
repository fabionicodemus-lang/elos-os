import { loadCostTraceability } from "@/lib/cost-vs-budget/traceability";
import { requireCompanyPermission } from "@/lib/workspace";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export async function TraceabilityPanel() {
  const { supabase, companyId, projectId } = await requireCompanyPermission("budgets.view");
  const context = await loadCostTraceability({ supabase, companyId, projectId });
  if (!projectId) return null;

  const unallocatedStages = [
    context.totals.unallocatedReceived,
    context.totals.unallocatedInvoiced,
    context.totals.unallocatedPaid,
  ].filter((value) => value > 0.01).length;

  return (
    <>
      {context.errors.length ? (
        <div className="auth-message error workspace-message">
          Parte da rastreabilidade financeira não pôde ser carregada: {context.errors.join(" · ")}
        </div>
      ) : null}

      <section className="registry-table-panel forecast-service-panel">
        <div className="section-heading">
          <div>
            <span>Rastreabilidade da compra</span>
            <h2>Pedido → recebimento → NF-e → pagamento</h2>
          </div>
          <p>{context.rows.length} centro(s) com movimentação</p>
        </div>

        <section className="forecast-kpis" style={{ marginBottom: 24 }}>
          <article className="actual">
            <span>Materiais recebidos</span>
            <strong>{money(context.totals.received)}</strong>
            <small>itens aceitos em recebimentos aprovados</small>
          </article>
          <article className="committed">
            <span>Materiais faturados</span>
            <strong>{money(context.totals.invoiced)}</strong>
            <small>itens de notas eletrônicas aprovadas</small>
          </article>
          <article className="ok">
            <span>Materiais pagos</span>
            <strong>{money(context.totals.paid)}</strong>
            <small>pagamentos rateados pelos serviços da NF-e</small>
          </article>
          <article className={unallocatedStages > 0 ? "danger" : "ok"}>
            <span>Etapas sem apropriação</span>
            <strong>{unallocatedStages}</strong>
            <small>
              recebido {money(context.totals.unallocatedReceived)} · faturado {money(context.totals.unallocatedInvoiced)} · pago {money(context.totals.unallocatedPaid)}
            </small>
          </article>
        </section>

        <div className="forecast-formula-panel" style={{ marginBottom: 24 }}>
          <div>
            <span>Como interpretar</span>
            <h2>São etapas do mesmo custo, não valores para somar</h2>
          </div>
          <p>
            O recebimento herda o serviço do item do pedido. A NF-e herda o serviço do pedido ou do recebimento e o pagamento é distribuído proporcionalmente pelos serviços da nota. Assim, o vínculo iniciado pelo koper-worker permanece rastreável até o financeiro.
          </p>
        </div>

        <div className="registry-table-wrap">
          <table className="registry-table forecast-service-table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Centro de custo · Serviço</th>
                <th>Recebido</th>
                <th>Faturado</th>
                <th>Pago</th>
                <th>Apropriação</th>
              </tr>
            </thead>
            <tbody>
              {context.rows.map((row) => (
                <tr key={row.id} className={row.status === "unallocated" ? "danger" : ""}>
                  <td><strong>{row.code} · {row.name}</strong></td>
                  <td>{money(row.receivedAmount)}</td>
                  <td>{money(row.invoicedAmount)}</td>
                  <td>{money(row.paidAmount)}</td>
                  <td>
                    {row.status === "unallocated" ? (
                      <span className="cashflow-direction out">Sem apropriação</span>
                    ) : (
                      <span className="cashflow-direction in">Apropriado</span>
                    )}
                  </td>
                </tr>
              ))}
              {context.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="budget-empty-state">
                    <strong>Ainda não há recebimentos, notas ou pagamentos rastreáveis nesta obra.</strong>
                    <span>Os pedidos emitidos continuam visíveis na comparação principal como custo comprometido.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th>Total da obra</th>
                <th>{money(context.totals.received)}</th>
                <th>{money(context.totals.invoiced)}</th>
                <th>{money(context.totals.paid)}</th>
                <th>—</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
