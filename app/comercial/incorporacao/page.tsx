import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [y,m,d] = value.slice(0,10).split("-");
  return `${d}/${m}/${y}`;
}

const transferLabels: Record<string,string> = {
  not_started: "Não iniciado", documents_pending: "Documentos", submitted: "Enviado ao banco",
  approved: "Aprovado", contracting: "Contratação", released: "Liberado", failed: "Pendência", cancelled: "Cancelado",
};

type Summary = {
  active_sales:number; cancelled_sales:number; contracted_amount:number; received_amount:number; open_amount:number;
  overdue_amount:number; overdue_installments:number; barter_amount:number; repasse_pending:number; collection_open:number; terminations_open:number;
};
type Row = {
  sale_id:string; project_id:string; sale_number:string; contract_number:string|null; sale_date:string; total_amount:number; sale_status:string;
  unit_code:string; client_name:string; received_amount:number; open_amount:number; overdue_amount:number; overdue_count:number;
  barter_amount:number; transfer_status:string; termination_status:string|null;
};

export default async function IncorporationPage({ searchParams }: { searchParams: Promise<{ q?:string; status?:string; error?:string; success?:string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("commercial.incorporation.view");
  const [summaryResult, portfolioResult] = await Promise.all([
    supabase.rpc("commercial_incorporation_summary", { p_company_id: companyId, p_project_id: projectId ?? null }),
    supabase.rpc("commercial_incorporation_portfolio", { p_company_id: companyId, p_project_id: projectId ?? null }),
  ]);
  const summary = (summaryResult.data ?? { active_sales:0,cancelled_sales:0,contracted_amount:0,received_amount:0,open_amount:0,overdue_amount:0,overdue_installments:0,barter_amount:0,repasse_pending:0,collection_open:0,terminations_open:0 }) as Summary;
  let rows = (portfolioResult.data ?? []) as Row[];
  const q = (params.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter(r => [r.sale_number,r.contract_number,r.unit_code,r.client_name].some(v => (v ?? "").toLowerCase().includes(q)));
  if (params.status === "overdue") rows = rows.filter(r => Number(r.overdue_amount) > 0);
  if (params.status === "repasse") rows = rows.filter(r => !["released","cancelled"].includes(r.transfer_status));
  if (params.status === "termination") rows = rows.filter(r => ["draft","approved"].includes(r.termination_status ?? ""));
  if (params.status === "active") rows = rows.filter(r => r.sale_status === "active");

  return <AppShell
    activeGroup="commercial" activeItem="incorporation" eyebrow="Comercial · Incorporação"
    title="Carteira da incorporadora"
    description={`${company.name} · contratos, recebíveis, permutas, repasses, cobrança, aditivos e distratos em uma única visão.`}
    actions={<>
      <Link className="elos-button" prefetch={false} href="/comercial/incorporacao/tabelas">Tabelas de venda</Link>
      <Link className="elos-button" prefetch={false} href="/comercial/propostas">Propostas</Link>
      <Link className="elos-button" prefetch={false} href="/comercial/vendas">Vendas</Link>
    </>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {summaryResult.error || portfolioResult.error ? <div className="auth-message error workspace-message">A migration do ERP de incorporação precisa estar aplicada antes de usar esta tela.</div> : null}

    <section className="finance-summary-grid">
      <article><span>VGV contratado ativo</span><strong>{money(summary.contracted_amount)}</strong><small>{summary.active_sales} venda(s) ativa(s)</small></article>
      <article><span>Recebido</span><strong>{money(summary.received_amount)}</strong><small>baixado na carteira</small></article>
      <article><span>Saldo a receber</span><strong>{money(summary.open_amount)}</strong><small>parcelas abertas</small></article>
      <article><span>Inadimplência</span><strong>{money(summary.overdue_amount)}</strong><small>{summary.overdue_installments} parcela(s) vencida(s)</small></article>
      <article><span>Permutas / dações</span><strong>{money(summary.barter_amount)}</strong><small>valor aceito na composição das vendas</small></article>
      <article><span>Repasse pendente</span><strong>{summary.repasse_pending}</strong><small>processos ainda não liberados</small></article>
      <article><span>Cobrança ativa</span><strong>{summary.collection_open}</strong><small>casos em acompanhamento</small></article>
      <article><span>Distratos em análise</span><strong>{summary.terminations_open}</strong><small>rascunho ou aprovado</small></article>
    </section>

    <section className="registry-toolbar">
      <form method="get" className="bank-filter">
        <input name="q" defaultValue={params.q ?? ""} placeholder="Cliente, unidade, venda ou contrato" />
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">Toda a carteira</option>
          <option value="active">Somente vendas ativas</option>
          <option value="overdue">Com inadimplência</option>
          <option value="repasse">Repasse pendente</option>
          <option value="termination">Distrato em análise</option>
        </select>
        <button type="submit">Filtrar</button>
        <Link prefetch={false} href="/comercial/incorporacao">Limpar</Link>
      </form>
    </section>

    <section className="registry-table-panel">
      <div className="section-heading"><div><span>Carteira contratual</span><h2>Unidades comercializadas</h2></div><small>{rows.length} registro(s)</small></div>
      <div className="registry-table-wrap"><table>
        <thead><tr><th>Venda</th><th>Cliente / unidade</th><th>Contrato</th><th>Valor</th><th>Recebido</th><th>Em aberto</th><th>Vencido</th><th>Permuta</th><th>Repasse</th><th></th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.sale_id}>
          <td><strong>{row.sale_number}</strong><br/><small>{dateBR(row.sale_date)} · {row.sale_status === "active" ? "Ativa" : "Cancelada"}</small></td>
          <td><strong>{row.client_name}</strong><br/><small>Unidade {row.unit_code}</small></td>
          <td>{row.contract_number || "—"}{row.termination_status ? <><br/><small>Distrato: {row.termination_status}</small></> : null}</td>
          <td>{money(row.total_amount)}</td>
          <td>{money(row.received_amount)}</td>
          <td>{money(row.open_amount)}</td>
          <td>{Number(row.overdue_amount) > 0 ? <strong>{money(row.overdue_amount)}</strong> : "—"}<br/>{Number(row.overdue_count) > 0 ? <small>{row.overdue_count} parcela(s)</small> : null}</td>
          <td>{Number(row.barter_amount) > 0 ? money(row.barter_amount) : "—"}</td>
          <td>{transferLabels[row.transfer_status] ?? row.transfer_status}</td>
          <td><Link prefetch={false} href={`/comercial/incorporacao/${row.sale_id}`}>Abrir carteira</Link></td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length ? <p>Nenhuma venda encontrada para os filtros atuais.</p> : null}
    </section>
  </AppShell>;
}
