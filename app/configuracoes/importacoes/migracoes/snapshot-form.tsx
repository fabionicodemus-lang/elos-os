'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { assertSnapshotPartPath, MAX_SNAPSHOT_BYTES, SNAPSHOT_BUCKET, SNAPSHOT_BUNDLE_BUCKET } from '@/lib/eobra-import/snapshot-request.mjs';
import { inspectSnapshotBundleFiles, snapshotUploadFileHash, verifySnapshotBundlePart, type SnapshotBundleSelection } from '@/lib/eobra-import/snapshot-upload.mjs';
import { SNAPSHOT_ENTITY_LABELS, snapshotLabel, type SnapshotView } from './snapshot-presentation';

type BundleUpload = {
  files: File[]; selection: SnapshotBundleSelection<File>; path: string;
  completedParts: Set<string>; manifestUploaded: boolean;
};

export function SnapshotForm({ companyId, companyName, userId, projects, disabled }: {
  companyId: string; companyName: string; userId: string;
  projects: { id: string; name: string }[]; disabled?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'parts' | 'single'>('parts');
  const [file, setFile] = useState<File | null>(null);
  const [bundleFiles, setBundleFiles] = useState<File[]>([]);
  const bundleUpload = useRef<BundleUpload | null>(null);
  const [uploaded, setUploaded] = useState<{ file: File; path: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [inspection, setInspection] = useState<SnapshotView | null>(null);
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  function clearReview() {
    setUploaded(null); setInspection(null); setProjectMap({}); setError(''); setUploadProgress(null); bundleUpload.current = null;
  }

  async function uploadBundle() {
    let operation = bundleUpload.current;
    if (!operation || operation.files !== bundleFiles) {
      setBusy('Conferindo os arquivos e o manifesto…');
      const selection = await inspectSnapshotBundleFiles(bundleFiles);
      operation = { files: bundleFiles, selection, path: `${companyId}/${userId}/${crypto.randomUUID()}/manifest.json`, completedParts: new Set(), manifestUploaded: false };
      bundleUpload.current = operation;
    }
    const storage = createClient().storage.from(SNAPSHOT_BUNDLE_BUCKET);
    const total = operation.selection.parts.length + 1;
    setUploadProgress({ done: operation.completedParts.size + Number(operation.manifestUploaded), total });
    const uploadImmutable = async (partFile: File, path: string, expectedHash: string) => {
      const result = await storage.upload(path, partFile, { contentType: 'application/json', upsert: false });
      if (!result.error) return;
      // A lost upload response can leave the immutable object already present.
      // Accept that retry only after reading and hashing the exact stored bytes.
      if (String(result.error.statusCode) === '409' || /already exists|duplicate/i.test(result.error.message)) {
        const existing = await storage.download(path);
        if (!existing.error && existing.data.size === partFile.size
          && await snapshotUploadFileHash({ name: partFile.name, size: existing.data.size, arrayBuffer: () => existing.data.arrayBuffer() }) === expectedHash) return;
        throw new Error('Um arquivo já enviado difere desta coleta. Selecione novamente a pasta para iniciar outro envio.');
      }
      if (String(result.error.statusCode) === '403') throw new Error('O envio exige permissão para administrar a empresa, obras, clientes, fornecedores, vendas, contas a receber, contas a pagar e contas bancárias.');
      throw new Error('Não foi possível enviar um arquivo da coleta. Confira a conexão e use Conferir coleta para retomar nesta página.');
    };
    for (const part of operation.selection.parts) {
      if (operation.completedParts.has(part.descriptor.name)) continue;
      setBusy(`Conferindo e enviando parte ${part.descriptor.ordinal} de ${operation.selection.parts.length}…`);
      await verifySnapshotBundlePart(part.file, part.descriptor);
      await uploadImmutable(part.file, assertSnapshotPartPath(operation.path, part.descriptor.name, companyId, userId), part.descriptor.sha256);
      operation.completedParts.add(part.descriptor.name);
      setUploadProgress({ done: operation.completedParts.size, total });
    }
    if (!operation.manifestUploaded) {
      setBusy('Enviando o manifesto da coleta…');
      await uploadImmutable(operation.selection.manifestFile, operation.path, await snapshotUploadFileHash(operation.selection.manifestFile));
      operation.manifestUploaded = true;
      setUploadProgress({ done: total, total });
    }
    setUploaded({ file: operation.selection.manifestFile, path: operation.path });
    return operation.path;
  }

  async function inspect() {
    setError(''); setInspection(null); setProjectMap({});
    if (mode === 'single' && (!file || !/\.json$/i.test(file.name) || !file.size || file.size > MAX_SNAPSHOT_BYTES)) {
      setError('Selecione um pacote da migração em JSON, de até 50 MB.'); return;
    }
    if (mode === 'parts' && !bundleFiles.length) { setError('Selecione a pasta com manifest.json e as partes da coleta.'); return; }
    try {
      setBusy('Enviando a coleta…');
      let path = mode === 'parts' ? await uploadBundle() : uploaded?.file === file ? uploaded.path : '';
      if (!path && file) {
        path = `${companyId}/${userId}/${crypto.randomUUID()}.json`;
        const result = await createClient().storage.from(SNAPSHOT_BUCKET).upload(path, file, { contentType: 'application/json', upsert: false });
        if (result.error) throw new Error('Não foi possível enviar o pacote. Confira sua conexão e tente novamente.');
        setUploaded({ file, path });
      }
      setBusy(mode === 'parts' ? 'Conferindo o manifesto para preparar as partes…' : 'Conferindo registros, vínculos e cobertura…');
      const response = await fetch('/api/imports/eobra/snapshot/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, storage_path: path }),
      });
      const result = await response.json();
      if (!response.ok || !result.inspection) throw new Error(result.error ?? 'Não foi possível conferir a coleta.');
      setInspection(result.inspection);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível conferir o pacote.'); }
    finally { setBusy(''); }
  }

  async function stage() {
    if (!uploaded || !inspection) return;
    setError(''); setBusy('Preparando a revisão…');
    try {
      const response = await fetch('/api/imports/eobra/snapshot/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, storage_path: uploaded.path, project_map: projectMap }),
      });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.error ?? 'Não foi possível preparar a revisão.');
      router.push(`/configuracoes/importacoes/migracoes/${encodeURIComponent(result.runId)}?prepare=1`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a revisão.'); setBusy(''); }
  }

  const projectNames = new Map(inspection?.projects.map((project) => [project.sourceId, project.name]));
  return <section className="registry-table-panel eobra-card">
    <div className="section-heading"><div><span className="eobra-step">Nova coleta</span><h2>Cadastros, vendas e financeiro vinculados</h2></div><p>{companyName}</p></div>
    <p>Envie a coleta do eObra com os registros originais, seus vínculos e as contagens da origem. Para coletas grandes, selecione a pasta com o manifesto e suas partes. A preparação confere os dados antes da revisão.</p>
    <fieldset className="eobra-snapshot-fieldset" disabled={Boolean(busy) || disabled}>
      <div className="eobra-actions">
        <label className="eobra-checkbox"><input type="radio" name="snapshot-upload-mode" checked={mode === 'parts'} onChange={() => { setMode('parts'); setFile(null); setBundleFiles([]); clearReview(); }} /><span>Pasta da coleta</span></label>
        <label className="eobra-checkbox"><input type="radio" name="snapshot-upload-mode" checked={mode === 'single'} onChange={() => { setMode('single'); setFile(null); setBundleFiles([]); clearReview(); }} /><span>Arquivo JSON único</span></label>
      </div>
      <div className="eobra-file-grid">
        {mode === 'parts' ? <label className="eobra-wide" key="parts">Pasta com manifesto e partes<input type="file" multiple {...{ webkitdirectory: '', directory: '' }} onChange={(event) => {
          setBundleFiles(Array.from(event.target.files ?? [])); clearReview();
        }} /><small>Selecione a pasta que contém manifest.json e part-000001.json, sem subpastas. Cada arquivo pode ter até 2 MiB; as partes, até 200 MiB no total.</small></label>
          : <label className="eobra-wide" key="single">Pacote da migração (.json)<input type="file" accept=".json,application/json" onChange={(event) => {
            setFile(event.target.files?.[0] ?? null); clearReview();
          }} /><small>Até 50 MB. A empresa de destino é a empresa selecionada no Elos.</small></label>}
        <button type="button" className="elos-button primary" onClick={inspect} disabled={mode === 'parts' ? !bundleFiles.length : !file}>Conferir coleta</button>
      </div>
      {inspection ? <>
        <div className="eobra-kpis eobra-snapshot-kpis">
          <article className="registry-table-panel"><span>{inspection.verificationPending ? 'Registros declarados' : 'Registros únicos'}</span><strong>{(inspection.verificationPending ? inspection.summary.records : inspection.summary.uniqueRecords).toLocaleString('pt-BR')}</strong><small>{inspection.source.host}</small></article>
          <article className="registry-table-panel"><span>Válidos na coleta</span><strong className={inspection.verificationPending ? 'eobra-snapshot-word' : undefined}>{inspection.verificationPending ? 'A conferir' : inspection.summary.validRecords.toLocaleString('pt-BR')}</strong><small>{inspection.verificationPending ? 'Na preparação das partes' : 'A promoção tem uma revisão adicional'}</small></article>
          <article className="registry-table-panel"><span>Exigem tratamento</span><strong className={inspection.verificationPending ? 'eobra-snapshot-word' : undefined}>{inspection.verificationPending ? 'A conferir' : inspection.summary.promotionBlockedRecords.toLocaleString('pt-BR')}</strong><small>Vínculos, regras ou suporte no destino</small></article>
          <article className="registry-table-panel"><span>Cobertura do escopo</span><strong className="eobra-snapshot-word">{inspection.verificationPending ? 'A conferir' : inspection.complete ? 'Conferida' : 'Incompleta'}</strong><small>{inspection.verificationPending ? 'Contagens e detalhes serão validados na preparação' : inspection.allProjectsComplete ? 'Todas as obras declaradas' : 'Confira o escopo e os filtros da coleta'}</small></article>
        </div>
        {inspection.verificationPending ? <p role="status" className="eobra-note">Manifesto recebido com {inspection.partCount?.toLocaleString('pt-BR')} partes. As quantidades acima foram declaradas no pacote. A preparação vai conferir cada parte, os registros, os vínculos e os totais; depois você poderá revisar a importação.</p> : null}
        {['receivable', 'payable'].map((kind) => inspection.summary.financial?.[kind]?.totalsComplete === false ? <p role="status" className="eobra-note" key={kind}><strong>{SNAPSHOT_ENTITY_LABELS[kind]}: totais ainda não conferidos.</strong> Há valores ou registros com inconsistências na coleta. A revisão no Elos mostrará as pendências e indicará quando algum total for parcial.</p> : null)}
        {inspection.summary.history_dates_complete === false ? <p role="status" className="eobra-note">Há datas pendentes no histórico financeiro. Os valores e registros são preservados; a linha do tempo desses eventos precisa de conferência.</p> : null}
        {inspection.errors.length ? <div role="alert" className="eobra-note"><strong>Inconsistências da coleta</strong><ul className="eobra-row-errors">{inspection.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></div> : null}
        {inspection.warnings.length ? <details className="eobra-raw-details"><summary>Observações da coleta ({inspection.warnings.length})</summary><ul className="eobra-row-warnings">{inspection.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></details> : null}
        <h3 className="eobra-sample-head">Correspondência dos empreendimentos</h3>
        <div className="eobra-form-grid">{inspection.scope.projectIds.map((sourceId) => <label key={sourceId}>
          {projectNames.get(sourceId) ?? sourceId}<select value={projectMap[sourceId] ?? ''} onChange={(event) => setProjectMap((current) => {
            const next = { ...current }; if (event.target.value) next[sourceId] = event.target.value; else delete next[sourceId]; return next;
          })}><option value="">Ainda não vinculado</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <small>Identificador na origem: {sourceId}</small>
        </label>)}</div>
        <p>Empreendimentos sem correspondência permanecem pendentes na revisão.</p>
        <div className="section-heading eobra-sample-head"><h3>Cobertura da origem</h3><p>Referência: {inspection.source.referenceDate.split('-').reverse().join('/')}</p></div>
        <div className="registry-table-wrap"><table className="registry-table eobra-sample-table"><thead><tr><th>Conjunto</th><th>Empreendimento</th><th>Na origem</th><th>Coletados</th><th>Detalhes</th><th>Conferência</th></tr></thead><tbody>
          {inspection.coverage.map((item, index) => <tr key={index}><td>{snapshotLabel(item.entity, item.archiveType)}</td><td>{item.sourceProjectId ? projectNames.get(item.sourceProjectId) ?? item.sourceProjectId : 'Empresa'}</td><td>{item.expectedCount ?? 'Não informado'}</td><td>{inspection.verificationPending ? 'Apurar' : item.collectedCount ?? 'Apurar'}</td><td>{inspection.verificationPending ? 'Apurar' : `${item.detailsCollected} / ${item.detailsExpected ?? '?'}`}</td><td><span className={`eobra-status ${!inspection.verificationPending && item.complete ? 'success' : 'warning'}`}>{inspection.verificationPending ? 'A conferir' : item.complete ? 'Conferida' : 'Incompleta'}</span>{item.errors.concat(item.warnings).map((message, i) => <small key={i}>{message}</small>)}</td></tr>)}
        </tbody></table></div>
        <div className="eobra-actions"><button type="button" className="elos-button primary" onClick={stage}>Preparar revisão no Elos</button><span className="eobra-muted">Cadastros e lançamentos serão gravados após a conferência da revisão.</span></div>
      </> : null}
    </fieldset>
    {busy ? <div role="status" aria-live="polite"><p>{busy}</p>{uploadProgress && mode === 'parts' ? <progress value={uploadProgress.done} max={uploadProgress.total} aria-label="Arquivos enviados da coleta" /> : null}</div> : null}
    {error ? <p role="alert" className="eobra-error">{error}</p> : null}
  </section>;
}
