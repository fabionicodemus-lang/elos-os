// Elos IA — cotas de consumo e registro de uso (tabela public.ai_usage_log).
//
// Quatro camadas limitam o gasto:
//   1. por resposta  -> max_output_tokens (openai.ts)
//   2. por pergunta  -> rodadas e orçamento de tokens (agent-loop.mjs)
//   3. por período   -> cota diária do usuário e mensal de tokens da empresa
//   4. por custo      -> teto mensal em USD por empresa (padrão US$ 20)
// Além delas, vale o limite de gastos configurado na própria conta/projeto da OpenAI.

import type { resolveActiveWorkspace } from "@/lib/workspace";
import type { AgentUsage } from "./agent-loop.mjs";
import type { ElosIaConfig } from "./config";
import { estimateMaxQuestionCostUsd, estimateUsageCostUsd } from "./usage-cost.mjs";

type SupabaseClientLike = Awaited<ReturnType<typeof resolveActiveWorkspace>>["supabase"];

export type ElosIaUsageSnapshot = {
  /** false enquanto a migration 0091 não foi aplicada: sem registro, sem cota. */
  tracking: boolean;
  /** true quando a migration do teto em USD já está ativa. */
  costTracking: boolean;
  userTokensToday: number;
  companyTokensMonth: number;
  companyUsdMonth: number;
  companyUsdLimit: number | null;
};

export type ElosIaQuotaView = {
  tracking: boolean;
  costTracking: boolean;
  userTokensToday: number;
  dailyUserTokens: number;
  companyTokensMonth: number;
  monthlyCompanyTokens: number;
  companyUsdMonth: number;
  monthlyCompanyUsd: number;
};

// Códigos do PostgREST/Postgres para "função ou tabela não existe".
const NOT_INSTALLED_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

function notInstalled(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return NOT_INSTALLED_CODES.has(error.code ?? "") || /ai_usage_(totals|log)/.test(error.message ?? "") && /(not find|does not exist|schema cache)/i.test(error.message ?? "");
}

function conservativeCostFromTokens(config: ElosIaConfig, tokens: number) {
  const rate = Math.max(config.rates.input, config.rates.cachedInput, config.rates.output);
  return Math.max(0, tokens) * rate / 1_000_000;
}

export async function loadElosIaUsage(supabase: SupabaseClientLike, companyId: string): Promise<ElosIaUsageSnapshot> {
  const { data, error } = await supabase.rpc("ai_usage_totals", { p_company_id: companyId });
  if (error) {
    if (notInstalled(error)) return { tracking: false, costTracking: false, userTokensToday: 0, companyTokensMonth: 0, companyUsdMonth: 0, companyUsdLimit: null };
    throw new Error(`Não foi possível conferir a cota do Elos IA: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    user_tokens_today?: number | string;
    company_tokens_month?: number | string;
    company_cost_usd_month?: number | string;
    company_usd_limit?: number | string;
  } | null;
  const costTracking = row?.company_cost_usd_month !== undefined && row?.company_usd_limit !== undefined;
  return {
    tracking: true,
    costTracking,
    userTokensToday: Number(row?.user_tokens_today ?? 0) || 0,
    companyTokensMonth: Number(row?.company_tokens_month ?? 0) || 0,
    companyUsdMonth: Number(row?.company_cost_usd_month ?? 0) || 0,
    companyUsdLimit: row?.company_usd_limit === undefined ? null : Number(row.company_usd_limit) || 0,
  };
}

function resolvedUsdUsage(config: ElosIaConfig, usage: ElosIaUsageSnapshot) {
  return usage.costTracking ? usage.companyUsdMonth : conservativeCostFromTokens(config, usage.companyTokensMonth);
}

function resolvedUsdLimit(config: ElosIaConfig, usage: ElosIaUsageSnapshot) {
  return usage.companyUsdLimit ?? config.monthlyCompanyUsdDefault;
}

export function checkElosIaQuota(config: ElosIaConfig, usage: ElosIaUsageSnapshot): { allowed: true } | { allowed: false; message: string } {
  if (!usage.tracking) return { allowed: true };
  if (config.dailyUserTokens > 0 && usage.userTokensToday >= config.dailyUserTokens) {
    return { allowed: false, message: "Você atingiu a cota diária do Elos IA. Ela é renovada à meia-noite." };
  }
  if (config.monthlyCompanyTokens > 0 && usage.companyTokensMonth >= config.monthlyCompanyTokens) {
    return { allowed: false, message: "A empresa atingiu a cota mensal de uso do Elos IA. Fale com o administrador para ampliar o limite." };
  }

  const usdLimit = resolvedUsdLimit(config, usage);
  if (usdLimit > 0) {
    const currentUsd = resolvedUsdUsage(config, usage);
    const reservationUsd = estimateMaxQuestionCostUsd(config);
    // Reserva conservadora do pior caso da próxima pergunta para não começar uma
    // chamada que possa ultrapassar o teto mensal.
    if (currentUsd >= usdLimit || currentUsd + reservationUsd > usdLimit) {
      return { allowed: false, message: `A empresa atingiu o limite mensal de US$ ${usdLimit.toFixed(2)} do Elos IA. O acesso é renovado no próximo mês.` };
    }
  }
  return { allowed: true };
}

export function quotaView(config: ElosIaConfig, usage: ElosIaUsageSnapshot, addedTokens = 0, addedUsd = 0): ElosIaQuotaView {
  return {
    tracking: usage.tracking,
    costTracking: usage.costTracking,
    userTokensToday: usage.userTokensToday + addedTokens,
    dailyUserTokens: config.dailyUserTokens,
    companyTokensMonth: usage.companyTokensMonth + addedTokens,
    monthlyCompanyTokens: config.monthlyCompanyTokens,
    companyUsdMonth: resolvedUsdUsage(config, usage) + addedUsd,
    monthlyCompanyUsd: resolvedUsdLimit(config, usage),
  };
}

export function estimateElosIaUsageCost(config: ElosIaConfig, usage: AgentUsage) {
  return estimateUsageCostUsd(usage, config.rates);
}

export async function recordElosIaUsage(supabase: SupabaseClientLike, entry: {
  companyId: string;
  projectId: string | null;
  userId: string;
  persona: string;
  model: string;
  status: "ok" | "incomplete" | "empty" | "error";
  usage: AgentUsage;
  estimatedCostUsd: number;
  toolsUsed: string[];
  durationMs: number;
}) {
  if (!entry.usage.modelCalls) return;
  const row = {
    company_id: entry.companyId,
    project_id: entry.projectId,
    created_by: entry.userId,
    persona: entry.persona,
    model: entry.model,
    status: entry.status,
    input_tokens: Math.round(entry.usage.inputTokens),
    cached_input_tokens: Math.round(entry.usage.cachedInputTokens),
    output_tokens: Math.round(entry.usage.outputTokens),
    total_tokens: Math.round(entry.usage.totalTokens),
    model_calls: entry.usage.modelCalls,
    tools_used: [...new Set(entry.toolsUsed)],
    duration_ms: Math.max(0, Math.round(entry.durationMs)),
    estimated_cost_usd: Math.max(0, entry.estimatedCostUsd),
  };
  let { error } = await supabase.from("ai_usage_log").insert(row);
  // Compatibilidade durante o deploy: se a coluna nova ainda não estiver no
  // schema cache, registra os tokens mesmo assim. A cota antiga continua ativa.
  if (error && /estimated_cost_usd|schema cache|column/i.test(error.message ?? "")) {
    const { estimated_cost_usd: _ignored, ...legacyRow } = row;
    ({ error } = await supabase.from("ai_usage_log").insert(legacyRow));
  }
  if (error && !notInstalled(error)) {
    console.error("[elos-ia] Falha ao registrar o consumo:", error.message);
  }
}
