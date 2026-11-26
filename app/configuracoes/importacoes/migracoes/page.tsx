import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { requireCompanyPermission } from '@/lib/workspace';
import { dateBR, pageNumber, statusTone } from '../import-presentation';
import { SnapshotForm } from './snapshot-form';
import { SNAPSHOT_STATUS_LABELS, type MigrationSummary } from './snapshot-presentation';
import '../eobra-import.css';

type Run = { id: string; source_host: string; reference_date: string; status: string; summary: MigrationSummary | null; created_at: string };

export default async function EobraMigrationsPage({ searchParams }: { searchParams: Promise<{ page?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, userId } = await requireCompanyPermission('admin.company.manage');
  const page = pageNumber(params.page);
  const [projectsResult, runsResult] = await Promise.all([
    supabase.from('projects').select('id,name').eq('company_id', companyId).neq('status', 'archived').order('name'),
    supabase.from('eobra_migration_runs').select('id,source_host,reference_date,status,summary,created_at', { count: 'exact' }).eq('company_id', companyId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 20, page * 20 - 1),
  ]);
  const unavailable = Boolean(projectsResult.error || runsResult.error);
  const runs = (runsResult.data ?? []) as Run[];
  const count = runsResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / 20));
  return <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Migração do eObra" description={`${company.name} · confira cadastros, vendas, parcelas e histórico financeiro em conjunto.`}>
    <div className="eobra-import-page">
      <div className="eobra-actions"><Link href="/configuracoes/importacoes" prefetch={false} className="eobra-text-link">← Importações por planilha</Link><Link href="/configuracoes/importacoes/correcao-eobra" prefetch={false} className="elos-button">Conferir reajuste das parcelas</Link></div>
      {params.error ? <div role="alert" className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div role="status" className="auth-message success workspace-message">{params.success}</div> : null}
      {unavailable ? <div role="alert" className="auth-message error workspace-message">Não foi possível carregar a migração. Atualize a página antes de enviar um pacote.</div> : null}
      <SnapshotForm key={companyId} companyId={companyId} companyName={company.name} userId={userId} projects={projectsResult.data ?? []} disabled={unavailable} />
      <section className="registry-table-panel eobra-card" id="historico"><div className="section-heading"><div><span className="eobra-step">Acompanhamento</span><h2>Coletas e revisões</h2></div><p>{count.toLocaleString('pt-BR')} coleta(s)</p></div>
        <div className="registry-table-wrap"><table className="registry-table eobra-history-table"><thead><tr><th>Origem</th><th>Referência</th><th>Registros</th><th>Cobertura</th><th>Situação</th><th>Preparada em</th><th>Ação</th></tr></thead><tbody>
          {runs.map((run) => <tr key={run.id}><td>{run.source_host}</td><td>{dateBR(run.reference_date)}</td><td>{Number(run.summary?.total ?? 0).toLocaleString('pt-BR')}</td><td>{run.summary?.coverage_complete ? 'Conferida' : 'Incompleta'}</td><td><span className={`eobra-status ${statusTone(run.status)}`}>{SNAPSHOT_STATUS_LABELS[run.status] ?? run.status}</span></td><td>{dateBR(run.created_at, true)}</td><td><Link href={`/configuracoes/importacoes/migracoes/${run.id}`} prefetch={false} className="table-action">Ver revisão</Link></td></tr>)}
          {!runs.length ? <tr><td colSpan={7}><div className="eobra-empty"><strong>{unavailable ? 'Histórico indisponível.' : 'Nenhuma coleta preparada nesta página.'}</strong><p>O resultado distingue dados coletados, preservados e importados nos módulos do Elos.</p></div></td></tr> : null}
        </tbody></table></div>
        {count > 0 ? <nav className="eobra-pagination" aria-label="Páginas das migrações">{page > 1 ? <Link href={`?page=${page - 1}#historico`} prefetch={false} className="elos-button">← Anterior</Link> : <span />}<span>Página {page} de {pages}</span>{page < pages ? <Link href={`?page=${page + 1}#historico`} prefetch={false} className="elos-button">Próxima →</Link> : <span />}</nav> : null}
      </section>
    </div>
  </AppShell>;
}
