// Read-only commercial analysis. The caller supplies the authenticated RLS client.
import { loadProjectForecast, type ProjectForecastContext } from "@/lib/forecast/server";
import { loadDevelopmentCosts } from "@/lib/development-costs/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type {
  DevelopmentBaselineMetrics, DevelopmentBaselineStudy, DevelopmentSale, DevelopmentUnit,
  DevelopmentReceivable, DevelopmentPayable,
} from "@/lib/commercial/development-result.mjs";
import { resolveElosIaProject, type ElosIaToolContext } from "./tools";
import type { ElosIaPersonaKey } from "./personas";
import {
  analyzeCommercialScenario, analyzeDevelopmentResult, effectiveAnnualDiscount, isCommercialIsoDate,
  type CommercialPaymentItem, type CommercialScenarioAnalysis,
} from "./commercial-analysis.mjs";

export type ElosIaCommercialToolName = "resultado_do_empreendimento" | "comparar_proposta_unidade";
type Args = Record<string, unknown>;
type Result = Record<string, unknown>;
type Definition = {
  name: ElosIaCommercialToolName;
  label: string;
  description: string;
  permissions: string[];
  properties: Record<string, Record<string, unknown>>;
  run: (context: ElosIaToolContext, args: Args) => Promise<Result>;
};

// Match the existing IA forecast/sales/receivables permissions as well as the
// result page's incorporation permission. Its aggregate view is not an escape
// hatch for a persona that cannot consult one of the underlying IA sources.
const RESULT_PERMISSIONS = [
  "commercial.incorporation.view", "projects.view", "sales.view", "receivables.view",
  "schedule.view", "budgets.view", "payables.view", "execution.contracts.view", "execution.measurements.view",
];

function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function positive(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function escapeLike(value: string) { return value.replace(/[\\%_]/g, "\\$&"); }
function isUuid(value: string) { return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value); }

function readFailed(error: { message: string } | null | undefined, source: string) {
  if (!error) return;
  console.error(`[elos-ia] Falha na consulta comercial (${source}):`, error.message);
  throw new Error(`Não foi possível consultar ${source}. Tente novamente; não calculei com uma lista parcial.`);
}

async function projectRows<T>(context: ElosIaToolContext, projectId: string, table: string, fields: string) {
  return fetchAllRows<T>(async (from, to) => {
    const result = await context.supabase.from(table).select(fields)
      .eq("company_id", context.companyId).eq("project_id", projectId).order("id").range(from, to);
    return { data: (result.data ?? []) as unknown as T[], error: result.error };
  });
}

function forecastFor(context: ElosIaToolContext, projectId: string) {
  const key = `forecast:${projectId}`;
  let forecast = context.cache.get(key) as Promise<ProjectForecastContext> | undefined;
  if (!forecast) {
    forecast = loadProjectForecast({ supabase: context.supabase, companyId: context.companyId, projectId, asOfDate: context.today });
    context.cache.set(key, forecast);
  }
  return forecast;
}

async function developmentResult(context: ElosIaToolContext, args: Args): Promise<Result> {
  const scope = resolveElosIaProject(context, args.obra, false);
  const projectId = scope.project!.id;
  const [project, profileResult, sales, units, receivables, payables, forecast, costs] = await Promise.all([
    context.supabase.from("projects").select("id,total_units").eq("company_id", context.companyId).eq("id", projectId).maybeSingle(),
    context.supabase.from("commercial_development_profiles").select("baseline_study_id,baseline_metrics,approved_at")
      .eq("company_id", context.companyId).eq("project_id", projectId).maybeSingle(),
    projectRows<DevelopmentSale>(context, projectId, "sales", "id,unit_id,total_amount,commission_pct,commission_amount,status,sale_date"),
    projectRows<DevelopmentUnit>(context, projectId, "units", "id,code,status,list_price"),
    projectRows<DevelopmentReceivable>(context, projectId, "receivables", "id,status,amount,adjusted_amount,paid_amount,due_date,paid_at"),
    projectRows<DevelopmentPayable>(context, projectId, "payables", "id,status,amount,paid_amount,due_date,paid_at"),
    forecastFor(context, projectId),
    loadDevelopmentCosts({ supabase: context.supabase, companyId: context.companyId, projectId }),
  ]);
  const profile = profileResult.data as { baseline_study_id: string; baseline_metrics: DevelopmentBaselineMetrics; approved_at: string } | null;
  const studyResult = profile?.baseline_study_id
    ? await context.supabase.from("commercial_feasibility_studies").select("id,name,commission_pct,tax_rate_pct")
      .eq("company_id", context.companyId).eq("converted_project_id", projectId).eq("id", profile.baseline_study_id).maybeSingle()
    : { data: null, error: null };
  const sourceErrors = [project.error?.message, profileResult.error?.message, sales.error?.message, units.error?.message,
    receivables.error?.message, payables.error?.message, studyResult.error?.message, ...forecast.errors, ...costs.errors]
    .filter(Boolean) as string[];
  if (!project.data && !project.error) sourceErrors.push("Empreendimento não encontrado no escopo da sessão.");
  if (sourceErrors.length) console.error("[elos-ia] Fontes incompletas do resultado econômico:", sourceErrors);
  const analysis = analyzeDevelopmentResult({
    baselineApproved: Boolean(profile?.baseline_study_id && profile.approved_at),
    sourceErrors,
    input: {
      baselineMetrics: profile?.baseline_metrics ?? {},
      baselineStudy: (studyResult.data ?? {}) as DevelopmentBaselineStudy,
      project: project.data ?? {}, sales: sales.data, units: units.data,
      receivables: receivables.data, payables: payables.data,
      forecast: forecast.forecast, developmentCosts: costs, today: context.today,
    },
  });
  return {
    obra: scope.label,
    data_de_referencia: context.today,
    ...analysis,
    fontes: ["Resultado do empreendimento", "Baseline econômico aprovado", "Vendas e unidades", "Previsão de custos da obra", "Centros de custo da incorporação", "Contas a pagar e a receber"],
    observacao: "Resultado econômico projetado: receita de vendas e estoque menos custo total projetado. Não equivale ao saldo de caixa. Os avisos indicam quais valores ainda usam referências do baseline.",
    ...(analysis.projecao_disponivel ? {} : { proximo_passo: "Revise o baseline aprovado, preços das unidades e cobertura dos custos na tela Comercial > Incorporação > Resultado do empreendimento." }),
  };
}

type Unit = { id: string; code: string; list_price: number | null; status: string };
type Proposal = { id: string; unit_id: string; number: string; version_no: number; proposed_amount: number; list_price: number; status: string; proposal_date: string; valid_until: string };
type PriceTable = { id: string; name: string; version_no: number; valid_from: string; valid_until: string | null };
type PriceItem = { list_price: number; cash_price: number | null };
type SuppliedScenario = { name: string; nominal: number | null; items: CommercialPaymentItem[] };

async function findUnit(context: ElosIaToolContext, projectId: string, requested: string): Promise<Unit> {
  let query = context.supabase.from("units").select("id,code,list_price,status")
    .eq("company_id", context.companyId).eq("project_id", projectId);
  query = isUuid(requested) ? query.eq("id", requested) : query.ilike("code", escapeLike(requested));
  const result = await query.limit(2);
  readFailed(result.error, "a unidade");
  const rows = (result.data ?? []) as Unit[];
  if (rows.length !== 1) throw new Error(rows.length ? "Mais de uma unidade corresponde ao código. Informe o identificador completo da unidade." : `Não encontrei a unidade "${requested}" nessa obra ou ela não está disponível para sua sessão.`);
  return rows[0];
}

async function findProposal(context: ElosIaToolContext, projectId: string, requested: string, version: unknown, unit: Unit | null): Promise<Proposal | null> {
  let query = context.supabase.from("commercial_proposals")
    .select("id,unit_id,number,version_no,proposed_amount,list_price,status,proposal_date,valid_until")
    .eq("company_id", context.companyId).eq("project_id", projectId);
  if (requested) query = isUuid(requested) ? query.eq("id", requested) : query.ilike("number", escapeLike(requested));
  else if (unit) query = query.eq("unit_id", unit.id).in("status", ["draft", "sent", "negotiation", "approved"]);
  else return null;
  if (version !== null && version !== undefined) {
    if (!Number.isInteger(version) || Number(version) < 1) throw new Error("A versão da proposta deve ser um inteiro positivo.");
    query = query.eq("version_no", Number(version));
  }
  query = query.order("version_no", { ascending: false }).order("proposal_date", { ascending: false }).order("id");
  // A short limit can hide a second proposal behind many revisions of the first.
  // Read the scoped unit's proposals before deciding it identifies one offer.
  const result = await fetchAllRows<Proposal>(async (from, to) => {
    const page = await query.range(from, to);
    return { data: (page.data ?? []) as Proposal[], error: page.error };
  });
  readFailed(result.error, "as propostas comerciais");
  const rows = result.data;
  if (!rows.length) {
    if (requested) throw new Error(`Não encontrei a proposta "${requested}" nessa obra e versão, ou ela não está disponível para sua sessão.`);
    return null;
  }
  const numbers = [...new Set(rows.map((row) => row.number))];
  if (numbers.length > 1) throw new Error(`Há mais de uma proposta para essa unidade (${numbers.slice(0, 8).join(", ")}${numbers.length > 8 ? ", …" : ""}). Informe qual delas devo comparar.`);
  const proposal = rows[0];
  if (unit && proposal.unit_id !== unit.id) throw new Error("A proposta selecionada pertence a outra unidade. Confirme o código da unidade ou o número da proposta.");
  return proposal;
}

function suppliedScenario(raw: unknown, defaultName: string): SuppliedScenario | null {
  if (raw === null || raw === undefined) return null;
  const value = record(raw);
  if (!value || !Array.isArray(value.parcelas) || value.parcelas.length > 30) throw new Error("As condições informadas precisam de até 30 grupos de parcelas.");
  if (value.valor_total !== null && value.valor_total !== undefined && positive(value.valor_total) === null) throw new Error("O valor total informado deve ser positivo.");
  const items = value.parcelas.map((rawItem): CommercialPaymentItem => {
    const item = record(rawItem);
    if (!item) throw new Error("Uma condição de pagamento está incompleta.");
    return {
      installment_count: item.quantidade as number,
      amount_per_installment: item.valor_parcela as number,
      first_due_date: string(item.primeiro_vencimento),
      interval_months: item.intervalo_meses as number,
    };
  });
  return { name: string(value.nome) || defaultName, nominal: positive(value.valor_total), items };
}

async function currentPriceTable(context: ElosIaToolContext, projectId: string, unitId: string, date: string) {
  // Price-table access is separate from proposal access. A proposal snapshot or
  // the unit's visible list price remains available without this permission.
  if (!context.can("commercial.incorporation.view")) return { table: null, item: null, warnings: [] as string[] };
  const historical = date < context.today;
  let query = context.supabase.from("commercial_price_tables")
    .select("id,name,version_no,valid_from,valid_until").eq("company_id", context.companyId).eq("project_id", projectId)
    .lte("valid_from", date).or(`valid_until.is.null,valid_until.gte.${date}`);
  query = historical ? query.in("status", ["active", "inactive", "archived"]) : query.eq("status", "active");
  const result = await query.order("valid_from", { ascending: false }).limit(2);
  readFailed(result.error, "a tabela de preços");
  const tables = (result.data ?? []) as PriceTable[];
  if (tables.length !== 1) return { table: null, item: null, warnings: [tables.length ? "Há mais de uma tabela candidata vigente nessa data; a comparação usa o preço registrado na unidade/proposta, sem escolher uma tabela arbitrariamente." : "Não encontrei tabela oficial vigente na data-base; a comparação nominal usa o preço registrado na unidade/proposta."] };
  const itemResult = await context.supabase.from("commercial_price_table_items").select("list_price,cash_price")
    .eq("company_id", context.companyId).eq("project_id", projectId).eq("price_table_id", tables[0].id).eq("unit_id", unitId).maybeSingle();
  readFailed(itemResult.error, "o preço da unidade na tabela");
  return { table: tables[0], item: itemResult.data as PriceItem | null, warnings: [] as string[] };
}

async function compareProposal(context: ElosIaToolContext, args: Args): Promise<Result> {
  const scope = resolveElosIaProject(context, args.obra, false);
  const projectId = scope.project!.id;
  const discountAnnualPct = effectiveAnnualDiscount(args.taxa_desconto_pct, args.base_taxa);
  const date = string(args.data_base) || null;
  if (date !== null && !isCommercialIsoDate(date)) throw new Error("Informe uma data-base válida no formato AAAA-MM-DD.");
  const explicitProposal = suppliedScenario(args.condicoes_proposta, "Proposta informada");
  const explicitTable = suppliedScenario(args.condicoes_tabela, "Tabela com condições informadas");
  const requestedUnit = string(args.unidade);
  const requestedProposal = string(args.proposta);
  if (!requestedUnit && !requestedProposal) return { obra: scope.label, dados_insuficientes: true, cenarios: [], avisos: ["Informe o código da unidade ou o número da proposta cadastrada para comparar valores e condições."] };
  let unit = requestedUnit ? await findUnit(context, projectId, requestedUnit) : null;
  const proposal = requestedProposal || !explicitProposal ? await findProposal(context, projectId, requestedProposal, args.versao, unit) : null;
  if (!unit && proposal) unit = await findUnit(context, projectId, proposal.unit_id);
  if (!unit) throw new Error("Não foi possível identificar uma unidade da obra para a comparação.");
  const price = await currentPriceTable(context, projectId, unit.id, date ?? context.today);
  const warnings = [...price.warnings];
  const assumptions = ["Comparação somente de leitura; não aprova a proposta nem altera preços ou condições.", "Margem por unidade indisponível: não há custo oficial unitário completo vinculado a esta consulta. Nenhum rateio de custo foi presumido."];
  const scenarios: CommercialScenarioAnalysis[] = [];
  const sources: string[] = [];
  const nominalPrice = positive(price.item?.list_price) ?? positive(unit.list_price) ?? positive(proposal?.list_price);
  const historicalUnconfirmed = date !== null && date < context.today && !price.item;
  if (explicitTable?.nominal !== null && explicitTable?.nominal !== undefined && nominalPrice !== null && Math.abs(explicitTable.nominal - nominalPrice) > 0.011) {
    const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    throw new Error(`O valor total informado para a tabela (${money(explicitTable.nominal)}) diverge do preço de referência cadastrado (${money(nominalPrice)}). Confirme qual preço/tabela devo usar; não substituí silenciosamente o valor informado nem calculei o VP.${historicalUnconfirmed ? " Como a data-base é histórica, identifique a tabela vigente naquela data." : ""}`);
  }
  if (nominalPrice !== null || explicitTable) {
    const label = price.item && price.table ? `${price.table.name} v${price.table.version_no}` : "Preço de tabela registrado";
    const tableScenario = analyzeCommercialScenario({
      label: `${explicitTable?.name ?? label}${historicalUnconfirmed ? " (histórico não confirmado)" : ""}`,
      nominalAmount: nominalPrice ?? explicitTable?.nominal,
      paymentItems: explicitTable?.items ?? [], discountAnnualPct, valuationDate: date,
    });
    if (historicalUnconfirmed) {
      tableScenario.presentValue = null;
      tableScenario.assumptions = [];
      const reference = positive(unit.list_price) !== null ? "o preço ATUAL cadastrado na unidade" : positive(proposal?.list_price) !== null ? "o preço registrado na proposta, sem confirmação para aquela data" : "o preço informado, sem referência histórica confirmada";
      warnings.push(`A data-base ${date} é histórica. Sem uma tabela oficial única vigente naquela data, a referência usa ${reference} somente para comparação nominal; não é um preço histórico confirmado. O VP dessa referência não foi publicado. Identifique a tabela histórica para calcular uma comparação em valor presente.`);
    }
    scenarios.push(tableScenario);
    sources.push(price.item && price.table ? `Tabela oficial ${price.table.name} v${price.table.version_no}, vigente de ${price.table.valid_from} a ${price.table.valid_until ?? "data não encerrada"}` : positive(unit.list_price) !== null ? `Preço de lista ATUAL da unidade ${unit.code}` : `Preço de tabela registrado na proposta ${proposal?.number}`);
    if (explicitTable) assumptions.push("Condições de pagamento da tabela informadas pelo usuário; o cronograma precisa fechar o preço nominal oficial quando cadastrado.");
    else warnings.push("O preço de tabela não contém calendário de parcelas. Informe as condições para comparar o seu valor presente.");
  } else warnings.push("Não há preço de tabela para essa unidade. Informe ou cadastre o preço e as condições da referência de comparação.");

  // A cash price is a separate official alternative, never an invented payment
  // schedule for the list price. It is due on the explicitly selected base date.
  if (!explicitTable && positive(price.item?.cash_price) !== null && date) {
    scenarios.push(analyzeCommercialScenario({ label: "Tabela à vista", nominalAmount: price.item!.cash_price,
      paymentItems: [{ installment_count: 1, amount_per_installment: price.item!.cash_price!, first_due_date: date, interval_months: 0 }], discountAnnualPct, valuationDate: date }));
    assumptions.push("Alternativa à vista usa o preço à vista oficial, com pagamento na data-base informada.");
  }
  if (explicitProposal) {
    scenarios.push(analyzeCommercialScenario({ label: explicitProposal.name, nominalAmount: explicitProposal.nominal,
      paymentItems: explicitProposal.items, discountAnnualPct, valuationDate: date }));
    sources.push("Condições de proposta explicitamente informadas nesta conversa");
  } else if (proposal) {
    const items = await fetchAllRows<CommercialPaymentItem>(async (from, to) => {
      const result = await context.supabase.from("commercial_proposal_payment_items")
        .select("id,installment_count,first_due_date,interval_months,amount_per_installment,total_amount,adjustment_index,interest_rate_monthly")
        .eq("company_id", context.companyId).eq("proposal_id", proposal.id).order("id").range(from, to);
      return { data: (result.data ?? []) as unknown as CommercialPaymentItem[], error: result.error };
    });
    readFailed(items.error, "as parcelas da proposta");
    scenarios.push(analyzeCommercialScenario({ label: `Proposta ${proposal.number} v${proposal.version_no}`, nominalAmount: proposal.proposed_amount,
      paymentItems: items.data, discountAnnualPct, valuationDate: date }));
    sources.push(`Proposta ${proposal.number} v${proposal.version_no} e parcelas cadastradas`);
    if (["rejected", "expired", "cancelled", "converted"].includes(proposal.status) || proposal.valid_until < context.today) warnings.push(`A proposta ${proposal.number} está em status "${proposal.status}" e tem validade até ${proposal.valid_until}. A comparação é histórica e não indica disponibilidade para aprovação.`);
  } else warnings.push("Não encontrei proposta ativa para essa unidade. Informe o número da proposta ou o valor, quantidade e vencimentos dos pagamentos que deseja simular.");

  for (const scenario of scenarios) {
    warnings.push(...scenario.warnings.map((warning) => `${scenario.label}: ${warning}`));
    assumptions.push(...scenario.assumptions);
  }
  if (args.base_taxa === "mensal" && discountAnnualPct !== null) assumptions.push(`Taxa efetiva mensal informada de ${Number(args.taxa_desconto_pct)}%, convertida por capitalização composta para ${discountAnnualPct.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}% efetivos ao ano.`);
  const validScenarios = scenarios.filter((scenario) => scenario.nominal !== null);
  const presentValueScenarios = validScenarios.filter((scenario) => scenario.presentValue !== null);
  const allPresentValuesAvailable = validScenarios.length >= 2 && presentValueScenarios.length === validScenarios.length;
  if (presentValueScenarios.length && !allPresentValuesAvailable) warnings.push(`Valor presente disponível somente para: ${presentValueScenarios.map((scenario) => scenario.label).join(", ")}. A comparação geral permanece nominal; não compare o VP de um cenário com o nominal de outro.`);
  return {
    obra: scope.label, unidade: unit.code, numero_proposta: proposal?.number ?? null,
    data_de_referencia: context.today, data_base: date, taxa_desconto_anual_pct: discountAnnualPct,
    premissas: [...new Set(assumptions)], fontes: sources,
    cenarios: validScenarios.map((scenario) => ({ nome: scenario.label, valor_nominal: scenario.nominal, valor_presente: scenario.presentValue, margem_pct: scenario.marginPct })),
    comparacao_valor_presente_disponivel: allPresentValuesAvailable,
    cenarios_com_valor_presente: presentValueScenarios.map((scenario) => scenario.label),
    dados_insuficientes: validScenarios.length < 2,
    avisos: [...new Set(warnings)],
  };
}

const nullableText = (description: string) => ({ type: ["string", "null"], description });
const scenarioProperty = (description: string) => ({
  type: ["object", "null"], description, additionalProperties: false,
  properties: {
    nome: nullableText("Nome curto para identificar as condições informadas."),
    valor_total: { type: ["number", "null"], description: "Valor nominal total explicitamente informado. Null permite somar um cronograma completo; não adivinhe o saldo." },
    parcelas: { type: "array", maxItems: 30, items: {
      type: "object", additionalProperties: false,
      properties: {
        quantidade: { type: "integer", minimum: 1, maximum: 240 },
        valor_parcela: { type: "number", exclusiveMinimum: 0 },
        primeiro_vencimento: { type: "string", description: "AAAA-MM-DD explicitamente informado ou definido sem ambiguidade pelo usuário." },
        intervalo_meses: { type: "integer", minimum: 0, maximum: 120 },
      }, required: ["quantidade", "valor_parcela", "primeiro_vencimento", "intervalo_meses"],
    } },
  }, required: ["nome", "valor_total", "parcelas"],
});

const DEFINITIONS: Definition[] = [
  {
    name: "resultado_do_empreendimento", label: "Lucro e resultado do empreendimento",
    description: "Consulta o lucro e a margem econômica projetados de UMA obra pelo motor oficial do Resultado do empreendimento: vendas e estoque menos engenharia, terreno/outros custos, comissões, impostos e distratos. Só publica a projeção quando há baseline aprovado com cobertura de custos e fontes completas. Respeite os avisos; não invente decomposição em pontos percentuais.",
    permissions: RESULT_PERMISSIONS,
    properties: { obra: nullableText("Nome ou código da obra; null usa a obra ativa. A consulta exige uma obra específica.") },
    run: developmentResult,
  },
  {
    name: "comparar_proposta_unidade", label: "Comparação de proposta da unidade",
    description: "Compara proposta oficial ou condições informadas com o preço da unidade/tabela. Calcule valor presente somente com taxa de desconto, base anual/mensal, data-base e cronograma de parcelas explicitamente definidos. Taxa mensal é efetiva e capitalizada. Nunca presuma SELIC, datas, número de parcelas, custo ou margem. Preços nominais sem calendário não permitem VP. Se faltar uma premissa, use null e explique/pergunte. Não altera propostas.",
    permissions: ["commercial.proposals.view", "projects.view"],
    properties: {
      obra: nullableText("Nome/código da obra; null usa a obra ativa."),
      unidade: nullableText("Código exato da unidade ou identificador; null quando a proposta identifica a unidade."),
      proposta: nullableText("Número exato ou identificador da proposta cadastrada. Null busca propostas ativas da unidade, sem escolher entre propostas distintas."),
      versao: { type: ["integer", "null"], minimum: 1, description: "Versão específica; null usa a versão mais recente do mesmo número de proposta." },
      taxa_desconto_pct: { type: ["number", "null"], minimum: 0, description: "Taxa efetiva de desconto explicitamente informada pelo usuário. Zero somente se ele pediu taxa zero. Null se não informada; nunca usar SELIC padrão." },
      base_taxa: { type: ["string", "null"], enum: ["anual", "mensal", null], description: "Base da taxa explicitamente informada." },
      data_base: nullableText("Data de avaliação explicitamente informada, AAAA-MM-DD. 'Hoje' pode usar a data atual do contexto. Null se não informada."),
      condicoes_proposta: scenarioProperty("Condições fixas explicitamente informadas pelo usuário; null usa a proposta cadastrada. Se houver correção/juros ou faltarem datas/quantidade, não invente parcelas: peça esclarecimento. Pode enviar parcelas vazias com valor_total para comparação apenas nominal."),
      condicoes_tabela: scenarioProperty("Cronograma fixo de tabela explicitamente informado; null usa só o preço oficial sem inventar prazo. Deve fechar o preço oficial quando houver. Se faltarem condições, peça ao usuário."),
    },
    run: compareProposal,
  },
];
const BY_NAME = new Map(DEFINITIONS.map((tool) => [tool.name, tool]));

export function elosIaCommercialToolsForPersona(persona: ElosIaPersonaKey): ElosIaCommercialToolName[] {
  return persona === "diretoria" || persona === "financeiro" ? DEFINITIONS.map((tool) => tool.name) : [];
}
export function isElosIaCommercialTool(name: string): name is ElosIaCommercialToolName { return BY_NAME.has(name as ElosIaCommercialToolName); }
export const isElosIaCommercialToolName = isElosIaCommercialTool;
export function elosIaCommercialToolLabel(name: string) { return BY_NAME.get(name as ElosIaCommercialToolName)?.label ?? name; }
export function elosIaCommercialToolPermissions(name: string): string[] { return [...(BY_NAME.get(name as ElosIaCommercialToolName)?.permissions ?? [])]; }
export function elosIaCommercialToolSchemas(names: ElosIaCommercialToolName[]) {
  return names.map((name) => BY_NAME.get(name)).filter((tool): tool is Definition => Boolean(tool)).map((tool) => ({
    type: "function" as const, name: tool.name, description: tool.description, strict: true,
    parameters: { type: "object", additionalProperties: false, properties: tool.properties, required: Object.keys(tool.properties) },
  }));
}
export const getElosIaCommercialTools = elosIaCommercialToolSchemas;
export async function runElosIaCommercialTool(context: ElosIaToolContext, allowed: ElosIaCommercialToolName[], name: string, args: Args): Promise<Result> {
  const tool = BY_NAME.get(name as ElosIaCommercialToolName);
  if (!tool || !allowed.includes(tool.name)) return { erro: `A consulta "${name}" não está disponível para esta persona.` };
  try {
    for (const permission of tool.permissions) if (!context.can(permission)) throw new Error(`Você não tem permissão para consultar esta fonte no Elos OS (${permission}).`);
    return await tool.run(context, args);
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Não foi possível concluir a análise comercial." };
  }
}
