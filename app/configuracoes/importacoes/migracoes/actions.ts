'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCompanyPermission } from '@/lib/workspace';
import { isUuid } from '@/lib/eobra-import/resolution.mjs';
import { safeImportDatabaseMessage } from '@/lib/eobra-import/server';

const BASE = '/configuracoes/importacoes/migracoes';
const destination = (id: string, message: string, type = 'error') => `${BASE}${isUuid(id) ? `/${id}` : ''}?${new URLSearchParams({ [type]: message })}`;

export async function cancelEobraSnapshot(form: FormData) {
  const id = String(form.get('run_id') ?? '');
  if (!isUuid(id)) redirect(destination('', 'Revisão de migração inválida.'));
  const { supabase, companyId } = await requireCompanyPermission('admin.company.manage');
  const run = await supabase.from('eobra_migration_runs').select('id').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (run.error || !run.data) redirect(destination('', 'A coleta não está disponível na empresa selecionada.'));
  const result = await supabase.rpc('cancel_eobra_snapshot', { p_run_id: id });
  if (result.error) redirect(destination(id, safeImportDatabaseMessage(result.error)));
  revalidatePath(BASE); revalidatePath(`${BASE}/${id}`);
  redirect(destination(id, 'Coleta cancelada. O histórico da revisão foi preservado.', 'success'));
}
