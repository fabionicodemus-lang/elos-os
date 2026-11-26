import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireCompanyPermission } from '@/lib/workspace';
import { isUuid } from '@/lib/eobra-import/resolution.mjs';
import { dateBR, pageNumber, statusTone } from '../../import-presentation';
import { SnapshotControls } from '../snapshot-controls';
import { SNAPSHOT_ENTITY_LABELS, SNAPSHOT_STATUS_LABELS, snapshotLabel, type MigrationSummary, type SnapshotProgress } from '../snapshot-presentation';
import '../../eobra-import.css';

type Coverage = { entity: string; source_project_id: string | null; archive_type: string; expected_count: number | null; actual_count: number; verified: boolean; errors: string[] };
type Review = { run_id: string; status: string; preview_hash: string; summary: MigrationSummary; coverage?: Coverage[] };
type RecordRow = { id: string; entity: string; source_id: string; source_project_id: string | null; archive_type: string; project_id: string | null; status: string; errors: string[]; warnings: string[]; normalized_data: Record<string, unknown>; raw_data: Record<string, unknown>; canonical_targets: Record<string, unknown> };
const currency = (value: unknown) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return '—';
  const negative = text.startsWith('-');
  const [whole, decimal = ''] = text.replace(/^-/, '').split('.');
  return `${negative ? '-' : ''}R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimal.padEnd(2, '0')}`;
};

export default async function EobraMigrationReview({ params, searchParams }: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ page?: string; entity?: string; status?: string; error?: string; success?: string; prepare?: string }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(runId)) notFound();
  const { supabase, company, companyId } = await requireCompanyPermission('admin.company.manage');
  const runResult = await supabase.from('eobra_migration_runs').select('id,source_host,reference_date,captured_at,status,summary,preview_hash,project_map,promotion_result,created_at').eq('id', runId).eq('company_id', companyId).maybeSingle();
  if (runResult.error || !runResult.data) notFound();
  const run = runResult.data;
  const [reviewResult, progressResult] = await Promise.all([
    run.status === 'building' ? Promise.resolve({ data: null, error: null }) : supabase.rpc('review_eobra_snapshot', { p_run_id: runId }),
    supabase.rpc('eobra_snapshot_progress', { p_run_id: runId }),
  ]);
  const review = reviewResult.data as Review | null;
  const progress = progressResult.data as SnapshotProgress | null;
  const summary = (review?.summary ?? run.summary ?? {}) as MigrationSummary;
  const status = review?.status ?? run.status;
  const hash = review?.preview_hash ?? run.preview_hash ?? '';
  const page = pageNumber(query.page);
  const entity = query.entity && Object.hasOwn(SNAPSHOT_ENTITY_LABELS, query.entity) ? query.entity : '';
  const recordStatuses = ['ready', 'blocked', 'conflict', 'duplicate', 'archived', 'imported'];
  const rowStatus = query.status && recordStatuses.includes(query.status) ? query.status : '';
  let recordsQuery = supabase.from('eobra_migration_records').select('id,entity,source_id,source_project_id,archive_type,project_id,status,errors,warnings,normalized_data,raw_data,canonical_targets', { count: 'exact' })
    .eq('company_id', companyId).eq('run_id', runId).order('entity').order('source_id').order('id').range((page - 1) * 50, page * 50 - 1);
  if (entity) recordsQuery = recordsQuery.eq('entity', entity);
  if (rowStatus) recordsQuery = recordsQuery.eq('status', rowStatus);
  const [recordsResult, coverageResult, projectsResult] = await Promise.all([
    recordsQuery,
    supabase.from('eobra_migration_coverage').select('entity,source_project_id,archive_type,expected_count,actual_count,verified,errors').eq('company_id', companyId).eq('run_id', runId).order('entity'),
    Object.keys(run.project_map as Record<string, string>).length ? supabase.from('projects').select('id,name').eq('company_id', companyId).in('id', Object.values(run.project_map as Record<string, string>)) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  const records = (recordsResult.data ?? []) as RecordRow[];
  const coverage = (coverageResult.data ?? []) as Coverage[];
  const projectNames = new Map((projectsResult.data ?? []).map((project) => [project.id, project.name]));
  const mapping = run.project_map as Record<string, string>;
  const unavailable = Boolean(reviewResult.error || progressResult.error || !progress || recordsResult.error || coverageResult.error || projectsResult.error);
  const count = recordsResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / 50));
  const canPromote = !unavailable && status === 'ready' && Boolean(summary.coverage_complete) && Number(summary.blocked ?? 0) === 0 && Number(summary.conflicts ?? 0) === 0 && /^[a-f0-9]{64}$/.test(hash);
  const href = (target: number) => {
    const values = new URLSearchParams({ page: String(target) }); if (entity) values.set('entity', entity); if (rowStatus) values.set('status', rowStatus);
    return `/configuracoes/importacoes/migracoes/${runId}?${values}#registros`;
  };
  const labelForProject = (sourceId: string | null) => sourceId ? projectNames.get(mapping[sourceId]) ?? `Origem ${sourceId} · sem vínculo` : 'Empresa';

  return <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Revisar migração do eObra" description={`${company.name} · ${run.source_host} · referência ${dateBR(run.reference_date)}`}>
    <div className="eobra-import-page">
      <p><Link href="/configuracoes/importacoes/migracoes" prefetch={false} className="eobra-text-link">← Coletas e revisões</Link></p>
      {query.error ? <div role="alert" className="auth-message error workspace-message">{query.error}</div> : null}
      {query.success ? <div role="status" className="auth-message success workspace-message">{query.success}</div> : null}
      {unavailable ? <div role="alert" className="auth-message error workspace-message">Não foi possível atualizar toda a conferência. Atualize a página antes de importar.</div> : null}
      <section className="eobra-kpis">
        <article className="registry-table-panel"><span>Registros coletados</span><strong>{Number(summary.total ?? 0).toLocaleString('pt-BR')}</strong><small>{SNAPSHOT_STATUS_LABELS[status] ?? status}</small></article>
        <article className="registry-table-panel"><span>Prontos para processar</span><strong>{Number(summary.ready ?? 0).toLocaleString('pt-BR')}</strong><small>{Number(summary.duplicates ?? 0)} já importados</small></article>
        <article className="registry-table-panel"><span>Pendências e conflitos</span><strong>{(Number(summary.blocked ?? 0) + Number(summary.conflicts ?? 0)).toLocaleString('pt-BR')}</strong><small>Os detalhes aparecem em cada registro</small></article>
        <article className="registry-table-panel"><span>Preservados para consulta</span><strong>{Number(summary.archived ?? 0).toLocaleString('pt-BR')}</strong><small>Dados sem promoção nos módulos do Elos</small></article>
      </section>
      <section className="registry-table-panel eobra-card"><div className="section-heading"><div><span className="eobra-step">Escopo e cobertura</span><h2>{summary.coverage_complete ? 'Coleta conferida no escopo declarado' : 'Coleta com etapas pendentes'}</h2></div><p>Coletada em {dateBR(run.captured_at, true)}</p></div>
        <p>A cobertura compara as contagens, a paginação e os detalhes declarados na origem. Dados preservados para consulta continuam separados dos registros efetivamente criados nos módulos do Elos.</p>
        {summary.errors?.length ? <ul className="eobra-row-errors">{summary.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}
        <div className="registry-table-wrap"><table className="registry-table eobra-sample-table"><thead><tr><th>Conjunto</th><th>Escopo</th><th>Na origem</th><th>Coletados</th><th>Conferência</th></tr></thead><tbody>{coverage.map((item, index) => <tr key={index}><td>{snapshotLabel(item.entity, item.archive_type)}</td><td>{labelForProject(item.source_project_id)}</td><td>{item.expected_count ?? 'Não informado'}</td><td>{item.actual_count}</td><td><span className={`eobra-status ${item.verified ? 'success' : 'warning'}`}>{item.verified ? 'Conferida' : 'Incompleta'}</span>{item.errors?.map((message, i) => <small key={i}>{message}</small>)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="registry-table-panel eobra-card"><div className="section-heading"><div><span className="eobra-step">Financeiro na data de referência</span><h2>Conferência dos valores</h2></div></div>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Tipo</th><th>Original</th><th>Atualizado</th><th>Pago líquido de estornos</th><th>Saldo histórico</th><th>Saldo exigível</th></tr></thead><tbody>{['receivable', 'payable'].map((kind) => <tr key={kind}><td>{SNAPSHOT_ENTITY_LABELS[kind]}</td>{(['original_amount', 'current_amount', 'paid_amount', 'balance_amount', 'collectible_balance_amount'] as const).map((field) => <td className="eobra-money" key={field}>{currency(summary.totals?.[kind]?.[field])}</td>)}</tr>)}</tbody></table></div>
        {['receivable', 'payable'].map((kind) => summary.totals?.[kind]?.complete === false ? <p role="status" className="eobra-note" key={kind}><strong>{SNAPSHOT_ENTITY_LABELS[kind]}: totais parciais.</strong> Os valores acima somam somente os campos que puderam ser interpretados. Resolva os registros pendentes para conferir o total completo.</p> : null)}
        <p>O saldo histórico conserva o atualizado menos as baixas líquidas da origem. Parcelas canceladas podem manter esse valor para consulta, com saldo exigível zero, sem cobrança ou previsão. A regra de reajuste precisa estar validada para continuar a correção no Elos.</p>
        {summary.history_dates_complete === false ? <p role="status" className="eobra-note">Há eventos com data pendente na origem. O saldo pode estar conciliado, mas a linha do tempo desses eventos ainda exige conferência. Os registros e valores originais foram preservados.</p> : null}
        <p><Link href="/configuracoes/importacoes/correcao-eobra" prefetch={false} className="eobra-text-link">Conferir a base e a continuidade do reajuste das parcelas →</Link></p>
        {run.promotion_result ? <details className="eobra-raw-details"><summary>Resultado do processamento</summary><pre className="eobra-snapshot-json">{JSON.stringify(run.promotion_result, null, 2)}</pre></details> : null}
        {!unavailable && progress ? <SnapshotControls key={`${runId}:${status}`} companyId={companyId} runId={runId} previewHash={hash} canPromote={canPromote} canCancel={['building', 'ready', 'review'].includes(status)} initialProgress={progress} autoPrepare={query.prepare === '1'} /> : null}
      </section>
      <section className="registry-table-panel eobra-card" id="registros"><div className="section-heading"><div><span className="eobra-step">Conferência individual</span><h2>Registros e vínculos</h2></div><p>{count.toLocaleString('pt-BR')} registro(s) nos filtros</p></div>
        <form method="get" className="eobra-filter"><label>Conjunto<select name="entity" defaultValue={entity}><option value="">Todos</option>{Object.entries(SNAPSHOT_ENTITY_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Situação<select name="status" defaultValue={rowStatus}><option value="">Todas</option>{recordStatuses.map((value) => <option key={value} value={value}>{SNAPSHOT_STATUS_LABELS[value] ?? value}</option>)}</select></label><button type="submit" className="elos-button">Filtrar registros</button></form>
        <div className="registry-table-wrap"><table className="registry-table eobra-contact-table"><thead><tr><th>Origem</th><th>Registro</th><th>Escopo</th><th>Situação</th><th>Conferência</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>
          <td>{snapshotLabel(record.entity, record.archive_type)}<small>ID {record.source_id}</small></td><td>{String(record.normalized_data.name ?? record.normalized_data.description ?? record.normalized_data.number ?? record.normalized_data.code ?? record.source_id)}</td><td>{labelForProject(record.source_project_id)}</td><td><span className={`eobra-status ${statusTone(record.status)}`}>{SNAPSHOT_STATUS_LABELS[record.status] ?? record.status}</span></td><td className="eobra-row-notes">
            {record.errors?.length ? <ul className="eobra-row-errors">{record.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}{record.warnings?.length ? <ul className="eobra-row-warnings">{record.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
            <details className="eobra-raw-details"><summary>Dados da origem e vínculo no Elos</summary><pre className="eobra-snapshot-json">{JSON.stringify({ origem: record.raw_data, conferido: record.normalized_data, destino: record.canonical_targets }, null, 2)}</pre></details>
          </td></tr>)}{!records.length ? <tr><td colSpan={5}><div className="eobra-empty">Nenhum registro nesta página ou nos filtros selecionados.</div></td></tr> : null}</tbody></table></div>
        <nav className="eobra-pagination" aria-label="Páginas dos registros">{page > 1 ? <Link href={href(page - 1)} prefetch={false} className="elos-button">← Anterior</Link> : <span />}<span>Página {page} de {pages} · até 50 registros por página</span>{page < pages ? <Link href={href(page + 1)} prefetch={false} className="elos-button">Próxima →</Link> : <span />}</nav>
      </section>
    </div>
  </AppShell>;
}
