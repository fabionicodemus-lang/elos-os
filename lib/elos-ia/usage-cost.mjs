// Elos IA — estimativa de custo para proteção interna de orçamento.
// Valores por 1M tokens. O faturamento oficial continua sendo o da OpenAI.

const KNOWN_MODEL_RATES = {
  "gpt-6-luna": { input: 0.05, cachedInput: 0.005, output: 0.25 },
  "gpt-6-sol": { input: 1.0, cachedInput: 0.10, output: 5.0 },
  "gpt-6-astra": { input: 5.0, cachedInput: 0.50, output: 25.0 },
};

// Para modelo desconhecido, prefere superestimar a liberar gasto sem proteção.
const CONSERVATIVE_FALLBACK = { input: 5.0, cachedInput: 0.50, output: 25.0 };

export function defaultRatesForModel(model) {
  return KNOWN_MODEL_RATES[String(model ?? "").trim()] ?? CONSERVATIVE_FALLBACK;
}

export function estimateUsageCostUsd(usage, rates) {
  const input = Math.max(0, Number(usage?.inputTokens ?? 0) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage?.cachedInputTokens ?? 0) || 0));
  const output = Math.max(0, Number(usage?.outputTokens ?? 0) || 0);
  const uncached = Math.max(0, input - cached);
  const cost = (
    uncached * Number(rates.input || 0)
    + cached * Number(rates.cachedInput || 0)
    + output * Number(rates.output || 0)
  ) / 1_000_000;
  return Math.max(0, Math.round(cost * 1_000_000) / 1_000_000);
}

export function estimateMaxQuestionCostUsd(config) {
  const rates = config.rates;
  // Reserva conservadora antes de iniciar uma pergunta: até 2x o orçamento de
  // tokens como entrada acumulada + saída máxima de todas as idas ao modelo.
  // Isso deixa margem para a chamada final que pode ultrapassar o turnTokenBudget.
  const maxInputTokens = Math.max(0, Number(config.turnTokenBudget || 0)) * 2;
  const maxOutputTokens = Math.max(0, Number(config.maxOutputTokens || 0)) * (Math.max(1, Number(config.maxRounds || 0)) + 1);
  const cost = (
    maxInputTokens * Number(rates.input || 0)
    + maxOutputTokens * Number(rates.output || 0)
  ) / 1_000_000;
  return Math.max(0.001, Math.ceil(cost * 1_000_000) / 1_000_000);
}
