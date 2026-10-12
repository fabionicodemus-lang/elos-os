// Elos IA — ferramentas de consulta ao Elos OS.
//
// Segurança:
// - Todas as consultas usam o cliente Supabase da SESSÃO do usuário (chave
//   pública + cookies). O RLS do banco continua valendo: a IA nunca enxerga
//   dados de outra empresa nem dados que o usuário não poderia ver nas telas.
// - Toda ferramenta é SOMENTE LEITURA (apenas `select`).
// - Antes de consultar, a ferramenta confere as permissões do papel do
//   usuário. Sem isso o RLS devolveria listas vazias e a IA responderia
//   "R$ 0,00" como se fosse verdade.
// - Cada ferramenta devolve um resumo pequeno e já somado, para gastar poucos
//   tokens e para a IA não precisar fazer contas com listas grandes.

import type { ForecastServiceRow } from "@/lib/forecast/engine.mjs";
import { loadProjectForecast } from "@/lib/forecast/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { resolveActiveWorkspace } from "@/lib/workspace";
import {
  addMonthsKey,
  buildCashflowMonths,
  round2,
  summarizePayables,
  summarizeReceivables,
  summarizeSchedule,
  type PayableSummaryRow,
  type ReceivableSummaryRow,
  type ScheduleActivityRow,
  type ScheduleMeasurementRow,
  type ScheduleServiceWeightRow,
} from "./summaries.mjs";

type SupabaseClientLike = Awaited<ReturnType<typeof resolveActiveWorkspace>>["supabase"];

export type ElosIaToolName =
  | "listar_obras"
  | "resumo_da_obra"
  | "custos_e_orcamento"
  | "cronograma_fisico"
  | "contas_a_pagar"
  | "contas_a_receber"
  | "fluxo_de_caixa"
  | "vendas_e_unidades"
  | "contratos_de_servico"
  | "diario_de_obra";

export type ElosIaProject = { id: string; name: string; code: string | null; city: string | null; status: string };

export type ElosIaToolContext = {
  supabase: SupabaseClientLike;
  companyId: string;
  /** Obra selecionada no cabeçalho do Elos OS (null = visão da empresa). */
  activeProjectId: string | null;
  projects: ElosIaProject[];
  /** Data de hoje (America/Sao_Paulo) em AAAA-MM-DD. */
  today: string;
  can: (permission: string) => boolean;
  cache: Map<string, Promise<unknown>>;
};

type ToolArgs = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

type ToolDefinition = {
  name: ElosIaToolName;
  label: string;
  description: string;
  /** Permissões do Elos OS exigidas (todas). */
  permissions: string[];
  properties: Record<string, Record<string, unknown>>;
  run: (context: ElosIaToolContext, args: ToolArgs) => Promise<ToolResult>;
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const OBRA_PROPERTY = {
  type: ["string", "null"],
  description: "Nome ou código da obra. Use null para a obra ativa do usuário.",
};
const OBRA_OR_ALL_PROPERTY = {
  type: ["string", "null"],
  description: "Nome ou código da obra. Use null para a obra ativa do usuário, ou \"todas\" para somar todas as obras da empresa.",
};
const LIMIT_PROPERTY = {
  type: ["integer", "null"],
  description: "Quantidade máxima de itens na lista (padrão 10, máximo 25). Os totais sempre consideram tudo.",
};
const DATE_FROM_PROPERTY = { type: ["string", "null"], description: "Data inicial do período, formato AAAA-MM-DD. Use null para não filtrar." };
const DATE_TO_PROPERTY = { type: ["string", "null"], description: "Data final do período, formato AAAA-MM-DD. Use null para não filtrar." };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateArg(value: unknown) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function numberArg(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cut(value: string | null | undefined, max: number) {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function projectLabel(project: ElosIaProject) {
  return [project.code, project.name].filter(Boolean).join(" · ");
}

function cached<T>(context: ElosIaToolContext, key: string, load: () => Promise<T>): Promise<T> {
  const existing = context.cache.get(key);
  if (existing) return existing as Promise<T>;
  const created = load();
  context.cache.set(key, created);
  return created;
}

class ToolError extends Error {}

type ProjectScope = { project: ElosIaProject | null; label: string };

function resolveProject(context: ElosIaToolContext, raw: unknown, allowAll: boolean): ProjectScope {
  const requested = text(raw);
  const options = context.projects.map(projectLabel).join("; ") || "nenhuma obra cadastrada";

  if (!requested) {
    const active = context.projects.find((project) => project.id === context.activeProjectId) ?? null;
    if (active) return { project: active, label: projectLabel(active) };
    if (allowAll) return { project: null, label: "Todas as obras da empresa" };
    throw new ToolError(`Nenhuma obra está selecionada. Informe o parâmetro "obra". Obras disponíveis: ${options}.`);
  }

  const wanted = normalize(requested);
  if (["todas", "todas as obras", "empresa", "geral"].includes(wanted)) {
    if (allowAll) return { project: null, label: "Todas as obras da empresa" };
    throw new ToolError(`Esta consulta precisa de uma obra específica. Obras disponíveis: ${options}.`);
  }

  const exact = context.projects.filter((project) => normalize(project.name) === wanted || normalize(project.code) === wanted);
  const partial = exact.length
    ? exact
    : context.projects.filter((project) => normalize(projectLabel(project)).includes(wanted) || wanted.includes(normalize(project.name)));
  if (partial.length === 1) return { project: partial[0], label: projectLabel(partial[0]) };
  if (partial.length > 1) throw new ToolError(`Mais de uma obra combina com "${requested}": ${partial.map(projectLabel).join("; ")}. Pergunte ao usuário qual delas.`);
  throw new ToolError(`Não encontrei a obra "${requested}". Obras disponíveis: ${options}.`);
}

function failIfErrors(errors: Array<string | null | undefined>) {
  const messages = errors.filter(Boolean) as string[];
  if (!messages.length) return;
  // O detalhe técnico fica no log do servidor; para a IA vai só o aviso.
  console.error("[elos-ia] Falha de leitura no banco:", [...new Set(messages)].join(" · "));
  throw new ToolError("O Elos OS não conseguiu ler estes dados agora. Avise o usuário e sugira tentar de novo em instantes.");
}

/**
 * Permissões que a previsão de custos (Realizado / Comprometido / A comprometer)
 * precisa para ler TODAS as suas tabelas. Faltando uma, o RLS devolveria parte
 * dos dados vazia e os números sairiam errados sem aviso.
 */
const FORECAST_PERMISSIONS = ["schedule.view", "budgets.view", "payables.view", "execution.contracts.view", "execution.measurements.view"];

// ---------------------------------------------------------------------------
// Carregadores (com cache por pergunta)
// ---------------------------------------------------------------------------

type PayableRecord = {
  id: string; due_date: string; amount: number; status: string; document: string | null; installment_label: string | null;
  paid_at: string | null; paid_amount: number | null;
  suppliers: { legal_name: string; trade_name: string | null } | { legal_name: string; trade_name: string | null }[] | null;
};

function loadPayables(context: ElosIaToolContext, projectId: string | null) {
  return cached(context, `payables:${projectId ?? "all"}`, async (): Promise<PayableSummaryRow[]> => {
    const result = await fetchAllRows<PayableRecord>(async (from, to) => {
      let query = context.supabase
        .from("payables")
        .select("id, due_date, amount, status, document, installment_label, paid_at, paid_amount, suppliers(legal_name, trade_name)")
        .eq("company_id", context.companyId)
        .neq("status", "cancelled");
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query.order("due_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as unknown as PayableRecord[], error };
    });
    failIfErrors([result.error?.message]);
    return result.data.map((row) => {
      const supplier = relatedOne(row.suppliers);
      return {
        id: row.id,
        status: row.status,
        dueDate: row.due_date,
        paidAt: row.paid_at,
        amount: row.amount,
        paidAmount: row.paid_amount,
        supplier: supplier?.trade_name || supplier?.legal_name || null,
        document: row.document,
        installment: row.installment_label,
      };
    });
  });
}

type ReceivableRecord = {
  id: string; due_date: string; amount: number; adjusted_amount: number | null; status: string; category: string;
  sequence_number: number | null; sequence_total: number | null; paid_at: string | null; paid_amount: number | null;
  clients: { name: string } | { name: string }[] | null;
  units: { code: string } | { code: string }[] | null;
};

function loadReceivables(context: ElosIaToolContext, projectId: string | null) {
  return cached(context, `receivables:${projectId ?? "all"}`, async (): Promise<ReceivableSummaryRow[]> => {
    const result = await fetchAllRows<ReceivableRecord>(async (from, to) => {
      let query = context.supabase
        .from("receivables")
        .select("id, due_date, amount, adjusted_amount, status, category, sequence_number, sequence_total, paid_at, paid_amount, clients(name), units(code)")
        .eq("company_id", context.companyId)
        .neq("status", "cancelled");
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query.order("due_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as unknown as ReceivableRecord[], error };
    });
    failIfErrors([result.error?.message]);
    return result.data.map((row) => ({
      id: row.id,
      status: row.status,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      amount: row.amount,
      adjustedAmount: row.adjusted_amount,
      paidAmount: row.paid_amount,
      category: row.category,
      client: relatedOne(row.clients)?.name ?? null,
      unit: relatedOne(row.units)?.code ?? null,
      sequenceNumber: row.sequence_number,
      sequenceTotal: row.sequence_total,
    }));
  });
}

function loadForecast(context: ElosIaToolContext, projectId: string) {
  return cached(context, `forecast:${projectId}`, () =>
    loadProjectForecast({ supabase: context.supabase, companyId: context.companyId, projectId, asOfDate: context.today }),
  );
}

type ScheduleBaseline = { id: string; code: string; name: string; version: string; status: string };

async function namesById(
  context: ElosIaToolContext,
  table: "engineering_services" | "engineering_takeoff_locations",
  column: "description" | "name",
  ids: string[],
) {
  const names = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await context.supabase
      .from(table)
      .select(`id, code, ${column}`)
      .eq("company_id", context.companyId)
      .in("id", ids.slice(index, index + 100));
    failIfErrors([error?.message]);
    for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      if (row.id) names.set(row.id, [row.code, row[column]].filter(Boolean).join(" · "));
    }
  }
  return names;
}

function loadSchedule(context: ElosIaToolContext, projectId: string) {
  return cached(context, `schedule:${projectId}`, async () => {
    const baselinesResult = await fetchAllRows<ScheduleBaseline>(async (from, to) => {
      const { data, error } = await context.supabase
        .from("engineering_schedule_baselines")
        .select("id, code, name, version, status")
        .eq("company_id", context.companyId)
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as ScheduleBaseline[], error };
    });
    failIfErrors([baselinesResult.error?.message]);
    const baseline = baselinesResult.data.find((item) => item.status === "approved") ?? baselinesResult.data[0] ?? null;
    if (!baseline) return { baseline: null, activities: [], measurements: [], weights: [], serviceNames: new Map<string, string>(), locationNames: new Map<string, string>() };

    const [activitiesResult, measurementsResult, weightsResult] = await Promise.all([
      fetchAllRows<ScheduleActivityRow>(async (from, to) => {
        const { data, error } = await context.supabase
          .from("engineering_schedule_activities")
          .select("id, service_id, location_id, code, name, quantity_snapshot, duration_days, planned_start, planned_finish, planned_cost, record_status")
          .eq("company_id", context.companyId)
          .eq("project_id", projectId)
          .eq("baseline_id", baseline.id)
          .eq("record_status", "active")
          .order("sort_order")
          .order("id")
          .range(from, to);
        return { data: (data ?? []) as ScheduleActivityRow[], error };
      }),
      fetchAllRows<ScheduleMeasurementRow>(async (from, to) => {
        const { data, error } = await context.supabase
          .from("engineering_schedule_progress_measurements")
          .select("id, activity_id, measurement_date, progress_percent, current_start, current_finish, created_at")
          .eq("company_id", context.companyId)
          .eq("project_id", projectId)
          .order("measurement_date")
          .order("id")
          .range(from, to);
        return { data: (data ?? []) as ScheduleMeasurementRow[], error };
      }),
      fetchAllRows<ScheduleServiceWeightRow>(async (from, to) => {
        const { data, error } = await context.supabase
          .from("engineering_schedule_service_weights")
          .select("service_id, physical_weight_percent")
          .eq("company_id", context.companyId)
          .eq("project_id", projectId)
          .eq("baseline_id", baseline.id)
          .order("created_at")
          .range(from, to);
        return { data: (data ?? []) as ScheduleServiceWeightRow[], error };
      }),
    ]);
    failIfErrors([activitiesResult.error?.message, measurementsResult.error?.message, weightsResult.error?.message]);

    const activityIds = new Set(activitiesResult.data.map((activity) => activity.id));
    const serviceIds = [...new Set(activitiesResult.data.map((activity) => activity.service_id).filter(Boolean))] as string[];
    const locationIds = [...new Set(activitiesResult.data.map((activity) => activity.location_id).filter(Boolean))] as string[];
    const [serviceNames, locationNames] = await Promise.all([
      namesById(context, "engineering_services", "description", serviceIds),
      namesById(context, "engineering_takeoff_locations", "name", locationIds),
    ]);

    return {
      baseline,
      activities: activitiesResult.data,
      measurements: measurementsResult.data.filter((measurement) => activityIds.has(measurement.activity_id)),
      weights: weightsResult.data,
      serviceNames,
      locationNames,
    };
  });
}

type UnitRecord = { id: string; code: string; floor: number | null; type: string | null; list_price: number | null; status: string };
type SaleRecord = {
  id: string; number: string; sale_date: string; total_amount: number; status: string; broker_name: string | null;
  clients: { name: string } | { name: string }[] | null;
  units: { code: string } | { code: string }[] | null;
};

function loadUnitsAndSales(context: ElosIaToolContext, projectId: string | null) {
  return cached(context, `sales:${projectId ?? "all"}`, async () => {
    const [unitsResult, salesResult] = await Promise.all([
      fetchAllRows<UnitRecord>(async (from, to) => {
        let query = context.supabase.from("units").select("id, code, floor, type, list_price, status").eq("company_id", context.companyId);
        if (projectId) query = query.eq("project_id", projectId);
        const { data, error } = await query.order("code").order("id").range(from, to);
        return { data: (data ?? []) as UnitRecord[], error };
      }),
      fetchAllRows<SaleRecord>(async (from, to) => {
        let query = context.supabase
          .from("sales")
          .select("id, number, sale_date, total_amount, status, broker_name, clients(name), units(code)")
          .eq("company_id", context.companyId);
        if (projectId) query = query.eq("project_id", projectId);
        const { data, error } = await query.order("sale_date", { ascending: false }).order("id").range(from, to);
        return { data: (data ?? []) as unknown as SaleRecord[], error };
      }),
    ]);
    failIfErrors([unitsResult.error?.message, salesResult.error?.message]);
    return { units: unitsResult.data, sales: salesResult.data };
  });
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

const UNIT_STATUS_LABELS: Record<string, string> = { available: "disponíveis", reserved: "reservadas", sold: "vendidas", inactive: "inativas" };
const PROJECT_STATUS_LABELS: Record<string, string> = { planning: "em planejamento", active: "em andamento", paused: "pausada", completed: "concluída", archived: "arquivada" };
const CONTRACT_STATUS_LABELS: Record<string, string> = { draft: "rascunho", active: "ativo", suspended: "suspenso", finished: "encerrado", cancelled: "cancelado" };
const DAILY_LOG_STATUS_LABELS: Record<string, string> = {
  pending: "pendente", in_progress: "em preenchimento", awaiting_approval: "aguardando aprovação", approved: "aprovado",
  approved_with_reservations: "aprovado com ressalvas", reopened: "reaberto", cancelled: "cancelado",
};
const OCCURRENCE_TYPE_LABELS: Record<string, string> = {
  general: "geral", delay: "atraso", interference: "interferência", inspection: "fiscalização", visit: "visita", material: "material",
  equipment: "equipamento", quality: "qualidade", incident: "incidente", accident: "acidente", stoppage: "paralisação",
};
const IMPACT_LABELS: Record<string, string> = { low: "baixo", medium: "médio", high: "alto", critical: "crítico" };

async function runListarObras(context: ElosIaToolContext): Promise<ToolResult> {
  return {
    obra_ativa: context.projects.find((project) => project.id === context.activeProjectId)?.name ?? null,
    obras: context.projects.map((project) => ({
      nome: project.name,
      codigo: project.code,
      cidade: project.city,
      situacao: PROJECT_STATUS_LABELS[project.status] ?? project.status,
    })),
  };
}

function salesSummary(units: UnitRecord[], sales: SaleRecord[], today: string, limit: number) {
  const unitsByStatus: Record<string, { quantidade: number; valor_de_tabela: number }> = {};
  for (const unit of units) {
    if (unit.status === "inactive") continue;
    const key = UNIT_STATUS_LABELS[unit.status] ?? unit.status;
    const current = unitsByStatus[key] ?? { quantidade: 0, valor_de_tabela: 0 };
    current.quantidade += 1;
    current.valor_de_tabela = round2(current.valor_de_tabela + Number(unit.list_price ?? 0));
    unitsByStatus[key] = current;
  }
  const sellable = units.filter((unit) => unit.status !== "inactive");
  const sold = sellable.filter((unit) => unit.status === "sold").length;
  const activeSales = sales.filter((sale) => sale.status === "active");
  const firstMonth = addMonthsKey(today.slice(0, 7), -5);
  const byMonth = new Map<string, { mes: string; vendas: number; valor: number }>();
  for (const sale of activeSales) {
    const month = (sale.sale_date ?? "").slice(0, 7);
    if (!month || month < firstMonth) continue;
    const current = byMonth.get(month) ?? { mes: month, vendas: 0, valor: 0 };
    current.vendas += 1;
    current.valor = round2(current.valor + Number(sale.total_amount ?? 0));
    byMonth.set(month, current);
  }
  return {
    unidades: {
      total: sellable.length,
      por_situacao: unitsByStatus,
      percentual_vendido: sellable.length ? round2(sold / sellable.length * 100) : 0,
    },
    vendas: {
      ativas: activeSales.length,
      valor_total_vendido: round2(activeSales.reduce((sum, sale) => sum + Number(sale.total_amount ?? 0), 0)),
      canceladas: sales.length - activeSales.length,
      ultimos_6_meses: [...byMonth.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
      mais_recentes: activeSales.slice(0, limit).map((sale) => ({
        data: sale.sale_date,
        unidade: relatedOne(sale.units)?.code ?? null,
        cliente: relatedOne(sale.clients)?.name ?? null,
        valor: round2(sale.total_amount),
        corretor: sale.broker_name,
      })),
    },
  };
}

async function runVendasEUnidades(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, true);
  const { units, sales } = await loadUnitsAndSales(context, scope.project?.id ?? null);
  const limit = Math.min(Math.max(numberArg(args.limite) ?? 5, 1), 25);
  return { obra: scope.label, ...salesSummary(units, sales, context.today, limit) };
}

async function runContasAPagar(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, true);
  const rows = await loadPayables(context, scope.project?.id ?? null);
  return {
    obra: scope.label,
    data_de_hoje: context.today,
    ...summarizePayables(rows, {
      today: context.today,
      from: dateArg(args.de),
      to: dateArg(args.ate),
      situation: text(args.situacao),
      supplierText: text(args.fornecedor),
      limit: numberArg(args.limite),
    }),
  };
}

async function runContasAReceber(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, true);
  const rows = await loadReceivables(context, scope.project?.id ?? null);
  return {
    obra: scope.label,
    data_de_hoje: context.today,
    ...summarizeReceivables(rows, {
      today: context.today,
      from: dateArg(args.de),
      to: dateArg(args.ate),
      situation: text(args.situacao),
      clientText: text(args.cliente_ou_unidade),
      limit: numberArg(args.limite),
    }),
  };
}

async function runFluxoDeCaixa(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, true);
  const projectId = scope.project?.id ?? null;
  const canForecast = Boolean(projectId) && FORECAST_PERMISSIONS.every(context.can);
  const [payables, receivables, forecastContext] = await Promise.all([
    loadPayables(context, projectId),
    loadReceivables(context, projectId),
    projectId && canForecast ? loadForecast(context, projectId) : Promise.resolve(null),
  ]);
  const forecastFailed = Boolean(forecastContext?.errors.length);
  if (forecastFailed) console.error("[elos-ia] Falha ao carregar a previsão de custos:", forecastContext?.errors.join(" · "));
  // Projeção lida pela metade não entra: melhor avisar do que somar parcial.
  const forecast = forecastFailed ? null : forecastContext?.forecast ?? null;
  return {
    obra: scope.label,
    projecao_da_engenharia: forecast
      ? "incluída"
      : !projectId
        ? "não incluída: selecione uma obra para somar a projeção da Engenharia"
        : !canForecast
          ? "não incluída: o usuário não tem permissão de orçamento/cronograma/contratos/medições"
          : forecastFailed
            ? "não incluída: o Elos OS não conseguiu ler a previsão de custos agora (avise o usuário que o saldo completo está sem a projeção)"
            : "não incluída: a obra não tem cronograma linha de base com orçamento",
    ...buildCashflowMonths({
      payables,
      receivables,
      engineeringMonths: forecast?.months.map((month) => ({ key: month.key, engineeringProjected: month.engineeringProjected })) ?? [],
      today: context.today,
      monthsBack: numberArg(args.meses_atras),
      monthsAhead: numberArg(args.meses_a_frente),
    }),
  };
}

function scheduleSummary(schedule: Awaited<ReturnType<typeof loadSchedule>>, context: ElosIaToolContext, args: ToolArgs) {
  if (!schedule.baseline) return { erro: "Esta obra ainda não tem cronograma linha de base cadastrado (Engenharia › Cronograma Físico · Linha Base)." };
  return {
    linha_de_base: `${schedule.baseline.code} · ${schedule.baseline.name} (versão ${schedule.baseline.version}, ${schedule.baseline.status === "approved" ? "aprovada" : "não aprovada"})`,
    ...summarizeSchedule({
      activities: schedule.activities,
      measurements: schedule.measurements,
      serviceWeights: schedule.weights,
      serviceNames: schedule.serviceNames,
      locationNames: schedule.locationNames,
      today: context.today,
      limit: numberArg(args.limite),
      searchText: text(args.buscar),
    }),
  };
}

async function runCronogramaFisico(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, false);
  const schedule = await loadSchedule(context, scope.project!.id);
  return { obra: scope.label, ...scheduleSummary(schedule, context, args) };
}

type BudgetRecord = { id: string; code: string; name: string; version: string; status: string; is_base: boolean };

async function budgetsFallback(context: ElosIaToolContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("engineering_budgets")
    .select("id, code, name, version, status, is_base")
    .eq("company_id", context.companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5);
  failIfErrors([error?.message]);
  const budgets = (data ?? []) as BudgetRecord[];
  const chosen = budgets.find((budget) => budget.is_base) ?? budgets[0] ?? null;
  let total: number | null = null;
  let items = 0;
  if (chosen) {
    const itemsResult = await fetchAllRows<{ total_direct_cost: number; status: string }>(async (from, to) => {
      const { data: rows, error: itemsError } = await context.supabase
        .from("engineering_budget_items")
        .select("id, total_direct_cost, status")
        .eq("company_id", context.companyId)
        .eq("budget_id", chosen.id)
        .order("id")
        .range(from, to);
      return { data: (rows ?? []) as Array<{ total_direct_cost: number; status: string }>, error: itemsError };
    });
    failIfErrors([itemsResult.error?.message]);
    const active = itemsResult.data.filter((item) => item.status === "active");
    items = active.length;
    total = round2(active.reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0));
  }
  return {
    orcamentos_cadastrados: budgets.map((budget) => ({ codigo: budget.code, nome: budget.name, versao: budget.version, situacao: budget.status, orcamento_base: budget.is_base })),
    orcamento_considerado: chosen ? { codigo: chosen.code, nome: chosen.name, itens_ativos: items, custo_direto_total: total } : null,
  };
}

function costTotals(forecast: NonNullable<Awaited<ReturnType<typeof loadForecast>>["forecast"]>) {
  const totals = forecast.totals;
  return {
    orcamento: round2(totals.budget),
    realizado_pago: round2(totals.actual),
    comprometido_em_contas_a_pagar_abertas: round2(totals.committedPayable),
    comprometido_em_contratos_ainda_nao_faturados: round2(totals.committedFuture),
    a_comprometer: round2(totals.toCommit),
    custo_projetado_final: round2(totals.projectedCost),
    estouro_sobre_o_orcamento: round2(totals.deviation),
    estouro_pct: round2(totals.deviationPercent),
    percentual_do_orcamento_ja_pago: totals.budget > 0 ? round2(totals.actual / totals.budget * 100) : 0,
    percentual_do_orcamento_pago_ou_comprometido: totals.budget > 0 ? round2((totals.actual + totals.committed) / totals.budget * 100) : 0,
  };
}

async function runCustosEOrcamento(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, false);
  const projectId = scope.project!.id;
  const forecastContext = await loadForecast(context, projectId);
  failIfErrors(forecastContext.errors);
  const forecast = forecastContext.forecast;

  if (!forecast) {
    return {
      obra: scope.label,
      aviso: "A obra não tem cronograma linha de base ligado a um orçamento, então a previsão Realizado / Comprometido / A comprometer não pode ser calculada. Abaixo está só o que existe de orçamento.",
      ...(await budgetsFallback(context, projectId)),
    };
  }

  const filter = normalize(text(args.filtro_servico));
  const order = text(args.ordenar_por);
  const limit = Math.min(Math.max(numberArg(args.limite) ?? 10, 1), 25);
  const monthsAhead = Math.min(Math.max(numberArg(args.meses_a_frente) ?? 6, 0), 36);
  const sorters: Record<string, (row: ForecastServiceRow) => number> = {
    estouro: (row) => row.deviation,
    orcamento: (row) => row.budgetAmount,
    a_comprometer: (row) => row.toCommit,
    realizado: (row) => row.actual,
  };
  const sorter = sorters[order] ?? sorters.estouro;
  const matching = forecast.services.filter((row) => !filter || normalize(`${row.code} ${row.name}`).includes(filter));
  const ranked = [...matching].sort((a, b) => sorter(b) - sorter(a) || b.budgetAmount - a.budgetAmount);
  const currentMonth = context.today.slice(0, 7);
  const lastMonth = addMonthsKey(currentMonth, monthsAhead);

  return {
    obra: scope.label,
    data_de_referencia: forecast.asOfDate,
    orcamento_usado: forecastContext.budget ? `${forecastContext.budget.code} · ${forecastContext.budget.name} (versão ${forecastContext.budget.version})` : null,
    linha_de_base: forecastContext.baseline ? `${forecastContext.baseline.code} · ${forecastContext.baseline.name}` : null,
    totais: costTotals(forecast),
    servicos_no_orcamento: forecast.services.length,
    servicos_com_estouro: forecast.services.filter((row) => row.deviation > 0.005).length,
    filtro_de_servico: text(args.filtro_servico) || null,
    ordenado_por: sorters[order] ? order : "estouro",
    servicos: ranked.slice(0, limit).map((row) => ({
      servico: [row.code, row.name].filter(Boolean).join(" · "),
      orcamento: round2(row.budgetAmount),
      realizado_pago: round2(row.actual),
      comprometido: round2(row.committed),
      a_comprometer: round2(row.toCommit),
      custo_projetado_final: round2(row.projectedCost),
      estouro: round2(row.deviation),
      estouro_pct: round2(row.deviationPercent),
    })),
    servicos_omitidos: Math.max(0, ranked.length - limit),
    desembolso_previsto_por_mes: forecast.months
      .filter((month) => month.key >= currentMonth && month.key <= lastMonth)
      .map((month) => ({
        mes: month.key,
        contas_a_pagar_abertas: round2(month.committedPayable),
        contratos_a_faturar: round2(month.committedFuture),
        a_comprometer: round2(month.toCommit),
        total_previsto: round2(month.committedPayable + month.committedFuture + month.toCommit),
      })),
    avisos_do_motor: { quantidade: forecast.warnings.length, exemplos: forecast.warnings.slice(0, 5).map((warning) => warning.message) },
    observacao: "Realizado = contas pagas. Comprometido = contas a pagar abertas + contratos ainda não faturados. A comprometer = o que falta do orçamento. O estouro só aparece quando realizado + comprometido já passa do orçamento do serviço; economia futura não é projetada.",
  };
}

type ContractRecord = {
  id: string; supplier_id: string; contract_number: string; title: string; status: string; start_date: string | null; end_date: string | null;
  current_value: number; measured_value: number; retained_value: number; paid_value: number;
};

async function runContratosDeServico(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, false);
  const projectId = scope.project!.id;
  const contractsResult = await fetchAllRows<ContractRecord>(async (from, to) => {
    const { data, error } = await context.supabase
      .from("execution_service_contracts")
      .select("id, supplier_id, contract_number, title, status, start_date, end_date, current_value, measured_value, retained_value, paid_value")
      .eq("company_id", context.companyId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    return { data: (data ?? []) as ContractRecord[], error };
  });
  failIfErrors([contractsResult.error?.message]);

  const supplierIds = [...new Set(contractsResult.data.map((contract) => contract.supplier_id).filter(Boolean))];
  const supplierNames = new Map<string, string>();
  for (let index = 0; index < supplierIds.length; index += 100) {
    const { data, error } = await context.supabase
      .from("suppliers")
      .select("id, legal_name, trade_name")
      .eq("company_id", context.companyId)
      .in("id", supplierIds.slice(index, index + 100));
    failIfErrors([error?.message]);
    for (const supplier of (data ?? []) as Array<{ id: string; legal_name: string; trade_name: string | null }>) {
      supplierNames.set(supplier.id, supplier.trade_name || supplier.legal_name);
    }
  }

  const search = normalize(text(args.buscar));
  const statusFilter = text(args.situacao);
  const limit = Math.min(Math.max(numberArg(args.limite) ?? 10, 1), 25);
  const valid = contractsResult.data.filter((contract) => contract.status !== "cancelled");
  const live = valid.filter((contract) => contract.status === "active" || contract.status === "suspended");
  const selected = contractsResult.data
    .filter((contract) => (statusFilter === "todos" ? true : statusFilter === "encerrados" ? contract.status === "finished" : contract.status === "active" || contract.status === "suspended"))
    .filter((contract) => !search || normalize(`${contract.contract_number} ${contract.title} ${supplierNames.get(contract.supplier_id) ?? ""}`).includes(search))
    .map((contract) => {
      const value = Number(contract.current_value ?? 0);
      const measured = Number(contract.measured_value ?? 0);
      return {
        contrato: `${contract.contract_number} · ${cut(contract.title, 80)}`,
        fornecedor: supplierNames.get(contract.supplier_id) ?? null,
        situacao: CONTRACT_STATUS_LABELS[contract.status] ?? contract.status,
        inicio: contract.start_date,
        termino: contract.end_date,
        prazo_vencido: contract.status === "active" && Boolean(contract.end_date) && (contract.end_date as string) < context.today,
        valor_atual: round2(value),
        medido: round2(measured),
        medido_pct: value > 0 ? round2(measured / value * 100) : 0,
        saldo_a_medir: round2(value - measured),
        pago: round2(contract.paid_value),
        retido: round2(contract.retained_value),
      };
    })
    .sort((a, b) => b.saldo_a_medir - a.saldo_a_medir);

  const sum = (rows: ContractRecord[], field: "current_value" | "measured_value" | "paid_value" | "retained_value") =>
    round2(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0));

  return {
    obra: scope.label,
    data_de_hoje: context.today,
    resumo_geral: {
      contratos_validos: valid.length,
      ativos_ou_suspensos: live.length,
      valor_contratado: sum(valid, "current_value"),
      medido: sum(valid, "measured_value"),
      pago: sum(valid, "paid_value"),
      retido: sum(valid, "retained_value"),
      saldo_a_medir: round2(sum(valid, "current_value") - sum(valid, "measured_value")),
      ativos_com_prazo_vencido: live.filter((contract) => contract.status === "active" && Boolean(contract.end_date) && (contract.end_date as string) < context.today).length,
      ativos_com_mais_de_90pct_medido: live.filter((contract) => Number(contract.current_value) > 0 && Number(contract.measured_value) / Number(contract.current_value) >= 0.9).length,
    },
    filtro: { situacao: ["todos", "encerrados"].includes(statusFilter) ? statusFilter : "ativos", buscar: text(args.buscar) || null },
    contratos: selected.slice(0, limit),
    contratos_omitidos: Math.max(0, selected.length - limit),
  };
}

type DailyLogRecord = {
  id: string; log_date: string; shift: string; status: string; general_notes: string | null; completion_percent: number | null; responsible_name: string | null;
};
type OccurrenceRecord = {
  daily_log_id: string; occurrence_type: string; impact: string; title: string; description: string | null; action_taken: string | null;
  status: string; affects_schedule: boolean; is_safety_event: boolean;
};
type WorkforceRecord = { daily_log_id: string; company_name: string; role_name: string; worker_count: number };

const DAILY_LOG_LIMIT = 300;

async function runDiarioDeObra(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, false);
  const projectId = scope.project!.id;
  const days = Math.min(Math.max(numberArg(args.dias) ?? 7, 1), 31);
  const fromDate = new Date(new Date(`${context.today}T12:00:00Z`).getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const { data: logData, error: logError } = await context.supabase
    .from("execution_daily_logs")
    .select("id, log_date, shift, status, general_notes, completion_percent, responsible_name")
    .eq("company_id", context.companyId)
    .eq("project_id", projectId)
    .eq("is_current", true)
    .neq("status", "cancelled")
    .gte("log_date", fromDate)
    .lte("log_date", context.today)
    .order("log_date", { ascending: false })
    .order("id")
    // 31 dias × 2 turnos × tipos de diário cabem com folga; o resumo avisa se passar disso.
    .limit(DAILY_LOG_LIMIT + 1);
  failIfErrors([logError?.message]);
  const allLogs = (logData ?? []) as DailyLogRecord[];
  const logsTruncated = allLogs.length > DAILY_LOG_LIMIT;
  const logs = allLogs.slice(0, DAILY_LOG_LIMIT);
  const logIds = logs.map((log) => log.id);

  // Ocorrências e efetivo: lidos por completo (paginados), em lotes de diários.
  const occurrences: OccurrenceRecord[] = [];
  const workforce: WorkforceRecord[] = [];
  for (let index = 0; index < logIds.length; index += 100) {
    const batch = logIds.slice(index, index + 100);
    const [occurrencesResult, workforceResult] = await Promise.all([
      fetchAllRows<OccurrenceRecord>(async (from, to) => {
        const { data, error } = await context.supabase
          .from("execution_daily_log_occurrences")
          .select("id, daily_log_id, occurrence_type, impact, title, description, action_taken, status, affects_schedule, is_safety_event")
          .eq("company_id", context.companyId)
          .eq("project_id", projectId)
          .in("daily_log_id", batch)
          .order("id")
          .range(from, to);
        return { data: (data ?? []) as OccurrenceRecord[], error };
      }),
      fetchAllRows<WorkforceRecord>(async (from, to) => {
        const { data, error } = await context.supabase
          .from("execution_daily_log_workforce")
          .select("id, daily_log_id, company_name, role_name, worker_count")
          .eq("company_id", context.companyId)
          .eq("project_id", projectId)
          .in("daily_log_id", batch)
          .order("id")
          .range(from, to);
        return { data: (data ?? []) as WorkforceRecord[], error };
      }),
    ]);
    failIfErrors([occurrencesResult.error?.message, workforceResult.error?.message]);
    occurrences.push(...occurrencesResult.data);
    workforce.push(...workforceResult.data);
  }

  const dateByLog = new Map(logs.map((log) => [log.id, log.log_date]));
  const workersByLog = new Map<string, number>();
  const workersByCompany = new Map<string, number>();
  for (const row of workforce) {
    workersByLog.set(row.daily_log_id, (workersByLog.get(row.daily_log_id) ?? 0) + Number(row.worker_count ?? 0));
    workersByCompany.set(row.company_name, (workersByCompany.get(row.company_name) ?? 0) + Number(row.worker_count ?? 0));
  }
  const impactOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const orderedOccurrences = [...occurrences].sort((a, b) =>
    (impactOrder[a.impact] ?? 9) - (impactOrder[b.impact] ?? 9) || String(dateByLog.get(b.daily_log_id)).localeCompare(String(dateByLog.get(a.daily_log_id))));
  const daysWithLog = new Set(logs.map((log) => log.log_date));

  return {
    obra: scope.label,
    periodo: { de: fromDate, ate: context.today, dias: days },
    ...(logsTruncated ? { aviso: `Há mais de ${DAILY_LOG_LIMIT} diários no período; o resumo considera só os ${DAILY_LOG_LIMIT} mais recentes. Reduza o número de dias.` } : {}),
    resumo: {
      diarios_lancados: logs.length,
      dias_com_diario: daysWithLog.size,
      aguardando_aprovacao: logs.filter((log) => log.status === "awaiting_approval").length,
      efetivo_medio_por_diario: logs.length ? round2([...workersByLog.values()].reduce((sum, value) => sum + value, 0) / logs.length) : 0,
      ocorrencias: occurrences.length,
      ocorrencias_abertas: occurrences.filter((occurrence) => occurrence.status !== "resolved").length,
      ocorrencias_que_afetam_o_cronograma: occurrences.filter((occurrence) => occurrence.affects_schedule).length,
      eventos_de_seguranca: occurrences.filter((occurrence) => occurrence.is_safety_event).length,
    },
    diarios: logs.slice(0, 12).map((log) => ({
      data: log.log_date,
      turno: log.shift === "night" ? "noite" : "dia",
      situacao: DAILY_LOG_STATUS_LABELS[log.status] ?? log.status,
      responsavel: log.responsible_name,
      efetivo: workersByLog.get(log.id) ?? 0,
      preenchimento_pct: round2(log.completion_percent),
      anotacoes: cut(log.general_notes, 280) || null,
    })),
    ocorrencias_mais_relevantes: orderedOccurrences.slice(0, 10).map((occurrence) => ({
      data: dateByLog.get(occurrence.daily_log_id) ?? null,
      tipo: OCCURRENCE_TYPE_LABELS[occurrence.occurrence_type] ?? occurrence.occurrence_type,
      impacto: IMPACT_LABELS[occurrence.impact] ?? occurrence.impact,
      titulo: cut(occurrence.title, 100),
      descricao: cut(occurrence.description, 240) || null,
      providencia: cut(occurrence.action_taken, 160) || null,
      situacao: occurrence.status === "resolved" ? "resolvida" : occurrence.status === "monitoring" ? "em acompanhamento" : "aberta",
      afeta_cronograma: occurrence.affects_schedule,
    })),
    efetivo_por_empresa_no_periodo: [...workersByCompany.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([empresa, homens_dia]) => ({ empresa, homens_dia })),
  };
}

async function block(allowed: boolean, load: () => Promise<ToolResult>): Promise<ToolResult> {
  if (!allowed) return { indisponivel: "o usuário não tem permissão para este bloco" };
  try {
    return await load();
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Falha ao consultar este bloco." };
  }
}

async function runResumoDaObra(context: ElosIaToolContext, args: ToolArgs): Promise<ToolResult> {
  const scope = resolveProject(context, args.obra, false);
  const project = scope.project!;
  const canCosts = FORECAST_PERMISSIONS.every(context.can);

  const [fisico, custos, pagar, receber, caixa, comercial] = await Promise.all([
    block(context.can("schedule.view"), async () => {
      const summary = scheduleSummary(await loadSchedule(context, project.id), context, { limite: 3 }) as ToolResult;
      if ("erro" in summary) return summary;
      return { linha_de_base: summary.linha_de_base, ultima_medicao_de_avanco: summary.ultima_medicao_de_avanco, fisico_geral: summary.fisico_geral, prazo: summary.prazo, atividades: summary.atividades };
    }),
    block(canCosts, async () => {
      const forecastContext = await loadForecast(context, project.id);
      failIfErrors(forecastContext.errors);
      if (!forecastContext.forecast) return { erro: "Obra sem cronograma linha de base ligado a um orçamento; previsão de custos indisponível." };
      return { ...costTotals(forecastContext.forecast), servicos_com_estouro: forecastContext.forecast.services.filter((row) => row.deviation > 0.005).length };
    }),
    block(context.can("payables.view"), async () => summarizePayables(await loadPayables(context, project.id), { today: context.today, limit: 1 }).resumo_geral as ToolResult),
    block(context.can("receivables.view"), async () => summarizeReceivables(await loadReceivables(context, project.id), { today: context.today, limit: 1 }).resumo_geral as ToolResult),
    block(["cashflow.view", "payables.view", "receivables.view"].every(context.can), async () => {
      const [payables, receivables, forecastContext] = await Promise.all([
        loadPayables(context, project.id),
        loadReceivables(context, project.id),
        canCosts ? loadForecast(context, project.id) : Promise.resolve(null),
      ]);
      const forecast = forecastContext?.errors.length ? null : forecastContext?.forecast ?? null;
      const cashflow = buildCashflowMonths({
        payables,
        receivables,
        engineeringMonths: forecast?.months.map((month) => ({ key: month.key, engineeringProjected: month.engineeringProjected })) ?? [],
        today: context.today,
        monthsBack: 0,
        monthsAhead: 0,
      });
      return {
        projecao_da_engenharia: forecast ? "incluída" : "não incluída (sem permissão, sem linha de base com orçamento ou falha de leitura)",
        totais: cashflow.totais_de_toda_a_obra,
        primeiro_mes_com_saldo_acumulado_completo_negativo: cashflow.primeiro_mes_com_saldo_acumulado_completo_negativo,
        saldo_acumulado_completo_ja_negativo_antes_do_mes_atual: cashflow.saldo_acumulado_completo_ja_negativo_antes_do_mes_atual,
      };
    }),
    block(["sales.view", "projects.view"].every(context.can), async () => {
      const { units, sales } = await loadUnitsAndSales(context, project.id);
      const summary = salesSummary(units, sales, context.today, 1);
      return { unidades: summary.unidades, vendas_ativas: summary.vendas.ativas, valor_total_vendido: summary.vendas.valor_total_vendido, ultimos_6_meses: summary.vendas.ultimos_6_meses };
    }),
  ]);

  return {
    obra: { nome: project.name, codigo: project.code, cidade: project.city, situacao: PROJECT_STATUS_LABELS[project.status] ?? project.status },
    data_de_hoje: context.today,
    fisico_e_prazo: fisico,
    custos_x_orcamento: custos,
    contas_a_pagar: pagar,
    contas_a_receber: receber,
    fluxo_de_caixa: caixa,
    comercial,
    observacao: "Visão geral. Para detalhar um tema, use a ferramenta específica (cronograma_fisico, custos_e_orcamento, contas_a_pagar, contas_a_receber, fluxo_de_caixa, vendas_e_unidades).",
  };
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

const TOOLS: ToolDefinition[] = [
  {
    name: "listar_obras",
    label: "Obras da empresa",
    description: "Lista as obras (empreendimentos) da empresa do usuário e qual está ativa. Use quando o usuário citar uma obra pelo nome ou quando não houver obra ativa.",
    permissions: ["projects.view"],
    properties: {},
    run: runListarObras,
  },
  {
    name: "resumo_da_obra",
    label: "Resumo da obra",
    description: "Visão executiva de UMA obra em uma única consulta: avanço físico e prazo, custo x orçamento, contas a pagar, contas a receber, saldo de caixa e vendas. Use para perguntas gerais como 'como está a obra?' ou 'o que precisa de atenção?'.",
    permissions: ["projects.view"],
    properties: { obra: OBRA_PROPERTY },
    run: runResumoDaObra,
  },
  {
    name: "custos_e_orcamento",
    label: "Custos x orçamento",
    description: "Previsão de custos da obra por serviço: orçamento, realizado (pago), comprometido, a comprometer, custo projetado final e estouro. Traz também o desembolso previsto por mês. Use para perguntas de custo, estouro de orçamento ou quanto falta gastar.",
    permissions: FORECAST_PERMISSIONS,
    properties: {
      obra: OBRA_PROPERTY,
      filtro_servico: { type: ["string", "null"], description: "Trecho do nome ou código do serviço (ex.: 'alvenaria'). Use null para todos." },
      ordenar_por: { type: ["string", "null"], enum: ["estouro", "orcamento", "a_comprometer", "realizado", null], description: "Critério da lista de serviços. Padrão: estouro." },
      limite: LIMIT_PROPERTY,
      meses_a_frente: { type: ["integer", "null"], description: "Quantos meses de desembolso previsto trazer a partir do mês atual (padrão 6, máximo 36)." },
    },
    run: runCustosEOrcamento,
  },
  {
    name: "cronograma_fisico",
    label: "Cronograma físico",
    description: "Andamento físico da obra em relação à linha de base: percentual previsto x realizado, término projetado, atividades atrasadas, em andamento e próximas a iniciar. Não traz valores em reais.",
    permissions: ["schedule.view"],
    properties: {
      obra: OBRA_PROPERTY,
      buscar: { type: ["string", "null"], description: "Trecho do nome da atividade, serviço ou local/pavimento (ex.: 'reboco', 'pavimento 5'). Use null para todas." },
      limite: { type: ["integer", "null"], description: "Quantidade máxima de atividades em cada lista (padrão 8, máximo 20)." },
    },
    run: runCronogramaFisico,
  },
  {
    name: "contas_a_pagar",
    label: "Contas a pagar",
    description: "Contas a pagar: totais em aberto, vencidas, a vencer em 7 e 30 dias, pagas, maiores fornecedores e lista de títulos. Use para perguntas sobre pagamentos a fornecedores.",
    permissions: ["payables.view"],
    properties: {
      obra: OBRA_OR_ALL_PROPERTY,
      situacao: { type: ["string", "null"], enum: ["em_aberto", "vencidas", "pagas", "todas", null], description: "Quais títulos listar. Padrão: em_aberto." },
      de: DATE_FROM_PROPERTY,
      ate: DATE_TO_PROPERTY,
      fornecedor: { type: ["string", "null"], description: "Trecho do nome do fornecedor. Use null para todos." },
      limite: LIMIT_PROPERTY,
    },
    run: runContasAPagar,
  },
  {
    name: "contas_a_receber",
    label: "Contas a receber",
    description: "Contas a receber dos clientes: carteira em aberto, parcelas vencidas (inadimplência), a vencer em 30 dias, recebidas, maiores inadimplentes e lista de parcelas. Use para perguntas sobre recebimentos, inadimplência e cobrança.",
    permissions: ["receivables.view"],
    properties: {
      obra: OBRA_OR_ALL_PROPERTY,
      situacao: { type: ["string", "null"], enum: ["em_aberto", "vencidas", "recebidas", "todas", null], description: "Quais parcelas listar. Padrão: em_aberto." },
      de: DATE_FROM_PROPERTY,
      ate: DATE_TO_PROPERTY,
      cliente_ou_unidade: { type: ["string", "null"], description: "Trecho do nome do cliente ou código da unidade. Use null para todos." },
      limite: LIMIT_PROPERTY,
    },
    run: runContasAReceber,
  },
  {
    name: "fluxo_de_caixa",
    label: "Fluxo de caixa",
    description: "Fluxo de caixa mês a mês: recebido, a receber, pago, a pagar, projeção de custos da Engenharia, saldo do mês e saldo acumulado. Indica o primeiro mês em que o saldo acumulado fica negativo. Use para perguntas de caixa e necessidade de aporte.",
    permissions: ["cashflow.view", "payables.view", "receivables.view"],
    properties: {
      obra: OBRA_OR_ALL_PROPERTY,
      meses_atras: { type: ["integer", "null"], description: "Meses anteriores ao atual na janela (padrão 3, máximo 24)." },
      meses_a_frente: { type: ["integer", "null"], description: "Meses à frente do atual na janela (padrão 6, máximo 36)." },
    },
    run: runFluxoDeCaixa,
  },
  {
    name: "vendas_e_unidades",
    label: "Vendas e unidades",
    description: "Situação comercial: unidades disponíveis, reservadas e vendidas, valor de tabela do estoque, valor total vendido, vendas dos últimos 6 meses e vendas mais recentes.",
    permissions: ["sales.view", "projects.view"],
    properties: { obra: OBRA_OR_ALL_PROPERTY, limite: { type: ["integer", "null"], description: "Quantidade de vendas recentes a listar (padrão 5, máximo 25)." } },
    run: runVendasEUnidades,
  },
  {
    name: "contratos_de_servico",
    label: "Contratos de serviço",
    description: "Contratos de empreiteiros e prestadores da obra: valor contratado, medido, pago, retido, saldo a medir, contratos com prazo vencido ou quase totalmente medidos.",
    permissions: ["execution.contracts.view"],
    properties: {
      obra: OBRA_PROPERTY,
      situacao: { type: ["string", "null"], enum: ["ativos", "encerrados", "todos", null], description: "Quais contratos listar. Padrão: ativos." },
      buscar: { type: ["string", "null"], description: "Trecho do número, título ou fornecedor do contrato. Use null para todos." },
      limite: LIMIT_PROPERTY,
    },
    run: runContratosDeServico,
  },
  {
    name: "diario_de_obra",
    label: "Diário de obra",
    description: "Diários de obra dos últimos dias: quantos foram lançados, efetivo, anotações e ocorrências (atrasos, paralisações, segurança, qualidade).",
    permissions: ["execution.daily_logs.view"],
    properties: {
      obra: OBRA_PROPERTY,
      dias: { type: ["integer", "null"], description: "Quantos dias para trás considerar, contando hoje (padrão 7, máximo 31)." },
    },
    run: runDiarioDeObra,
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function elosIaToolLabel(name: string) {
  return TOOLS_BY_NAME.get(name as ElosIaToolName)?.label ?? name;
}

export function elosIaToolPermissions(name: ElosIaToolName) {
  return TOOLS_BY_NAME.get(name)?.permissions ?? [];
}

/** Definições no formato de funções da OpenAI Responses API (modo estrito). */
export function elosIaToolSchemas(names: ElosIaToolName[]) {
  return names
    .map((name) => TOOLS_BY_NAME.get(name))
    .filter((tool): tool is ToolDefinition => Boolean(tool))
    .map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      strict: true,
      parameters: {
        type: "object",
        properties: tool.properties,
        required: Object.keys(tool.properties),
        additionalProperties: false,
      },
    }));
}

export async function runElosIaTool(context: ElosIaToolContext, allowed: ElosIaToolName[], name: string, args: ToolArgs): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name as ElosIaToolName);
  if (!tool || !allowed.includes(tool.name)) {
    return { erro: `A consulta "${name}" não está disponível para esta persona.` };
  }
  const missing = tool.permissions.filter((permission) => !context.can(permission));
  if (missing.length) {
    return { erro: `O usuário não tem permissão no Elos OS para esta consulta (falta: ${missing.join(", ")}). Explique isso e sugira pedir o acesso ao administrador da empresa.` };
  }
  try {
    return await tool.run(context, args);
  } catch (error) {
    if (error instanceof ToolError) return { erro: error.message };
    console.error(`[elos-ia] Falha na ferramenta ${name}:`, error);
    return { erro: "Falha inesperada ao consultar o Elos OS. Avise o usuário e sugira tentar de novo." };
  }
}
