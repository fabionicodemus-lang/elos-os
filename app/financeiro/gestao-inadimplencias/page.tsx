import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";

type MoneyValue = number | string | null;
type Project = { id: string; name: string; code: string | null; status: string | null };
type Debtor = {
  client_id: string;
  client_name: string;
  tax_id: string | null;
  projects: string | null;
  project_count: number;
  overdue_amount: MoneyValue;
  open_amount: MoneyValue;
  overdue_installments: number;
  open_installments: number;
  oldest_due_date: string | null;
  max_days_overdue: number;
};
type Overview = {
  as_of_date: string;
  open_amount: MoneyValue;
  open_installments: number;
  overdue_amount: MoneyValue;
  overdue_installments: number;
  debtor_count: number;
  matched_debtor_count: number;
  aging_1_30: MoneyValue;
  aging_31_60: MoneyValue;
  aging_61_90: MoneyValue;
  aging_91_plus: MoneyValue;
  debtors: Debtor[];
};
type Installment = {
  id: string;
  project_id: string;
  project_name: string | null;
  project_code: string | null;
  unit_code: string | null;
  sale_id: string;
  sale_number: string | null;
  category: string;
  description: string;
  sequence_number: number;
  sequence_total: number;
  due_date: string;
  amount: MoneyValue;
  adjusted_amount: MoneyValue;
  paid_amount: MoneyValue;
  balance: MoneyValue;
  is_overdue: boolean;
  days_overdue: number;
};
type InstallmentReport = {
  client_id: string;
  client_name: string;
  open_amount: MoneyValue;
  overdue_amount: MoneyValue;
  open_installments: number;
  overdue_installments: number;
  installments: Installment[];
};

const DEBTOR_PAGE_SIZE = 25;
const INSTALLMENT_PAGE_SIZE = 40;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categoryLabels: Record<string, string> = {
  entry: "Entrada",
  monthly: "Mensal",
  reinforcement: "Reforço",
  keys: "Chaves",
  post_keys: "Pós-chaves",
  other: "Outra",
};

function amount(value: MoneyValue | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: MoneyValue | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount(value));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function positivePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 10_000)) : 1;
}

function reportUrl({ project, q, page, client, itemPage }: {
  project: string;
  q?: string;
  page?: number;
  client?: string | null;
  itemPage?: number;
}) {
  const params = new URLSearchParams({ project });
  if (q) params.set("q", q);
  if (page && page > 1) params.set("page", String(page));
  if (client) params.set("client", client);
  if (itemPage && itemPage > 1) params.set("itemPage", String(itemPage));
  return `/financeiro/gestao-inadimplencias?${params.toString()}`;
}

export default async function DelinquencyManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; q?: string; page?: string; client?: string; itemPage?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("receivables.view");
  const projectsResult = await supabase
    .from("projects")
    .select("id, name, code, status")
    .eq("company_id", companyId)
    .order("name");
  const projects = (projectsResult.data ?? []) as Project[];
  const rawProject = typeof params.project === "string" ? params.project : undefined;
  const defaultProject = projectId && projects.some((item) => item.id === projectId) ? projectId : "all";
  const project = rawProject === "all" || projects.some((item) => item.id === rawProject)
    ? rawProject!
    : defaultProject;
  const selectedProjectId = project === "all" ? null : project;
  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const search = (typeof params.q === "string" ? params.q : "").trim().slice(0, 80);
  const page = positivePage(params.page);
  const itemPage = positivePage(params.itemPage);
  const rawClient = typeof params.client === "string" ? params.client : "";
  const clientId = UUID_PATTERN.test(rawClient) ? rawClient : null;

  const [overviewResult, installmentsResult] = await Promise.all([
    supabase.rpc("finance_delinquency_overview", {
      p_company_id: companyId,
      p_project_id: selectedProjectId,
      p_search: search || null,
      p_limit: DEBTOR_PAGE_SIZE,
      p_offset: (page - 1) * DEBTOR_PAGE_SIZE,
    }),
    clientId
      ? supabase.rpc("finance_delinquency_installments", {
          p_company_id: companyId,
          p_client_id: clientId,
          p_project_id: selectedProjectId,
          p_limit: INSTALLMENT_PAGE_SIZE,
          p_offset: (itemPage - 1) * INSTALLMENT_PAGE_SIZE,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const overview = overviewResult.data as Overview | null;
  const installments = installmentsResult.data as InstallmentReport | null;
  const debtorPages = Math.max(1, Math.ceil(Number(overview?.matched_debtor_count ?? 0) / DEBTOR_PAGE_SIZE));
  const installmentPages = Math.max(1, Math.ceil(Number(installments?.open_installments ?? 0) / INSTALLMENT_PAGE_SIZE));
  const overdueTotal = amount(overview?.overdue_amount);
  const aging = overview ? [
    { label: "1 a 30 dias", value: amount(overview.aging_1_30), tone: "recent" },
    { label: "31 a 60 dias", value: amount(overview.aging_31_60), tone: "attention" },
    { label: "61 a 90 dias", value: amount(overview.aging_61_90), tone: "warning" },
    { label: "Acima de 90 dias", value: amount(overview.aging_91_plus), tone: "critical" },
  ] : [];

  return (
    <AppShell
      activeGroup="finance"
      activeItem="delinquency"
      eyebrow="Financeiro · Carteira de recebíveis"
      title="Gestão de Inadimplências"
      description={`${company.name} · ${selectedProject ? [selectedProject.code, selectedProject.name].filter(Boolean).join(" · ") : "todos os empreendimentos"}`}
      actions={<Link prefetch={false} className="elos-button" href="/financeiro/contas-a-receber">Contas a Receber</Link>}
    >
      {projectsResult.error ? (
        <div className="auth-message error workspace-message">Não foi possível carregar a lista de empreendimentos.</div>
      ) : null}

      {overviewResult.error || !overview ? (
        <div className="auth-message error workspace-message">
          Não foi possível carregar a Gestão de Inadimplências. Confira se a atualização financeira foi aplicada no Supabase.
        </div>
      ) : (
        <>
          <section className="finance-summary-grid delinquency-summary" aria-label="Resumo da inadimplência">
            <article className="delinquency-summary-overdue"><span>Total vencido</span><strong>{money(overview.overdue_amount)}</strong><small>Saldo das parcelas em atraso</small></article>
            <article><span>Clientes inadimplentes</span><strong>{Number(overview.debtor_count)}</strong><small>Com pelo menos uma parcela vencida</small></article>
            <article><span>Parcelas vencidas</span><strong>{Number(overview.overdue_installments)}</strong><small>Ainda com saldo a receber</small></article>
            <article><span>Total em aberto</span><strong>{money(overview.open_amount)}</strong><small>{Number(overview.open_installments)} parcelas vencidas e futuras</small></article>
          </section>

          <section className="delinquency-aging-panel" aria-label="Valores vencidos por faixa de atraso">
            <div className="section-heading">
              <div><span>Envelhecimento da dívida</span><h2>Há quanto tempo as parcelas estão vencidas?</h2></div>
              <p>Posição em {dateBR(overview.as_of_date)} · valores corrigidos, descontando recebimentos parciais.</p>
            </div>
            <div className="delinquency-aging-grid">
              {aging.map((bucket) => {
                const share = overdueTotal > 0 ? Math.min(100, (bucket.value / overdueTotal) * 100) : 0;
                return <article key={bucket.label} className={`delinquency-aging-${bucket.tone}`}>
                  <span>{bucket.label}</span>
                  <strong>{money(bucket.value)}</strong>
                  <div className="delinquency-aging-track" role="progressbar" aria-label={`${bucket.label}: ${money(bucket.value)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
                    <span style={{ width: `${share}%` }} />
                  </div>
                  <small>{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(share)}% do total vencido</small>
                </article>;
              })}
            </div>
          </section>

          <section className="registry-toolbar">
            <form method="get" className="delinquency-filter">
              <label>
                <span>Empreendimento</span>
                <select name="project" defaultValue={project}>
                  <option value="all">Construtora toda</option>
                  {projects.map((item) => <option key={item.id} value={item.id}>
                    {[item.code, item.name].filter(Boolean).join(" · ")}{item.status === "archived" ? " (arquivado)" : ""}
                  </option>)}
                </select>
              </label>
              <label>
                <span>Cliente</span>
                <input name="q" defaultValue={search} placeholder="Nome, CPF ou CNPJ" maxLength={80} />
              </label>
              <button type="submit">Filtrar</button>
              <Link prefetch={false} href="/financeiro/gestao-inadimplencias">Limpar</Link>
            </form>
            <p className="delinquency-filter-note">Os indicadores e as faixas de atraso consideram todo o empreendimento selecionado. A busca por cliente filtra somente a lista abaixo.</p>
          </section>

          <section className="registry-table-panel delinquency-debtors-panel">
            <div className="section-heading">
              <div><span>Carteira em atraso</span><h2>Inadimplentes por cliente</h2></div>
              <p>{Number(overview.matched_debtor_count)} cliente(s) no filtro · ordem pelo maior saldo vencido</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table finance-table delinquency-table">
                <thead><tr>
                  <th>Cliente</th><th>Empreendimento</th><th>Parcelas vencidas</th><th>Mais antiga</th><th>Total vencido</th><th>Total em aberto</th><th>Ação</th>
                </tr></thead>
                <tbody>
                  {(overview.debtors ?? []).map((debtor) => (
                    <tr key={debtor.client_id} className={clientId === debtor.client_id ? "delinquency-selected-row" : ""}>
                      <td><strong>{debtor.client_name}</strong><span>{debtor.tax_id || "CPF/CNPJ não informado"}</span></td>
                      <td><strong>{debtor.projects || "—"}</strong><small>{Number(debtor.project_count)} empreendimento(s)</small></td>
                      <td><strong>{Number(debtor.overdue_installments)}</strong><small>{Number(debtor.open_installments)} em aberto no total</small></td>
                      <td><strong>{dateBR(debtor.oldest_due_date)}</strong><small>{Number(debtor.max_days_overdue)} dia(s) de atraso</small></td>
                      <td><strong className="delinquency-money-alert">{money(debtor.overdue_amount)}</strong></td>
                      <td><strong>{money(debtor.open_amount)}</strong></td>
                      <td><Link prefetch={false} className="table-action" href={`${reportUrl({ project, q: search, page, client: debtor.client_id })}#parcelas`}>Ver parcelas</Link></td>
                    </tr>
                  ))}
                  {overview.debtors.length === 0 ? <tr><td colSpan={7} className="empty-table">Nenhum cliente com parcelas vencidas neste filtro.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="registry-pagination">
              <span>Página {page} de {debtorPages}</span>
              <div>
                {page > 1 ? <Link prefetch={false} href={reportUrl({ project, q: search, page: page - 1, client: clientId, itemPage })}>Anterior</Link> : null}
                {page < debtorPages ? <Link prefetch={false} href={reportUrl({ project, q: search, page: page + 1, client: clientId, itemPage })}>Próxima</Link> : null}
              </div>
            </div>
          </section>

          {clientId ? <section id="parcelas" className="registry-table-panel delinquency-installments-panel">
            {installmentsResult.error || !installments ? (
              <div className="auth-message error workspace-message">Não foi possível consultar as parcelas deste cliente.</div>
            ) : <>
              <div className="section-heading">
                <div><span>Detalhamento do cliente</span><h2>{installments.client_name}</h2></div>
                <Link prefetch={false} className="elos-button" href={reportUrl({ project, q: search, page })}>Fechar detalhes</Link>
              </div>
              <div className="delinquency-client-summary">
                <div><span>Vencido</span><strong>{money(installments.overdue_amount)}</strong><small>{Number(installments.overdue_installments)} parcela(s) em atraso</small></div>
                <div><span>Em aberto</span><strong>{money(installments.open_amount)}</strong><small>{Number(installments.open_installments)} parcela(s) vencidas e futuras</small></div>
              </div>
              <div className="registry-table-wrap">
                <table className="registry-table finance-table delinquency-table">
                  <thead><tr>
                    <th>Empreendimento / unidade</th><th>Parcela</th><th>Vencimento</th><th>Valor atualizado</th><th>Já recebido</th><th>Saldo</th><th>Situação</th><th>Venda</th>
                  </tr></thead>
                  <tbody>
                    {(installments.installments ?? []).map((item) => (
                      <tr key={item.id}>
                        <td><strong>{[item.project_code, item.project_name].filter(Boolean).join(" · ") || "Empreendimento"}</strong><span>Unidade {item.unit_code || "—"}</span></td>
                        <td><strong>{categoryLabels[item.category] || item.category}</strong><span>{item.description}</span><small>{item.sequence_number} / {item.sequence_total}</small></td>
                        <td>{dateBR(item.due_date)}</td>
                        <td>{money(item.adjusted_amount)}</td>
                        <td>{money(item.paid_amount)}</td>
                        <td><strong className={item.is_overdue ? "delinquency-money-alert" : ""}>{money(item.balance)}</strong></td>
                        <td><span className={`status-badge ${item.is_overdue ? "overdue" : "open"}`}>{item.is_overdue ? `${item.days_overdue} dia(s) em atraso` : "A vencer"}</span></td>
                        <td><Link prefetch={false} className="table-action" href={`/comercial/vendas/${item.sale_id}`}>{item.sale_number || "Abrir venda"}</Link></td>
                      </tr>
                    ))}
                    {installments.installments.length === 0 ? <tr><td className="empty-table" colSpan={8}>Nenhuma parcela com saldo em aberto neste filtro.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="registry-pagination">
                <span>Página {itemPage} de {installmentPages}</span>
                <div>
                  {itemPage > 1 ? <Link prefetch={false} href={`${reportUrl({ project, q: search, page, client: clientId, itemPage: itemPage - 1 })}#parcelas`}>Anterior</Link> : null}
                  {itemPage < installmentPages ? <Link prefetch={false} href={`${reportUrl({ project, q: search, page, client: clientId, itemPage: itemPage + 1 })}#parcelas`}>Próxima</Link> : null}
                </div>
              </div>
            </>}
          </section> : null}
        </>
      )}
    </AppShell>
  );
}
