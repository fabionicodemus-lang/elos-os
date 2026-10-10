import assert from "node:assert/strict";
import test from "node:test";
import { addDaysIso, addMonthsKey, buildCashflowMonths, summarizePayables, summarizeReceivables, summarizeSchedule } from "./summaries.mjs";

const TODAY = "2026-10-09";

const payable = (id, status, dueDate, amount, extra = {}) => ({
  id, status, dueDate, amount, paidAt: null, paidAmount: null, supplier: "Concreteira Sul", document: `NF ${id}`, installment: "1/1", ...extra,
});

const PAYABLES = [
  payable("p1", "open", "2026-09-20", 1000),                                              // vencida há 19 dias
  payable("p2", "open", "2026-10-09", 500, { supplier: "Aço Forte" }),                     // vence hoje
  payable("p3", "open", "2026-10-15", 2000, { supplier: "Aço Forte" }),                    // 7 dias
  payable("p4", "open", "2026-11-05", 4000),                                              // 30 dias
  payable("p5", "open", "2027-01-10", 8000),                                              // longe
  payable("p6", "paid", "2026-09-10", 300, { paidAt: "2026-09-12", paidAmount: 310 }),     // paga com valor diferente
  payable("p7", "paid", "2026-08-10", 700, { paidAt: "2026-08-10" }),                      // paga sem paid_amount
  payable("p8", "cancelled", "2026-10-01", 99999),                                        // nunca entra
];

test("contas a pagar: totais gerais não dependem da lista e ignoram canceladas", () => {
  const summary = summarizePayables(PAYABLES, { today: TODAY });
  assert.deepEqual(summary.resumo_geral.em_aberto, { quantidade: 5, valor: 15500 });
  assert.deepEqual(summary.resumo_geral.vencidas, { quantidade: 1, valor: 1000 });
  assert.deepEqual(summary.resumo_geral.vencem_em_7_dias, { quantidade: 2, valor: 2500, ate: "2026-10-16" });
  assert.deepEqual(summary.resumo_geral.vencem_em_30_dias, { quantidade: 3, valor: 6500, ate: "2026-11-08" });
  assert.equal(summary.resumo_geral.pagas.valor, 1010);
  assert.equal(summary.filtro.situacao, "em_aberto");
  assert.equal(summary.itens.length, 5);
  assert.equal(summary.itens[0].situacao, "vencida");
  assert.equal(summary.itens[0].dias_de_atraso, 19);
  assert.equal(summary.itens[1].situacao, "em aberto", "conta que vence hoje ainda não está vencida");
});

test("contas a pagar: limite corta a lista mas não os totais", () => {
  const summary = summarizePayables(PAYABLES, { today: TODAY, limit: 2 });
  assert.equal(summary.itens.length, 2);
  assert.equal(summary.itens_omitidos, 3);
  assert.deepEqual(summary.selecao, { quantidade: 5, valor: 15500 });
  assert.deepEqual(summary.maiores_fornecedores_da_selecao.map((group) => [group.nome, group.valor]), [["Concreteira Sul", 13000], ["Aço Forte", 2500]]);
});

test("contas a pagar: filtros de situação, período e fornecedor (sem acento)", () => {
  const overdue = summarizePayables(PAYABLES, { today: TODAY, situation: "vencidas" });
  assert.deepEqual(overdue.selecao, { quantidade: 1, valor: 1000 });

  const paidInSeptember = summarizePayables(PAYABLES, { today: TODAY, situation: "pagas", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(paidInSeptember.selecao, { quantidade: 1, valor: 310 });
  assert.equal(paidInSeptember.itens[0].pago_em, "2026-09-12");

  const supplier = summarizePayables(PAYABLES, { today: TODAY, supplierText: "aco forte" });
  assert.deepEqual(supplier.resumo_geral.em_aberto, { quantidade: 2, valor: 2500 });

  const period = summarizePayables(PAYABLES, { today: TODAY, situation: "em_aberto", from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(period.selecao, { quantidade: 1, valor: 4000 });

  assert.equal(summarizePayables(PAYABLES, { today: TODAY, situation: "inventada" }).filtro.situacao, "em_aberto");
  assert.equal(summarizePayables([], { today: TODAY }).resumo_geral.em_aberto.valor, 0);
});

const receivable = (id, status, dueDate, amount, extra = {}) => ({
  id, status, dueDate, amount, adjustedAmount: null, paidAt: null, paidAmount: null, category: "monthly", client: "Ana Lima", unit: "501", sequenceNumber: 1, sequenceTotal: 10, ...extra,
});

const RECEIVABLES = [
  receivable("r1", "open", "2026-08-10", 1000, { adjustedAmount: 1100 }),                                  // vencida, 60 dias
  receivable("r2", "open", "2026-09-10", 1000, { adjustedAmount: 1080 }),                                  // vencida, 29 dias
  receivable("r3", "open", "2026-10-20", 1000, { adjustedAmount: 1050, client: "Bruno Sá", unit: "702" }), // a vencer
  receivable("r4", "open", "2027-03-10", 50000, { category: "keys", client: "Bruno Sá", unit: "702" }),    // chaves, sem correção
  receivable("r5", "paid", "2026-07-10", 1000, { adjustedAmount: 1020, paidAt: "2026-07-09", paidAmount: 1020 }),
  receivable("r6", "cancelled", "2026-07-10", 77777),
];

test("contas a receber: usa valor corrigido em aberto e valor pago no recebido", () => {
  const summary = summarizeReceivables(RECEIVABLES, { today: TODAY });
  assert.deepEqual(summary.resumo_geral.carteira_em_aberto, { quantidade: 4, valor: 53230 });
  assert.deepEqual(summary.resumo_geral.vencidas, { quantidade: 2, valor: 2180, clientes: 1 });
  assert.equal(summary.resumo_geral.percentual_da_carteira_vencido, 4.1);
  assert.deepEqual(summary.resumo_geral.vencem_em_30_dias, { quantidade: 1, valor: 1050, ate: "2026-11-08" });
  assert.equal(summary.resumo_geral.recebidas.valor, 1020);
  assert.deepEqual(summary.maiores_inadimplentes, [{ cliente: "Ana Lima", unidades: ["501"], parcelas: 2, valor: 2180, maior_atraso_dias: 60 }]);
  assert.deepEqual(summary.carteira_em_aberto_por_categoria.map((group) => [group.nome, group.valor]), [["Chaves", 50000], ["Mensal", 3230]]);
});

test("contas a receber: filtro por cliente ou unidade", () => {
  const byUnit = summarizeReceivables(RECEIVABLES, { today: TODAY, clientText: "702" });
  assert.deepEqual(byUnit.resumo_geral.carteira_em_aberto, { quantidade: 2, valor: 51050 });
  assert.equal(byUnit.resumo_geral.vencidas.quantidade, 0);
  const byClient = summarizeReceivables(RECEIVABLES, { today: TODAY, clientText: "bruno sa", situation: "todas" });
  assert.equal(byClient.selecao.quantidade, 2);
});

test("fluxo de caixa: mesma regra da tela, com janela e acumulado desde o início", () => {
  const cashflow = buildCashflowMonths({
    payables: PAYABLES,
    receivables: RECEIVABLES,
    engineeringMonths: [{ key: "2026-10", engineeringProjected: 3000 }, { key: "2026-12", engineeringProjected: 6000 }, { key: "2027-06", engineeringProjected: 100 }],
    today: TODAY,
    monthsBack: 1,
    monthsAhead: 2,
  });

  assert.deepEqual(cashflow.janela, { de: "2026-09", ate: "2026-12", mes_atual: "2026-10" });
  assert.deepEqual(cashflow.totais_de_toda_a_obra, {
    recebido: 1020,
    a_receber: 53230,
    pago: 1010,
    a_pagar: 15500,
    projetado_engenharia: 9100,
    saldo_atual: 10,
    saldo_projetado: 37740,
    saldo_projetado_completo: 28640,
  });

  // Antes da janela: jul (+1020 recebido) e ago (+1100 a receber vencido − 700 pago) => 1420.
  assert.deepEqual(cashflow.antes_da_janela, { meses: 2, saldo_acumulado: 1420, saldo_acumulado_completo: 1420 });
  assert.deepEqual(cashflow.meses.map((month) => month.mes), ["2026-09", "2026-10", "2026-11", "2026-12"]);

  const september = cashflow.meses[0];
  assert.equal(september.saldo_do_mes, 1080 - 310 - 1000);
  assert.equal(september.saldo_acumulado, 1190);

  const october = cashflow.meses[1];
  assert.equal(october.mes_atual, true);
  assert.equal(october.a_pagar, 2500);
  assert.equal(october.a_receber, 1050);
  assert.equal(october.projetado_engenharia, 3000);
  assert.equal(october.saldo_acumulado, 1190 + 1050 - 2500);
  assert.equal(october.saldo_acumulado_completo, 1190 + 1050 - 2500 - 3000);
  assert.equal(cashflow.primeiro_mes_com_saldo_acumulado_completo_negativo, "2026-10");

  assert.deepEqual(cashflow.depois_da_janela, { meses: 3, a_receber: 50000, a_pagar: 8000, projetado_engenharia: 100 });
});

test("fluxo de caixa: sem lançamentos devolve zeros e nenhum mês negativo", () => {
  const cashflow = buildCashflowMonths({ today: TODAY });
  assert.equal(cashflow.meses.length, 0);
  assert.equal(cashflow.totais_de_toda_a_obra.saldo_projetado_completo, 0);
  assert.equal(cashflow.primeiro_mes_com_saldo_acumulado_completo_negativo, null);
});

const activity = (id, plannedStart, plannedFinish, extra = {}) => ({
  id, service_id: null, location_id: null, code: id.toUpperCase(), name: `Atividade ${id}`, planned_start: plannedStart, planned_finish: plannedFinish,
  planned_cost: 0, duration_days: 10, quantity_snapshot: 0, record_status: "active", ...extra,
});

test("fluxo de caixa: meses nulos usam a janela padrão; zero significa só o mês atual", () => {
  // No modo estrito a IA envia null em todo parâmetro que não quer definir.
  const padrao = buildCashflowMonths({ today: TODAY, monthsBack: null, monthsAhead: null });
  assert.deepEqual(padrao.janela, { de: addMonthsKey(TODAY.slice(0, 7), -3), ate: addMonthsKey(TODAY.slice(0, 7), 6), mes_atual: TODAY.slice(0, 7) });

  const soMesAtual = buildCashflowMonths({ today: TODAY, monthsBack: 0, monthsAhead: 0 });
  assert.equal(soMesAtual.janela.de, TODAY.slice(0, 7));
  assert.equal(soMesAtual.janela.ate, TODAY.slice(0, 7));

  const limitado = buildCashflowMonths({ today: TODAY, monthsBack: 99, monthsAhead: 99 });
  assert.equal(limitado.janela.de, addMonthsKey(TODAY.slice(0, 7), -24));
  assert.equal(limitado.janela.ate, addMonthsKey(TODAY.slice(0, 7), 36));
});

test("fluxo de caixa: saldo que já chega negativo ao mês atual é apontado no mês atual", () => {
  // Pagou 100 mil em agosto e não há mais nada lançado: o caixa já está negativo hoje.
  const soPassado = buildCashflowMonths({ today: TODAY, payables: [payable("x1", "paid", "2026-08-10", 100_000, { paidAt: "2026-08-10" })] });
  assert.equal(soPassado.primeiro_mes_com_saldo_acumulado_completo_negativo, "2026-10");
  assert.equal(soPassado.saldo_acumulado_completo_ja_negativo_antes_do_mes_atual, true);

  // Com uma conta só em dezembro, o mês negativo continua sendo o atual, não dezembro.
  const comFuturo = buildCashflowMonths({
    today: TODAY,
    payables: [payable("x1", "paid", "2026-08-10", 100_000, { paidAt: "2026-08-10" }), payable("x2", "open", "2026-12-05", 5_000)],
  });
  assert.equal(comFuturo.primeiro_mes_com_saldo_acumulado_completo_negativo, "2026-10");

  // Caixa positivo até hoje que só vira em dezembro: aponta dezembro.
  const viraDepois = buildCashflowMonths({
    today: TODAY,
    receivables: [receivable("y1", "paid", "2026-08-10", 10_000, { paidAt: "2026-08-10", paidAmount: 10_000 })],
    payables: [payable("x2", "open", "2026-12-05", 50_000)],
  });
  assert.equal(viraDepois.primeiro_mes_com_saldo_acumulado_completo_negativo, "2026-12");
  assert.equal(viraDepois.saldo_acumulado_completo_ja_negativo_antes_do_mes_atual, false);
});

test("cronograma: físico previsto x realizado, atrasos e prazo projetado", () => {
  const activities = [
    activity("a1", "2026-09-01", "2026-09-30"),                               // deveria estar 100%, está 100%
    activity("a2", "2026-09-10", "2026-09-29", { service_id: "s1" }),         // deveria estar 100%, está 40% => atrasada
    activity("a3", "2026-10-05", "2026-10-14", { location_id: "l1" }),        // 5 de 10 dias => 50% previsto, 50% real
    activity("a4", "2026-10-20", "2026-10-29"),                               // começa em 11 dias
    activity("a5", "2026-12-01", "2026-12-10"),                               // futuro distante
    activity("a6", "2026-09-01", "2026-09-10", { record_status: "inactive" }),
  ];
  const measurements = [
    { activity_id: "a1", measurement_date: "2026-09-30", progress_percent: 100, current_start: "2026-09-01", current_finish: "2026-09-30", created_at: "1" },
    { activity_id: "a2", measurement_date: "2026-09-20", progress_percent: 20, current_start: "2026-09-10", current_finish: "2026-09-29", created_at: "1" },
    { activity_id: "a2", measurement_date: "2026-10-02", progress_percent: 40, current_start: "2026-09-10", current_finish: "2026-10-25", created_at: "2" },
    { activity_id: "a3", measurement_date: "2026-10-08", progress_percent: 50, current_start: "2026-10-05", current_finish: "2026-10-14", created_at: "1" },
    { activity_id: "a4", measurement_date: "2026-11-01", progress_percent: 90, current_start: "2026-10-20", current_finish: "2026-10-29", created_at: "1" }, // medição futura: ignorada
  ];

  const summary = summarizeSchedule({
    activities,
    measurements,
    serviceNames: new Map([["s1", "ALV · Alvenaria"]]),
    locationNames: new Map([["l1", "P05 · 5º pavimento"]]),
    today: TODAY,
  });

  // Sem pesos configurados nem custo, o peso segue a duração (mesma regra do
  // dashboard): a1 30 dias, a2 20, a3/a4/a5 10 cada => 37,5% · 25% · 12,5% x 3.
  assert.deepEqual(summary.atividades, { total: 5, concluidas: 1, em_andamento: 2, nao_iniciadas: 2, atrasadas: 1, iniciam_nos_proximos_30_dias: 1 });
  assert.equal(summary.fisico_geral.previsto_ate_hoje_pct, 68.75);
  assert.equal(summary.fisico_geral.realizado_pct, 53.75);
  assert.equal(summary.fisico_geral.diferenca_pontos_percentuais, -15);
  assert.equal(summary.fisico_geral.situacao, "atrasado em relação à linha de base");
  assert.equal(summary.ultima_medicao_de_avanco, "2026-10-08");
  assert.deepEqual(summary.prazo, { termino_linha_de_base: "2026-12-10", termino_projetado: "2026-12-10", desvio_de_prazo_dias: 0 });

  assert.equal(summary.atrasadas_mais_relevantes.length, 1);
  const late = summary.atrasadas_mais_relevantes[0];
  assert.equal(late.atividade, "A2 · Atividade a2");
  assert.equal(late.servico, "ALV · Alvenaria");
  assert.equal(late.avanco_real_pct, 40);
  assert.equal(late.avanco_previsto_hoje_pct, 100);
  assert.equal(late.termino_atual, "2026-10-25");
  assert.equal(late.dias_vencidos_sem_concluir, 10);
  assert.equal(late.peso_no_fisico_pct, 25);

  assert.deepEqual(summary.em_andamento_no_prazo.map((row) => row.local), ["P05 · 5º pavimento"]);
  assert.deepEqual(summary.proximas_a_iniciar.map((row) => row.atividade), ["A4 · Atividade a4"]);
  assert.ok(!JSON.stringify(summary).includes("planned_cost"), "o resumo do cronograma não leva valores em reais");
});

test("cronograma: prazo projetado além da linha de base e busca por texto", () => {
  const summary = summarizeSchedule({
    activities: [activity("b1", "2026-09-01", "2026-09-30"), activity("b2", "2026-09-01", "2026-10-31", { name: "Reboco externo" })],
    measurements: [{ activity_id: "b2", measurement_date: "2026-10-01", progress_percent: 10, current_start: "2026-09-01", current_finish: "2026-11-20", created_at: "1" }],
    today: TODAY,
    searchText: "reboco",
  });
  assert.equal(summary.prazo.desvio_de_prazo_dias, 20);
  assert.equal(summary.atividades.atrasadas, 2);
  assert.deepEqual(summary.atrasadas_mais_relevantes.map((row) => row.atividade), ["B2 · Reboco externo"]);
});

test("cronograma: sem medição lançada não afirma atraso", () => {
  const summary = summarizeSchedule({ activities: [activity("c1", "2026-12-01", "2026-12-31")], measurements: [], today: TODAY });
  assert.equal(summary.fisico_geral.situacao, "sem medição de avanço lançada");
  assert.equal(summary.ultima_medicao_de_avanco, null);
  assert.equal(summarizeSchedule({ today: TODAY }).atividades.total, 0);
});

test("datas auxiliares", () => {
  assert.equal(addDaysIso("2026-12-28", 7), "2027-01-04");
  assert.equal(addMonthsKey("2026-10", 3), "2027-01");
  assert.equal(addMonthsKey("2026-01", -1), "2025-12");
});
