export type AgentUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  modelCalls: number;
};

export type AgentToolTrace = { name: string; args: Record<string, unknown>; ok: boolean; ms: number };
export type AgentHistoryMessage = { role: "user" | "assistant"; content: string };
export type ResponsesItem = Record<string, unknown>;
export type ResponsesApiResult = {
  id?: string; status?: string; output?: ResponsesItem[]; usage?: Record<string, unknown>;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string; code?: string } | null;
};
export type AgentTurnResult = {
  text: string; status: "ok" | "incomplete" | "empty"; incompleteReason: string | null;
  forcedFinal: boolean; usage: AgentUsage; toolTrace: AgentToolTrace[];
};
export const TRUNCATION_NOTICE: string;
export const TURN_DATA_LIMIT_NOTICE: string;
export function emptyUsage(): AgentUsage;
export function addUsage(total: AgentUsage, usage: unknown): AgentUsage;
export function extractText(response: ResponsesApiResult): string;
export function extractFunctionCalls(response: ResponsesApiResult): Array<{ type: "function_call"; name: string; call_id: string; arguments?: unknown }>;
export function parseArguments(raw: unknown): Record<string, unknown>;
export function serializeToolOutput(result: unknown, maxChars: number): string;
export function trimHistory(history: unknown, options?: { maxMessages?: number; maxCharsPerMessage?: number }): AgentHistoryMessage[];
export function runAgentTurn(input: {
  callModel: (request: { input: ResponsesItem[]; toolChoice: "auto" | "none" }) => Promise<ResponsesApiResult>;
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  history?: AgentHistoryMessage[];
  question: string;
  /** Conteúdo multimodal da mensagem atual (input_text/input_file/input_image). */
  userContent?: Array<Record<string, unknown>> | null;
  maxRounds?: number;
  turnTokenBudget?: number;
  maxToolOutputChars?: number;
  maxToolOutputCharsPerTurn?: number;
  deadlineAt?: number;
  now?: () => number;
}): Promise<AgentTurnResult>;
