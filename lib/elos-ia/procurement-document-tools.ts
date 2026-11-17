import type { ElosIaActionToolContext } from "./action-tools";
import type { ElosIaPersonaKey } from "./personas";
import { allocateSharedAmount, normalizeActionText } from "./action-utils.mjs";
import { createDocumentProposal } from "./document-action-shared";

// Documents only prepare immutable proposals. Execution belongs to the human
// confirmation endpoint and the official procurement/contract RPCs.
export type ProcurementDocumentToolName =
  | "consultar_contexto_documentos_operacionais"
  | "preparar_nova_cotacao_documento"
  | "preparar_contrato_empreiteiro_documento";
type Context = ElosIaActionToolContext;
type Args = Record<string, unknown>;
type Row = Record<string, unknown>;
type Definition = {
  name: ProcurementDocumentToolName; label: string; description: string;
  permissions: string[]; properties: Record<string, Record<string, unknown>>;
};

const QUOTATION_PERMISSION = "procurement.quotations.manage";
const CONTRACT_PERMISSION = "execution.contract_procurement.contract";
const MAX_ITEMS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const optional = (value: unknown) => text(value) || null;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const label = (row: { code: string | null; name: string }) => [row.code, row.name].filter(Boolean).join(" · ");
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const strictObject = (properties: Record<string, Record<string, unknown>>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

function requiredText(value: unknown, field: string) {
  const result = text(value);
  if (!result || result.length > 4000) throw new Error(`Informe ${field} de forma explícita no documento ou na conversa.`);
  return result;
}
function number(value: unknown, field: string, min = 0, max = 1e12) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Revise ${field}: o valor precisa estar entre ${min} e ${max}.`);
  }
  return value;
}
function decimal(value: unknown, field: string, places: number, min = 0, max = 1e12) {
  const result = number(value, field, min, max);
  if (Number(result.toFixed(places)) !== result) throw new Error(`${field} aceita até ${places} casas decimais. Confirme o valor antes de preparar.`);
  return result;
}
function optionalDecimal(value: unknown, field: string, places: number, max = 1e12) {
  return value == null ? 0 : decimal(value, field, places, 0, max);
}
function quotationSubtotal(quantity: number, price: number, discount: number, tax: number) {
  // Match PostgreSQL numeric's half-up cent rounding, including half-cent prices.
  const scaled = (value: number, places: number) => BigInt(value.toFixed(places).replace(".", ""));
  const percentBase = BigInt(1000000), denominator = BigInt("10000000000000000000000");
  const numerator = scaled(quantity, 6) * scaled(price, 6) * (percentBase - scaled(discount, 4)) * (percentBase + scaled(tax, 4));
  const cents = Number((numerator + denominator / BigInt(2)) / denominator);
  if (!Number.isSafeInteger(cents)) throw new Error("O valor do item ultrapassa o limite de cálculo seguro. Revise o documento no módulo de Suprimentos.");
  return cents / 100;
}
function integer(value: unknown, field: string, fallback: number | null = null) {
  if (value == null) return fallback;
  const result = number(value, field, 0, 3650);
  if (!Number.isInteger(result)) throw new Error(`${field} precisa ser um número inteiro.`);
  return result;
}
function date(value: unknown, field: string, required = false) {
  const result = text(value);
  if (!result && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`Informe ${field} com uma data válida no formato AAAA-MM-DD.`);
  }
  return result;
}
function project(context: Context, value: unknown) {
  const requested = text(value);
  if (!requested) {
    const active = context.projects.find(row => row.id === context.activeProjectId);
    if (active) return active;
    if (context.projects.length === 1) return context.projects[0];
    throw new Error("Selecione a obra ou informe seu código para preparar o documento.");
  }
  const matches = context.projects.filter(row => [row.id, row.code, row.name, label(row)].some(key => normalizeActionText(key) === normalizeActionText(requested)));
  if (matches.length !== 1) throw new Error("Não há uma única obra com essa identificação. Informe o código exato da obra.");
  return matches[0];
}
function sourceFile(context: Context, value: unknown) {
  const requested = text(value);
  if (!requested) {
    if (!context.attachmentNames.length) throw new Error("Anexe o documento de origem nesta pergunta para preparar o cadastro.");
    if (context.attachmentNames.length > 1) throw new Error("Informe qual dos anexos é a origem deste cadastro.");
    return context.attachmentNames[0];
  }
  if (!context.attachmentNames.includes(requested)) throw new Error("O arquivo de origem não pertence aos anexos desta pergunta. Envie-o novamente.");
  return requested;
}
function searchTerm(value: unknown) { return text(value).replace(/[%,()._]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100); }
function assertItems(rows: Row[]) {
  if (!rows.length || rows.length > MAX_ITEMS) throw new Error(`O documento deve conter de 1 a ${MAX_ITEMS} itens. Divida documentos maiores em partes revisáveis.`);
}

async function supplier(context: Context, value: unknown) {
  const id = requiredText(value, "o ID do fornecedor localizado na consulta");
  if (!UUID.test(id)) throw new Error("Consulte os fornecedores e use o ID retornado. Não crie fornecedor nem escolha apenas por semelhança de nome.");
  const response = await context.supabase.from("suppliers").select("id,legal_name,trade_name,tax_id,status,updated_at")
    .eq("company_id", context.companyId).eq("id", id).eq("status", "active").maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error("Fornecedor não encontrado ou inativo nesta empresa. Cadastre/confira o fornecedor antes de preparar o documento.");
  return response.data as Row;
}
async function materialRequest(context: Context, projectId: string, reference: unknown) {
  const requested = requiredText(reference, "a solicitação de materiais aprovada");
  let query = context.supabase.from("execution_material_requests").select("id,request_number,needed_date,requester_name,notes,status,updated_at")
    .eq("company_id", context.companyId).eq("project_id", projectId).in("status", ["approved", "partially_ordered"]);
  query = UUID.test(requested) ? query.eq("id", requested) : query.eq("request_number", requested);
  const response = await query.maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error("Não encontrei essa solicitação aprovada com saldo. A cotação depende da solicitação aprovada da Engenharia; informe seu número ou conclua essa etapa na tela de solicitações.");
  const items = await context.supabase.from("execution_material_request_items")
    .select("id,input_id,input_code,input_name,unit_snapshot,cost_center_code,cost_center_name,requested_quantity,ordered_quantity,stock_fulfilled_quantity,updated_at")
    .eq("company_id", context.companyId).eq("project_id", projectId).eq("request_id", response.data.id).order("id").limit(MAX_ITEMS + 1);
  if (items.error) throw new Error(items.error.message);
  if ((items.data?.length ?? 0) > MAX_ITEMS) throw new Error("A solicitação tem mais de 100 itens. Divida a operação na tela de Suprimentos para revisar todos os vínculos.");
  return { request: response.data as Row, items: (items.data ?? []) as Row[] };
}
async function competition(context: Context, projectId: string, reference: unknown) {
  const requested = requiredText(reference, "o mapa de concorrência aprovado");
  let query = context.supabase.from("execution_service_competitions")
    .select("id,competition_number,title,request_id,status,winner_offer_id,winner_supplier_id,generated_contract_id,updated_at")
    .eq("company_id", context.companyId).eq("project_id", projectId).eq("status", "approved");
  query = UUID.test(requested) ? query.eq("id", requested) : query.eq("competition_number", requested);
  const response = await query.maybeSingle();
  if (response.error) throw new Error(response.error.message);
  const map = response.data as Row | null;
  if (!map || !map.winner_offer_id) throw new Error("Informe um mapa de concorrência aprovado com vencedor. O contrato deve seguir Solicitação de Serviços → Concorrência → Aprovação; a IA não cria nem aprova essas etapas silenciosamente.");
  if (map.generated_contract_id) throw new Error("Esse mapa já gerou um contrato. Abra o contrato existente; não crie uma segunda contratação para o mesmo documento.");
  const [offerResponse, itemsResponse, requestItemsResponse] = await Promise.all([
    context.supabase.from("execution_service_competition_offers").select("id,supplier_id,status,total_amount,payment_days,updated_at")
      .eq("company_id", context.companyId).eq("project_id", projectId).eq("competition_id", map.id).eq("id", map.winner_offer_id).eq("status", "winner").maybeSingle(),
    context.supabase.from("execution_service_competition_offer_items").select("id,request_item_id,offered_quantity,unit_price,total_amount,meets_specification")
      .eq("company_id", context.companyId).eq("project_id", projectId).eq("offer_id", map.winner_offer_id).order("sort_order").limit(MAX_ITEMS + 1),
    context.supabase.from("execution_service_request_items").select("id,service_id,service_code,service_name,location_name,unit_snapshot,scope_notes,measurement_notes")
      .eq("company_id", context.companyId).eq("project_id", projectId).eq("request_id", map.request_id).order("sort_order").limit(MAX_ITEMS + 1),
  ]);
  if (offerResponse.error || itemsResponse.error || requestItemsResponse.error) throw new Error(offerResponse.error?.message || itemsResponse.error?.message || requestItemsResponse.error?.message || "Não foi possível conferir o mapa.");
  if (!offerResponse.data) throw new Error("A proposta vencedora não está disponível para conferência.");
  if ((itemsResponse.data?.length ?? 0) > MAX_ITEMS || (requestItemsResponse.data?.length ?? 0) > MAX_ITEMS) throw new Error("O contrato ultrapassa 100 itens; revise-o pelo módulo de contratação.");
  const requests = new Map((requestItemsResponse.data ?? []).map(row => [row.id, row]));
  const items = (itemsResponse.data ?? []).map(row => ({ ...row, request: requests.get(row.request_item_id) }));
  if (!items.length || items.some(row => !row.request) || items.length !== requests.size) throw new Error("Os itens da proposta e da solicitação não coincidem. Revise a concorrência antes de preparar o contrato.");
  return { competition: map, offer: offerResponse.data as Row, items: items as Row[] };
}

async function lookup(context: Context, args: Args) {
  const selected = project(context, args.obra);
  const isMaterials = args.tipo === "materiais";
  if (!isMaterials && args.tipo !== "servicos") throw new Error("Escolha materiais ou serviços.");
  if (!context.can(isMaterials ? QUOTATION_PERMISSION : CONTRACT_PERMISSION)) throw new Error("Seu papel não permite preparar esse tipo de documento.");
  const supplierSearch = searchTerm(args.fornecedor);
  let supplierQuery = context.supabase.from("suppliers").select("id,legal_name,trade_name,tax_id")
    .eq("company_id", context.companyId).eq("status", "active").order("legal_name").limit(26);
  if (supplierSearch) supplierQuery = supplierQuery.or(`legal_name.ilike.%${supplierSearch}%,trade_name.ilike.%${supplierSearch}%,tax_id.ilike.%${supplierSearch}%`);
  const supplierResponse = await supplierQuery;
  if (supplierResponse.error) throw new Error(supplierResponse.error.message);
  const common = { obra: label(selected), fornecedores: (supplierResponse.data ?? []).slice(0, 25), mais_fornecedores: (supplierResponse.data?.length ?? 0) > 25 };
  if (text(args.referencia)) {
    if (isMaterials) {
      const data = await materialRequest(context, selected.id, args.referencia);
      return { ...common, solicitacao: data.request, itens: data.items.map(row => ({ ...row, saldo: Number(row.requested_quantity) - Number(row.ordered_quantity) - Number(row.stock_fulfilled_quantity ?? 0) })), instrucao: "Vincule cada item do documento ao ID e unidade da solicitação. Não converta unidades nem crie materiais automaticamente." };
    }
    const data = await competition(context, selected.id, args.referencia);
    return { ...common, concorrencia: data.competition, proposta_vencedora: data.offer, itens: data.items, instrucao: "Fornecedor, itens, unidades, quantidades e preços do documento devem coincidir com a proposta aprovada. Etapas de medição precisam estar explícitas ou ser confirmadas pelo usuário." };
  }
  const term = searchTerm(args.buscar);
  let query = isMaterials
    ? context.supabase.from("execution_material_requests").select("id,request_number,needed_date,requester_name,notes,status").eq("company_id", context.companyId).eq("project_id", selected.id).in("status", ["approved", "partially_ordered"]).order("created_at", { ascending: false }).limit(26)
    : context.supabase.from("execution_service_competitions").select("id,competition_number,title,winner_supplier_id").eq("company_id", context.companyId).eq("project_id", selected.id).eq("status", "approved").is("generated_contract_id", null).order("created_at", { ascending: false }).limit(26);
  if (term) query = query.or(`${isMaterials ? "request_number" : "competition_number"}.ilike.%${term}%,${isMaterials ? "notes" : "title"}.ilike.%${term}%`);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return { ...common, origens: (result.data ?? []).slice(0, 25), mais_origens: (result.data?.length ?? 0) > 25, instrucao: "Escolha a origem correspondente e consulte novamente com referencia para obter os IDs dos itens. Se houver dúvida, pergunte ao usuário; se a origem não existir, conclua primeiro o fluxo oficial." };
}

async function createProposal(context: Context, input: { projectId: string; actionType: "procurement_quotation_create" | "execution_contract_create"; title: string; summary: string; payload: Row; preview: Row; sourceFile: string; documentKey: string }) {
  const response = await createDocumentProposal(context, input);
  return { acao_preparada: true, action_id: response.id, titulo: response.title, resumo: response.summary, instrucao: "Nada foi lançado no módulo. Mostre o cartão e peça revisão; somente o botão de confirmação executa exatamente os efeitos exibidos." };
}

async function prepareQuotation(context: Context, args: Args) {
  const selected = project(context, args.obra);
  const [{ request, items: requestItems }, selectedSupplier] = await Promise.all([
    materialRequest(context, selected.id, args.solicitacao), supplier(context, args.fornecedor_id),
  ]);
  const rows = array(args.itens); assertItems(rows);
  const responseDeadline = date(args.prazo_resposta, "o prazo de resposta da cotação", true)!;
  if (responseDeadline < context.today) throw new Error("A nova cotação exige prazo de resposta atual/futuro. Não transforme documento antigo em data nova; use a implantação histórica na tela se necessário.");
  const awardMode = text(args.modo_fechamento);
  if (!["item", "lot"].includes(awardMode)) throw new Error("Informe fechamento por item (item) ou lote (lot).");
  const seen = new Set<string>();
  const prepared = rows.map((row, index) => {
    const item = requestItems.find(candidate => candidate.id === row.item_solicitacao_id);
    if (!item || seen.has(text(item.id))) throw new Error(`O item ${index + 1} não pertence à solicitação ou está repetido. Use o ID retornado na consulta.`);
    seen.add(text(item.id));
    if (normalizeActionText(row.unidade) !== normalizeActionText(item.unit_snapshot)) throw new Error(`A unidade do documento para ${item.input_code} difere da solicitação. Confirme a conversão no cadastro antes de importar.`);
    const quantity = decimal(row.quantidade, `a quantidade do item ${index + 1}`, 6, 0.000001);
    const remaining = Number((Number(item.requested_quantity) - Number(item.ordered_quantity) - Number(item.stock_fulfilled_quantity ?? 0)).toFixed(6));
    if (quantity > remaining + 0.000001) throw new Error(`A quantidade de ${item.input_code} supera o saldo disponível (${remaining} ${item.unit_snapshot}).`);
    const unitPrice = decimal(row.preco_unitario, `o preço do item ${index + 1}`, 6, 0.000001);
    const discount = optionalDecimal(row.desconto_percentual, "o desconto percentual", 4, 100);
    const tax = optionalDecimal(row.imposto_percentual, "o imposto acrescido", 4, 100);
    return { request_item_id: item.id, input_id: item.input_id, code: item.input_code, name: item.input_name, unit: item.unit_snapshot,
      costCenter: `${item.cost_center_code} · ${item.cost_center_name}`, expected_updated_at: item.updated_at, expected_remaining_quantity: remaining,
      quantity_to_quote: quantity, quantity_offered: quantity, unit_price: unitPrice, discount_percent: discount, tax_percent: tax,
      brand: optional(row.marca), manufacturer: optional(row.fabricante), delivery_days: integer(row.prazo_entrega_dias, "o prazo de entrega"),
      meets_specification: row.atende_especificacao === true, technical_notes: optional(row.observacoes_tecnicas),
      specificationConfirmed: row.atende_especificacao != null, subtotal: quotationSubtotal(quantity, unitPrice, discount, tax) };
  });
  const freightTotal = optionalDecimal(args.frete_total, "o frete", 2);
  const otherTotal = optionalDecimal(args.outros_custos_total, "os outros custos", 2);
  const freight = allocateSharedAmount(freightTotal, prepared.map(row => row.subtotal));
  const other = allocateSharedAmount(otherTotal, prepared.map(row => row.subtotal));
  const items = prepared.map((row, index) => ({ ...row, freight_amount: freight[index], other_cost_amount: other[index], total: money(row.subtotal + freight[index] + other[index]) }));
  const total = money(items.reduce((sum, row) => sum + row.total, 0));
  const documentTotal = args.valor_total_documento == null ? null : decimal(args.valor_total_documento, "o total do documento", 2, 0.01);
  if (documentTotal != null && documentTotal !== total) throw new Error("A soma dos itens, frete, impostos e descontos não coincide com o total do documento. Confira a divergência antes de preparar a cotação.");
  const source = sourceFile(context, args.arquivo_origem);
  const payload = { requestId: request.id, requestNumber: request.request_number, requestUpdatedAt: request.updated_at,
    supplierId: selectedSupplier.id, supplierUpdatedAt: selectedSupplier.updated_at,
    title: requiredText(args.titulo, "o título da cotação"), awardMode, responseDeadline,
    desiredDeliveryDate: date(args.entrega_desejada, "a entrega desejada"), paymentTerms: optional(args.condicao_pagamento), deliveryAddress: optional(args.endereco_entrega), notes: optional(args.observacoes),
    proposalNumber: optional(args.numero_proposta), proposalDate: date(args.data_proposta, "a data da proposta"), validityDate: date(args.validade, "a validade da proposta"),
    deliveryDays: integer(args.prazo_entrega_dias, "o prazo de entrega"), freightTerms: optional(args.condicao_frete), warrantyTerms: optional(args.garantia),
    documentTotal, freightTotal, otherTotal, total, items };
  const preview = { kind: "procurement_quotation_create", blocked: false, module: "Orçamentos de Materiais", project: { id: selected.id, label: label(selected) },
    sourceFile: source, title: payload.title, request: { id: request.id, number: request.request_number }, supplier: { id: selectedSupplier.id, name: selectedSupplier.trade_name || selectedSupplier.legal_name, taxId: selectedSupplier.tax_id },
    awardMode, responseDeadline, desiredDeliveryDate: payload.desiredDeliveryDate, paymentTerms: payload.paymentTerms,
    proposalNumber: payload.proposalNumber, proposalDate: payload.proposalDate, validityDate: payload.validityDate, deliveryAddress: payload.deliveryAddress,
    deliveryDays: payload.deliveryDays, freightTerms: payload.freightTerms, warrantyTerms: payload.warrantyTerms, notes: payload.notes,
    items: items.map(row => ({ code: row.code, name: row.name, unit: row.unit, costCenter: row.costCenter, quantity: row.quantity_offered, unitPrice: row.unit_price, discountPercent: row.discount_percent, taxPercent: row.tax_percent, freight: row.freight_amount, otherCost: row.other_cost_amount, brand: row.brand, manufacturer: row.manufacturer, deliveryDays: row.delivery_days, meetsSpecification: row.meets_specification, specificationConfirmed: row.specificationConfirmed, technicalNotes: row.technical_notes, total: row.total })), freightTotal, otherTotal, total,
    effects: ["Criar uma cotação vinculada à solicitação aprovada.", "Abrir a cotação para coleta e registrar esta proposta de fornecedor.", "Manter a escolha de vencedor, pedido de compra e financeiro no fluxo de aprovação."],
    warnings: [payload.documentTotal == null ? "Total do documento não informado; confira o total calculado." : null, items.some(row => !row.specificationConfirmed) ? "Há itens sem comprovação de atendimento à especificação; eles ficam sem aceite técnico." : null].filter(Boolean) };
  return createProposal(context, { projectId: selected.id, actionType: "procurement_quotation_create", title: `Nova cotação · ${payload.title}`, summary: `${items.length} item(ns) · ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, payload, preview, sourceFile: source,
    documentKey: `${selectedSupplier.id}:${items.map(row => row.request_item_id).sort().join(",")}` });
}

async function prepareContract(context: Context, args: Args) {
  const selected = project(context, args.obra);
  const [{ competition: map, offer, items: offerItems }, selectedSupplier] = await Promise.all([
    competition(context, selected.id, args.concorrencia), supplier(context, args.fornecedor_id),
  ]);
  if (offer.supplier_id !== selectedSupplier.id || map.winner_supplier_id !== selectedSupplier.id) throw new Error("O fornecedor do documento não é o vencedor aprovado. Revise a concorrência; a IA não troca o contratado.");
  const rows = array(args.itens); assertItems(rows);
  if (rows.length !== offerItems.length) throw new Error("O documento deve conferir todos os serviços da proposta vencedora; há itens ausentes ou adicionais.");
  const seen = new Set<string>();
  const items = rows.map((row, index) => {
    const offered = offerItems.find(candidate => candidate.request_item_id === row.item_solicitacao_id);
    const requestItem = object(offered?.request);
    if (!offered || seen.has(text(offered.request_item_id))) throw new Error(`O serviço ${index + 1} não pertence ao mapa ou está repetido.`);
    seen.add(text(offered.request_item_id));
    if (normalizeActionText(row.unidade) !== normalizeActionText(requestItem.unit_snapshot)) throw new Error(`Unidade divergente no serviço ${requestItem.service_code}. Não converta automaticamente.`);
    const quantity = number(row.quantidade, "a quantidade contratada", 0.000001);
    const unitPrice = number(row.preco_unitario, "o preço contratado", 0.000001);
    if (quantity !== Number(offered.offered_quantity) || unitPrice !== Number(offered.unit_price)) throw new Error(`Quantidade/preço do serviço ${requestItem.service_code} diverge da proposta aprovada. Corrija a origem antes de gerar o contrato.`);
    if (offered.meets_specification !== true) throw new Error(`O serviço ${requestItem.service_code} não possui aceite técnico na proposta aprovada.`);
    const rawStages = array(row.etapas);
    if (!rawStages.length || rawStages.length > 20) throw new Error(`Defina de 1 a 20 etapas explícitas de medição para ${requestItem.service_code}. Não presuma uma etapa de 100%.`);
    const stages = rawStages.map((stage, stageIndex) => {
      const mode = text(stage.modo_medicao);
      if (!["quantity", "percent"].includes(mode)) throw new Error("O modo de medição deve ser quantity ou percent.");
      return { code: `ET-${String(stageIndex + 1).padStart(2, "0")}`, name: requiredText(stage.nome, "o nome da etapa de medição"), description: optional(stage.descricao), measurement_mode: mode, weight_percent: decimal(stage.peso_percentual, "o peso da etapa", 4, 0.0001, 100) };
    });
    if (Math.abs(stages.reduce((sum, stage) => sum + stage.weight_percent, 0) - 100) > 0.001) throw new Error(`As etapas de ${requestItem.service_code} devem somar 100%.`);
    return { request_item_id: offered.request_item_id, offer_item_id: offered.id, service_id: requestItem.service_id, code: requestItem.service_code, name: requestItem.service_name, location: requestItem.location_name,
      scopeNotes: requestItem.scope_notes, measurementNotes: requestItem.measurement_notes, unit: requestItem.unit_snapshot, quantity, unit_price: unitPrice, total: Number(offered.total_amount), stages };
  });
  const total = money(items.reduce((sum, row) => sum + row.total, 0));
  if (decimal(args.valor_total_documento, "o valor total do contrato", 2, 0.01) !== total || total !== Number(offer.total_amount)) throw new Error("O valor total do contrato não coincide com os itens e a proposta vencedora aprovada.");
  const startDate = date(args.inicio, "o início do contrato", true)!;
  const endDate = date(args.fim, "o fim do contrato", true)!;
  if (endDate < startDate) throw new Error("O fim do contrato não pode anteceder o início.");
  const retentionPercent = decimal(args.retencao_percentual, "a retenção contratual (zero somente se confirmado)", 4, 0, 100);
  const guaranteePercent = decimal(args.garantia_percentual, "a retenção de garantia (zero somente se confirmado)", 4, 0, 100);
  if (retentionPercent + guaranteePercent > 100) throw new Error("As retenções do contrato não podem superar 100%.");
  const paymentDays = integer(args.prazo_pagamento_dias, "o prazo de pagamento");
  if (paymentDays === null) throw new Error("Confirme o prazo de pagamento após a medição; não presuma o prazo padrão do sistema.");
  const guaranteeMonths = integer(args.garantia_meses, "os meses de garantia");
  if (guaranteeMonths === null) throw new Error("Confirme os meses de garantia do contrato; use zero somente quando confirmado.");
  if (paymentDays > 365 || guaranteeMonths > 240) throw new Error("O cadastro aceita prazo de pagamento de até 365 dias e garantia de até 240 meses.");
  const source = sourceFile(context, args.arquivo_origem);
  const payload = { competitionId: map.id, competitionNumber: map.competition_number, competitionUpdatedAt: map.updated_at,
    winnerOfferId: offer.id, offerUpdatedAt: offer.updated_at, supplierId: selectedSupplier.id, supplierUpdatedAt: selectedSupplier.updated_at,
    title: requiredText(args.titulo, "o título do contrato"), scopeSummary: requiredText(args.escopo, "o escopo do contrato"),
    startDate, endDate, signedDate: date(args.assinatura, "a assinatura"), retentionPercent, guaranteePercent,
    guaranteeMonths, paymentDays,
    adjustmentIndex: optional(args.indice_reajuste), adjustmentBaseDate: date(args.data_base_reajuste, "a data-base do reajuste"),
    contactName: optional(args.contato_nome), contactPhone: optional(args.contato_telefone), contactEmail: optional(args.contato_email), notes: optional(args.observacoes), total, items };
  const preview = { kind: "execution_contract_create", blocked: false, module: "Contratos e Medições", project: { id: selected.id, label: label(selected) }, sourceFile: source,
    title: payload.title, scopeSummary: payload.scopeSummary, competition: { id: map.id, number: map.competition_number, title: map.title },
    supplier: { id: selectedSupplier.id, name: selectedSupplier.trade_name || selectedSupplier.legal_name, taxId: selectedSupplier.tax_id },
    startDate, endDate, signedDate: payload.signedDate, retentionPercent, guaranteePercent, guaranteeMonths: payload.guaranteeMonths, paymentDays,
    adjustmentIndex: payload.adjustmentIndex, adjustmentBaseDate: payload.adjustmentBaseDate, contactName: payload.contactName, contactPhone: payload.contactPhone, contactEmail: payload.contactEmail, notes: payload.notes,
    items: items.map(row => ({ code: row.code, name: row.name, location: row.location, scopeNotes: row.scopeNotes, measurementNotes: row.measurementNotes, unit: row.unit, quantity: row.quantity, unitPrice: row.unit_price, total: row.total, stages: row.stages.map(stage => ({ name: stage.name, description: stage.description, measurementMode: stage.measurement_mode, weightPercent: stage.weight_percent })) })), total,
    effects: ["Criar contrato em elaboração a partir do mapa de concorrência já aprovado.", "Registrar escopo, condições e etapas de medição exibidas.", "Ativação, medições, aprovação e financeiro continuam nas etapas próprias."], warnings: [] };
  return createProposal(context, { projectId: selected.id, actionType: "execution_contract_create", title: `Contrato de empreiteiro · ${payload.title}`, summary: `${items.length} serviço(s) · ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · em elaboração`, payload, preview, sourceFile: source, documentKey: text(map.id) });
}

const quoteItem = strictObject({ item_solicitacao_id: { type: "string", description: "ID exato retornado pela consulta da solicitação aprovada." }, unidade: { type: "string" }, quantidade: { type: "number" }, preco_unitario: { type: "number" }, desconto_percentual: nullableNumber, imposto_percentual: nullableNumber, marca: nullableText, fabricante: nullableText, prazo_entrega_dias: nullableInteger, atende_especificacao: { type: ["boolean", "null"] }, observacoes_tecnicas: nullableText });
const stage = strictObject({ nome: { type: "string" }, descricao: nullableText, modo_medicao: { type: "string", enum: ["quantity", "percent"] }, peso_percentual: { type: "number" } });
const contractItem = strictObject({ item_solicitacao_id: { type: "string", description: "ID de request_item_id da proposta vencedora." }, unidade: { type: "string" }, quantidade: { type: "number" }, preco_unitario: { type: "number" }, etapas: { type: "array", minItems: 1, maxItems: 20, items: stage } });
const DEFINITIONS: Definition[] = [
  { name: "consultar_contexto_documentos_operacionais", label: "Conferir origem do documento", permissions: [],
    description: "Consulta fornecedores e origens aprovadas para documentos de materiais/empreiteiros. Use antes de preparar. Retorna até 25 origens; filtre a busca se necessário. Com referencia, retorna os IDs dos itens. Não escreve nem aprova nada.",
    properties: { obra: nullableText, tipo: { type: "string", enum: ["materiais", "servicos"] }, buscar: nullableText, referencia: { ...nullableText, description: "ID/número exato da solicitação ou mapa retornado, para detalhar itens." }, fornecedor: { ...nullableText, description: "Nome/trecho do nome ou CPF/CNPJ a localizar; null lista primeiros 25 ativos." } } },
  { name: "preparar_nova_cotacao_documento", label: "Preparar nova cotação pelo documento", permissions: [QUOTATION_PERMISSION],
    description: "Prepara cartão de nova cotação + proposta do fornecedor, SOMENTE vinculada a solicitação de materiais aprovada. Não executa. Use fornecedor e IDs de itens consultados; pergunte por dados ausentes. Unidades devem coincidir; não invente conversões. Prazo de resposta e modo de fechamento devem ser definidos pelo usuário. Quantidades, preços e condições vêm do documento. Cotação existente usa preparar_cotacao_fornecedor.",
    properties: { obra: nullableText, solicitacao: { type: "string" }, fornecedor_id: { type: "string" }, arquivo_origem: nullableText, titulo: { type: "string" }, modo_fechamento: { type: "string", enum: ["item", "lot"] }, prazo_resposta: { type: "string" }, entrega_desejada: nullableText, numero_proposta: nullableText, data_proposta: nullableText, validade: nullableText, condicao_pagamento: nullableText, endereco_entrega: nullableText, prazo_entrega_dias: nullableInteger, condicao_frete: nullableText, garantia: nullableText, observacoes: nullableText, frete_total: nullableNumber, outros_custos_total: nullableNumber, valor_total_documento: nullableNumber, itens: { type: "array", minItems: 1, maxItems: MAX_ITEMS, items: quoteItem } } },
  { name: "preparar_contrato_empreiteiro_documento", label: "Preparar contrato de empreiteiro", permissions: [CONTRACT_PERMISSION],
    description: "Prepara cartão de contrato em elaboração a partir de concorrência já aprovada com vencedor. Não executa, ativa nem gera contas a pagar. Documento deve conferir fornecedor, serviços, unidades, quantidades e preços aprovados. Etapas/pesos e condições contratuais precisam estar explícitos no documento ou confirmados pelo usuário; não presuma 100%, retenção zero ou prazo padrão. Sem mapa aprovado, oriente o fluxo oficial e não o contorne.",
    properties: { obra: nullableText, concorrencia: { type: "string" }, fornecedor_id: { type: "string" }, arquivo_origem: nullableText, titulo: { type: "string" }, escopo: { type: "string" }, inicio: { type: "string" }, fim: { type: "string" }, assinatura: nullableText, retencao_percentual: { type: "number" }, garantia_percentual: { type: "number" }, garantia_meses: { type: "integer" }, prazo_pagamento_dias: { type: "integer" }, indice_reajuste: nullableText, data_base_reajuste: nullableText, contato_nome: nullableText, contato_telefone: nullableText, contato_email: nullableText, observacoes: nullableText, valor_total_documento: { type: "number" }, itens: { type: "array", minItems: 1, maxItems: MAX_ITEMS, items: contractItem } } },
];
const BY_NAME = new Map(DEFINITIONS.map(definition => [definition.name, definition]));
export function procurementDocumentToolsForPersona(persona: ElosIaPersonaKey): ProcurementDocumentToolName[] {
  if (persona === "clientes") return [];
  return persona === "financeiro" ? ["consultar_contexto_documentos_operacionais", "preparar_nova_cotacao_documento"] : DEFINITIONS.map(row => row.name);
}
export function procurementDocumentToolPermissions(name: ProcurementDocumentToolName) { return BY_NAME.get(name)?.permissions ?? []; }
export function procurementDocumentToolLabel(name: string) { return BY_NAME.get(name as ProcurementDocumentToolName)?.label ?? name; }
export function isProcurementDocumentTool(name: string): name is ProcurementDocumentToolName { return BY_NAME.has(name as ProcurementDocumentToolName); }
export function procurementDocumentToolSchemas(names: ProcurementDocumentToolName[]) {
  return names.map(name => BY_NAME.get(name)).filter((row): row is Definition => Boolean(row)).map(row => ({ type: "function" as const, name: row.name, description: row.description, strict: true, parameters: strictObject(row.properties) }));
}
export async function runProcurementDocumentTool(context: Context, allowed: ProcurementDocumentToolName[], name: string, args: Args) {
  const definition = BY_NAME.get(name as ProcurementDocumentToolName);
  if (!definition || !allowed.includes(definition.name)) return { erro: "Esta ferramenta não está disponível para a persona atual." };
  if (!definition.permissions.every(permission => context.can(permission))) return { erro: "Seu papel não possui permissão para preparar esse cadastro." };
  try {
    if (definition.name === "consultar_contexto_documentos_operacionais") return await lookup(context, args);
    if (definition.name === "preparar_nova_cotacao_documento") return await prepareQuotation(context, args);
    return await prepareContract(context, args);
  } catch (error) { return { erro: error instanceof Error ? error.message : "Não foi possível preparar o documento para revisão." }; }
}
