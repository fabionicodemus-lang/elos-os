import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";

type Client = {
  id: string;
  name: string;
  tax_id: string | null;
};

type Unit = {
  id: string;
  code: string;
  floor: number | null;
  type: string | null;
};

type Sale = {
  id: string;
  number: string;
  contract_number: string | null;
  sale_date: string;
  total_amount: number;
  broker_name: string | null;
  status: "active" | "cancelled";
  payment_plan_available: boolean;
  source_system: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
};

type Summary = {
  total_count: number;
  active_count: number;
  cancelled_count: number;
  total_amount: number;
  average_ticket: number;
  payment_plan_missing_count: number;
};

const PAGE_SIZE = 50;

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function dateBR(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    client?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("sales.view");
  const queryText = (params.q ?? "").trim();
  const status = ["active", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const clientId = params.client ?? "";
  const dateFrom = params.from ?? "";
  const dateTo = params.to ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const clientsQuery = supabase
    .from("clients")
    .select("id, name, tax_id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("name")
    .limit(1200);

  let listQuery = supabase
    .from("sales")
    .select(
      "id, number, contract_number, sale_date, total_amount, broker_name, status, payment_plan_available, source_system, clients(id, name, tax_id), units(id, code, floor, type)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("sale_date", { ascending: false })
    .range(fromRow, toRow);

  if (projectId) listQuery = listQuery.eq("project_id", projectId);
  if (status) listQuery = listQuery.eq("status", status);
  if (clientId) listQuery = listQuery.eq("client_id", clientId);
  if (dateFrom) listQuery = listQuery.gte("sale_date", dateFrom);
  if (dateTo) listQuery = listQuery.lte("sale_date", dateTo);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(
      `number.ilike.%${safe}%,contract_number.ilike.%${safe}%,source_code.ilike.%${safe}%,broker_name.ilike.%${safe}%`,
    );
  }

  const [projectResult, clientsResult, listResult, summaryResult] = await Promise.all([
    projectQuery,
    clientsQuery,
    listQuery,
    supabase.rpc("sales_summary", { p_company_id: companyId, p_project_id: projectId }),
  ]);

  const schemaMissing =
    listResult.error?.code === "42P01" ||
    listResult.error?.message.includes("sales") ||
    summaryResult.error?.message.includes("sales_summary");

  const sales = (listResult.data ?? []) as unknown as Sale[];
  const clients = (clientsResult.data ?? []) as Client[];
  const summary = (summaryResult.data ?? {
    total_count: 0,
    active_count: 0,
    cancelled_count: 0,
    total_amount: 0,
    average_ticket: 0,
    payment_plan_missing_count: 0,
  }) as Summary;
  const totalPages = Math.max(1, Math.ceil((listResult.count ?? 0) / PAGE_SIZE));
  const project = projectResult.data;

  return (
    <AppShell
      activeGroup="commercial"
      activeItem="sales"
      eyebrow="Comercial"
      title="Vendas"
      description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : " · todas as obras"}`}
      actions={
        <>
          <Link className="elos-button" href="/comercial/planos-de-pagamento">Planos de pagamento</Link>
          <Link className="elos-button" href="/cadastros/clientes">Abrir clientes</Link>
        </>
      }
    >
      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura comercial</h2>
          <p>Execute no SQL Editor do Supabase o arquivo <code>supabase/migrations/20260723_0004_flow_sales.sql</code>.</p>
        </section>
      ) : (
        <>
          <section className="finance-summary-grid">
            <article><span>Valor vendido</span><strong>{money(summary.total_amount)}</strong><small>{summary.active_count} vendas ativas</small></article>
            <article><span>Vendas cadastradas</span><strong>{summary.total_count}</strong><small>{summary.cancelled_count} canceladas</small></article>
            <article><span>Ticket médio</span><strong>{money(summary.average_ticket)}</strong><small>vendas ativas</small></article>
            <article><span>Planos a detalhar</span><strong>{summary.payment_plan_missing_count}</strong><small>sem parcelas no relatório antigo</small></article>
          </section>

          {summary.payment_plan_missing_count > 0 ? (
            <div className="auth-message error workspace-message">
              Abra uma venda pelo botão <strong>Editar venda</strong> para conferir seus dados e cadastrar o plano de pagamento dentro do próprio contrato.
            </div>
          ) : null}

          <section className="registry-toolbar">
            <form className="finance-filter" method="get">
              <input name="q" defaultValue={queryText} placeholder="Venda, contrato, código ou corretor" />
              <select name="status" defaultValue={status}>
                <option value="">Todos os status</option>
                <option value="active">Ativas</option>
                <option value="cancelled">Canceladas</option>
              </select>
              <select name="client" defaultValue={clientId}>
                <option value="">Todos os clientes</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              <input name="from" type="date" defaultValue={dateFrom} />
              <input name="to" type="date" defaultValue={dateTo} />
              <button type="submit">Filtrar</button>
              <Link href="/comercial/vendas">Limpar</Link>
            </form>
          </section>

          <section className="registry-table-panel">
            <div className="section-heading">
              <div><span>Contratos de venda</span><h2>Vendas encontradas</h2></div>
              <p>{listResult.count ?? 0} venda(s) no filtro atual.</p>
            </div>

            <div className="registry-table-wrap">
              <table className="registry-table finance-table sales-table">
                <thead>
                  <tr><th>Unidade</th><th>Cliente</th><th>Venda / contrato</th><th>Data</th><th>Valor</th><th>Corretor</th><th>Status</th><th>Plano financeiro</th><th>Ação</th></tr>
                </thead>
                <tbody>
                  {sales.map((sale) => {
                    const client = relatedOne(sale.clients);
                    const unit = relatedOne(sale.units);
                    return (
                      <tr key={sale.id}>
                        <td><strong>{unit?.code || "—"}</strong><small>{unit?.floor ? `${unit.floor}º pavimento` : unit?.type}</small></td>
                        <td><strong>{client?.name || "Cliente"}</strong><small>{client?.tax_id}</small></td>
                        <td><span>{sale.number}</span><small>{sale.contract_number || "Sem número de contrato"}{sale.source_system === "koper_flow" ? " · KOPER" : ""}</small></td>
                        <td>{dateBR(sale.sale_date)}</td>
                        <td><strong>{money(sale.total_amount)}</strong></td>
                        <td>{sale.broker_name || "—"}</td>
                        <td><span className={`status-badge ${sale.status}`}>{sale.status === "active" ? "Ativa" : "Cancelada"}</span></td>
                        <td><span className={`status-badge ${sale.payment_plan_available ? "active" : "inactive"}`}>{sale.payment_plan_available ? "Disponível" : "A detalhar"}</span></td>
                        <td><Link className="table-action table-action-link" href={`/comercial/vendas/${sale.id}`}>Editar venda</Link></td>
                      </tr>
                    );
                  })}
                  {sales.length === 0 ? <tr><td className="empty-table" colSpan={9}>Nenhuma venda encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="registry-pagination">
              <span>Página {page} de {totalPages}</span>
              <div>
                {page > 1 ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&client=${clientId}&from=${dateFrom}&to=${dateTo}&page=${page - 1}`}>Anterior</Link> : null}
                {page < totalPages ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&client=${clientId}&from=${dateFrom}&to=${dateTo}&page=${page + 1}`}>Próxima</Link> : null}
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
