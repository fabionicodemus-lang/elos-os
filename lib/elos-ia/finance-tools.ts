import type { ElosIaPersonaKey } from "./personas";
import type { ElosIaToolContext } from "./tools";

export type ElosIaFinanceToolName =
  | "financeiro_notas"
  | "financeiro_impostos"
  | "financeiro_bancos"
  | "financeiro_indices";

type Args = Record<string, unknown>;
type Result = Record<string, unknown>;
type Definition = {
  name: ElosIaFinanceToolName;
  label: string;
  description: string;
  permissions: string[];
  properties: Record<string, Record<string, unknown>>;
  run: (context: ElosIaToolContext, args: Args) => Promise<Result>;
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function limit(value: unknown, fallback = 12) { const n = Number(value); return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.floor(n))) : fallback; }
function projectId(context: ElosIaToolContext, raw: unknown) {
  const requested = text(raw).toLowerCase();
  if (!requested) return context.activeProjectId;
  const hits = context.projects.filter((p) => p.id === raw || p.name.toLowerCase() === requested || (p.code ?? "").toLowerCase() === requested || p.name.toLowerCase().includes(requested));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new Error(`Mais de uma obra combina com "${text(raw)}".`);
  throw new Error(`Não encontrei a obra "${text(raw)}".`);
}
function money(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function ensure(context: ElosIaToolContext, permissions: string[]) {
  const missing = permissions.filter((permission) => !context.can(permission));
  if (missing.length) throw new Error(`Seu papel não possui permissão para esta consulta (${missing.join(", ")}).`);
}

async function invoices(context: ElosIaToolContext, args: Args): Promise<Result> {
  const pid = projectId(context, args.obra);
  const max = limit(args.limite);
  const [electronic, manual] = await Promise.all([
    context.supabase.from("finance_electronic_invoices").select("id,number,series,issue_date,total_invoice,status,validation_status,suppliers(legal_name,trade_name)").eq("company_id", context.companyId).eq("project_id", pid ?? "").order("issue_date", { ascending: false }).limit(max),
    context.supabase.from("finance_manual_invoices").select("id,document_type,document_number,issue_date,gross_amount,net_amount,status,suppliers(legal_name,trade_name)").eq("company_id", context.companyId).eq("project_id", pid ?? "").order("issue_date", { ascending: false }).limit(max),
  ]);
  if (electronic.error) throw new Error(electronic.error.message);
  if (manual.error) throw new Error(manual.error.message);
  return {
    obra: pid ?? null,
    notas_eletronicas: (electronic.data ?? []).map((row) => ({ id: row.id, numero: row.number, serie: row.series, emissao: row.issue_date, valor: money(row.total_invoice), status: row.status, validacao: row.validation_status, fornecedor: Array.isArray(row.suppliers) ? row.suppliers[0]?.trade_name || row.suppliers[0]?.legal_name : row.suppliers?.trade_name || row.suppliers?.legal_name })),
    notas_manuais: (manual.data ?? []).map((row) => ({ id: row.id, tipo: row.document_type, numero: row.document_number, emissao: row.issue_date, bruto: money(row.gross_amount), liquido: money(row.net_amount), status: row.status, fornecedor: Array.isArray(row.suppliers) ? row.suppliers[0]?.trade_name || row.suppliers[0]?.legal_name : row.suppliers?.trade_name || row.suppliers?.legal_name })),
  };
}

async function taxes(context: ElosIaToolContext, args: Args): Promise<Result> {
  const pid = projectId(context, args.obra);
  const max = limit(args.limite);
  let query = context.supabase.from("finance_tax_obligations").select("id,competence_date,reference,due_date,principal_amount,interest_amount,penalty_amount,other_amount,discount_amount,status,payable_id,finance_tax_types(code,name,category)").eq("company_id", context.companyId).order("due_date", { ascending: true }).limit(max);
  if (pid) query = query.eq("project_id", pid);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return { obra: pid ?? "todas", obrigacoes: (result.data ?? []).map((row) => { const type = Array.isArray(row.finance_tax_types) ? row.finance_tax_types[0] : row.finance_tax_types; return { id: row.id, tributo: type ? `${type.code} · ${type.name}` : null, categoria: type?.category ?? null, competencia: row.competence_date, referencia: row.reference, vencimento: row.due_date, valor: money(Number(row.principal_amount ?? 0) + Number(row.interest_amount ?? 0) + Number(row.penalty_amount ?? 0) + Number(row.other_amount ?? 0) - Number(row.discount_amount ?? 0)), status: row.status, conta_a_pagar_gerada: Boolean(row.payable_id) }; }) };
}

async function banks(context: ElosIaToolContext, args: Args): Promise<Result> {
  const max = limit(args.limite, 20);
  const accounts = await context.supabase.from("finance_bank_accounts").select("id,label,bank_name,agency,account_number,account_type,current_balance,status,is_default").eq("company_id", context.companyId).order("is_default", { ascending: false }).order("label").limit(max);
  if (accounts.error) throw new Error(accounts.error.message);
  return { contas: (accounts.data ?? []).map((row) => ({ id: row.id, conta: row.label, banco: row.bank_name, agencia: row.agency, numero: row.account_number, tipo: row.account_type, saldo: money(row.current_balance), status: row.status, padrao: row.is_default })) };
}

async function indices(context: ElosIaToolContext, args: Args): Promise<Result> {
  const max = limit(args.limite, 20);
  const names = await context.supabase.from("correction_indices").select("id,code,name,status").eq("company_id", context.companyId).eq("status", "active").order("code");
  if (names.error) throw new Error(names.error.message);
  const ids = (names.data ?? []).map((row) => row.id);
  if (!ids.length) return { indices: [] };
  const values = await context.supabase.from("correction_index_values").select("correction_index_id,reference_month,value,notes").eq("company_id", context.companyId).in("correction_index_id", ids).order("reference_month", { ascending: false }).limit(max * Math.max(1, ids.length));
  if (values.error) throw new Error(values.error.message);
  return { indices: (names.data ?? []).map((index) => ({ id: index.id, codigo: index.code, nome: index.name, valores: (values.data ?? []).filter((row) => row.correction_index_id === index.id).slice(0, max).map((row) => ({ mes: row.reference_month, valor: row.value, observacoes: row.notes })) })) };
}

const nullableObra = { type: ["string", "null"], description: "Nome/código da obra; null usa a obra ativa. Para impostos, sem obra ativa retorna visão geral." };
const nullableLimit = { type: ["integer", "null"], description: "Máximo de registros retornados; null usa o padrão." };
const DEFINITIONS: Definition[] = [
  { name: "financeiro_notas", label: "Notas fiscais e documentos", description: "Consulta as notas eletrônicas e manuais do Financeiro, com fornecedor, valor, status e validação.", permissions: ["finance.invoices.view", "finance.manual_invoices.view"], properties: { obra: nullableObra, limite: nullableLimit }, run: invoices },
  { name: "financeiro_impostos", label: "Impostos e obrigações", description: "Consulta obrigações tributárias, vencimentos, valores, status e vínculo com Contas a Pagar.", permissions: ["finance.taxes.view"], properties: { obra: nullableObra, limite: nullableLimit }, run: taxes },
  { name: "financeiro_bancos", label: "Contas bancárias", description: "Consulta contas bancárias e saldos registrados no Elos.", permissions: ["finance.bank_accounts.view"], properties: { limite: nullableLimit }, run: banks },
  { name: "financeiro_indices", label: "Índices de correção", description: "Consulta índices ativos e seus valores mensais mais recentes.", permissions: ["indices.view"], properties: { limite: nullableLimit }, run: indices },
];
const BY_NAME = new Map(DEFINITIONS.map((tool) => [tool.name, tool]));

export function elosIaFinanceToolsForPersona(persona: ElosIaPersonaKey): ElosIaFinanceToolName[] {
  if (persona === "financeiro" || persona === "diretoria") return DEFINITIONS.map((item) => item.name);
  return [];
}
export function isElosIaFinanceTool(name: string): name is ElosIaFinanceToolName { return BY_NAME.has(name as ElosIaFinanceToolName); }
export function elosIaFinanceToolLabel(name: string) { return BY_NAME.get(name as ElosIaFinanceToolName)?.label ?? name; }
export function elosIaFinanceToolSchemas(names: ElosIaFinanceToolName[]) {
  return names.map((name) => BY_NAME.get(name)).filter((tool): tool is Definition => Boolean(tool)).map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, strict: true, parameters: { type: "object", additionalProperties: false, properties: tool.properties, required: Object.keys(tool.properties) } }));
}
export async function runElosIaFinanceTool(context: ElosIaToolContext, allowed: ElosIaFinanceToolName[], name: string, args: Args): Promise<Result> {
  const tool = BY_NAME.get(name as ElosIaFinanceToolName);
  if (!tool || !allowed.includes(tool.name)) return { erro: `A consulta "${name}" não está disponível para esta persona.` };
  try { ensure(context, tool.permissions); return await tool.run(context, args); }
  catch (error) { return { erro: error instanceof Error ? error.message : "Não foi possível consultar o Financeiro." }; }
}
