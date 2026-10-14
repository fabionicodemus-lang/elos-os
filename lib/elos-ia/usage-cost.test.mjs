import test from "node:test";
import assert from "node:assert/strict";
import { defaultRatesForModel, estimateMaxQuestionCostUsd, estimateUsageCostUsd } from "./usage-cost.mjs";

test("calcula custo do gpt-6-luna descontando entrada em cache", () => {
  const rates = defaultRatesForModel("gpt-6-luna");
  const cost = estimateUsageCostUsd({ inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 }, rates);
  assert.equal(cost, 0.066);
});

test("reserva custo conservador da pergunta antes de chamar a OpenAI", () => {
  const cost = estimateMaxQuestionCostUsd({
    rates: defaultRatesForModel("gpt-6-luna"),
    turnTokenBudget: 60_000,
    maxOutputTokens: 16_000,
    maxRounds: 4,
  });
  assert.equal(cost, 0.026);
});

test("modelo desconhecido usa tarifa conservadora", () => {
  assert.deepEqual(defaultRatesForModel("modelo-futuro"), { input: 5, cachedInput: 0.5, output: 25 });
});
