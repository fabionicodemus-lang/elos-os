// Elos IA — chamada à OpenAI (Responses API) sem SDK, só `fetch`.
//
// - `store: false`: a OpenAI não guarda a conversa do lado dela. O contexto de
//   cada rodada (inclusive os itens de raciocínio cifrados) é reenviado por nós.
// - `max_output_tokens` limita cada resposta; o teto por pergunta e as cotas
//   diária/mensal ficam em agent-loop.mjs e usage.ts.

import type { ResponsesApiResult, ResponsesItem } from "./agent-loop.mjs";
import type { ElosIaConfig } from "./config";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_REQUEST_TIMEOUT_MS = 50_000;

export class OpenAiRequestError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "OpenAiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function createOpenAiResponse({
  config,
  instructions,
  input,
  tools,
  toolChoice,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
}: {
  config: ElosIaConfig;
  instructions: string;
  input: ResponsesItem[];
  tools: unknown[];
  toolChoice: "auto" | "none";
  /** Tempo máximo desta chamada; o servidor reduz conforme o prazo da pergunta. */
  timeoutMs?: number;
}): Promise<ResponsesApiResult> {
  if (timeoutMs < 1_000) throw new OpenAiRequestError("Não sobrou tempo para concluir a resposta.", 0, "timeout");
  const body = {
    model: config.model,
    instructions,
    input,
    tools,
    tool_choice: toolChoice,
    parallel_tool_calls: true,
    max_output_tokens: config.maxOutputTokens,
    reasoning: { effort: config.reasoningEffort },
    store: false,
    include: ["reasoning.encrypted_content"],
  };

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(timeoutMs, OPENAI_REQUEST_TIMEOUT_MS)),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OpenAiRequestError(timedOut ? "A OpenAI demorou demais para responder." : "Não foi possível conectar à OpenAI.", 0, timedOut ? "timeout" : "network");
  }

  const payload = (await response.json().catch(() => null)) as (ResponsesApiResult & { error?: { message?: string; code?: string; type?: string } | null }) | null;
  if (!response.ok || !payload) {
    throw new OpenAiRequestError(
      payload?.error?.message || `A OpenAI respondeu com erro ${response.status}.`,
      response.status,
      payload?.error?.code ?? payload?.error?.type ?? null,
    );
  }
  return payload;
}

/** Mensagem que o usuário final vê; o detalhe técnico vai só para o log do servidor. */
export function friendlyOpenAiError(error: unknown) {
  if (!(error instanceof OpenAiRequestError)) return "O Elos IA não conseguiu concluir a resposta. Tente novamente em instantes.";
  if (error.status === 401) return "A chave da OpenAI configurada no Elos OS é inválida ou foi revogada. Avise o administrador.";
  if (error.status === 403) return "A chave da OpenAI não tem acesso a este modelo. Avise o administrador.";
  if (error.status === 404) return "O modelo configurado para o Elos IA não existe nesta conta da OpenAI. Avise o administrador.";
  if (error.status === 429 && error.code === "insufficient_quota") return "O limite de gastos da conta da OpenAI foi atingido. Avise o administrador.";
  if (error.status === 429) return "A OpenAI está limitando as chamadas neste momento. Aguarde um minuto e tente de novo.";
  if (error.code === "timeout") return "A OpenAI demorou demais para responder. Tente uma pergunta mais específica ou tente de novo.";
  if (error.status >= 500 || error.status === 0) return "A OpenAI está instável neste momento. Tente novamente em instantes.";
  return "O Elos IA não conseguiu concluir a resposta. Tente novamente em instantes.";
}
