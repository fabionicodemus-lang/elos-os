import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assertImportOrigin, getImportWorkspace, ImportRequestError, safeImportDatabaseMessage } from '@/lib/eobra-import/server';
import { readSnapshotControl } from '@/lib/eobra-import/snapshot-request.mjs';
import { isUuid } from '@/lib/eobra-import/resolution.mjs';
import { loadEobraSnapshotPart } from '@/lib/eobra-import/snapshot-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Progress = { run_id: string; status: string; stage: string; next_step: string; expected_records: number; loaded_records: number; validated_records: number; promoted_records: number; next_part_ordinal?: number };
const batchError = (error: { code?: string; message?: string } | null) => error && ['42P01', 'PGRST202', '42501', 'P0001'].includes(error.code ?? '')
  ? safeImportDatabaseMessage(error) : 'Não foi possível concluir este lote. Confira o progresso salvo antes de retomar.';

export async function POST(request: Request) {
  try {
    assertImportOrigin(request);
    const workspace = await getImportWorkspace();
    const control = await readSnapshotControl(request);
    if (control.company_id !== workspace.companyId || !isUuid(control.run_id)) {
      throw new ImportRequestError('A empresa ou a coleta selecionada mudou. Atualize a página.', 409);
    }
    const runId = String(control.run_id);
    if (control.operation !== 'prepare' && control.operation !== 'promote') throw new ImportRequestError('Etapa de migração inválida.');
    const run = await workspace.supabase.from('eobra_migration_runs').select('id,source_storage_path').eq('id', control.run_id).eq('company_id', workspace.companyId).maybeSingle();
    if (run.error || !run.data) throw new ImportRequestError('A coleta não está disponível na empresa selecionada.', 404);
    const before = await workspace.supabase.rpc('eobra_snapshot_progress', { p_run_id: control.run_id });
    if (before.error || !before.data) throw new ImportRequestError(batchError(before.error), 400);
    const progress = before.data as Progress;
    let result: { error: { message: string; code?: string } | null } | null = null;
    if (control.operation === 'prepare') {
      const argumentsForRun = { p_run_id: control.run_id };
      if (progress.next_step === 'upload_part') {
        const part = await loadEobraSnapshotPart(workspace, runId, run.data.source_storage_path, progress.next_part_ordinal);
        result = await workspace.supabase.rpc('append_eobra_snapshot_part', { ...argumentsForRun, p_part_ordinal: part.ordinal, p_json_text: part.jsonText });
      }
      else if (progress.next_step === 'append') result = await workspace.supabase.rpc('append_eobra_snapshot', { ...argumentsForRun, p_limit: 250 });
      else if (progress.next_step === 'finish_append') result = await workspace.supabase.rpc('finish_eobra_snapshot_append', argumentsForRun);
      else if (progress.next_step === 'validate') result = await workspace.supabase.rpc('validate_eobra_snapshot_chunk', { ...argumentsForRun, p_limit: 100 });
      else if (progress.next_step === 'seal') result = await workspace.supabase.rpc('seal_eobra_snapshot', argumentsForRun);
    } else if (progress.next_step === 'promote') {
      if (typeof control.preview_hash !== 'string' || !/^[a-f0-9]{64}$/.test(control.preview_hash)) throw new ImportRequestError('A revisão mudou. Atualize a página antes de importar.', 409);
      if (progress.status === 'ready' && control.confirm_review !== true) throw new ImportRequestError('Confira a revisão antes de iniciar a importação.');
      result = await workspace.supabase.rpc('promote_eobra_snapshot_chunk', { p_run_id: control.run_id, p_preview_hash: control.preview_hash, p_limit: 50 });
    } else if (progress.status === 'building') {
      throw new ImportRequestError('Conclua a preparação e confira a revisão antes de importar.', 409);
    }
    if (result?.error) throw new ImportRequestError(batchError(result.error), 400);
    const after = await workspace.supabase.rpc('eobra_snapshot_progress', { p_run_id: control.run_id });
    if (after.error || !after.data) throw new ImportRequestError('O lote foi processado, mas não foi possível atualizar o progresso. Atualize a página para retomar.', 503);
    const updated = after.data as Progress;
    if (updated.status === 'imported') {
      for (const path of ['/configuracoes/importacoes', '/configuracoes/importacoes/migracoes', '/cadastros/clientes', '/cadastros/fornecedores', '/empreendimentos/unidades', '/comercial/vendas', '/financeiro/contas-a-receber', '/financeiro/contas-a-pagar', '/financeiro/fluxo-de-caixa', '/financeiro/relatorios', '/dashboard']) revalidatePath(path);
    }
    return NextResponse.json({ progress: updated }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ImportRequestError ? error.message : 'Não foi possível processar este lote. O progresso anterior foi preservado.' },
      { status: error instanceof ImportRequestError ? error.status : 500 });
  }
}
