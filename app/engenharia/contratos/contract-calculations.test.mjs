import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contractBalance,
  contractCurrentValue,
  contractItemsMatchOriginal,
  dueDateFromApproval,
  requiresOverContractConfirmation,
  retainedBalance,
  serviceDeviation,
  sumContractItems,
} from "./contract-calculations.mjs";

test("a soma dos itens coincide com o valor original do contrato", () => {
  const items = [{ total_value: 60000 }, { total_value: 40000 }];
  assert.equal(sumContractItems(items), 100000);
  assert.equal(contractItemsMatchOriginal(100000, items), true);
  assert.equal(contractItemsMatchOriginal(99900, items), false);
});

test("saldo considera acréscimos, supressões e apenas medições válidas", () => {
  const current = contractCurrentValue(100000, [{ value_change: 20000 }, { value_change: -5000 }]);
  const balance = contractBalance(current, [
    { status: "invoiced", gross_amount: 30000 },
    { status: "reversed", gross_amount: 15000 },
  ]);
  assert.equal(current, 115000);
  assert.equal(balance, 85000);
});

test("vencimento soma os dias de pagamento à data da aprovação", () => {
  assert.equal(dueDateFromApproval("2026-08-03", 30), "2026-09-02");
});

test("estouro exige confirmação sem reduzir o saldo futuro", () => {
  assert.equal(requiresOverContractConfirmation(100000, 70000, 40000), true);
  assert.equal(requiresOverContractConfirmation(100000, 70000, 30000), false);
});

test("retenção ignora medições estornadas", () => {
  assert.equal(retainedBalance([
    { status: "invoiced", contractual_retention_amount: 5000, guarantee_retention_amount: 1000 },
    { status: "reversed", contractual_retention_amount: 2000, guarantee_retention_amount: 500 },
  ]), 6000);
});

test("desvio comprometido contra orçamento é visível", () => {
  assert.deepEqual(serviceDeviation(100000, 120000), { deviation: 20000, overBudget: true });
  assert.deepEqual(serviceDeviation(100000, 90000), { deviation: -10000, overBudget: false });
});

test("migration habilita RLS e isola a nova tabela por company_id", () => {
  const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/20260803_0071_execution_contract_commitments.sql", import.meta.url));
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /execution_service_contract_amendment_items enable row level security/i);
  assert.match(sql, /has_company_permission\(company_id,'execution\.contracts\.view'\)/i);
  assert.match(sql, /has_company_permission\(company_id,'execution\.contracts\.amend'\)/i);
  assert.match(sql, /company_id uuid not null references public\.companies/i);
});
