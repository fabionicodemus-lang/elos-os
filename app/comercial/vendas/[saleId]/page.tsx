import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { updateSale } from "../actions";
import {
  cancelReceivable,
  createReceivableSeries,
  markReceivablePaid,
} from "@/app/comercial/planos-de-pagamento/actions";

type Client = {
  id: string;
  name: string;
  tax_id: string | null;
  status?: string;
};

type Unit = {
  id: string;
  code: string;
  floor: number | null;
  type: string | null;
  status: string;
};

type Sale = {
  id: string;
  project_id: string;
  client_id: string;
  unit_id: string;
  number: string;
  source_code: string | null;
  contract_number: string | null;
  sale_date: string;
  total_amount: number;
  commission_pct: number;
  commission_amount: number;
  broker_name: string | null;
  status: "active" | "cancelled";
  payment_plan_available: boolean;
  notes: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
  projects: { id: string; name: string; code: string | null } | { id: string; name: string; code: string | null }[] | null;
};

type Receivable = {
  id: string;
  category: string;
  description: string;
  sequence_number: number;
  sequence_total: number;
  due_date: string;
  amount: number;
  adjustment_index: string | null;
  interest_rate_monthly: number | null;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
  paid_account_name: string | null;
};

type Summary = {
  contracted_amount: number;
  total_count: number;
  open_count: number;
  paid_count: number;
  overdue_count: number;
  planned_amount: number;
  open_amount: number;
  paid_amount: number;
  unplanned_amount: number;
};

const categoryLabels: Record<string, string> = {
  entry: "Entrada",
  monthly: "Mensal",
  reinforcement: "Reforço",
  keys: "Chaves",
  post_keys: "Pós-chaves",
  other: "Outra",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function inputMoney(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2).replace(".", ",");
}

function dateBR(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default async function SaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { saleId } = await params;
  const messages = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("sales.view");
  const today = new Date().toISOString().slice(0, 10);

  const saleResult = await supabase
    .from("sales")
    .select("id, project_id, client_id, unit_id, number, source_code, contract_number, sale_date, total_amount, commission_pct, commission_amount, broker_name, status, payment_plan_available, notes, clients(id, name, tax_id), units(id, code, floor, type, status), projects(id, name, code)")
    .eq("id", saleId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!saleResult.data) notFound();
  const sale = saleResult.data as unknown as Sale;

  const [clientsResult, unitsResult, receivablesResult, summaryResult, salesManageResult, receivablesManageResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, tax_id, status")
      .eq("company_id", companyId)
      .order("name")
      .limit(1200),
    supabase
      .from("units")
      .select("id, code, floor, type, status")
      .eq("company_id", companyId)
      .eq("project_id", sale.project_id)
      .neq("status", "inactive")
      .order("code"),
    supabase
      .from("receivables")
      .select("id, category, description, sequence_number, sequence_total, due_date, amount, adjustment_index, interest_rate_monthly, status, paid_at, paid_amount, paid_account_name")
      .eq("company_id", companyId)
      .eq("sale_id", saleId)
      .order("due_date", { ascending: true })
      .limit(500),
    supabase.rpc("receivables_summary", {
      p_company_id: companyId,
      p_project_id: sale.project_id,
      p_sale_id: saleId,
    }),
    supabase.rpc("has_company_permission", {
      target_company_id: companyId,
      target_permission: "sales.manage",
    }),
    supabase.rpc("has_company_permission", {
      target_company_id: companyId,
      target_permission: "receivables.manage",
    }),
  ]);

  const client = relatedOne(sale.clients);
  const unit = relatedOne(sale.units);
  const project = relatedOne(sale.projects);
  const clients = (clientsResult.data ?? []) as Client[];
  const units = (unitsResult.data ?? []) as Unit[];
  const receivables = (receivablesResult.data ?? []) as Receivable[];
  const summary = (summaryResult.data ?? {
    contracted_amount: sale.total_amount,
    total_count: 0,
    open_count: 0,
    paid_count: 0,
    overdue_count: 0,
    planned_amount: 0,
    open_amount: 0,
    paid_amount: 0,
    unplanned_amount: sale.total_amount,
  }) as Summary;
  const privileged = roleKey === "owner" || roleKey === "admin";
  const canEditSale = salesManageResult.data === true || privileged;
  const canManagePlan = receivablesManageResult.data === true || privileged;
  const returnPath = `/comercial/vendas/${saleId}`;

  return (
    <AppShell
      activeGroup="commercial"
      activeItem="sales"
      eyebrow="Comercial · Contrato de venda"
      title={`Venda ${sale.number}`}
      description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : ""}`}
      actions={
        <>
          <Link className="elos-button" href="/comercial/vendas">Voltar às vendas</Link>
          <Link className="elos-button" href={`/comercial/planos-de-pagamento?sale=${sale.id}`}>Visão financeira</Link>
        </>
      }
    >
      {messages.error ? <div className="auth-message error workspace-message">{messages.error}</div> : null}
      {messages.success ? <div className="auth-message success workspace-message">{messages.success}</div> : null}

      <section className="sale-detail-hero">
        <div>
          <span>Unidade e cliente</span>
          <h2>{unit?.code || "Unidade"} · {client?.name || "Cliente"}</h2>
          <p>Contrato {sale.contract_number || "sem numeração"} · venda em {dateBR(sale.sale_date)}</p>
        </div>
        <div className="sale-detail-values">
          <div><span>Valor contratado</span><strong>{money(sale.total_amount)}</strong></div>
          <div><span>Plano cadastrado</span><strong>{money(summary.planned_amount)}</strong></div>
          <div><span>A detalhar</span><strong>{money(summary.unplanned_amount)}</strong></div>
        </div>
      </section>

      <section className="finance-summary-grid sale-finance-summary">
        <article><span>Parcelas</span><strong>{summary.total_count}</strong><small>{summary.open_count} em aberto</small></article>
        <article><span>Em aberto</span><strong>{money(summary.open_amount)}</strong><small>{summary.overdue_count} vencida(s)</small></article>
        <article><span>Recebido</span><strong>{money(summary.paid_amount)}</strong><small>{summary.paid_count} parcela(s)</small></article>
        <article><span>Situação do plano</span><strong>{summary.unplanned_amount <= 0.01 ? "Completo" : "Incompleto"}</strong><small>{sale.payment_plan_available ? "plano iniciado" : "sem parcelas"}</small></article>
      </section>

      <section className="sale-detail-columns">
        <details className="registry-create sale-edit-panel" open={summary.total_count === 0}>
          <summary>Editar dados da venda</summary>
          {canEditSale ? (
            <form action={updateSale}>
              <input type="hidden" name="sale_id" value={sale.id} />
              <div className="registry-form-grid sale-edit-grid">
                <label>Cliente
                  <select name="client_id" defaultValue={sale.client_id} required>
                    {clients.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "inactive" ? " · inativo" : ""}</option>)}
                  </select>
                </label>
                <label>Unidade
                  <select name="unit_id" defaultValue={sale.unit_id} required>
                    {units.map((item) => (
                      <option key={item.id} value={item.id} disabled={item.status === "sold" && item.id !== sale.unit_id}>
                        {item.code}{item.type ? ` · ${item.type}` : ""}{item.status === "sold" && item.id !== sale.unit_id ? " · vendida" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Identificação da venda<input name="number" defaultValue={sale.number} required /></label>
                <label>Código de origem<input name="source_code" defaultValue={sale.source_code ?? ""} /></label>
                <label>Número do contrato<input name="contract_number" defaultValue={sale.contract_number ?? ""} /></label>
                <label>Data da venda<input name="sale_date" type="date" defaultValue={sale.sale_date} required /></label>
                <label>Valor total<input name="total_amount" inputMode="decimal" defaultValue={inputMoney(sale.total_amount)} required /></label>
                <label>Comissão (%)<input name="commission_pct" inputMode="decimal" defaultValue={inputMoney(sale.commission_pct)} /></label>
                <label>Corretor / origem<input name="broker_name" defaultValue={sale.broker_name ?? ""} /></label>
                <label>Status
                  <select name="status" defaultValue={sale.status}>
                    <option value="active">Ativa</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </label>
                <label className="registry-wide">Observações<textarea name="notes" rows={3} defaultValue={sale.notes ?? ""} /></label>
              </div>
              <button className="auth-primary" type="submit">Salvar alterações da venda</button>
            </form>
          ) : <p className="sale-readonly-message">Seu perfil possui acesso somente para consulta.</p>}
        </details>

        <details className="registry-create sale-plan-panel" open={summary.total_count === 0}>
          <summary>+ Adicionar ao plano de pagamento</summary>
          {canManagePlan && sale.status === "active" ? (
            <form action={createReceivableSeries}>
              <input type="hidden" name="sale_id" value={sale.id} />
              <input type="hidden" name="return_path" value={returnPath} />
              <div className="registry-form-grid receivable-plan-grid">
                <label>Tipo
                  <select name="category" defaultValue="monthly" required>
                    {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>Descrição<input name="description" placeholder="Ex.: Mensais até as chaves" /></label>
                <label>Primeiro vencimento<input name="first_due_date" type="date" required /></label>
                <label>Valor por parcela<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
                <label>Quantidade<input name="quantity" type="number" min={1} max={240} defaultValue={1} required /></label>
                <label>Periodicidade
                  <select name="frequency" defaultValue="monthly">
                    <option value="once">Única</option>
                    <option value="monthly">Mensal</option>
                    <option value="bimonthly">Bimestral</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="semiannual">Semestral</option>
                    <option value="annual">Anual</option>
                  </select>
                </label>
                <label>Índice de correção<input name="adjustment_index" placeholder="CUB, INCC, IPCA..." /></label>
                <label>Juros ao mês (%)<input name="interest_rate_monthly" inputMode="decimal" placeholder="0,00" /></label>
                <label className="registry-wide">Observações<textarea name="notes" rows={3} /></label>
              </div>
              <button className="auth-primary" type="submit">Adicionar parcelas à venda</button>
            </form>
          ) : <p className="sale-readonly-message">Venda cancelada ou perfil sem permissão para alterar o plano.</p>}
        </details>
      </section>

      <section className="registry-table-panel sale-plan-table-panel">
        <div className="section-heading">
          <div><span>Plano do contrato</span><h2>Parcelas da venda</h2></div>
          <p>{receivables.length} parcela(s) cadastrada(s) · diferença para o contrato: {money(summary.unplanned_amount)}</p>
        </div>

        <div className="registry-table-wrap">
          <table className="registry-table finance-table">
            <thead>
              <tr><th>Tipo</th><th>Descrição</th><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Correção</th><th>Status</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {receivables.map((receivable) => {
                const overdue = receivable.status === "open" && receivable.due_date < today;
                return (
                  <tr key={receivable.id}>
                    <td><span>{categoryLabels[receivable.category] || "Outra"}</span></td>
                    <td><strong>{receivable.description}</strong></td>
                    <td>{receivable.sequence_number}/{receivable.sequence_total}</td>
                    <td>{dateBR(receivable.due_date)}</td>
                    <td><strong>{money(receivable.amount)}</strong>{receivable.status === "paid" ? <small>Recebido: {money(receivable.paid_amount)}</small> : null}</td>
                    <td><span>{receivable.adjustment_index || "—"}</span><small>{receivable.interest_rate_monthly ? `${receivable.interest_rate_monthly}% a.m.` : ""}</small></td>
                    <td><span className={`status-badge ${receivable.status}`}>{receivable.status === "paid" ? "Recebida" : receivable.status === "cancelled" ? "Cancelada" : overdue ? "Vencida" : "Em aberto"}</span></td>
                    <td>
                      {canManagePlan && receivable.status === "open" ? (
                        <div className="payable-actions">
                          <details>
                            <summary>Baixar</summary>
                            <form action={markReceivablePaid}>
                              <input type="hidden" name="receivable_id" value={receivable.id} />
                              <input type="hidden" name="sale_id" value={sale.id} />
                              <input type="hidden" name="return_path" value={returnPath} />
                              <label>Data recebida<input name="paid_at" type="date" defaultValue={today} required /></label>
                              <label>Valor recebido<input name="paid_amount" inputMode="decimal" defaultValue={inputMoney(receivable.amount)} required /></label>
                              <label>Conta / banco<input name="paid_account_name" /></label>
                              <button type="submit">Registrar recebimento</button>
                            </form>
                          </details>
                          <form action={cancelReceivable}>
                            <input type="hidden" name="receivable_id" value={receivable.id} />
                            <input type="hidden" name="sale_id" value={sale.id} />
                            <input type="hidden" name="return_path" value={returnPath} />
                            <button className="table-action" type="submit">Cancelar</button>
                          </form>
                        </div>
                      ) : <span>—</span>}
                    </td>
                  </tr>
                );
              })}
              {receivables.length === 0 ? <tr><td className="empty-table" colSpan={8}>Nenhuma parcela cadastrada. Use o formulário acima para montar o plano desta venda.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
