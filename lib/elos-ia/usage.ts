// Elos IA — cotas de consumo e registro de uso (tabela public.ai_usage_log).
//
// Três camadas limitam o gasto:
//   1. por resposta  -> max_output_tokens (openai.ts)
//   2. por pergunta  -> rodadas e orçamento de tokens (agent-loop.mjs)
//   3. por período   -> cota diária do usuário e mensal da empresa (este arquivo)
// Além delas, vale o limite de gastos configurado na própria conta da OpenAI.

import type { resolveActiveWorkspace } from "@/lib/workspace";
import type { AgentUsage } from "./agent-loop.mjs";
import type { ElosIaConfig } from "./config";

type SupabaseClientLike = Awaited<ReturnType<typeof resolveActiveWorkspace>>["supabase"];

export type ElosIaUsageSnapshot = {
  /** false enquanto a migration 0091 não foi aplicada: sem registro, sem cota. */
  tracking: boolean;
  userTokensToday: number;
  companyTokensMonth: number;
};

export type ElosIaQuotaView = {
  tracking: boolean;
  userTokensToday: number;
  dailyUserTokens: number;
  companyTokensMonth: number;
  monthlyCompanyTokens: number;
};

// Códigos do PostgREST/Postgres para "função ou tabela não existe".
const NOT_INSTALLED_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

function notInstalled(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return NOT_INSTALLED_CODES.has(error.code ?? "") || /ai_usage_(totals|log)/.test(error.message ?? "") && /(not find|does not exist|schema cache)/i.test(error.message ?? "");
}

export async function loadElosIaUsage(supabase: SupabaseClientLike, companyId: string): Promise<ElosIaUsageSnapshot> {
  const { data, error } = await supabase.rpc("ai_usage_totals", { p_company_id: companyId });
  if (error) {
    if (notInstalled(error)) return { tracking: false, userTokensToday: 0, companyTokensMonth: 0 };
    throw new Error(`Não foi possível conferir a cota do Elos IA: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { user_tokens_today?: number | string; company_tokens_month?: number | string } | null;
  return {
    tracking: true,
    userTokensToday: Number(row?.user_tokens_today ?? 0) || 0,
    companyTokensMonth: Number(row?.company_tokens_month ?? 0) || 0,
  };
}

export function checkElosIaQuota(config: ElosIaConfig, usage: ElosIaUsageSnapshot): { allowed: true } | { allowed: false; message: string } {
  if (!usage.tracking) return { allowed: true };
  if (config.dailyUserTokens > 0 && usage.userTokensToday >= config.dailyUserTokens) {
    return { allowed: false, message: "Você atingiu a cota diária do Elos IA. Ela é renovada à meia-noite." };
  }
  if (config.monthlyCompanyTokens > 0 && usage.companyTokensMonth >= config.monthlyCompanyTokens) {
    return { allowed: false, message: "A empresa atingiu a cota mensal do Elos IA. Fale com o administrador para ampliar o limite." };
  }
  return { allowed: true };
}

export function quotaView(config: ElosIaConfig, usage: ElosIaUsageSnapshot, added = 0): ElosIaQuotaView {
  return {
    tracking: usage.tracking,
    userTokensToday: usage.userTokensToday + added,
    dailyUserTokens: config.dailyUserTokens,
    companyTokensMonth: usage.companyTokensMonth + added,
    monthlyCompanyTokens: config.monthlyCompanyTokens,
  };
}

export async function recordElosIaUsage(supabase: SupabaseClientLike, entry: {
  companyId: string;
  projectId: string | null;
  userId: string;
  persona: string;
  model: string;
  status: "ok" | "incomplete" | "empty" | "error";
  usage: AgentUsage;
  toolsUsed: string[];
  durationMs: number;
}) {
  if (!entry.usage.modelCalls) return;
  const { error } = await supabase.from("ai_usage_log").insert({
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
  });
  if (error && !notInstalled(error)) {
    console.error("[elos-ia] Falha ao registrar o consumo:", error.message);
  }
}
