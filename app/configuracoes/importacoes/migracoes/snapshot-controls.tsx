'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { cancelEobraSnapshot } from './actions';
import { type SnapshotProgress } from './snapshot-presentation';

function CancelButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="elos-button" disabled={pending}>{pending ? 'Cancelando…' : 'Cancelar esta coleta'}</button>;
}

export function SnapshotControls({ companyId, runId, previewHash, canPromote, canCancel, initialProgress, autoPrepare = false }: {
  companyId: string; runId: string; previewHash: string; canPromote: boolean; canCancel: boolean;
  initialProgress: SnapshotProgress; autoPrepare?: boolean;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState(initialProgress);
  const [busy, setBusy] = useState(false);
  const [pausePending, setPausePending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const stopAfterBatch = useRef(false);
  const autoStarted = useRef(false);

  const start = useCallback(async (operation: 'prepare' | 'promote', approved = false) => {
    if (active.current) return;
    active.current = true; stopAfterBatch.current = false;
    setBusy(true); setError(''); setPausePending(false);
    try {
      let previous = '';
      while (!stopAfterBatch.current) {
        const response = await fetch('/api/imports/eobra/snapshot/process', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, run_id: runId, operation, preview_hash: previewHash, confirm_review: approved }),
        });
        const result = await response.json();
        if (!response.ok || !result.progress) throw new Error(result.error ?? 'Não foi possível atualizar o lote. Retome pelo progresso salvo.');
        const next = result.progress as SnapshotProgress;
        setProgress(next);
        const continues = operation === 'prepare'
          ? ['upload_part', 'append', 'finish_append', 'validate', 'seal'].includes(next.next_step)
          : next.next_step === 'promote';
        if (!continues) {
          router.replace('/configuracoes/importacoes/migracoes/' + runId);
          router.refresh();
          break;
        }
        const position = [next.status, next.stage, next.next_step, next.uploaded_parts, next.loaded_records, next.validated_records, next.promoted_records].join(':');
        if (position === previous) throw new Error('O progresso não avançou. Atualize a página para conferir a última etapa salva.');
        previous = position;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Este lote foi interrompido. O progresso anterior foi preservado.'); }
    finally { active.current = false; setBusy(false); setPausePending(false); }
  }, [companyId, runId, previewHash, router]);

  useEffect(() => {
    if (autoPrepare && initialProgress.status === 'building' && initialProgress.next_step !== 'map_units' && !autoStarted.current) {
      autoStarted.current = true;
      void start('prepare');
    }
  }, [autoPrepare, initialProgress.status, initialProgress.next_step, start]);
  useEffect(() => () => { stopAfterBatch.current = true; }, []);

  const preparing = progress.status === 'building';
  const promoting = progress.status === 'promoting';
  const total = Math.max(0, Number(progress.expected_records));
  const amount = preparing
    ? (progress.stage === 'loading' ? Number(progress.loaded_records) : Number(progress.validated_records))
    : Number(progress.promoted_records);
  const label = preparing ? (progress.stage === 'loading' ? 'Registros preparados' : 'Registros conferidos') : 'Registros processados';
  if (!preparing && !promoting && !canPromote && !canCancel) return null;

  return <div className="eobra-review-actions">
    {(preparing || promoting || busy) ? <div role="status" aria-live="polite">
      <p><strong>{label}: {amount.toLocaleString('pt-BR')} / {total.toLocaleString('pt-BR')}</strong></p>
      {preparing && progress.transport === 'parts' ? <p>Partes preparadas: {Number(progress.uploaded_parts ?? 0).toLocaleString('pt-BR')} / {Number(progress.expected_parts ?? 0).toLocaleString('pt-BR')}</p> : null}
      <progress value={Math.min(amount, total)} max={total || 1} aria-label={label} />
      <p>{progress.next_step === 'map_units' ? 'Defina os vínculos de unidades para continuar a conferência desta coleta.' : busy ? (pausePending ? 'O lote atual será concluído antes da pausa.' : 'O progresso é salvo a cada lote. Você pode pausar e retomar esta coleta.') : 'Continue a partir da última etapa salva. Os lotes concluídos não serão repetidos.'}</p>
    </div> : null}
    {canPromote && !promoting ? <label className="eobra-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>Conferi os empreendimentos, os vínculos, a cobertura e os totais. Li os dados que serão apenas preservados para consulta.</span></label> : null}
    <div className="eobra-actions">
      {preparing && !busy && progress.next_step !== 'map_units' ? <button type="button" className="elos-button primary" onClick={() => void start('prepare')}>Continuar preparação</button> : null}
      {preparing && !busy && progress.next_step === 'map_units' ? <a className="elos-button primary" href="#unidades">Conferir vínculos das unidades</a> : null}
      {(canPromote || promoting) && !busy ? <button type="button" className="elos-button primary" disabled={!promoting && !confirmed} onClick={() => void start('promote', confirmed || promoting)}>{promoting ? 'Retomar importação' : 'Importar registros revisados'}</button> : null}
      {busy ? <button type="button" className="elos-button" disabled={pausePending} onClick={() => { stopAfterBatch.current = true; setPausePending(true); }}>Pausar após este lote</button> : null}
      {canCancel && !busy && !promoting ? <form action={cancelEobraSnapshot}><input type="hidden" name="run_id" value={runId} /><CancelButton /></form> : null}
    </div>
    {error ? <p role="alert" className="eobra-error">{error}</p> : null}
  </div>;
}
