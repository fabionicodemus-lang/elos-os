import type { ElosIaPersonaKey } from "./personas";
import type { ElosIaToolContext } from "./tools";

export type ElosIaWorksiteToolName = "qualidade_da_obra" | "materiais_da_obra";

type Args = Record<string, unknown>;
type Result = Record<string, unknown>;
type Definition = {
  name: ElosIaWorksiteToolName;
  label: string;
  description: string;
  permissions: string[];
  properties: Record<string, Record<string, unknown>>;
  run: (context: ElosIaToolContext, args: Args) => Promise<Result>;
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function limit(value: unknown, fallback = 12) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(30, Math.max(1, Math.floor(parsed))) : fallback;
}
function projectId(context: ElosIaToolContext, raw: unknown) {
  const requested = text(raw).toLowerCase();
  if (!requested) {
    if (context.activeProjectId) return context.activeProjectId;
    throw new Error("Selecione uma obra ou informe o nome/código da obra.");
  }
  const hits = context.projects.filter((project) => project.id === raw || project.name.toLowerCase() === requested || (project.code ?? "").toLowerCase() === requested || project.name.toLowerCase().includes(requested));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new Error(`Mais de uma obra combina com "${text(raw)}".`);
  throw new Error(`Não encontrei a obra "${text(raw)}".`);
}
function ensure(context: ElosIaToolContext, permissions: string[]) {
  const missing = permissions.filter((permission) => !context.can(permission));
  if (missing.length) throw new Error(`Seu papel não possui permissão para esta consulta (${missing.join(", ")}).`);
}
function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

async function quality(context: ElosIaToolContext, args: Args): Promise<Result> {
  const pid = projectId(context, args.obra);
  const max = limit(args.limite, 15);
  const [inspections, nonconformities] = await Promise.all([
    context.supabase.from("quality_inspections")
      .select("id,inspection_number,stage_name,due_date,status,completion_percent,current_score,first_inspection_score,release_status,tower,unit_name,environment_name,executor_team,created_at")
      .eq("company_id", context.companyId).eq("project_id", pid)
      .order("due_date", { ascending: true }).limit(200),
    context.supabase.from("quality_nonconformities")
      .select("id,nc_number,description,severity,is_blocking,responsible_team,opened_at,due_at,estimated_rework_cost,status")
      .eq("company_id", context.companyId).eq("project_id", pid)
      .order("due_at", { ascending: true }).limit(200),
  ]);
  if (inspections.error) throw new Error(inspections.error.message);
  if (nonconformities.error) throw new Error(nonconformities.error.message);
  const today = context.today;
  const inspectionRows = inspections.data ?? [];
  const ncRows = nonconformities.data ?? [];
  const activeInspections = inspectionRows.filter((row) => !["closed", "cancelled"].includes(row.status));
  const openNcs = ncRows.filter((row) => !["closed", "cancelled"].includes(row.status));
  const overdueNcs = openNcs.filter((row) => String(row.due_at ?? "").slice(0, 10) < today);
  const blocked = activeInspections.filter((row) => row.release_status === "blocked" || row.status === "blocked");
  const scores = inspectionRows.map((row) => Number(row.current_score)).filter((value) => Number.isFinite(value));
  return {
    obra: pid,
    resumo: {
      vistorias_abertas: activeInspections.length,
      vistorias_bloqueadas: blocked.length,
      nao_conformidades_abertas: openNcs.length,
      nao_conformidades_vencidas: overdueNcs.length,
      custo_estimado_retrabalho_aberto: money(openNcs.reduce((sum, row) => sum + Number(row.estimated_rework_cost ?? 0), 0)),
      nota_media: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : null,
    },
    prioridades: [
      ...overdueNcs.map((row) => ({ tipo: "nc_vencida", numero: row.nc_number, gravidade: row.severity, bloqueante: row.is_blocking, prazo: row.due_at, equipe: row.responsible_team, descricao: row.description })),
      ...blocked.map((row) => ({ tipo: "vistoria_bloqueada", numero: row.inspection_number, etapa: row.stage_name, local: [row.tower, row.unit_name, row.environment_name].filter(Boolean).join(" · ") || null, equipe: row.executor_team, prazo: row.due_date, progresso: row.completion_percent })),
    ].slice(0, max),
    vistorias: activeInspections.slice(0, max).map((row) => ({ numero: row.inspection_number, etapa: row.stage_name, status: row.status, liberacao: row.release_status, prazo: row.due_date, progresso: row.completion_percent, nota: row.current_score, equipe: row.executor_team, local: [row.tower, row.unit_name, row.environment_name].filter(Boolean).join(" · ") || null })),
  };
}

async function materials(context: ElosIaToolContext, args: Args): Promise<Result> {
  const pid = projectId(context, args.obra);
  const max = limit(args.limite, 15);
  const requests = await context.supabase.from("execution_material_requests")
    .select("id,request_number,status,needed_date,requester_name,notes,created_at,updated_at")
    .eq("company_id", context.companyId).eq("project_id", pid)
    .order("needed_date", { ascending: true }).limit(200);
  if (requests.error) throw new Error(requests.error.message);
  const rows = requests.data ?? [];
  const active = rows.filter((row) => !["fulfilled", "cancelled"].includes(row.status));
  const urgent = active.filter((row) => row.needed_date && row.needed_date <= context.today);
  const ids = active.map((row) => row.id);
  const items = ids.length ? await context.supabase.from("execution_material_request_items")
    .select("request_id,input_code,input_name,unit_snapshot,requested_quantity,ordered_quantity,stock_fulfilled_quantity,notes")
    .eq("company_id", context.companyId).eq("project_id", pid).in("request_id", ids).limit(1000) : { data: [], error: null };
  if (items.error) throw new Error(items.error.message);
  const itemRows = items.data ?? [];
  return {
    obra: pid,
    resumo: {
      solicitacoes_abertas: active.length,
      necessarias_hoje_ou_atrasadas: urgent.length,
      itens_abertos: itemRows.filter((item) => Number(item.requested_quantity ?? 0) > Number(item.ordered_quantity ?? 0) + Number(item.stock_fulfilled_quantity ?? 0)).length,
    },
    prioridades: urgent.slice(0, max).map((row) => ({
      numero: row.request_number,
      status: row.status,
      data_necessaria: row.needed_date,
      solicitante: row.requester_name,
      observacoes: row.notes,
      itens: itemRows.filter((item) => item.request_id === row.id).slice(0, 12).map((item) => ({
        codigo: item.input_code,
        material: item.input_name,
        unidade: item.unit_snapshot,
        solicitado: item.requested_quantity,
        pedido: item.ordered_quantity,
        atendido_estoque: item.stock_fulfilled_quantity,
        saldo: Math.max(0, Number(item.requested_quantity ?? 0) - Number(item.ordered_quantity ?? 0) - Number(item.stock_fulfilled_quantity ?? 0)),
      })),
    })),
    solicitacoes: active.slice(0, max).map((row) => ({ numero: row.request_number, status: row.status, data_necessaria: row.needed_date, solicitante: row.requester_name, observacoes: row.notes })),
  };
}

const nullableObra = { type: ["string", "null"], description: "Nome/código da obra; null usa a obra ativa." };
const nullableLimit = { type: ["integer", "null"], description: "Máximo de registros detalhados; null usa o padrão." };
const DEFINITIONS: Definition[] = [
  { name: "qualidade_da_obra", label: "Qualidade da obra", description: "Consulta vistorias, liberações, não conformidades, prazos, bloqueios, retrabalho e notas da Qualidade para identificar prioridades de campo.", permissions: ["execution.quality.view"], properties: { obra: nullableObra, limite: nullableLimit }, run: quality },
  { name: "materiais_da_obra", label: "Materiais da obra", description: "Consulta solicitações de materiais, datas de necessidade, itens ainda sem atendimento e prioridades da equipe de campo.", permissions: ["execution.material_requests.view"], properties: { obra: nullableObra, limite: nullableLimit }, run: materials },
];
const BY_NAME = new Map(DEFINITIONS.map((tool) => [tool.name, tool]));

export function elosIaWorksiteToolsForPersona(persona: ElosIaPersonaKey): ElosIaWorksiteToolName[] {
  if (persona === "engenharia" || persona === "diretoria") return DEFINITIONS.map((item) => item.name);
  return [];
}
export function isElosIaWorksiteTool(name: string): name is ElosIaWorksiteToolName { return BY_NAME.has(name as ElosIaWorksiteToolName); }
export function elosIaWorksiteToolLabel(name: string) { return BY_NAME.get(name as ElosIaWorksiteToolName)?.label ?? name; }
export function elosIaWorksiteToolSchemas(names: ElosIaWorksiteToolName[]) {
  return names.map((name) => BY_NAME.get(name)).filter((tool): tool is Definition => Boolean(tool)).map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, strict: true, parameters: { type: "object", additionalProperties: false, properties: tool.properties, required: Object.keys(tool.properties) } }));
}
export async function runElosIaWorksiteTool(context: ElosIaToolContext, allowed: ElosIaWorksiteToolName[], name: string, args: Args): Promise<Result> {
  const tool = BY_NAME.get(name as ElosIaWorksiteToolName);
  if (!tool || !allowed.includes(tool.name)) return { erro: `A consulta "${name}" não está disponível para esta persona.` };
  try { ensure(context, tool.permissions); return await tool.run(context, args); }
  catch (error) { return { erro: error instanceof Error ? error.message : "Não foi possível consultar o grupo Obra." }; }
}
