import type { ElosIaActionToolContext } from "./action-tools";
import type { ElosIaPersonaKey } from "./personas";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { normalizeActionText } from "./action-utils.mjs";
import { createDocumentProposal } from "./document-action-shared";
import { normalizeCommercialDocumentInput, normalizeCommercialTaxId } from "./commercial-document-utils.mjs";

export type CommercialDocumentToolName = "preparar_venda_documento";
type Context = ElosIaActionToolContext;
type Args = Record<string, unknown>;
const NAME: CommercialDocumentToolName = "preparar_venda_documento";
const PERMISSIONS = ["commercial.proposals.manage", "commercial.proposals.approve", "commercial.proposals.convert", "sales.manage", "receivables.manage"];
const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const object = (properties: Record<string, Record<string, unknown>>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const CLIENT = object({
  nome: { type: "string" }, tipo_pessoa: { type: "string", enum: ["PF", "PJ"] },
  cpf_cnpj: { type: "string", description: "CPF/CNPJ expresso no documento. Nunca invente. O cadastro existente será localizado pelo documento fiscal." },
  documento_identidade: nullableText, data_nascimento: { ...nullableText, description: "AAAA-MM-DD ou null." },
  estado_civil: nullableText, profissao: nullableText, email: nullableText, telefone: nullableText,
  telefone_secundario: nullableText, endereco: nullableText, cep: nullableText, cidade: nullableText, estado: nullableText, nacionalidade: nullableText,
});
const PAYMENT = object({
  categoria: { type: "string", enum: ["entry", "monthly", "reinforcement", "keys", "post_keys", "other"] },
  descricao: { type: "string" }, quantidade: { type: "integer", minimum: 1, maximum: 240 },
  primeiro_vencimento: { type: "string", description: "AAAA-MM-DD explícito. Nunca substitua entrega/chaves por uma data estimada." },
  intervalo_meses: { type: "integer", minimum: 0, maximum: 120, description: "0 para parcela única; 1 mensal; 12 anual. Datas irregulares: uma série de uma parcela por data." },
  valor_parcela: { type: "number", description: "Valor nominal de cada parcela, com até duas casas decimais." },
  indice_correcao: { ...nullableText, description: "Código do índice cadastrado e expresso no contrato, por exemplo CUB-SC. Null somente se a condição não tiver correção." },
  juros_mensais: { ...nullableNumber, description: "Percentual mensal, por exemplo 0.59. Juros maiores que zero serão mostrados como impedimento, pois não são aplicados automaticamente neste fluxo." },
  forma_pagamento: { ...nullableText, description: "PIX, transferência, boleto etc. Preserve o que o contrato diz; não presuma boleto. Será preservado nas observações do título." },
  observacoes: nullableText,
});
const PROPERTIES: Record<string, Record<string, unknown>> = {
  obra: { ...nullableText, description: "Código/nome exato da obra. Null usa a obra ativa." },
  unidade: { type: "string", description: "Código exato da unidade cadastrada, por exemplo 1901." },
  arquivo_origem: { type: "string", description: "Nome exato do contrato anexado nesta pergunta." },
  moeda: { type: "string", enum: ["BRL"] }, data_venda: { type: "string", description: "AAAA-MM-DD da celebração da venda." },
  numero_contrato: { type: "string", description: "Número/identificação literal do contrato. Pergunte se ausente." },
  valor_total: { type: "number" }, cliente: CLIENT, condicoes_pagamento: { type: "array", minItems: 1, maxItems: 24, items: PAYMENT },
  comissao_percentual: nullableNumber, corretor: nullableText,
  inicio_correcao_meses: { type: ["integer", "null"], description: "Início contratual da correção em meses após a venda, 0 a 60. Não use o padrão de quatro meses sem confirmação." },
  tem_permuta: { type: "boolean" }, tem_multiplos_compradores: { type: "boolean" },
  tem_vencimento_por_evento: { type: "boolean" }, tem_troca_indice_por_evento: { type: "boolean" },
  tem_pagamento_ja_realizado: { type: "boolean", description: "True se o contrato declara entrada ou outra parcela já recebida; não dar baixa nem tratar pagamento histórico como título novo." },
  regras_financeiras_completas: { type: "boolean", description: "True somente se todas as condições financeiras relevantes forem legíveis e estiverem representadas. False bloqueia execução." },
  clausulas_pendentes: { type: "array", maxItems: 30, items: { type: "string" }, description: "Cláusulas, dados ilegíveis ou condições que não couberem nos campos. Preserve-as; não omita para conseguir gerar a venda." },
  observacoes: nullableText,
};

function project(context: Context, value: unknown) {
  const requested = text(value);
  if (!requested) {
    const active = context.projects.find(row => row.id === context.activeProjectId);
    if (active) return active;
    if (context.projects.length === 1) return context.projects[0];
    throw new Error("Selecione a obra ou informe seu código para preparar a venda.");
  }
  const matches = context.projects.filter(row => [row.id, row.code, row.name, [row.code, row.name].filter(Boolean).join(" · ")].some(key => normalizeActionText(key) === normalizeActionText(requested)));
  if (matches.length !== 1) throw new Error("A obra não foi identificada de forma única. Informe o código exato.");
  return matches[0];
}

async function prepare(context: Context, args: Args) {
  const selectedProject = project(context, args.obra);
  const sourceFile = text(args.arquivo_origem);
  if (!sourceFile || !context.attachmentNames.includes(sourceFile)) throw new Error("Anexe o contrato nesta pergunta e identifique seu nome exato.");
  const draft = normalizeCommercialDocumentInput(args, context.today);
  const unitCode = text(args.unidade);
  if (!unitCode || unitCode.length > 100) throw new Error("Informe o código da unidade.");
  if (!context.can("clients.view") && !context.can("clients.manage")) throw new Error("Seu papel não permite conferir o cadastro de clientes.");
  const unitResponse = await context.supabase.from("units").select("id,code,tower,status,list_price,updated_at")
    .eq("company_id", context.companyId).eq("project_id", selectedProject.id).eq("code", unitCode).maybeSingle();
  if (unitResponse.error) throw new Error(unitResponse.error.message);
  const unit = unitResponse.data;
  if (!unit) throw new Error("A unidade não pertence à obra selecionada ou o código está incorreto.");
  if (unit.status !== "available") throw new Error("A unidade não está disponível. Revise a reserva/venda existente antes de importar outro contrato.");
  type Client = { id: string; name: string; tax_id: string | null; person_type: string; status: string; updated_at: string };
  const clients = await fetchAllRows<Client>(async (from, to) => {
    const result = await context.supabase.from("clients").select("id,name,tax_id,person_type,status,updated_at")
      .eq("company_id", context.companyId).order("id").range(from, to);
    return { data: (result.data ?? []) as Client[], error: result.error };
  });
  if (clients.error) throw new Error("Não foi possível conferir clientes existentes. Nada foi preparado.");
  const matched = clients.data.filter(row => normalizeCommercialTaxId(row.tax_id) === draft.clientData.taxId);
  if (matched.length > 1) throw new Error("Mais de um cliente possui esse CPF/CNPJ. Resolva a duplicidade no cadastro antes de importar.");
  const client = matched[0] ?? null;
  if (client?.status === "inactive") throw new Error("O cliente identificado está inativo. Confira o cadastro antes de continuar.");
  if (client && client.person_type !== draft.clientData.personType) throw new Error("O tipo de pessoa no documento diverge do cadastro existente.");
  if (!client && !context.can("clients.manage")) throw new Error("O cliente ainda não existe e seu papel não permite preparar seu cadastro.");
  const competing = await fetchAllRows<{ id: string; number: string; status: string; updated_at: string }>(async (from, to) => {
    const response = await context.supabase.from("commercial_proposals").select("id,number,status,updated_at")
      .eq("company_id", context.companyId).eq("project_id", selectedProject.id).eq("unit_id", unit.id)
      .in("status", ["draft", "sent", "negotiation", "approved"]).order("id").range(from, to);
    return { data: response.data ?? [], error: response.error };
  });
  if (competing.error) throw new Error(competing.error.message);
  if ((competing.data ?? []).some(row => row.status === "approved")) throw new Error("Existe proposta aprovada para a unidade. Converta/revise essa proposta no fluxo Comercial.");
  const indicesResponse = await context.supabase.from("correction_indices").select("id,code,name,status,updated_at")
    .eq("company_id", context.companyId).eq("status", "active").order("code");
  if (indicesResponse.error) throw new Error("Não foi possível conferir os índices de correção.");
  const indices = indicesResponse.data ?? [];
  const paymentItems = draft.paymentItems.map(item => {
    if (!item.correctionIndexLabel) return { ...item, correctionIndexId: null, correctionIndexUpdatedAt: null };
    const exact = indices.filter(index => [index.code, index.name].some(value => normalizeActionText(value) === normalizeActionText(item.correctionIndexLabel)));
    if (exact.length !== 1) throw new Error(`O índice "${item.correctionIndexLabel}" não corresponde a um único índice ativo da empresa. Confirme o código cadastrado.`);
    return { ...item, correctionIndexId: exact[0].id, correctionIndexLabel: exact[0].code, correctionIndexUpdatedAt: exact[0].updated_at };
  });
  let broker: { id: string; name: string; status: string; updated_at: string } | null = null;
  if (draft.brokerName) {
    const result = await fetchAllRows<{ id: string; name: string; status: string; updated_at: string }>(async (from, to) => {
      const page = await context.supabase.from("commercial_brokers").select("id,name,status,updated_at").eq("company_id", context.companyId).order("id").range(from, to);
      return { data: page.data ?? [], error: page.error };
    });
    if (result.error) throw new Error("Não foi possível conferir o corretor.");
    const matches = result.data.filter(row => row.name.trim().toLowerCase() === draft.brokerName?.trim().toLowerCase());
    if (matches.length !== 1 || matches[0].status !== "active") throw new Error("O corretor informado não corresponde a um cadastro ativo único. Confira o nome cadastrado.");
    broker = matches[0];
  }
  const unsupportedClauses = [...draft.unsupportedClauses];
  const indexIds = [...new Set(paymentItems.map(item => item.correctionIndexId).filter((id): id is string => Boolean(id)))];
  const baseValues = await Promise.all(indexIds.map(async id => {
    const response = await context.supabase.from("correction_index_values").select("value")
      .eq("company_id", context.companyId).eq("correction_index_id", id).lte("reference_month", `${draft.saleDate.slice(0, 7)}-01`)
      .order("reference_month", { ascending: false }).limit(1).maybeSingle();
    if (response.error) throw new Error("Não foi possível conferir o valor-base dos índices.");
    return { id, value: response.data?.value };
  }));
  for (const base of baseValues) if (base.value == null || Number(base.value) === 0) {
    unsupportedClauses.push(`O índice ${paymentItems.find(item => item.correctionIndexId === base.id)?.correctionIndexLabel} não possui valor-base válido no mês da venda ou anterior.`);
  }
  if (draft.commissionPct > 0 && !broker) unsupportedClauses.push("Existe comissão contratual sem corretor identificado no cadastro.");
  const warnings = ["As parcelas serão criadas em aberto. Esta ação não registra recebimento, não emite boleto e não envia cobrança."];
  if (client && client.name.trim().toLowerCase() !== draft.clientData.name.trim().toLowerCase()) warnings.push(`O CPF/CNPJ pertence ao cliente cadastrado como ${client.name}. O nome no documento é ${draft.clientData.name}; o cadastro existente será preservado.`);
  if (paymentItems.some(item => item.paymentMethod)) warnings.push("A forma de pagamento será preservada nas observações de cada série e título, conforme os campos existentes no módulo.");
  const competingProposals = (competing.data ?? []).map(row => ({ id: row.id, number: row.number, status: row.status, updatedAt: row.updated_at }));
  const effects = [
    ...(client ? [] : [`Cadastrar ${draft.clientData.name} como novo cliente.`]),
    "Registrar a proposta comercial do contrato, aprová-la e convertê-la em venda.",
    `Criar ${draft.installments.length} título(s) a receber em aberto, com os valores nominais e vencimentos mostrados.`,
    `Alterar a unidade ${unit.code} de disponível para vendida.`,
    ...(competingProposals.length ? [`Rejeitar ${competingProposals.length} proposta(s) concorrente(s) listada(s) abaixo, conforme o fluxo oficial de conversão.`] : []),
    ...(draft.commissionPct > 0 ? [`Registrar comissão planejada de ${draft.commissionPct}% para ${broker?.name ?? draft.brokerName ?? "corretor pendente"}; a aprovação financeira segue o módulo Comercial.`] : []),
    "Preservar o documento de origem no histórico da ação confirmada.",
  ];
  const { name, personType, taxId, ...details } = draft.clientData;
  const listPrice = unit.list_price == null ? draft.totalAmount : Number(unit.list_price);
  if (!Number.isFinite(listPrice) || listPrice < 0) throw new Error("O preço de tabela da unidade está inválido. Corrija-o antes de preparar a venda.");
  if (unit.list_price == null) warnings.push("A unidade não possui preço de tabela. A proposta de registro usará o valor do contrato como referência, sem desconto de tabela calculado.");
  const payload = {
    unitId: unit.id, expectedUnitUpdatedAt: unit.updated_at, clientId: client?.id ?? null,
    expectedClientUpdatedAt: client?.updated_at ?? null, clientTaxId: taxId, documentClientName: name,
    newClient: client ? null : draft.clientData, saleDate: draft.saleDate, contractNumber: draft.contractNumber,
    totalAmount: draft.totalAmount, listPrice, commissionPct: draft.commissionPct, brokerName: broker?.name ?? null,
    brokerId: broker?.id ?? null, expectedBrokerUpdatedAt: broker?.updated_at ?? null,
    correctionStartMonth: draft.correctionStartMonth, paymentItems, notes: draft.notes,
    expectedCompetingProposals: competingProposals, unsupportedClauses,
  };
  let installmentOffset = 0;
  const installments = paymentItems.flatMap(item => {
    const rows = draft.installments.slice(installmentOffset, installmentOffset + item.installmentCount)
      .map(row => ({ ...row, correctionIndexLabel: item.correctionIndexLabel }));
    installmentOffset += item.installmentCount;
    return rows;
  });
  const preview = {
    kind: "commercial_sale_create", blocked: unsupportedClauses.length > 0,
    blockReason: unsupportedClauses.length ? "O contrato possui condições pendentes de revisão. Nenhuma venda poderá ser gerada até resolvê-las." : null,
    sourceFile, project: { id: selectedProject.id, label: [selectedProject.code, selectedProject.name].filter(Boolean).join(" · ") },
    unit: { id: unit.id, code: unit.code, tower: unit.tower, status: unit.status },
    client: { id: client?.id ?? null, name: client?.name ?? name, taxId, personType, isNew: !client, details: client ? {} : details },
    saleDate: draft.saleDate, contractNumber: draft.contractNumber, totalAmount: draft.totalAmount,
    listPrice, discountAmount: Math.max(0, Math.round((listPrice - draft.totalAmount) * 100) / 100),
    commissionPct: draft.commissionPct, brokerName: broker?.name ?? draft.brokerName, correctionStartMonth: draft.correctionStartMonth,
    paymentItems, installments,
    notes: draft.notes, unsupportedClauses, effects, warnings, competingProposals,
  };
  const title = `Venda · unidade ${unit.code}`;
  const summary = `${client?.name ?? name} · ${draft.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · ${draft.installments.length} parcela(s)`;
  const proposal = await createDocumentProposal(context, { projectId: selectedProject.id, actionType: "commercial_sale_create", title, summary, payload, preview, sourceFile, documentKey: unit.id });
  return {
    acao_preparada: true, action_id: proposal.id, titulo: title, resumo: summary,
    bloqueada: preview.blocked, pendencias: unsupportedClauses,
    instrucao: preview.blocked ? "Mostre as pendências do cartão. Não afirme que a venda foi criada; ela permanece bloqueada até uma nova revisão completa." : "Peça ao usuário para conferir todos os dados e clicar no botão de confirmação. Cliente, venda, unidade e parcelas ainda não foram alterados.",
  };
}

export function commercialDocumentToolsForPersona(persona: ElosIaPersonaKey): CommercialDocumentToolName[] {
  return persona === "diretoria" || persona === "financeiro" ? [NAME] : [];
}
export function isCommercialDocumentTool(name: string): name is CommercialDocumentToolName { return name === NAME; }
export function commercialDocumentToolLabel(name: string) { return name === NAME ? "Preparar venda por contrato" : name; }
export function commercialDocumentToolPermissions(name: string = NAME) { return name === NAME ? [...PERMISSIONS] : []; }
export function commercialDocumentToolSchemas(names: CommercialDocumentToolName[]) {
  return names.filter(name => name === NAME).map(name => ({
    type: "function" as const, name, strict: true,
    description: "Lê os dados de um contrato de venda anexado e PREPARA um cartão imutável para revisão. Não cria cliente, venda ou parcelas. O clique humano revalidará tudo e usará a aprovação/conversão oficial. Exija dados explícitos, todas as condições e CPF/CNPJ; preserve pendências. Permuta, vários compradores, pagamentos já realizados, juros mensais e regras por evento são mostrados como impedimentos, nunca omitidos.",
    parameters: object(PROPERTIES),
  }));
}
export async function runCommercialDocumentTool(context: Context, allowed: CommercialDocumentToolName[], name: string, args: Args): Promise<Record<string, unknown>> {
  if (name !== NAME || !allowed.includes(NAME)) return { erro: "A preparação de venda não está disponível nesta persona." };
  const missing = PERMISSIONS.filter(permission => !context.can(permission));
  if (missing.length) return { erro: `Seu papel não possui as permissões necessárias (${missing.join(", ")}).` };
  try { return await prepare(context, args); }
  catch (error) { return { erro: error instanceof Error ? error.message : "Não foi possível preparar a venda. Nenhum cadastro foi efetivado." }; }
}
