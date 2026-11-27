import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getImportWorkspace, ImportRequestError, safeImportDatabaseMessage } from '@/lib/eobra-import/server';
import { parseUnitMapPageQuery, readSnapshotUnitMapRequest, UNIT_MAP_PAGE_SIZE, unitMapRequiredPermissions, unitMapSearchPattern } from '@/lib/eobra-import/unit-map.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store' };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const own = (value: Json, key: string) => Object.hasOwn(value, key) ? value[key] : undefined;
const text = (value: unknown) => typeof value === 'string' ? value : null;
const amount = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && /^\d+(?:\.\d+)?$/.test(String(value)) ? value : null;

async function workspaceForUnitMap(companyId: string, runId: string) {
  const workspace = await getImportWorkspace();
  if (workspace.companyId !== companyId) throw new ImportRequestError('A empresa selecionada mudou. Atualize a página antes de continuar.', 409);
  const result = await workspace.supabase.from('eobra_migration_runs')
    .select('id,status,project_map,required_permissions,unit_map,unit_target_evidence,unit_map_confirmed_at').eq('id', runId).eq('company_id', companyId).maybeSingle();
  if (result.error || !result.data) throw new ImportRequestError('A coleta não está disponível na empresa selecionada.', 404);
  const permissions = unitMapRequiredPermissions(result.data.required_permissions);
  const checks = await Promise.all(permissions.map(permission => workspace.supabase.rpc('has_company_permission', { target_company_id: companyId, target_permission: permission })));
  if (checks.some(check => check.error || check.data !== true)) throw new ImportRequestError('Seu perfil precisa ter acesso aos cadastros e módulos desta migração para revisar as unidades.', 403);
  return { ...workspace, run: result.data };
}

function replyError(error: unknown) {
  return NextResponse.json({ error: error instanceof ImportRequestError ? error.message : 'Não foi possível conferir as unidades desta coleta.' }, { status: error instanceof ImportRequestError ? error.status : 500, headers });
}

export async function GET(request: Request) {
  try {
    const query = parseUnitMapPageQuery(new URL(request.url).searchParams);
    const { supabase, companyId, run } = await workspaceForUnitMap(query.companyId, query.runId);
    const projects = Object.values(object(run.project_map));
    if (query.projectId && !projects.includes(query.projectId)) throw new ImportRequestError('A obra não pertence ao escopo desta coleta.', 403);
    if (query.mode === 'options') {
      const options = await supabase.rpc('eobra_snapshot_unit_options', { p_run_id: query.runId, p_project_id: query.projectId, p_search: query.search || null, p_limit: UNIT_MAP_PAGE_SIZE, p_offset: (query.page - 1) * UNIT_MAP_PAGE_SIZE });
      if (options.error || !options.data) throw new ImportRequestError(options.error ? safeImportDatabaseMessage(options.error) : 'Não foi possível conferir os cadastros de unidades.', 400);
      return NextResponse.json({ ...object(options.data), page: query.page, page_size: UNIT_MAP_PAGE_SIZE }, { headers });
    }
    const progress = await supabase.rpc('eobra_snapshot_progress', { p_run_id: query.runId });
    if (progress.error || !progress.data) throw new ImportRequestError(progress.error ? safeImportDatabaseMessage(progress.error) : 'O progresso da coleta não está disponível.', 400);
    const state = object(progress.data);
    if (state.stage === 'loading') throw new ImportRequestError('Conclua o carregamento das partes antes de revisar as unidades.', 409);
    let rowsQuery = supabase.from('eobra_migration_records').select('source_id,source_project_id,project_id,normalized_data', { count: 'exact' })
      .eq('company_id', companyId).eq('run_id', query.runId).eq('entity', 'unit').order('source_project_id').order('source_id')
      .range((query.page - 1) * UNIT_MAP_PAGE_SIZE, query.page * UNIT_MAP_PAGE_SIZE - 1);
    if (query.projectId) rowsQuery = rowsQuery.eq('project_id', query.projectId);
    if (query.search) rowsQuery = rowsQuery.ilike('normalized_data->>code', unitMapSearchPattern(query.search));
    const rows = await rowsQuery;
    if (rows.error) throw new ImportRequestError('Não foi possível carregar esta página de unidades.', 500);
    const unitMap = object(run.unit_map);
    const evidence = object(run.unit_target_evidence);
    return NextResponse.json({
      page: query.page, page_size: UNIT_MAP_PAGE_SIZE, count: rows.count ?? 0,
      total_units: Number(state.unit_records ?? state.units_requiring_decision ?? 0), confirmed: Boolean(run.unit_map_confirmed_at),
      records: (rows.data ?? []).map(row => {
        const data = object(row.normalized_data);
        const saved = object(own(evidence, row.source_id));
        const identity = object(saved.identity);
        return {
          source_id: row.source_id, source_project_id: row.source_project_id, project_id: row.project_id,
          code: text(data.code) || row.source_id, type: text(data.type), status: text(data.status),
          private_area: amount(data.private_area), total_area: amount(data.total_area),
          decision: own(unitMap, row.source_id) ?? null,
          target: identity.id ? { id: identity.id, code: identity.code, type: identity.type, status: saved.reviewed_status, private_area: identity.private_area, total_area: identity.total_area, source_system: identity.source_system } : null,
        };
      }),
    }, { headers });
  } catch (error) { return replyError(error); }
}

export async function POST(request: Request) {
  try {
    const control = await readSnapshotUnitMapRequest(request);
    const { supabase } = await workspaceForUnitMap(control.company_id, control.run_id);
    const confirmed = await supabase.rpc('confirm_eobra_snapshot_unit_map', { p_run_id: control.run_id, p_unit_map: control.unit_map });
    if (confirmed.error || !confirmed.data) throw new ImportRequestError(confirmed.error ? safeImportDatabaseMessage(confirmed.error) : 'Não foi possível confirmar os vínculos.', 400);
    revalidatePath(`/configuracoes/importacoes/migracoes/${control.run_id}`);
    return NextResponse.json({ progress: confirmed.data }, { headers });
  } catch (error) { return replyError(error); }
}
