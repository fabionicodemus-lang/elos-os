import assert from "node:assert/strict";
import test from "node:test";
import { buildElosIaVisuals, sanitizeElosIaVisuals, ELOS_IA_MAX_VISUALS, ELOS_IA_MAX_VISUAL_POINTS } from "./visuals.mjs";
import { buildCashflowMonths, summarizeSchedule } from "./summaries.mjs";
import { buildDashboardPhysicalMonths } from "../dashboard-physical-curve.mjs";
import { runAgentTurn } from "./agent-loop.mjs";

const TODAY = "2026-11-10";
const PROJECT = "HOM-001 · Residencial Aurora";
const observation = (name, result, sequence = 0, args = {}) => ({ name, result, sequence, args });
const build = (observations, question) => buildElosIaVisuals({ observations, today: TODAY, generatedAt: "2026-11-10T14:00:00.000Z", question });
const COST = {
  obra: PROJECT, data_de_referencia: TODAY, orcamento_usado: "ORC-1 · Baseline (versão 2)",
  totais: { orcamento: 100, realizado_pago: 20, comprometido_em_contas_a_pagar_abertas: 30, comprometido_em_contratos_ainda_nao_faturados: 10, a_comprometer: 40, custo_projetado_final: 100, estouro_sobre_o_orcamento: 0 },
  avisos_do_motor: { exemplos: ["Custo sem serviço cadastrado."] },
};
function cash(monthsBack = 0, monthsAhead = 1, engineeringIncluded = true) {
  return {
    obra: PROJECT,
    projecao_da_engenharia: engineeringIncluded ? "incluída" : "não incluída: sem linha de base com orçamento",
    ...buildCashflowMonths({
      today: TODAY, monthsBack, monthsAhead,
      payables: [
        { id: "p1", status: "paid", paidAt: "2026-10-15", dueDate: "2026-10-15", amount: 30, paidAmount: 30 },
        { id: "p2", status: "open", dueDate: "2026-11-20", amount: 50 },
        { id: "p3", status: "open", dueDate: "2026-12-20", amount: 80 },
        { id: "p4", status: "open", dueDate: "2027-01-20", amount: 700 },
      ],
      receivables: [
        { id: "r1", status: "paid", paidAt: "2026-10-10", dueDate: "2026-10-10", amount: 100, paidAmount: 100 },
        { id: "r2", status: "open", dueDate: "2026-11-20", amount: 10 },
        { id: "r3", status: "open", dueDate: "2026-12-20", amount: 15 },
      ],
      engineeringMonths: engineeringIncluded ? [{ key: "2026-11", engineeringProjected: 5 }, { key: "2026-12", engineeringProjected: 10 }] : [],
    }),
  };
}
function schedule(measurements = [{ activity_id: "a", measurement_date: TODAY, progress_percent: 40 }]) {
  const input = {
    activities: [{ id: "a", service_id: "s", code: "01", name: "Estrutura", record_status: "active", planned_start: "2026-10-01", planned_finish: "2026-12-31", planned_cost: 100 }],
    measurements,
    serviceWeights: [{ service_id: "s", physical_weight_percent: 100 }],
    today: TODAY,
  };
  return { obra: PROJECT, linha_de_base: "CRO-1 · Baseline aprovada", ...summarizeSchedule(input), curva_fisica: buildDashboardPhysicalMonths(input) };
}

test("composição usa os valores oficiais e reconcilia falta desembolsar com o custo final", () => {
  const [visual] = build([observation("custos_e_orcamento", COST)]);
  assert.equal(visual.type, "cost-composition");
  assert.deepEqual(visual.segments.map((row) => row.value), [20, 30, 10, 40]);
  assert.equal(visual.remaining, 80);
  assert.equal(visual.projected, visual.segments.reduce((sum, row) => sum + row.value, 0));
  assert.equal(visual.projectLabel, PROJECT);
  assert.equal(visual.asOfDate, TODAY);
  assert.equal(visual.generatedAt, "2026-11-10T14:00:00.000Z");
  assert.match(visual.sourceLabel, /versão 2/);
  assert.deepEqual(visual.warnings, COST.avisos_do_motor.exemplos);
  assert.match(visual.notes[0], /Não é apenas/);
});

test("faltas, falhas, permissões e números inconsistentes não viram gráficos de custo com zeros", () => {
  const cases = [
    { ...COST, erro: "Sem permissão" }, { ...COST, indisponivel: "Não autorizado" },
    { obra: PROJECT, aviso: "Sem previsão", orcamento_considerado: { custo_direto_total: 100 } },
    { ...COST, totais: { ...COST.totais, a_comprometer: null } },
    { ...COST, totais: { ...COST.totais, custo_projetado_final: 1000 } },
    { ...COST, totais: { ...COST.totais, a_comprometer: Infinity } },
    { ...COST, totais: { ...COST.totais, a_comprometer: "40" } },
  ];
  for (const value of cases) assert.deepEqual(build([observation("custos_e_orcamento", value)]), []);
  assert.deepEqual(build([observation("ferramenta_inventada", COST)]), []);
  assert.deepEqual(buildElosIaVisuals({ observations: [], today: "2026-02-31" }), []);
});

test("fluxo usa meses da janela e saldo acumulado completo, sem confundir totais globais/bancários", () => {
  const source = cash();
  const [visual] = build([observation("fluxo_de_caixa", source)]);
  assert.equal(visual.type, "cashflow");
  assert.deepEqual(visual.points.map((row) => row.key), ["2026-11", "2026-12"]);
  assert.deepEqual(visual.points.map((row) => row.cumulative), [25, -50]);
  assert.equal(visual.engineeringIncluded, true);
  assert.equal(visual.metrics.find((row) => row.label === "Entradas no período").value, 25);
  assert.equal(visual.metrics.find((row) => row.label === "Saídas no período").value, 145);
  assert.equal(visual.metrics.find((row) => row.label.startsWith("Menor saldo")).value, -50);
  assert.notEqual(visual.points.at(-1).cumulative, source.totais_de_toda_a_obra.saldo_projetado_completo);
  assert.match(visual.notes.join(" "), /não representa saldo bancário/);
});

test("fluxo sem engenharia usa saldo simples e mantém aviso explícito", () => {
  const [visual] = build([observation("fluxo_de_caixa", cash(0, 1, false))]);
  assert.equal(visual.engineeringIncluded, false);
  assert.deepEqual(visual.points.map((row) => row.cumulative), [30, -35]);
  assert.match(visual.warnings[0], /não incluída/);
  const incomplete = cash(); delete incomplete.meses[0].a_pagar;
  assert.deepEqual(build([observation("fluxo_de_caixa", incomplete)]), []);
});

test("dedup preserva recortes diferentes e não mistura empresas/obras", () => {
  const values = build([
    observation("fluxo_de_caixa", cash(0, 0), 0),
    observation("fluxo_de_caixa", cash(0, 1), 1),
    observation("fluxo_de_caixa", { ...cash(0, 1), obra: "HOM-002 · Outra obra" }, 2),
    observation("fluxo_de_caixa", cash(0, 0), 3),
  ]);
  assert.equal(values.length, 3);
  assert.equal(new Set(values.map((row) => row.id)).size, 3);
  assert.deepEqual(values.map((row) => [row.projectLabel, row.points.length]), [[PROJECT, 2], ["HOM-002 · Outra obra", 2], [PROJECT, 1]]);
});

test("cronograma compartilha pesos reais, não inventa futuro nem transforma ausência de medição em zero", () => {
  const data = schedule();
  const [visual] = build([observation("cronograma_fisico", data)]);
  assert.equal(visual.type, "schedule");
  assert.deepEqual(visual.points.filter((row) => row.key !== TODAY).map((row) => row.planned), data.curva_fisica.map((row) => row.planned));
  assert.equal(visual.points.find((row) => row.key === TODAY).actual, 40);
  assert.equal(visual.points.find((row) => row.key === TODAY).planned, data.fisico_geral.previsto_ate_hoje_pct);
  assert.equal(visual.points.find((row) => row.key === "2026-11-30").actual, null);
  assert.equal(visual.points.find((row) => row.key === "2026-12-31").actual, null);
  assert.ok(visual.points.every((row) => row.projected === null));
  const [empty] = build([observation("cronograma_fisico", schedule([]))]);
  assert.ok(empty.points.every((row) => row.actual === null));
  assert.equal(empty.metrics.find((row) => row.label === "Realizado registrado").value, null);
  assert.match(empty.warnings.join(" "), /não há medição/);
});

test("filtros de listas não fingem reduzir os totais/gráficos da obra; séries longas são omitidas", () => {
  const [cost] = build([observation("custos_e_orcamento", { ...COST, filtro_de_servico: "alvenaria" })]);
  assert.match(cost.notes.join(" "), /obra inteira.*alvenaria/);
  const [physical] = build([observation("cronograma_fisico", { ...schedule(), filtro_de_texto: "estrutura" })]);
  assert.match(physical.notes.join(" "), /obra inteira.*estrutura/);
  const source = schedule();
  source.curva_fisica = Array.from({ length: 73 }, (_, index) => ({ key: `${2020 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`, planned: index, actual: null }));
  assert.deepEqual(build([observation("cronograma_fisico", source)]), []);
});

test("resumo reutiliza blocos autorizados completos e preserva avisos e fontes dos custos", () => {
  const input = { obra: { nome: "Residencial Aurora", codigo: "HOM-001" }, data_de_hoje: TODAY, custos_x_orcamento: { ...COST.totais, orcamento_usado: COST.orcamento_usado, linha_de_base: "CRO-1 · Baseline aprovada", avisos_do_motor: COST.avisos_do_motor }, fisico_e_prazo: schedule(), fluxo_de_caixa: { indisponivel: "sem acesso", ...cash() } };
  const visuals = build([observation("resumo_da_obra", input)]);
  assert.deepEqual(visuals.map((row) => row.type), ["cost-composition", "schedule"]);
  assert.ok(visuals.every((row) => row.projectLabel === PROJECT));
  assert.deepEqual(visuals[0].warnings, COST.avisos_do_motor.exemplos);
  assert.match(visuals[0].sourceLabel, /ORC-1.*versão 2.*CRO-1/);
});

const RESULT = {
  obra: PROJECT, data_de_referencia: TODAY, baseline_disponivel: true, projecao_disponivel: true,
  resultado: {
    commercial: { projectedVgv: 200 },
    cost: { engineeringProjected: 100, projectedCommission: 10, projectedTaxes: 5, projectedOtherCost: 30, projectedCancellations: 15 },
    result: { projectedProfit: 40, projectedMarginPct: 20 }, baseline: { marginPct: 25 }, warnings: ["Premissa do motor preservada."],
  }, avisos: [],
};
test("waterfall reconcilia lucro oficial e não inventa causas/valores do baseline ausente", () => {
  const [visual] = build([observation("resultado_do_empreendimento", RESULT)]);
  assert.equal(visual.type, "result-waterfall");
  assert.equal(visual.steps[0].value + visual.steps.slice(1, -1).reduce((sum, row) => sum + row.value, 0), visual.steps.at(-1).value);
  assert.equal(visual.steps.at(-1).value, 40);
  const [withoutBaseline] = build([observation("resultado_do_empreendimento", { ...RESULT, baseline_disponivel: false })]);
  assert.ok(!withoutBaseline.metrics.some((row) => /viabilidade/i.test(row.label)));
  assert.deepEqual(build([observation("resultado_do_empreendimento", { ...RESULT, projecao_disponivel: false })]), []);
  const loss = structuredClone(RESULT); loss.resultado.cost.engineeringProjected = 200; loss.resultado.result = { projectedProfit: -60, projectedMarginPct: -30 };
  const [negative] = build([observation("resultado_do_empreendimento", loss)]);
  assert.equal(negative.steps.at(-1).value, -60);
});

function proposal(rate = null) {
  return { obra: PROJECT, unidade: "1201", data_de_referencia: TODAY, data_base: TODAY, taxa_desconto_anual_pct: rate, premissas: ["Fluxos sem correção."], avisos: [], cenarios: [{ nome: "Tabela", valor_nominal: 100, valor_presente: rate === null ? null : 90, margem_pct: null }, { nome: "Proposta", valor_nominal: 90, valor_presente: rate === null ? null : 80, margem_pct: null }] };
}
test("proposta mantém VPL/margem indisponíveis; taxas/cenários distintos não são deduplicados", () => {
  const [visual] = build([observation("comparar_proposta_unidade", proposal())]);
  assert.equal(visual.type, "proposal-comparison");
  assert.ok(visual.scenarios.every((row) => row.presentValue === null && row.marginPct === null));
  assert.match(visual.title, /nominal/);
  assert.match(visual.title, /1201/);
  const different = build([observation("comparar_proposta_unidade", proposal(10), 0), observation("comparar_proposta_unidade", proposal(20), 1)]);
  assert.equal(different.length, 2);
  assert.notEqual(different[0].id, different[1].id);
  const fabricated = proposal(); fabricated.cenarios[0].valor_presente = 88;
  assert.deepEqual(build([observation("comparar_proposta_unidade", fabricated)]), []);
});

test("proposta sem data-base preserva null e não pode apresentar valor presente", () => {
  const input = { ...proposal(), data_base: null };
  const [visual] = build([observation("comparar_proposta_unidade", input)]);
  assert.equal(visual.valuationDate, null);
  assert.equal(visual.periodLabel, "Data-base não informada");
  assert.equal(sanitizeElosIaVisuals([visual])[0].valuationDate, null);
  assert.deepEqual(build([observation("comparar_proposta_unidade", { ...proposal(10), data_base: null })]), []);
  assert.deepEqual(sanitizeElosIaVisuals([{ ...visual, discountAnnualPct: 10, scenarios: visual.scenarios.map((row) => ({ ...row, presentValue: row.nominal })) }]), []);
});

test("sanitizer protege cache/HTTP: allowlist, limites, números finitos, reconciliação e texto sem execução", () => {
  const [cost] = build([observation("custos_e_orcamento", COST)]);
  const [safe] = sanitizeElosIaVisuals([{ ...cost, html: "<script>unsafe()</script>", title: "<script>unsafe()</script>" }]);
  assert.equal(safe.html, undefined);
  assert.equal(safe.title, "<script>unsafe()</script>", "texto será escapado pelo React, nunca executado");
  assert.deepEqual(sanitizeElosIaVisuals([{ ...cost, projected: NaN }]), []);
  assert.deepEqual(sanitizeElosIaVisuals([{ ...cost, remaining: 0 }]), []);
  assert.deepEqual(sanitizeElosIaVisuals([{ ...cost, segments: cost.segments.slice(1) }]), []);
  assert.deepEqual(sanitizeElosIaVisuals([{ ...cost, type: "script" }]), []);
  assert.equal(sanitizeElosIaVisuals(Array.from({ length: 10 }, (_, index) => ({ ...cost, id: `${index}` }))).length, ELOS_IA_MAX_VISUALS);
  const [cashflow] = build([observation("fluxo_de_caixa", cash())]);
  assert.deepEqual(sanitizeElosIaVisuals([{ ...cashflow, points: Array.from({ length: ELOS_IA_MAX_VISUAL_POINTS + 1 }, () => cashflow.points[0]) }]), []);
});

test("ferramenta cuja saída estoura orçamento global não fornece evidência visual elegível", async () => {
  const observations = [];
  let sequence = 0;
  let modelCalls = 0;
  const turn = await runAgentTurn({
    question: "Como estão os custos?", maxToolOutputCharsPerTurn: 100,
    callModel: async () => ++modelCalls === 1 ? {
      status: "completed", output: [{ type: "function_call", name: "custos_e_orcamento", call_id: "1", arguments: "{}" }],
    } : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "A consulta excedeu o limite." }] }] },
    runTool: async (name, args) => {
      observations.push({ sequence: sequence++, name, args, result: COST });
      return COST;
    },
  });
  assert.equal(turn.toolTrace[0].ok, false);
  const eligible = observations.filter((item) => turn.toolTrace[item.sequence]?.ok && turn.toolTrace[item.sequence].name === item.name);
  assert.deepEqual(build(eligible), []);
});

function fullSummary(physical = schedule()) {
  return { obra: PROJECT, data_de_hoje: TODAY, custos_x_orcamento: COST.totais, fisico_e_prazo: physical, fluxo_de_caixa: cash() };
}

test("troca de custo para prazo na mesma conversa seleciona somente a evidência do tema atual", async () => {
  async function answer(question, history = [], summary = fullSummary()) {
    const observations = [];
    let calls = 0;
    const turn = await runAgentTurn({
      question, history,
      callModel: async () => ++calls === 1 ? {
        status: "completed", output: [{ type: "function_call", name: "resumo_da_obra", call_id: "summary", arguments: "{}" }],
      } : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: question.includes("prazo") || question.includes("atrasar") ? "O avanço físico registrado é de 40%; o término cadastrado é 31/12/2026." : "Falta desembolsar R$ 80,00." }] }] },
      runTool: async (name, args) => {
        observations.push({ sequence: observations.length, name, args, result: summary });
        return summary;
      },
    });
    const eligible = observations.filter((item) => turn.toolTrace[item.sequence]?.ok && turn.toolTrace[item.sequence].name === item.name);
    return { text: turn.text, visuals: build(eligible, question) };
  }
  const first = await answer("Quanto falta desembolsar?");
  assert.deepEqual(first.visuals.map((visual) => visual.type), ["cost-composition"]);
  const costHistory = [{ role: "user", content: "Quanto falta desembolsar?" }, { role: "assistant", content: first.text }];
  const next = await answer("a obra vai atrasar?", costHistory);
  assert.match(next.text, /avanço físico/);
  assert.deepEqual(next.visuals.map((visual) => visual.type), ["schedule"]);
  assert.equal(next.visuals[0].points.find((point) => point.key === TODAY).actual, 40);
  assert.deepEqual((await answer("e o prazo?", costHistory)).visuals.map((visual) => visual.type), ["schedule"]);
  assert.deepEqual((await answer("a obra vai atrasar?", costHistory, fullSummary({ ...schedule(), curva_fisica: [] }))).visuals, []);
  const scheduleHistory = [{ role: "user", content: "a obra vai atrasar?" }, { role: "assistant", content: next.text }];
  assert.deepEqual((await answer("E quanto falta desembolsar?", scheduleHistory)).visuals.map((visual) => visual.type), ["cost-composition"]);
});

test("foco é aplicado antes do limite, preserva geral/multitema e distingue prazo financeiro e proposta", () => {
  const summary = observation("resumo_da_obra", fullSummary());
  const all = [summary, observation("resultado_do_empreendimento", RESULT, 1), observation("comparar_proposta_unidade", proposal(), 2)];
  const cases = [
    ["A obra vai atrasar?", ["schedule"]], ["E o prazo?", ["schedule"]],
    ["Quando entregamos as chaves?", ["schedule"]], ["Resumo do cronograma", ["schedule"]],
    ["Quando vou receber as chaves?", ["schedule"]], ["Em quantos dias a obra acaba?", ["schedule"]],
    ["Quanto ainda falta pagar nessa obra?", ["cost-composition"]], ["Qual o custo da obra?", ["cost-composition"]],
    ["Qual o custo do acabamento da obra?", ["cost-composition"]],
    ["Quanto ainda falta pagar nessa obra até o fim do mês?", ["cashflow"]],
    ["Quanto preciso até o fim do mês?", ["cashflow"]], ["Resumo do caixa", ["cashflow"]],
    ["Prazo dos recebimentos nos próximos 6 meses", ["cashflow"]], ["Tem boleto atrasado?", ["cashflow"]],
    ["Quais clientes estão em atraso?", ["cashflow"]], ["Quanto tenho de contas a pagar vencidas?", ["cashflow"]],
    ["Qual prazo de pagamento da proposta?", ["proposal-comparison"]],
    ["Qual o custo dessa proposta para o cliente?", ["proposal-comparison"]],
    ["Qual o custo e prazo da proposta da unidade 1201?", ["proposal-comparison"]],
    ["Qual a margem dessa proposta?", ["proposal-comparison"]],
    ["Compare a proposta com 20% de entrada e o saldo em 60 parcelas", ["proposal-comparison"]],
    ["Compare a proposta e o fluxo de caixa", ["cashflow", "proposal-comparison"]],
    ["Vale a pena vender a unidade 1201 com parcelas até as chaves?", ["proposal-comparison"]],
    ["Quanto vou lucrar nessa obra?", ["result-waterfall"]], ["Qual a margem do empreendimento?", ["result-waterfall"]],
    ["Prazo e caixa", ["schedule", "cashflow"]], ["Custo, prazo e lucro", ["cost-composition", "schedule", "result-waterfall"]],
    ["Não quero os custos, só o prazo da obra.", ["schedule"]], ["E o prazo, sem repetir o custo?", ["schedule"]],
    ["Me dê uma visão geral do caixa", ["cashflow"]],
  ];
  for (const [question, expected] of cases) assert.deepEqual(build(all, question).map((visual) => visual.type), expected, question);
  for (const question of [undefined, "Como está a obra?", "Me dê um panorama geral"]) {
    assert.deepEqual(build([summary], question).map((visual) => visual.type), ["cost-composition", "schedule", "cashflow"]);
  }
  assert.deepEqual(build([observation("custos_e_orcamento", COST)], "E o prazo?"), []);
});

test("tema específico sem gráfico suportado não reaproveita gráficos de outras consultas", () => {
  const summary = observation("resumo_da_obra", fullSummary());
  const costOnly = observation("custos_e_orcamento", COST);
  const unsupported = [
    "quanto de valor $ tenho em estoque?",
    "qual o saldo do estoque?",
    "tem material em estoque?",
    "qual o valor dos materiais armazenados?",
    "quais itens estão no almoxarifado?",
    "qual o saldo de concreto no estoque?",
  ];
  for (const question of unsupported) {
    assert.deepEqual(build([summary], question), [], question);
    assert.deepEqual(build([costOnly], question), [], question);
  }
});

test("somente perguntas realmente gerais liberam o conjunto de gráficos do resumo", () => {
  const summary = observation("resumo_da_obra", fullSummary());
  for (const question of [
    undefined,
    "Como está a obra?",
    "Como anda o empreendimento?",
    "Me dê um panorama geral",
    "Quero uma visão geral da obra",
    "Qual o status geral?",
    "Faça um giro de obra",
  ]) {
    assert.deepEqual(build([summary], question).map((visual) => visual.type), ["cost-composition", "schedule", "cashflow"], String(question));
  }
});
