// Elos IA — configuração lida somente no servidor.
//
// A chave da OpenAI e os limites de consumo ficam em variáveis de ambiente da
// Vercel. Nada daqui é enviado ao navegador.

import { defaultRatesForModel } from "./usage-cost.mjs";

export type ElosIaConfig = {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  /** Teto de tokens de saída (raciocínio + texto) de CADA ida ao modelo. */
  maxOutputTokens: number;
  /** Máximo de rodadas de consulta ao Elos OS por pergunta. */
  maxRounds: number;
  /** Ao passar deste total de tokens na pergunta, a IA é obrigada a responder. */
  turnTokenBudget: number;
  /** Cota diária de tokens por usuário (0 desliga). */
  dailyUserTokens: number;
  /** Cota mensal de tokens por empresa (0 desliga). */
  monthlyCompanyTokens: number;
  /** Fallback do teto mensal em USD. A coluna da empresa prevalece quando instalada. */
  monthlyCompanyUsdDefault: number;
  /** Tarifas estimadas por 1M tokens para o controle de orçamento interno. */
  rates: { input: number; cachedInput: number; output: number };
  maxQuestionChars: number;
};

function cleanValue(value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  const quoted = (cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"));
  return quoted ? cleaned.slice(1, -1).trim() : cleaned;
}

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const cleaned = cleanValue(value);
  if (!cleaned) return fallback;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function decimal(value: string | undefined, fallback: number, min: number, max: number) {
  const cleaned = cleanValue(value);
  if (!cleaned) return fallback;
  const parsed = Number.parseFloat(cleaned.replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const ELOS_IA_DEFAULT_MODEL = "gpt-6-luna";

export function getElosIaConfig(): ElosIaConfig {
  const model = cleanValue(process.env.ELOS_IA_MODEL) || ELOS_IA_DEFAULT_MODEL;
  const defaults = defaultRatesForModel(model);
  return {
    apiKey: cleanValue(process.env.OPENAI_API_KEY),
    model,
    reasoningEffort: cleanValue(process.env.ELOS_IA_REASONING_EFFORT) || "low",
    maxOutputTokens: integer(process.env.ELOS_IA_MAX_OUTPUT_TOKENS, 16_000, 500, 64_000),
    maxRounds: integer(process.env.ELOS_IA_MAX_ROUNDS, 4, 1, 8),
    turnTokenBudget: integer(process.env.ELOS_IA_TURN_TOKEN_BUDGET, 60_000, 5_000, 1_000_000),
    dailyUserTokens: integer(process.env.ELOS_IA_DAILY_TOKENS_PER_USER, 300_000, 0, 1_000_000_000),
    monthlyCompanyTokens: integer(process.env.ELOS_IA_MONTHLY_TOKENS_PER_COMPANY, 5_000_000, 0, 1_000_000_000),
    monthlyCompanyUsdDefault: decimal(process.env.ELOS_IA_MONTHLY_USD_PER_COMPANY, 20, 0, 100_000),
    rates: {
      input: decimal(process.env.ELOS_IA_INPUT_USD_PER_1M, defaults.input, 0, 1_000),
      cachedInput: decimal(process.env.ELOS_IA_CACHED_INPUT_USD_PER_1M, defaults.cachedInput, 0, 1_000),
      output: decimal(process.env.ELOS_IA_OUTPUT_USD_PER_1M, defaults.output, 0, 10_000),
    },
    maxQuestionChars: 2_000,
  };
}

export function isElosIaConfigured() {
  return Boolean(cleanValue(process.env.OPENAI_API_KEY));
}
