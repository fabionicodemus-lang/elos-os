'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_UNIT_MAP_BYTES, parseSnapshotUnitMap, type SnapshotUnitDecision } from '@/lib/eobra-import/unit-map.mjs';

type Target = { id: string; project_id?: string; code: string; status: string; type: string | null; private_area: string | number | null; total_area: string | number | null; source_system: string | null; identity_hash?: string };
type SourceUnit = { source_id: string; source_project_id: string | null; project_id: string | null; code: string; type: string | null; status: string | null; private_area: string | number | null; total_area: string | number | null; decision: SnapshotUnitDecision | null; target: Target | null };
type SourcePage = { records: SourceUnit[]; count: number; total_units: number; page: number; page_size: number; confirmed: boolean };
type OptionsPage = { items: Target[]; total: number; page: number; page_size: number };
type Choice = { decision: SnapshotUnitDecision; target: Target | null };
type Query = { page: number; search: string; projectId: string };
const UNIT_STATUS: Record<string, string> = { available: 'Disponível', reserved: 'Reservada', sold: 'Vendida', inactive: 'Inativa' };
const area = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && /^\d+(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²` : 'Não informada';
const targetDetails = (unit: Target) => `${UNIT_STATUS[unit.status] ?? unit.status} · Área privativa ${area(unit.private_area)} · Área total ${area(unit.total_area)}`;

export function SnapshotUnitMap({ companyId, runId, projects, expectedCount, confirmed, canEdit }: {
  companyId: string; runId: string; projects: { id: string; name: string }[]; expectedCount: number; confirmed: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState<Query>({ page: 1, search: '', projectId: '' });
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sourcePage, setSourcePage] = useState<SourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceError, setSourceError] = useState('');
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [approved, setApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidateSource, setCandidateSource] = useState<SourceUnit | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateQuery, setCandidateQuery] = useState({ page: 1, search: '' });
  const [options, setOptions] = useState<OptionsPage | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const values = new URLSearchParams({ mode: 'source', company_id: companyId, run_id: runId, page: String(query.page), search: query.search });
    if (query.projectId) values.set('project_id', query.projectId);
    void fetch(`/api/imports/eobra/snapshot/unit-map?${values}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.records) || data.total_units !== expectedCount) throw new Error(data.error ?? 'A lista de unidades mudou. Atualize esta revisão.');
        if (Boolean(data.confirmed) !== confirmed) { router.refresh(); throw new Error('Os vínculos foram confirmados em outra sessão. Atualizando esta revisão.'); }
        if (!controller.signal.aborted) { setSourcePage(data as SourcePage); setSourceError(''); }
      }).catch(cause => { if (!controller.signal.aborted) setSourceError(cause instanceof Error ? cause.message : 'Não foi possível carregar as unidades.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyId, runId, query, expectedCount, confirmed, router]);

  useEffect(() => {
    if (!candidateSource?.project_id) return;
    const controller = new AbortController();
    const values = new URLSearchParams({ mode: 'options', company_id: companyId, run_id: runId, project_id: candidateSource.project_id, page: String(candidateQuery.page), search: candidateQuery.search });
    void fetch(`/api/imports/eobra/snapshot/unit-map?${values}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error ?? 'Não foi possível conferir os cadastros existentes.');
        if (!controller.signal.aborted) { setOptions(data as OptionsPage); setOptionsError(''); }
      }).catch(cause => { if (!controller.signal.aborted) setOptionsError(cause instanceof Error ? cause.message : 'Não foi possível conferir os cadastros existentes.'); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [companyId, runId, candidateSource?.project_id, candidateSource?.source_id, candidateQuery]);

  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects]);
  const chosenTargets = useMemo(() => new Map(Object.entries(choices).flatMap(([sourceId, choice]) => choice.decision.action === 'reuse' ? [[choice.decision.unit_id, sourceId] as const] : [])), [choices]);
  const selectedCount = confirmed ? expectedCount : Object.keys(choices).length;
  const createCount = Object.values(choices).filter(choice => choice.decision.action === 'create').length;
  const pageCount = Math.max(1, Math.ceil((sourcePage?.count ?? 0) / (sourcePage?.page_size ?? 50)));
  const optionsPageCount = Math.max(1, Math.ceil((options?.total ?? 0) / (options?.page_size ?? 50)));
  const editable = canEdit && !confirmed;
  const canConfirm = editable && !saving && !loading && !sourceError && selectedCount === expectedCount && expectedCount > 0 && approved;
  const changePage = (next: Query) => { setQuery(next); setLoading(true); setSourceError(''); setError(''); setCandidateSource(null); };
  const choose = (sourceId: string, choice: Choice) => { setChoices(previous => ({ ...previous, [sourceId]: choice })); setApproved(false); setError(''); };
  const beginReuse = (source: SourceUnit) => {
    setCandidateSource(source); setCandidateSearch(''); setCandidateQuery({ page: 1, search: '' });
    setOptions(null); setOptionsLoading(true); setOptionsError('');
  };

  async function confirmMap() {
    if (!canConfirm) return;
    setSaving(true); setError('');
    try {
      const unitMap = parseSnapshotUnitMap(Object.fromEntries(Object.entries(choices).map(([sourceId, choice]) => [sourceId, choice.decision])), expectedCount);
      const body = JSON.stringify({ company_id: companyId, run_id: runId, confirm_units: true, unit_map: unitMap });
      if (new TextEncoder().encode(body).byteLength > MAX_UNIT_MAP_BYTES) throw new Error('O de-para excede 3 MiB. Prepare uma coleta com menos unidades por revisão.');
      const response = await fetch('/api/imports/eobra/snapshot/unit-map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const result = await response.json();
      if (!response.ok || !result.progress) throw new Error(result.error ?? 'Não foi possível confirmar as unidades. Confira o progresso antes de tentar novamente.');
      router.replace(`/configuracoes/importacoes/migracoes/${runId}?prepare=1`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar os vínculos.'); }
    finally { setSaving(false); }
  }

  return <section className="registry-table-panel eobra-card" id="unidades">
    <div className="section-heading"><div><span className="eobra-step">Identidade das unidades</span><h2>{confirmed ? 'Vínculos de unidades confirmados' : 'Definir os cadastros que receberão os vínculos'}</h2></div><p>{selectedCount.toLocaleString('pt-BR')} de {expectedCount.toLocaleString('pt-BR')} unidades</p></div>
    <p>Cada unidade da origem precisa de uma decisão explícita. Vincular um cadastro existente conserva seu código, áreas e demais dados cadastrais. A venda importada poderá atualizar sua situação conforme as regras comerciais.</p>
    {editable ? <p className="eobra-note">Confira inclusive códigos parecidos e rótulos históricos, como “DEVOLUÇÃO”. Ao escolher criar, confirme que a unidade física ainda não possui cadastro nesta obra. As escolhas ficam nesta página até a confirmação; depois, fazem parte da revisão e não podem ser alteradas neste lote.</p> : confirmed ? <p>Estes vínculos fazem parte da revisão confirmada. Para mudar uma decisão, prepare uma nova revisão.</p> : <p className="eobra-note">Esta coleta não está na etapa de confirmação das unidades. Prepare uma nova revisão para definir os vínculos pendentes.</p>}
    <form className="eobra-filter" onSubmit={event => { event.preventDefault(); changePage({ page: 1, search, projectId }); }}>
      <label>Empreendimento<select value={projectId} disabled={saving} onChange={event => setProjectId(event.target.value)}><option value="">Todos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Código na origem<input value={search} maxLength={120} disabled={saving} onChange={event => setSearch(event.target.value)} placeholder="Buscar na lista coletada" /></label>
      <button className="elos-button" type="submit" disabled={saving}>Filtrar unidades</button>
    </form>
    {sourceError ? <p className="eobra-error" role="alert">{sourceError}</p> : null}
    {error ? <p className="eobra-error" role="alert">{error}</p> : null}
    {loading ? <p role="status">Carregando unidades…</p> : sourceError ? null : <div className="registry-table-wrap"><table className="registry-table eobra-sample-table"><thead><tr><th>Unidade na origem</th><th>Obra</th><th>Decisão e cadastro no Elos</th><th>Conferência</th></tr></thead><tbody>
      {(sourcePage?.records ?? []).map(source => {
        const choice = confirmed ? (source.decision ? { decision: source.decision, target: source.target } : null) : (Object.hasOwn(choices, source.source_id) ? choices[source.source_id] : null);
        return <tr key={source.source_id}><td><strong>{source.code}</strong><small>ID na origem: {source.source_id}</small><small>Área privativa {area(source.private_area)} · Total {area(source.total_area)}</small>{source.type ? <small>Tipo: {source.type}</small> : null}</td><td>{source.project_id ? projectNames.get(source.project_id) ?? source.project_id : 'Obra sem vínculo'}</td><td>
          {choice?.decision.action === 'create' ? <><strong>Criar unidade: {source.code}</strong><small>Decisão explícita de novo cadastro</small></> : choice?.decision.action === 'reuse' ? <><strong>Vincular: {choice.target?.code ?? choice.decision.unit_id}</strong><small>{choice.target ? targetDetails(choice.target) : 'Cadastro existente selecionado'}</small>{choice.target?.source_system ? <small>Origem do cadastro: {choice.target.source_system}</small> : null}<small>ID no Elos: {choice.decision.unit_id}</small></> : <span className="eobra-status warning">Decisão pendente</span>}
        </td><td>{editable ? <div className="eobra-actions"><button type="button" className="elos-button" disabled={saving || !source.project_id} onClick={() => beginReuse(source)}>Vincular existente</button><button type="button" className="elos-button" disabled={saving || !source.project_id} onClick={() => choose(source.source_id, { decision: { action: 'create' }, target: null })}>Criar unidade</button>{choice ? <button type="button" className="elos-button" disabled={saving} onClick={() => { setChoices(previous => { const next = { ...previous }; delete next[source.source_id]; return next; }); setApproved(false); }}>Limpar decisão</button> : null}</div> : confirmed ? <span className="eobra-status success">Confirmada</span> : 'Pendente'}</td></tr>;
      })}
      {!sourcePage?.records.length ? <tr><td colSpan={4}><div className="eobra-empty">Nenhuma unidade nestes filtros.</div></td></tr> : null}
    </tbody></table></div>}
    <nav className="eobra-pagination" aria-label="Páginas das unidades da origem"><button type="button" className="elos-button" disabled={saving || loading || query.page <= 1} onClick={() => changePage({ ...query, page: query.page - 1 })}>← Anterior</button><span>Página {query.page} de {pageCount} · {sourcePage?.count ?? 0} unidades nos filtros</span><button type="button" className="elos-button" disabled={saving || loading || query.page >= pageCount} onClick={() => changePage({ ...query, page: query.page + 1 })}>Próxima →</button></nav>

    {candidateSource && editable ? <section className="eobra-card" aria-labelledby="native-unit-title">
      <div className="section-heading"><div><span className="eobra-step">Escolher cadastro existente</span><h3 id="native-unit-title">Vincular {candidateSource.code}</h3></div><button type="button" className="elos-button" onClick={() => setCandidateSource(null)}>Fechar seleção</button></div>
      <p>Unidades cadastradas em {projectNames.get(candidateSource.project_id ?? '') ?? 'esta obra'}. Compare o código e as áreas antes de escolher.</p>
      <form className="eobra-filter" onSubmit={event => { event.preventDefault(); setCandidateQuery({ page: 1, search: candidateSearch }); setOptionsLoading(true); setOptionsError(''); }}><label>Código no Elos<input autoFocus value={candidateSearch} maxLength={120} onChange={event => setCandidateSearch(event.target.value)} placeholder="Pesquisar cadastro existente" /></label><button type="submit" className="elos-button">Buscar unidades</button></form>
      {optionsError ? <p role="alert" className="eobra-error">{optionsError}</p> : null}
      {optionsLoading ? <p role="status">Conferindo cadastros existentes…</p> : <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Cadastro existente</th><th>Características</th><th>Vínculo</th></tr></thead><tbody>{(options?.items ?? []).map(target => {
        const usedBy = chosenTargets.get(target.id);
        const taken = Boolean(usedBy && usedBy !== candidateSource.source_id);
        return <tr key={target.id}><td><strong>{target.code}</strong><small>{UNIT_STATUS[target.status] ?? target.status}{target.type ? ` · ${target.type}` : ''}</small><small>ID no Elos: {target.id}</small></td><td>Privativa {area(target.private_area)}<small>Total {area(target.total_area)}</small>{target.source_system ? <small>Origem: {target.source_system}</small> : null}</td><td><button type="button" className="elos-button" disabled={saving || taken || !target.identity_hash} onClick={() => { choose(candidateSource.source_id, { decision: { action: 'reuse', unit_id: target.id, expected_identity_hash: target.identity_hash! }, target }); setCandidateSource(null); }}>{taken ? 'Já escolhida para outra unidade' : 'Vincular esta unidade'}</button></td></tr>;
      })}{!options?.items.length ? <tr><td colSpan={3}><div className="eobra-empty">Nenhum cadastro encontrado neste filtro.</div></td></tr> : null}</tbody></table></div>}
      <nav className="eobra-pagination" aria-label="Páginas dos cadastros existentes"><button type="button" className="elos-button" disabled={optionsLoading || candidateQuery.page <= 1} onClick={() => { setCandidateQuery({ ...candidateQuery, page: candidateQuery.page - 1 }); setOptionsLoading(true); }}>← Anterior</button><span>Página {candidateQuery.page} de {optionsPageCount} · {options?.total ?? 0} cadastros nos filtros</span><button type="button" className="elos-button" disabled={optionsLoading || candidateQuery.page >= optionsPageCount} onClick={() => { setCandidateQuery({ ...candidateQuery, page: candidateQuery.page + 1 }); setOptionsLoading(true); }}>Próxima →</button></nav>
    </section> : null}

    {editable ? <div className="eobra-review-actions"><p>{selectedCount.toLocaleString('pt-BR')} decisões: {chosenTargets.size.toLocaleString('pt-BR')} vínculos existentes e {createCount.toLocaleString('pt-BR')} novos cadastros. Faltam {Math.max(0, expectedCount - selectedCount).toLocaleString('pt-BR')} unidades.</p><label className="eobra-checkbox"><input type="checkbox" checked={approved} disabled={saving || selectedCount !== expectedCount || expectedCount === 0} onChange={event => setApproved(event.target.checked)} /><span>Conferi cada vínculo. As unidades marcadas para criar ainda não têm cadastro físico nesta obra. Entendo que esta confirmação fica registrada na revisão.</span></label><div className="eobra-actions"><button type="button" className="elos-button primary" disabled={!canConfirm} onClick={() => void confirmMap()}>{saving ? 'Confirmando vínculos…' : 'Confirmar unidades e continuar preparação'}</button></div></div> : null}
  </section>;
}
