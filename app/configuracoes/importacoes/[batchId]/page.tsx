import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { ImportControls } from "../import-controls";
import { BATCH_LABELS, ENTITY_LABELS, ROW_LABELS, dateBR, moneyBR, pageNumber, rowText, statusTone, type ImportSummary } from "../import-presentation";
import "../eobra-import.css";

type Batch = {
  id: string;
  project_id: string | null;
  source_host: string;
  entity_kind: string;
  file_name: string;
  sheet_name: string;
  reference_date: string;
  status: string;
  preview_hash: string;
  summary: ImportSummary | null;
  promotion_result: { created?: number; reused?: number; duplicates?: number; total?: number } | null;
  created_at: string;
  promoted_at: string | null;
  cancelled_at: string | null;
};

type ImportRow = {
  id: string;
  source_row: number;
  external_id: string | null;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  status: string;
  target_id: string | null;
};

const FINANCIAL_STATUS: Record<string, string> = { open: "Em aberto", paid: "Pago", cancelled: "Cancelado na origem", partial: "Pagamento parcial", unknown: "Situação não identificada" };

function RowNotes({ row }: { row: ImportRow }) {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  return (
    <div className="eobra-row-notes">
      {errors.length ? <ul className="eobra-row-errors">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
      {warnings.length ? <ul className="eobra-row-warnings">{warnings.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
      {!errors.length && !warnings.length ? <span className="eobra-muted">Sem pendências nesta linha</span> : null}
      <details className="eobra-raw-details"><summary>Ver dados do arquivo</summary><dl className="eobra-raw-data">
        {Object.entries(row.raw_data ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{rowText(value)}</dd></div>)}
      </dl></details>
    </div>
  );
}

export default async function ImportReviewPage({ params, searchParams }: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ page?: string; status?: string; success?: string; error?: string }>;
}) {
  const [{ batchId }, search] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) notFound();
  const { supabase, company, companyId } = await requireCompanyPermission("admin.company.manage");
  const batchResult = await supabase.from("integration_import_batches")
    .select("id,project_id,source_host,entity_kind,file_name,sheet_name,reference_date,status,preview_hash,summary,promotion_result,created_at,promoted_at,cancelled_at")
    .eq("company_id", companyId).eq("id", batchId).maybeSingle();
  if (batchResult.error) {
    return <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Revisar importação" description={company.name}
      actions={<Link prefetch={false} className="elos-button" href="/configuracoes/importacoes">← Importações</Link>}>
      <div role="alert" className="auth-message error workspace-message">Não foi possível carregar esta prévia. Atualize a página antes de continuar.</div>
    </AppShell>;
  }
  if (!batchResult.data) notFound();
  const batch = batchResult.data as Batch;
  const financial = batch.entity_kind === "payable" || batch.entity_kind === "receivable";
  const page = pageNumber(search.page);
  const status = search.status && Object.hasOwn(ROW_LABELS, search.status) ? search.status : "";
  let rowsQuery = supabase.from("integration_import_rows")
    .select("id,source_row,external_id,raw_data,normalized_data,errors,warnings,status,target_id", { count: "exact" })
    .eq("company_id", companyId).eq("batch_id", batchId)
    .order("source_row").order("id").range((page - 1) * 50, page * 50 - 1);
  if (status) rowsQuery = rowsQuery.eq("status", status);
  const [rowsResult, blockedResult, projectResult] = await Promise.all([
    rowsQuery,
    supabase.from("integration_import_rows").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("batch_id", batchId).in("status", ["blocked", "conflict"]),
    batch.project_id ? supabase.from("projects").select("id,name,code").eq("company_id", companyId).eq("id", batch.project_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const rows = (rowsResult.data ?? []) as ImportRow[];
  const summary = batch.summary ?? {};
  const ready = Number(summary.ready ?? 0);
  const blocked = Number(summary.blocked ?? 0);
  const conflicts = Number(summary.conflicts ?? 0);
  const loadError = Boolean(rowsResult.error || blockedResult.error || projectResult.error);
  const unresolved = Math.max(blocked + conflicts, blockedResult.count ?? 0);
  const editable = batch.status === "ready" || batch.status === "review";
  const canPromote = batch.status === "ready" && !loadError && unresolved === 0 && Number(summary.total ?? 0) > 0 && Boolean(batch.preview_hash) && (!financial || (Boolean(projectResult.data) && summary.totals_complete !== false));
  const count = rowsResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / 50));
  const pageHref = (target: number) => {
    const query = new URLSearchParams({ page: String(target) });
    if (status) query.set("status", status);
    return `/configuracoes/importacoes/${batch.id}?${query.toString()}#registros`;
  };
  const sourceHref = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.eobra\.com\.br$/i.test(batch.source_host) ? `https://${batch.source_host}` : null;

  return (
    <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Conferir importação do eObra"
      description={`${company.name} · ${ENTITY_LABELS[batch.entity_kind] ?? batch.entity_kind} · ${financial ? projectResult.data?.name ?? "obra indisponível" : "cadastros da empresa"}`}
      actions={<Link prefetch={false} className="elos-button" href="/configuracoes/importacoes#historico">← Importações</Link>}>
      <div className="eobra-import-page">
        {search.success ? <div role="status" className="auth-message success workspace-message">{search.success}</div> : null}
        {search.error ? <div role="alert" className="auth-message error workspace-message">{search.error}</div> : null}
        {loadError ? <div role="alert" className="auth-message error workspace-message">A leitura desta prévia ficou incompleta. Atualize a página antes de confirmar qualquer operação.</div> : null}

        <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">Prévia do lote</span><h2>{batch.file_name}</h2></div><span className={`eobra-status ${statusTone(batch.status)}`}>{BATCH_LABELS[batch.status] ?? batch.status}</span></div>
          <dl className="eobra-metadata">
            <div><dt>Empresa de destino</dt><dd>{company.name}</dd></div>
            <div><dt>{financial ? "Obra de destino" : "Escopo"}</dt><dd>{financial ? projectResult.data?.name ?? "Obra indisponível" : "Cadastros da empresa"}</dd></div>
            <div><dt>Ambiente de origem</dt><dd>{sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer">{batch.source_host} ↗</a> : batch.source_host}</dd></div>
            <div><dt>Aba do arquivo</dt><dd>{batch.sheet_name || "—"}</dd></div>
            <div><dt>Data de referência</dt><dd>{dateBR(batch.reference_date)}</dd></div>
            <div><dt>Prévia preparada</dt><dd>{dateBR(batch.created_at, true)}</dd></div>
          </dl>
          {batch.status === "imported" ? <div role="status" className="eobra-result"><strong>Importação concluída em {dateBR(batch.promoted_at, true)}</strong><p>{Number(batch.promotion_result?.created ?? 0).toLocaleString("pt-BR")} registro(s) criado(s), {Number(batch.promotion_result?.reused ?? 0).toLocaleString("pt-BR")} vinculado(s) a cadastros existentes e {Number(batch.promotion_result?.duplicates ?? 0).toLocaleString("pt-BR")} já importado(s).</p></div> : batch.status === "cancelled" ? <p className="eobra-muted">Esta prévia foi cancelada em {dateBR(batch.cancelled_at, true)}. Para continuar, envie o arquivo em um novo lote.</p> : <p className="eobra-muted">Este lote está em revisão. Os registros desta prévia só entram nos cadastros e no financeiro após a confirmação da importação.</p>}
        </section>

        <section className="eobra-kpis" aria-label="Resultado da validação">
          <article className="registry-table-panel"><span>Linhas na prévia</span><strong>{Number(summary.total ?? 0).toLocaleString("pt-BR")}</strong><small>Todas as linhas do lote</small></article>
          <article className="registry-table-panel"><span>{batch.status === "imported" ? "Importadas neste lote" : "Prontas na prévia"}</span><strong>{batch.status === "imported" ? Number((batch.promotion_result?.created ?? 0) + (batch.promotion_result?.reused ?? 0)).toLocaleString("pt-BR") : ready.toLocaleString("pt-BR")}</strong><small>{batch.status === "imported" ? "Criadas ou vinculadas no Elos" : "Conferir antes de confirmar"}</small></article>
          <article className="registry-table-panel"><span>Já importadas</span><strong>{Number(batch.status === "imported" ? batch.promotion_result?.duplicates ?? 0 : summary.duplicates ?? 0).toLocaleString("pt-BR")}</strong><small>{batch.status === "imported" ? "Reconhecidas sem duplicar" : "Serão reconhecidas sem duplicar"}</small></article>
          <article className="registry-table-panel"><span>Pendências</span><strong>{unresolved.toLocaleString("pt-BR")}</strong><small>{blocked} bloqueada(s) · {conflicts} conflito(s)</small></article>
        </section>

        {financial ? <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">Conferência financeira</span><h2>Compare os totais com o eObra</h2></div></div>
          <dl className="eobra-totals"><div><dt>Valor original</dt><dd>{moneyBR(summary.totals?.original_amount)}</dd></div><div><dt>Valor atual</dt><dd>{moneyBR(summary.totals?.current_amount)}</dd></div><div><dt>Pago / recebido</dt><dd>{moneyBR(summary.totals?.paid_amount)}</dd></div><div><dt>Saldo em aberto</dt><dd>{moneyBR(summary.totals?.balance_amount)}</dd></div></dl>
          {summary.totals_complete === false ? <div role="alert" className="auth-message error workspace-message">Totais incompletos: há valores que não puderam ser interpretados em linhas bloqueadas. Os números acima não representam o total integral do arquivo. Corrija essas linhas antes de conferir e importar.</div> : null}
          <p className="eobra-muted">Os totais incluem os valores legíveis de todas as linhas, inclusive as bloqueadas. Valores inválidos aparecem nas pendências; o filtro da tabela não altera estes totais.</p>
          <p className="eobra-note">Pagos históricos são preservados sem gerar uma nova movimentação bancária. Pagamentos parciais e ajustes não suportados precisam ser tratados antes de importar.</p>
        </section> : null}

        {editable && unresolved > 0 ? <div role="alert" className="auth-message error workspace-message">A importação está bloqueada por {unresolved.toLocaleString("pt-BR")} linha(s) com pendências. Confira as mensagens abaixo, corrija o arquivo ou o mapeamento e prepare uma nova prévia.</div> : null}

        <section className="registry-table-panel eobra-card" id="registros">
          <div className="section-heading"><div><span className="eobra-step">Registros</span><h2>Revise cada linha</h2></div><p>{count.toLocaleString("pt-BR")} linha(s) no filtro · até 50 por página</p></div>
          <form method="get" className="eobra-filter"><label>Situação<select name="status" defaultValue={status}><option value="">Todas as linhas</option>{Object.entries(ROW_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><button type="submit" className="elos-button">Filtrar linhas</button>{status ? <Link prefetch={false} className="eobra-text-link" href={`/configuracoes/importacoes/${batch.id}#registros`}>Ver todas</Link> : null}</form>
          <div className="registry-table-wrap"><table className={`registry-table ${financial ? "eobra-finance-table" : "eobra-contact-table"}`}>
            <thead><tr><th>Linha / código de origem</th><th>{financial ? "Lançamento" : "Cadastro"}</th>{financial ? <><th>Obra na origem</th><th>Vencimento</th><th>Original</th><th>Atual</th><th>Pago</th><th>Saldo</th></> : <><th>CPF / CNPJ</th><th>Contato</th></>}<th>Validação</th><th>Conferência</th></tr></thead>
            <tbody>{rows.map((row) => {
              const data = row.normalized_data ?? {};
              return <tr key={row.id}>
                <td><strong>Linha {row.source_row}</strong><span>{row.external_id || "Código ausente"}</span></td>
                <td><strong>{rowText(financial ? data.description : data.name)}</strong>{financial ? <>
                  <span>{rowText(data.document)}{data.installment_label ? ` · ${rowText(data.installment_label)}` : ""}</span>
                  <span>Favorecido na origem: {rowText(data.counterparty_name)}</span>
                  {batch.entity_kind === "payable" ? data.supplier_id && data.resolved_counterparty_name
                    ? <small>Fornecedor no Elos: {rowText(data.resolved_counterparty_name)}</small>
                    : <small className="eobra-unresolved">Fornecedor no Elos: sem vínculo. Confira o favorecido na origem.</small>
                    : data.sale_id && data.resolved_sale_number && data.resolved_counterparty_name
                      ? <small>Venda no Elos: {rowText(data.resolved_sale_number)} · Cliente: {rowText(data.resolved_counterparty_name)}</small>
                      : <small className="eobra-unresolved">Venda e cliente no Elos: vínculo pendente.</small>}
                  <small>{FINANCIAL_STATUS[String(data.status)] ?? rowText(data.status)}</small>
                </> : <span>{rowText(data.city)}{data.state ? ` / ${rowText(data.state)}` : ""}</span>}</td>
                {financial ? <><td>{rowText(data.source_project)}</td><td>{dateBR(typeof data.due_date === "string" ? data.due_date : null)}</td><td className="eobra-money">{moneyBR(data.original_amount)}</td><td className="eobra-money">{moneyBR(data.current_amount)}</td><td className="eobra-money">{moneyBR(data.paid_amount)}</td><td className="eobra-money">{moneyBR(data.balance_amount)}</td></> : <><td>{rowText(data.tax_id)}</td><td><span>{rowText(data.email)}</span><span>{rowText(data.phone)}</span></td></>}
                <td><span className={`eobra-status ${statusTone(row.status)}`}>{ROW_LABELS[row.status] ?? row.status}</span>{row.target_id ? <small>Vínculo no Elos identificado</small> : null}</td>
                <td><RowNotes row={row} /></td>
              </tr>;
            })}{!rows.length ? <tr><td colSpan={financial ? 10 : 6}><div className="eobra-empty">{loadError ? "Não foi possível carregar os registros." : "Nenhuma linha encontrada neste filtro."}</div></td></tr> : null}</tbody>
          </table></div>
          {count > 0 ? <nav className="eobra-pagination" aria-label="Páginas dos registros"><span>{page > 1 ? <Link prefetch={false} className="elos-button" href={pageHref(page - 1)}>← Anterior</Link> : null}</span><span>Página {page} de {pages}</span><span>{page < pages ? <Link prefetch={false} className="elos-button" href={pageHref(page + 1)}>Próxima →</Link> : null}</span></nav> : null}
          <ImportControls key={`${batch.id}:${batch.preview_hash}:${batch.status}`} batchId={batch.id} previewHash={batch.preview_hash} canPromote={canPromote} canCancel={editable && !loadError} readyCount={ready} financial={financial} />
        </section>
      </div>
    </AppShell>
  );
}
