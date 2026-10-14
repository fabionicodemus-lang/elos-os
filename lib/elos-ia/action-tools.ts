import type { ElosIaPersonaKey } from "./personas";
import type { ElosIaToolContext } from "./tools";
import { allocateSharedAmount, buildMeasurementPreview, matchUniqueCandidate, normalizeActionText } from "./action-utils.mjs";

export type ElosIaActionToolName = "preparar_cotacao_fornecedor" | "preparar_medicao_contrato";
export type ElosIaActionToolContext = ElosIaToolContext & {
  userId:string;
  turnId:string;
  persona:ElosIaPersonaKey;
  attachmentNames:string[];
};

type ToolArgs=Record<string,unknown>;
type ToolResult=Record<string,unknown>;
type ActionDefinition={
  name:ElosIaActionToolName;
  label:string;
  description:string;
  permissions:string[];
  properties:Record<string,Record<string,unknown>>;
  run:(context:ElosIaActionToolContext,args:ToolArgs)=>Promise<ToolResult>;
};

class ActionToolError extends Error {}

function text(value:unknown){return typeof value==="string"?value.trim():"";}
function nullableText(value:unknown){const valueText=text(value);return valueText||null;}
function num(value:unknown,fallback=0){const parsed=Number(value??fallback);return Number.isFinite(parsed)?parsed:fallback;}
function nullableInt(value:unknown){if(value==null||value==="")return null;const parsed=Number(value);return Number.isInteger(parsed)?parsed:null;}
function date(value:unknown){const raw=text(value);return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null;}
function money(value:number){return Math.round(value*100)/100;}

function projectLabel(project:{code:string|null;name:string}){return [project.code,project.name].filter(Boolean).join(" · ");}
function resolveProject(context:ElosIaActionToolContext,raw:unknown){
  const requested=text(raw);
  if(!requested){
    const active=context.projects.find((project)=>project.id===context.activeProjectId);
    if(active)return active;
    if(context.projects.length===1)return context.projects[0];
    throw new ActionToolError("Selecione uma obra no cabeçalho ou informe o nome da obra para preparar o lançamento.");
  }
  const matched=matchUniqueCandidate(requested,context.projects,(project)=>[project.code,project.name,projectLabel(project)]);
  if(!matched.match)throw new ActionToolError(matched.reason==="ambiguous"?`Mais de uma obra combina com "${requested}".`:`Não encontrei a obra "${requested}".`);
  return matched.match;
}

function resolveSourceFile(context:ElosIaActionToolContext,raw:unknown){
  const requested=text(raw);
  if(!requested)return context.attachmentNames.length===1?context.attachmentNames[0]:null;
  const match=matchUniqueCandidate(requested,context.attachmentNames,(name)=>[name]);
  if(!match.match)throw new ActionToolError(`Não encontrei o arquivo "${requested}" entre os anexos desta pergunta.`);
  return match.match;
}

async function createProposal(context:ElosIaActionToolContext,input:{
  projectId:string;actionType:"procurement_supplier_offer"|"execution_contract_measurement";title:string;summary:string;payload:Record<string,unknown>;preview:Record<string,unknown>;sourceFile:string|null;
}){
  const insert=await context.supabase.from("ai_action_proposals").insert({
    company_id:context.companyId,project_id:input.projectId,turn_id:context.turnId,persona:context.persona,
    action_type:input.actionType,required_permission:"pending-trigger",title:input.title,summary:input.summary,
    payload:input.payload,preview:input.preview,created_by:context.userId,
  }).select("id,status,required_permission,title,summary,preview,created_at,expires_at").single();
  if(insert.error||!insert.data)throw new ActionToolError(insert.error?.message||"Não foi possível preparar a ação para revisão.");
  let attachmentWarning:string|null=null;
  if(input.sourceFile){
    const linked=await context.supabase.rpc("ai_link_action_attachment",{p_turn_id:context.turnId,p_proposal_id:insert.data.id,p_file_name:input.sourceFile});
    if(linked.error)attachmentWarning="O lançamento foi preparado, mas o arquivo-fonte não pôde ser vinculado ao cartão de revisão.";
  }
  return {...insert.data,attachmentWarning};
}

function strictObject(properties:Record<string,Record<string,unknown>>){return {type:"object",additionalProperties:false,properties,required:Object.keys(properties)};}
const nullableString={type:["string","null"]};
const nullableNumber={type:["number","null"]};
const nullableInteger={type:["integer","null"]};

const QUOTE_ITEM_SCHEMA=strictObject({
  item:{type:"string",description:"Código ou descrição do item exatamente como aparece na proposta do fornecedor."},
  quantidade:{type:["number","null"],description:"Quantidade ofertada. Use null quando a proposta atende exatamente toda a quantidade da cotação."},
  preco_unitario:{type:"number",description:"Preço unitário bruto do item."},
  desconto_percentual:{type:["number","null"],description:"Desconto percentual do item; null quando não informado."},
  imposto_percentual:{type:["number","null"],description:"Imposto acrescido ao item; null quando não informado."},
  marca:{type:["string","null"]},fabricante:{type:["string","null"]},
  prazo_entrega_dias:{type:["integer","null"]},
  atende_especificacao:{type:["boolean","null"],description:"Use null se o documento não permite confirmar aderência técnica."},
  observacoes_tecnicas:{type:["string","null"]},
});

const MEASUREMENT_ITEM_SCHEMA=strictObject({
  servico:{type:"string",description:"Código ou descrição do serviço medido."},
  local:{type:["string","null"],description:"Pavimento/local quando necessário para diferenciar itens iguais."},
  quantidade:{type:"number",description:"Quantidade executada nesta medição, não o acumulado."},
  observacoes:{type:["string","null"]},
});

type QuoteRow={id:string;quotation_number:string;title:string;status:string;award_mode:string};
type QuoteSupplier={supplier_id:string;supplier_name:string;status:string};
type QuoteItem={id:string;input_code:string;input_name:string;unit_snapshot:string;quantity_to_quote:number};
type ContractRow={id:string;contract_number:string;title:string;supplier_id:string;status:string;start_date:string;end_date:string;current_value:number;measured_value:number;retention_percent:number;guarantee_percent:number};
type ContractItem={id:string;service_code:string;service_name:string;location_name:string|null;unit_snapshot:string;contracted_quantity:number;measured_quantity:number;unit_price:number};

async function prepareSupplierQuote(context:ElosIaActionToolContext,args:ToolArgs):Promise<ToolResult>{
  const project=resolveProject(context,args.obra);
  const quoteResult=await context.supabase.from("procurement_material_quotations")
    .select("id,quotation_number,title,status,award_mode")
    .eq("company_id",context.companyId).eq("project_id",project.id).eq("status","collecting").order("created_at",{ascending:false});
  if(quoteResult.error)throw new ActionToolError(quoteResult.error.message);
  const quotes=(quoteResult.data??[]) as QuoteRow[];
  const requestedQuote=text(args.cotacao);
  let quote:QuoteRow|null=null;
  if(!requestedQuote&&quotes.length===1)quote=quotes[0];
  else{
    const match=matchUniqueCandidate(requestedQuote,quotes,(row)=>[row.quotation_number,row.title,`${row.quotation_number} ${row.title}`]);
    quote=match.match;
    if(!quote)throw new ActionToolError(match.reason==="ambiguous"?`Mais de uma cotação em coleta combina com "${requestedQuote}".`:`Não encontrei uma cotação em coleta que combine com "${requestedQuote}".`);
  }

  const [supplierResult,itemResult]=await Promise.all([
    context.supabase.from("procurement_material_quotation_suppliers").select("supplier_id,supplier_name,status").eq("quotation_id",quote.id),
    context.supabase.from("procurement_material_quotation_items").select("id,input_code,input_name,unit_snapshot,quantity_to_quote").eq("quotation_id",quote.id).order("sort_order"),
  ]);
  if(supplierResult.error||itemResult.error)throw new ActionToolError(supplierResult.error?.message||itemResult.error?.message||"Falha ao ler a cotação.");
  const suppliers=(supplierResult.data??[]) as QuoteSupplier[];
  const requestedSupplier=text(args.fornecedor);
  let supplier:QuoteSupplier|null=null;
  if(!requestedSupplier&&suppliers.length===1)supplier=suppliers[0];
  else{
    const match=matchUniqueCandidate(requestedSupplier,suppliers,(row)=>[row.supplier_name]);
    supplier=match.match;
    if(!supplier)throw new ActionToolError(match.reason==="ambiguous"?`Mais de um fornecedor convidado combina com "${requestedSupplier}".`:`O fornecedor "${requestedSupplier}" não está entre os convidados desta cotação.`);
  }

  const quoteItems=(itemResult.data??[]) as QuoteItem[];
  const extracted=Array.isArray(args.itens)?args.itens as Array<Record<string,unknown>>:[];
  if(!extracted.length)throw new ActionToolError("Não encontrei itens com preço no documento/texto enviado.");
  const seen=new Set<string>();
  const prepared=extracted.map((raw)=>{
    const requested=text(raw.item);
    const match=matchUniqueCandidate(requested,quoteItems,(row)=>[row.input_code,row.input_name,`${row.input_code} ${row.input_name}`]);
    if(!match.match)throw new ActionToolError(match.reason==="ambiguous"?`O item "${requested}" é ambíguo na cotação. Informe o código exato.`:`O item "${requested}" não existe nesta cotação.`);
    const item=match.match;
    if(seen.has(item.id))throw new ActionToolError(`O item ${item.input_code} apareceu mais de uma vez no documento. Consolide a quantidade/preço antes de lançar.`);
    seen.add(item.id);
    const quantity=raw.quantidade==null?num(item.quantity_to_quote):num(raw.quantidade);
    const unitPrice=num(raw.preco_unitario);
    if(quantity<=0||unitPrice<=0)throw new ActionToolError(`Revise quantidade e preço do item ${item.input_code}.`);
    if(quantity>num(item.quantity_to_quote)+0.000001)throw new ActionToolError(`A quantidade ofertada de ${item.input_code} (${quantity}) supera a quantidade da cotação (${item.quantity_to_quote}).`);
    const discount=Math.min(100,Math.max(0,num(raw.desconto_percentual)));
    const tax=Math.min(100,Math.max(0,num(raw.imposto_percentual)));
    const subtotal=quantity*unitPrice*(1-discount/100)*(1+tax/100);
    return {raw,item,quantity,unitPrice,discount,tax,subtotal};
  });
  const freightTotal=Math.max(0,num(args.frete_total));
  const otherTotal=Math.max(0,num(args.outros_custos_total));
  const freightParts=allocateSharedAmount(freightTotal,prepared.map((row)=>row.subtotal));
  const otherParts=allocateSharedAmount(otherTotal,prepared.map((row)=>row.subtotal));
  const rpcItems=prepared.map((row,index)=>({
    quotation_item_id:row.item.id,quantity_offered:row.quantity,unit_price:row.unitPrice,
    discount_percent:row.discount,tax_percent:row.tax,freight_amount:freightParts[index],other_cost_amount:otherParts[index],
    brand:nullableText(row.raw.marca),manufacturer:nullableText(row.raw.fabricante),delivery_days:nullableInt(row.raw.prazo_entrega_dias),
    meets_specification:row.raw.atende_especificacao==null?true:Boolean(row.raw.atende_especificacao),
    technical_notes:nullableText(row.raw.observacoes_tecnicas),
  }));
  const previewItems=prepared.map((row,index)=>{
    const total=money(row.subtotal+freightParts[index]+otherParts[index]);
    return {id:row.item.id,code:row.item.input_code,name:row.item.input_name,unit:row.item.unit_snapshot,quantityToQuote:num(row.item.quantity_to_quote),quantity:row.quantity,unitPrice:row.unitPrice,discountPercent:row.discount,taxPercent:row.tax,freight:freightParts[index],otherCost:otherParts[index],deliveredUnitCost:money(total/row.quantity),total,brand:nullableText(row.raw.marca),deliveryDays:nullableInt(row.raw.prazo_entrega_dias)};
  });
  const total=money(previewItems.reduce((sum,row)=>sum+row.total,0));
  const sourceFile=resolveSourceFile(context,args.arquivo_origem);
  const payload={
    quotationId:quote.id,supplierId:supplier.supplier_id,
    proposalNumber:nullableText(args.numero_proposta),proposalDate:date(args.data_proposta),validityDate:date(args.validade),
    paymentTerms:nullableText(args.condicao_pagamento),deliveryDays:nullableInt(args.prazo_entrega_dias),freightTerms:nullableText(args.condicao_frete),warrantyTerms:nullableText(args.garantia),notes:nullableText(args.observacoes),items:rpcItems,
  };
  const preview={kind:"procurement_supplier_offer",blocked:false,project:{id:project.id,label:projectLabel(project)},quotation:{id:quote.id,number:quote.quotation_number,title:quote.title},supplier:{id:supplier.supplier_id,name:supplier.supplier_name},sourceFile,proposalNumber:payload.proposalNumber,proposalDate:payload.proposalDate,validityDate:payload.validityDate,paymentTerms:payload.paymentTerms,deliveryDays:payload.deliveryDays,freightTerms:payload.freightTerms,items:previewItems,freightTotal,otherTotal,total};
  const proposal=await createProposal(context,{projectId:project.id,actionType:"procurement_supplier_offer",title:`Proposta · ${supplier.supplier_name}`,summary:`${quote.quotation_number} · ${previewItems.length} item(ns) · total ${total.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}`,payload,preview,sourceFile});
  return {acao_preparada:true,action_id:proposal.id,titulo:proposal.title,resumo:proposal.summary,total,arquivo_origem:sourceFile,aviso:proposal.attachmentWarning??null,instrucao:"Mostre ao usuário que a proposta foi preparada e que ele deve revisar o cartão antes de lançar. Não diga que já foi gravada na cotação."};
}

async function prepareContractMeasurement(context:ElosIaActionToolContext,args:ToolArgs):Promise<ToolResult>{
  const project=resolveProject(context,args.obra);
  const contractsResult=await context.supabase.from("execution_service_contracts")
    .select("id,contract_number,title,supplier_id,status,start_date,end_date,current_value,measured_value,retention_percent,guarantee_percent")
    .eq("company_id",context.companyId).eq("project_id",project.id).in("status",["active","suspended"]).order("contract_number");
  if(contractsResult.error)throw new ActionToolError(contractsResult.error.message);
  const contracts=(contractsResult.data??[]) as ContractRow[];
  const requested=text(args.contrato);
  let contract:ContractRow|null=null;
  if(!requested&&contracts.length===1)contract=contracts[0];
  else{
    const match=matchUniqueCandidate(requested,contracts,(row)=>[row.contract_number,row.title,`${row.contract_number} ${row.title}`]);
    contract=match.match;
    if(!contract)throw new ActionToolError(match.reason==="ambiguous"?`Mais de um contrato combina com "${requested}".`:`Não encontrei contrato ativo/suspenso que combine com "${requested}".`);
  }
  const periodStart=date(args.inicio_periodo); const periodEnd=date(args.fim_periodo);
  if(!periodStart||!periodEnd)throw new ActionToolError("Informe o período da medição com data inicial e final.");
  if(periodEnd<periodStart)throw new ActionToolError("A data final da medição não pode ser anterior à inicial.");
  if(periodStart<contract.start_date||periodEnd>contract.end_date)throw new ActionToolError(`O período precisa estar dentro da vigência do contrato (${contract.start_date} a ${contract.end_date}).`);

  const [itemsResult,supplierResult]=await Promise.all([
    context.supabase.from("execution_service_contract_items").select("id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,measured_quantity,unit_price").eq("contract_id",contract.id).order("sort_order"),
    context.supabase.from("suppliers").select("id,legal_name,trade_name").eq("id",contract.supplier_id).maybeSingle(),
  ]);
  if(itemsResult.error)throw new ActionToolError(itemsResult.error.message);
  const contractItems=(itemsResult.data??[]) as ContractItem[];
  const extracted=Array.isArray(args.itens)?args.itens as Array<Record<string,unknown>>:[];
  if(!extracted.length)throw new ActionToolError("Não encontrei serviços com quantidade executada para montar a medição.");
  const seen=new Set<string>();
  const selected=extracted.map((raw)=>{
    const service=text(raw.servico); const location=text(raw.local);
    const requestedKey=location?`${service} ${location}`:service;
    const match=matchUniqueCandidate(requestedKey,contractItems,(row)=>location
      ? [`${row.service_code} ${row.location_name??""}`,`${row.service_name} ${row.location_name??""}`,`${row.service_code} ${row.service_name} ${row.location_name??""}`]
      : [row.service_code,row.service_name,`${row.service_code} ${row.service_name}`]);
    if(!match.match)throw new ActionToolError(match.reason==="ambiguous"?`O serviço "${service}" existe em mais de um local. Informe o pavimento/local.`:`O serviço "${service}" não pertence ao contrato selecionado.`);
    const item=match.match;
    if(seen.has(item.id))throw new ActionToolError(`O serviço ${item.service_code}${item.location_name?` · ${item.location_name}`:""} apareceu mais de uma vez. Consolide a quantidade desta medição.`);
    seen.add(item.id);
    const quantity=num(raw.quantidade);
    if(quantity<=0)throw new ActionToolError(`A quantidade medida de ${item.service_code} precisa ser maior que zero.`);
    return {...item,current_quantity:quantity,notes:nullableText(raw.observacoes)};
  });
  const tax=Math.max(0,num(args.retencao_impostos));
  const advance=Math.max(0,num(args.desconto_adiantamento));
  const other=Math.max(0,num(args.outros_descontos));
  const calculated=buildMeasurementPreview({contract,items:selected,taxWithholding:tax,advanceDeduction:advance,otherDiscount:other});
  if(calculated.net<0)throw new ActionToolError("As retenções e descontos informados superam o valor bruto medido.");
  const sourceFile=resolveSourceFile(context,args.arquivo_origem);
  const supplier=supplierResult.data as {legal_name:string;trade_name:string|null}|null;
  const rpcItems=selected.map((item)=>({contract_item_id:item.id,current_quantity:item.current_quantity,notes:item.notes}));
  const payload={contractId:contract.id,periodStart,periodEnd,taxWithholding:tax,advanceDeduction:advance,otherDiscount:other,notes:nullableText(args.observacoes),contractorNotes:nullableText(args.observacoes_empreiteiro),items:rpcItems,overContractConfirmed:false};
  const previewItems=calculated.rows.map((row)=>({id:row.id,code:row.service_code,name:row.service_name,location:row.location_name,unit:row.unit_snapshot,contractedQuantity:row.contractedQuantity,previousQuantity:row.previousQuantity,currentQuantity:row.currentQuantity,accumulatedQuantity:row.accumulatedQuantity,unitPrice:row.unitPrice,currentAmount:row.currentAmount,overContract:row.overContract}));
  const preview={kind:"execution_contract_measurement",blocked:calculated.overContract,blockReason:calculated.overContract?"A medição ultrapassa quantidade de item ou valor vigente do contrato. A Elos IA não confirma estouro automaticamente.":null,project:{id:project.id,label:projectLabel(project)},contract:{id:contract.id,number:contract.contract_number,title:contract.title,supplier:supplier?.trade_name||supplier?.legal_name||null,currentValue:num(contract.current_value),measuredValue:num(contract.measured_value),retentionPercent:num(contract.retention_percent),guaranteePercent:num(contract.guarantee_percent)},sourceFile,periodStart,periodEnd,items:previewItems,gross:calculated.gross,contractualRetention:calculated.contractualRetention,guaranteeRetention:calculated.guaranteeRetention,taxWithholding:tax,advanceDeduction:advance,otherDiscount:other,totalDeductions:calculated.deductions,net:calculated.net};
  const proposal=await createProposal(context,{projectId:project.id,actionType:"execution_contract_measurement",title:`Medição · ${contract.contract_number}`,summary:`${periodStart} a ${periodEnd} · bruto ${calculated.gross.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})} · líquido ${calculated.net.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}`,payload,preview,sourceFile});
  return {acao_preparada:true,action_id:proposal.id,titulo:proposal.title,resumo:proposal.summary,bloqueada:calculated.overContract,motivo_bloqueio:preview.blockReason,arquivo_origem:sourceFile,aviso:proposal.attachmentWarning??null,instrucao:calculated.overContract?"Avise que a medição foi preparada para conferência, mas não poderá ser lançada pela IA porque ultrapassa o contrato. O estouro exige tratamento explícito no fluxo de medição/aditivo.":"Mostre ao usuário que a medição em rascunho foi preparada e precisa ser revisada no cartão antes do lançamento."};
}

const ACTIONS:ActionDefinition[]=[
  {
    name:"preparar_cotacao_fornecedor",label:"Preparar proposta de fornecedor",permissions:["procurement.quotations.manage"],
    description:"Prepara, mas NÃO lança ainda, uma proposta de fornecedor dentro de uma cotação de materiais em coleta. Use quando o usuário enviar orçamento em PDF, foto, planilha ou texto. Faça um chamado por fornecedor. Nunca invente item, preço, quantidade, condição ou fornecedor; use null quando um campo opcional não estiver no documento.",
    properties:{
      obra:{...nullableString,description:"Nome/código da obra; null usa a obra ativa."},cotacao:{...nullableString,description:"Número ou título da cotação; null somente se houver uma única cotação em coleta."},fornecedor:{...nullableString,description:"Fornecedor identificado no documento; null somente se houver um único convidado."},arquivo_origem:{...nullableString,description:"Nome exato do PDF/foto/planilha usado para esta proposta; null se a origem for somente texto."},
      numero_proposta:{...nullableString},data_proposta:{...nullableString,description:"AAAA-MM-DD ou null."},validade:{...nullableString,description:"AAAA-MM-DD ou null."},condicao_pagamento:{...nullableString},prazo_entrega_dias:{...nullableInteger},condicao_frete:{...nullableString},garantia:{...nullableString},observacoes:{...nullableString},frete_total:{...nullableNumber,description:"Frete total do documento; será rateado entre itens. null se não informado/embutido."},outros_custos_total:{...nullableNumber},itens:{type:"array",items:QUOTE_ITEM_SCHEMA,minItems:1},
    },run:prepareSupplierQuote,
  },
  {
    name:"preparar_medicao_contrato",label:"Preparar medição de contrato",permissions:["execution.measurements.manage"],
    description:"Prepara, mas NÃO lança/submete/aprova ainda, uma medição de contrato de serviço a partir de planilha, PDF, foto ou texto. Quantidades são sempre desta medição, não acumuladas. Nunca confirme automaticamente estouro do contrato.",
    properties:{
      obra:{...nullableString,description:"Nome/código da obra; null usa a obra ativa."},contrato:{...nullableString,description:"Número ou título do contrato; null apenas se houver um único contrato ativo/suspenso."},arquivo_origem:{...nullableString,description:"Nome exato do arquivo usado; null se a origem for somente texto."},inicio_periodo:{type:"string",description:"Data inicial AAAA-MM-DD."},fim_periodo:{type:"string",description:"Data final AAAA-MM-DD."},retencao_impostos:{...nullableNumber,description:"Valor monetário de retenção tributária adicional; null se não informado."},desconto_adiantamento:{...nullableNumber},outros_descontos:{...nullableNumber},observacoes:{...nullableString},observacoes_empreiteiro:{...nullableString},itens:{type:"array",items:MEASUREMENT_ITEM_SCHEMA,minItems:1},
    },run:prepareContractMeasurement,
  },
];
const BY_NAME=new Map(ACTIONS.map((tool)=>[tool.name,tool]));

export function elosIaActionToolsForPersona(persona:ElosIaPersonaKey):ElosIaActionToolName[]{
  if(persona==="clientes")return [];
  if(persona==="financeiro")return ["preparar_cotacao_fornecedor"];
  return ["preparar_cotacao_fornecedor","preparar_medicao_contrato"];
}
export function elosIaActionToolLabel(name:string){return BY_NAME.get(name as ElosIaActionToolName)?.label??name;}
export function elosIaActionToolPermissions(name:ElosIaActionToolName){return BY_NAME.get(name)?.permissions??[];}
export function isElosIaActionTool(name:string):name is ElosIaActionToolName{return BY_NAME.has(name as ElosIaActionToolName);}
export function elosIaActionToolSchemas(names:ElosIaActionToolName[]){
  return names.map((name)=>BY_NAME.get(name)).filter((tool):tool is ActionDefinition=>Boolean(tool)).map((tool)=>({
    type:"function" as const,name:tool.name,description:tool.description,strict:true,
    parameters:{type:"object",additionalProperties:false,properties:tool.properties,required:Object.keys(tool.properties)},
  }));
}
export async function runElosIaActionTool(context:ElosIaActionToolContext,allowed:ElosIaActionToolName[],name:string,args:ToolArgs):Promise<ToolResult>{
  const tool=BY_NAME.get(name as ElosIaActionToolName);
  if(!tool||!allowed.includes(tool.name))return {erro:`A ação "${name}" não está disponível para esta persona.`};
  const missing=tool.permissions.filter((permission)=>!context.can(permission));
  if(missing.length)return {erro:`Seu papel não possui permissão para preparar esta ação (${missing.join(", ")}).`};
  try{return await tool.run(context,args);}catch(error){return {erro:error instanceof Error?error.message:"Não foi possível preparar a ação."};}
}
