// Elos IA — laço de conversa com ferramentas (sem Supabase, sem rede).
//
// Recebe duas funções injetadas:
//   callModel({ input, toolChoice }) -> resposta crua da OpenAI Responses API
//   runTool(name, args)              -> resultado (objeto) da consulta ao Elos OS
//
// O laço garante os limites de custo de UMA pergunta.

export const TURN_DATA_LIMIT_NOTICE = JSON.stringify({ erro: "Limite de dados desta pergunta atingido. Responda com o que já foi consultado e diga ao usuário para perguntar o restante em seguida." });
const CHARS_PER_TOKEN = 3;
export const TRUNCATION_NOTICE = "\n…[resultado cortado pelo limite de tamanho; refine os filtros ou reduza o limite]";

export function emptyUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, modelCalls: 0 };
}

export function addUsage(total, usage) {
  if (!usage || typeof usage !== "object") return total;
  const input = Number(usage.input_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? 0) || 0;
  total.inputTokens += input;
  total.outputTokens += output;
  total.cachedInputTokens += Number(usage.input_tokens_details?.cached_tokens ?? 0) || 0;
  total.reasoningTokens += Number(usage.output_tokens_details?.reasoning_tokens ?? 0) || 0;
  total.totalTokens += Number(usage.total_tokens ?? input + output) || 0;
  return total;
}

export function extractText(response) {
  const messages = (Array.isArray(response?.output) ? response.output : []).filter(
    (item) => item?.type === "message" && Array.isArray(item.content),
  );
  const finals = messages.filter((item) => item.phase === "final_answer");
  const parts = [];
  for (const item of finals.length ? finals : messages) {
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
      else if (content?.type === "refusal" && typeof content.refusal === "string") parts.push(content.refusal);
    }
  }
  return parts.join("\n").trim();
}

export function extractFunctionCalls(response) {
  return (Array.isArray(response?.output) ? response.output : []).filter(
    (item) => item?.type === "function_call" && typeof item.name === "string" && typeof item.call_id === "string",
  );
}

export function parseArguments(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function serializeToolOutput(result, maxChars) {
  let text;
  try {
    text = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    text = JSON.stringify({ erro: "Não foi possível serializar o resultado da consulta." });
  }
  if (typeof text !== "string") text = "null";
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - TRUNCATION_NOTICE.length)) + TRUNCATION_NOTICE;
}

export function trimHistory(history, { maxMessages = 8, maxCharsPerMessage = 2000 } = {}) {
  const clean = (Array.isArray(history) ? history : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({ role: message.role, content: String(message.content ?? "").trim() }))
    .filter((message) => message.content)
    .map((message) => ({
      role: message.role,
      content: message.content.length > maxCharsPerMessage ? `${message.content.slice(0, maxCharsPerMessage)}…` : message.content,
    }));
  const tail = clean.slice(-Math.max(0, maxMessages));
  while (tail.length && tail[0].role !== "user") tail.shift();
  return tail;
}

export async function runAgentTurn({
  callModel,
  runTool,
  history = [],
  question,
  userContent = null,
  maxRounds = 4,
  turnTokenBudget = 60_000,
  maxToolOutputChars = 12_000,
  maxToolOutputCharsPerTurn = 36_000,
  deadlineAt = Number.POSITIVE_INFINITY,
  now = Date.now,
}) {
  const currentUserMessage = userContent
    ? { role: "user", content: userContent }
    : { role: "user", content: String(question ?? "") };
  const input = [...history, currentUserMessage];
  const usage = emptyUsage();
  const toolTrace = [];
  let forcedFinal = false;
  let lastInputTokens = 0;
  let charsAddedSinceLastCall = JSON.stringify(currentUserMessage).length;
  let toolOutputChars = 0;

  for (let round = 0; ; round += 1) {
    const nextInputTokens = lastInputTokens + Math.ceil(charsAddedSinceLastCall / CHARS_PER_TOKEN);
    const overBudget = usage.totalTokens >= turnTokenBudget || (round > 0 && usage.totalTokens + 2 * nextInputTokens > turnTokenBudget);
    const mustAnswer = round >= maxRounds || overBudget || now() >= deadlineAt;
    if (mustAnswer) forcedFinal = true;

    let response;
    try {
      response = await callModel({ input, toolChoice: mustAnswer ? "none" : "auto" });
    } catch (error) {
      if (error && typeof error === "object") {
        error.usage ??= usage;
        error.toolTrace ??= toolTrace;
      }
      throw error;
    }
    usage.modelCalls += 1;
    addUsage(usage, response?.usage);
    lastInputTokens = Number(response?.usage?.input_tokens ?? 0) || nextInputTokens;
    charsAddedSinceLastCall = 0;

    if (response?.status === "failed" || response?.error) {
      const message = response?.error?.message || "A OpenAI não conseguiu concluir a resposta.";
      const error = new Error(message);
      error.code = response?.error?.code ?? "openai_failed";
      error.usage = usage;
      error.toolTrace = toolTrace;
      throw error;
    }

    const calls = mustAnswer ? [] : extractFunctionCalls(response);
    const text = extractText(response);
    const incomplete = response?.status === "incomplete";

    if (!calls.length) {
      return {
        text,
        status: incomplete ? "incomplete" : text ? "ok" : "empty",
        incompleteReason: incomplete ? response?.incomplete_details?.reason ?? "unknown" : null,
        forcedFinal,
        usage,
        toolTrace,
      };
    }

    input.push(...response.output);
    charsAddedSinceLastCall += JSON.stringify(response.output).length;
    const results = await Promise.all(calls.map(async (call) => {
      const args = parseArguments(call.arguments);
      const startedAt = Date.now();
      let result;
      let ok = true;
      try {
        result = await runTool(call.name, args);
        if (result && typeof result === "object" && "erro" in result) ok = false;
      } catch (error) {
        ok = false;
        result = { erro: error instanceof Error ? error.message : "Falha ao consultar o Elos OS." };
      }
      return { call, args, ok, ms: Date.now() - startedAt, output: serializeToolOutput(result, maxToolOutputChars) };
    }));
    for (const item of results) {
      let { output, ok } = item;
      if (toolOutputChars + output.length > maxToolOutputCharsPerTurn) {
        output = TURN_DATA_LIMIT_NOTICE;
        ok = false;
      }
      toolOutputChars += output.length;
      charsAddedSinceLastCall += output.length;
      toolTrace.push({ name: item.call.name, args: item.args, ok, ms: item.ms });
      input.push({ type: "function_call_output", call_id: item.call.call_id, output });
    }
  }
}
