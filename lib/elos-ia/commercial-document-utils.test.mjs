import test from "node:test";
import assert from "node:assert/strict";
import { addCommercialMonths, normalizeCommercialDocumentInput, normalizeCommercialTaxId, validCommercialDate } from "./commercial-document-utils.mjs";

function input() {
  return {
    moeda: "BRL", data_venda: "2026-01-10", numero_contrato: "CT-101", valor_total: 1100,
    cliente: {
      nome: "Comprador de teste", tipo_pessoa: "PF", cpf_cnpj: "123.456.789-01",
      documento_identidade: null, data_nascimento: null, estado_civil: null, profissao: null,
      email: null, telefone: null, telefone_secundario: null, endereco: null, cep: null,
      cidade: null, estado: null, nacionalidade: null,
    },
    condicoes_pagamento: [
      { categoria: "entry", descricao: "Entrada", quantidade: 1, primeiro_vencimento: "2026-01-10", intervalo_meses: 0, valor_parcela: 100, indice_correcao: null, juros_mensais: null, forma_pagamento: "PIX", observacoes: null },
      { categoria: "monthly", descricao: "Mensal", quantidade: 10, primeiro_vencimento: "2026-01-31", intervalo_meses: 1, valor_parcela: 100, indice_correcao: null, juros_mensais: null, forma_pagamento: null, observacoes: null },
    ],
    comissao_percentual: null, corretor: null, inicio_correcao_meses: null,
    tem_permuta: false, tem_multiplos_compradores: false, tem_vencimento_por_evento: false,
    tem_troca_indice_por_evento: false, tem_pagamento_ja_realizado: false, regras_financeiras_completas: true,
    clausulas_pendentes: [], observacoes: null,
  };
}

test("venda documental fecha valores em centavos e preserva forma de pagamento sem inventar boleto", () => {
  const result = normalizeCommercialDocumentInput(input(), "2026-11-17");
  assert.equal(result.totalAmount, 1100);
  assert.equal(result.installments.length, 11);
  assert.equal(result.installments.reduce((sum, row) => sum + row.amount, 0), 1100);
  assert.equal(result.paymentItems[0].notes, "Forma de pagamento: PIX.");
  assert.equal(result.paymentItems[1].paymentMethod, null);
  assert.deepEqual(result.unsupportedClauses, []);
});

test("parcelas preservam aniversário ao atravessar fevereiro, sem espalhar o último dia", () => {
  const rows = normalizeCommercialDocumentInput(input(), "2026-11-17").installments;
  assert.equal(rows[1].dueDate, "2026-01-31");
  assert.equal(rows[2].dueDate, "2026-02-28");
  assert.equal(rows[3].dueDate, "2026-03-31");
  assert.equal(addCommercialMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(validCommercialDate("2026-02-30"), false);
  assert.equal(validCommercialDate("2024-02-29"), true);
});

test("diferença financeira, excesso de parcelas e data impossível não geram rascunho executável", () => {
  const mismatch = input(); mismatch.valor_total = 1099.99;
  assert.throws(() => normalizeCommercialDocumentInput(mismatch, "2026-11-17"), /somam/);
  const fractional = input(); fractional.condicoes_pagamento[1].valor_parcela = 100.001;
  assert.throws(() => normalizeCommercialDocumentInput(fractional, "2026-11-17"), /duas casas/);
  const invalid = input(); invalid.condicoes_pagamento[0].primeiro_vencimento = "2026-02-30";
  assert.throws(() => normalizeCommercialDocumentInput(invalid, "2026-11-17"), /data válida/);
  const large = input(); large.condicoes_pagamento[1].quantidade = 240; large.valor_total = 24100;
  assert.throws(() => normalizeCommercialDocumentInput(large, "2026-11-17"), /240 parcelas/);
});

test("juros, pagamentos históricos e cláusulas sem representação permanecem impedimentos explícitos", () => {
  const row = input();
  row.condicoes_pagamento[1].indice_correcao = "IPCA";
  row.condicoes_pagamento[1].juros_mensais = 0.59;
  row.tem_pagamento_ja_realizado = true;
  row.tem_troca_indice_por_evento = true;
  row.clausulas_pendentes = ["Pagamento após obtenção do habite-se."];
  const result = normalizeCommercialDocumentInput(row, "2026-11-17");
  assert(result.unsupportedClauses.some(value => value.includes("0.59%")));
  assert(result.unsupportedClauses.some(value => value.includes("pagamentos já realizados")));
  assert(result.unsupportedClauses.some(value => value.includes("troca de índice")));
  assert(result.unsupportedClauses.some(value => value.includes("início contratual")));
  assert(result.unsupportedClauses.includes("Pagamento após obtenção do habite-se."));
  assert.equal(result.paymentItems[1].interestRateMonthly, 0.59);
});

test("identificação fiscal preserva CNPJ alfanumérico e não usa somente nome para identidade", () => {
  assert.equal(normalizeCommercialTaxId("12.ABC.345/01DE-35"), "12ABC34501DE35");
  const row = input(); row.cliente.tipo_pessoa = "PJ"; row.cliente.cpf_cnpj = "12.ABC.345/01DE-35";
  assert.equal(normalizeCommercialDocumentInput(row, "2026-11-17").clientData.taxId, "12ABC34501DE35");
  row.cliente.cpf_cnpj = "";
  assert.throws(() => normalizeCommercialDocumentInput(row, "2026-11-17"), /cpf\/cnpj/i);
});
