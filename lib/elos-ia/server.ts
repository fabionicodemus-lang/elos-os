// Elos IA — orquestração de uma pergunta (somente servidor).

import { resolveActiveWorkspace } from "@/lib/workspace";
import { runAgentTurn, trimHistory, emptyUsage, type AgentUsage, type AgentToolTrace } from "./agent-loop.mjs";
import { getElosIaConfig, type ElosIaConfig } from "./config";
import { createOpenAiResponse, friendlyOpenAiError } from "./openai";
import { buildElosIaInstructions, getElosIaPersona, type ElosIaPersonaKey } from "./personas";
import { elosIaToolLabel, elosIaToolSchemas, runElosIaTool, type ElosIaProject, type ElosIaToolContext } from "./tools";
import { checkElosIaQuota, loadElosIaUsage, quotaView, recordElosIaUsage, type ElosIaQuotaView } from "./usage";

type Workspace = Awaited<ReturnType<typeof resolveActiveWorkspace>>;

// A rota pode rodar por 120 s (maxDuration). Para nunca ser cortada no meio —
// o que deixaria o consumo sem registro —, a pergunta tem dois prazos:
//   - aos 55 s a IA para de consultar e a próxima ida é a resposta final;
//   - nenhuma chamada à OpenAI passa dos 100 s contados do início.
const ANSWER_DEADLINE_MS = 55_000;
const HARD_DEADLINE_MS = 100_000;

export type ElosIaAccess = {
  workspace: Workspace;
  privileged: boolean;
  can: (permission: string) => boolean;
  allowed: boolean;
};

export type ElosIaAnswer =
  | {
      ok: true;
      text: string;
      persona: ElosIaPersonaKey;
      consultas: Array<{ nome: string; ok: boolean }>;
      tokens: number;
      quota: ElosIaQuotaView;
    }
  | { ok: false; status: number; error: string; quota?: ElosIaQuotaView };

export function elosIaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Resolve empresa, obra, papel e permissões do usuário logado.
 * Uma permissão `x.view` também é atendida por `x.manage` (e, em Execução,
 * por `x.approve`/`x.finance`), como nas políticas de RLS do banco.
 */
export async function resolveElosIaAccess(): Promise<ElosIaAccess> {
  const workspace = await resolveActiveWorkspace();
  const privileged = workspace.roleKey === "owner" || workspace.roleKey === "admin";
  const granted = new Set<string>();

  if (!privileged && workspace.role.id) {
    const { data, error } = await workspace.supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("role_id", workspace.role.id)
      .eq("allowed", true);
    if (error) console.error("[elos-ia] Falha ao ler permissões do papel:", error.message);
    for (const row of (data ?? []) as { permission_key: string }[]) granted.add(row.permission_key);
  }

  const can = (permission: string) => {
    if (privileged || granted.has(permission)) return true;
    if (!permission.endsWith(".view")) return false;
    const base = permission.slice(0, -5);
    if (granted.has(`${base}.manage`)) return true;
    // Nas tabelas de Execução, quem aprova também lê; nas medições, quem libera o financeiro também.
    if (base.startsWith("execution.") && granted.has(`${base}.approve`)) return true;
    return base === "execution.measurements" && granted.has(`${base}.finance`);
  };

  return { workspace, privileged, can, allowed: privileged || can("ai.assistant.use") };
}

export async function loadElosIaProjects(workspace: Workspace): Promise<ElosIaProject[]> {
  const { data, error } = await workspace.supabase
    .from("projects")
    .select("id, name, code, city, status")
    .eq("company_id", workspace.companyId)
    .neq("status", "archived")
    .order("name");
  if (error) console.error("[elos-ia] Falha ao listar obras:", error.message);
  return (data ?? []) as ElosIaProject[];
}

function finalText(text: string, status: "ok" | "incomplete" | "empty") {
  if (status === "incomplete") {
    return text
      ? `${text}\n\n*(Resposta cortada pelo limite de tokens desta pergunta.)*`
      : "A resposta foi interrompida pelo limite de tokens desta pergunta. Tente uma pergunta mais específica.";
  }
  if (!text) return "Não consegui montar uma resposta com os dados consultados. Tente reformular a pergunta.";
  return text;
}

export async function answerElosIaQuestion(input: { persona: unknown; question: unknown; history: unknown }): Promise<ElosIaAnswer> {
  const startedAt = Date.now();
  const access = await resolveElosIaAccess();
  const { workspace } = access;
  if (!access.allowed) return { ok: false, status: 403, error: "Você não tem permissão para usar o Elos IA. Peça o acesso ao administrador da empresa." };

  const config: ElosIaConfig = getElosIaConfig();
  if (!config.apiKey) return { ok: false, status: 503, error: "O Elos IA ainda não foi ativado: falta configurar a chave da OpenAI no servidor." };

  const persona = getElosIaPersona(input.persona);
  if (!persona) return { ok: false, status: 400, error: "Persona inválida." };

  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return { ok: false, status: 400, error: "Escreva uma pergunta." };
  if (question.length > config.maxQuestionChars) {
    return { ok: false, status: 400, error: `A pergunta passou de ${config.maxQuestionChars} caracteres. Resuma e envie de novo.` };
  }

  let usageSnapshot;
  try {
    usageSnapshot = await loadElosIaUsage(workspace.supabase, workspace.companyId);
  } catch (error) {
    console.error("[elos-ia]", error);
    return { ok: false, status: 503, error: "Não foi possível conferir a cota do Elos IA agora. Tente novamente em instantes." };
  }
  const quota = checkElosIaQuota(config, usageSnapshot);
  if (!quota.allowed) return { ok: false, status: 429, error: quota.message, quota: quotaView(config, usageSnapshot) };

  const [projects, profileResult] = await Promise.all([
    loadElosIaProjects(workspace),
    workspace.supabase.from("profiles").select("full_name").eq("id", workspace.userId).maybeSingle(),
  ]);
  const activeProject = projects.find((project) => project.id === workspace.projectId) ?? null;
  const today = elosIaToday();
  const toolContext: ElosIaToolContext = {
    supabase: workspace.supabase,
    companyId: workspace.companyId,
    activeProjectId: activeProject?.id ?? null,
    projects,
    today,
    can: access.can,
    cache: new Map(),
  };
  const instructions = buildElosIaInstructions(persona, {
    today,
    companyName: workspace.company.name,
    activeProjectLabel: activeProject ? [activeProject.code, activeProject.name].filter(Boolean).join(" · ") : null,
    projectCount: projects.length,
    userName: profileResult.data?.full_name?.trim() || workspace.email.split("@")[0] || "Usuário",
    roleName: workspace.role.name ?? workspace.roleKey,
  });
  const tools = elosIaToolSchemas(persona.tools);

  const record = (status: "ok" | "incomplete" | "empty" | "error", usage: AgentUsage, trace: AgentToolTrace[]) =>
    recordElosIaUsage(workspace.supabase, {
      companyId: workspace.companyId,
      projectId: activeProject?.id ?? null,
      userId: workspace.userId,
      persona: persona.key,
      model: config.model,
      status,
      usage,
      toolsUsed: trace.map((item) => item.name),
      durationMs: Date.now() - startedAt,
    });

  try {
    const result = await runAgentTurn({
      callModel: ({ input: items, toolChoice }) =>
        createOpenAiResponse({ config, instructions, input: items, tools, toolChoice, timeoutMs: startedAt + HARD_DEADLINE_MS - Date.now() }),
      runTool: (name, args) => runElosIaTool(toolContext, persona.tools, name, args),
      history: trimHistory(input.history),
      question,
      maxRounds: config.maxRounds,
      turnTokenBudget: config.turnTokenBudget,
      deadlineAt: startedAt + ANSWER_DEADLINE_MS,
    });
    await record(result.status, result.usage, result.toolTrace);
    return {
      ok: true,
      text: finalText(result.text, result.status),
      persona: persona.key,
      consultas: result.toolTrace.map((item) => ({ nome: elosIaToolLabel(item.name), ok: item.ok })),
      tokens: result.usage.totalTokens,
      quota: quotaView(config, usageSnapshot, result.usage.totalTokens),
    };
  } catch (error) {
    const partial = error as { usage?: AgentUsage; toolTrace?: AgentToolTrace[] };
    const usage = partial.usage ?? emptyUsage();
    console.error("[elos-ia] Falha ao responder:", error);
    await record("error", usage, partial.toolTrace ?? []);
    return { ok: false, status: 502, error: friendlyOpenAiError(error), quota: quotaView(config, usageSnapshot, usage.totalTokens) };
  }
}
