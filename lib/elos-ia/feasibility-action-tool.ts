import type { ElosIaActionToolContext } from './action-tools';
import { matchUniqueCandidate } from './action-utils.mjs';
import { studyFields, reportedFields, unitFields, areaFields, normalizeFeasibilityImport, feasibilityImportWarnings, type ImportField } from './feasibility-import.mjs';
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const schema=(fields:ImportField[])=>object(Object.fromEntries(fields.map(([key,label,type])=>[key,{type:[type==='integer'?'integer':type==='number'?'number':'string','null'],...(key==='tax_regime'?{enum:['ret','common',null]}:key==='project_type'?{enum:['residential','commercial','mixed','land','industrial','other',null]}:{}),description:label+'. null se ausente/ilegível; datas AAAA-MM-DD. Não deduzir alíquotas, preços ou permutas.'}])));
export const feasibilityActionProperties={obra:{type:['string','null'],description:'Nome/código da obra. null usa a obra ativa.'},arquivo_origem:{type:['string','null'],description:'Nome exato do anexo desta pergunta; null somente para dados fornecidos por texto.'},study:schema(studyFields),reported:schema(reportedFields),unit_types:{type:'array',items:schema(unitFields),maxItems:150},construction_areas:{type:'array',items:schema(areaFields),maxItems:150,description:'Áreas adicionais (garagens, lazer, circulação), sem repetir área de apartamentos calculada pelas tipologias. Custo global declarado pertence a reported.total_cost; preserve decomposições sem campo em observations.'},observations:{type:'array',maxItems:150,items:object({label:{type:'string'},value:{type:'string'},source:{type:'string',description:'Página/tabela/célula do documento. Inclua premissas que não tenham campo específico e referências dos campos extraídos.'}})},warnings:{type:'array',items:{type:'string'},description:'Ausências, ambiguidades, texto ilegível ou divergências, sem impedir a preparação.'}};
export async function prepareFeasibility(context:ElosIaActionToolContext,args:Record<string,unknown>){
 const requested=typeof args.obra==='string'?args.obra.trim():'';
 const project=requested?matchUniqueCandidate(requested,context.projects,p=>[p.name,p.code]).match:context.projects.find(p=>p.id===context.activeProjectId);
 if(!project)throw Error('Selecione o empreendimento ou identifique a obra sem ambiguidade antes de preparar o estudo.');
 let sourceFile=typeof args.arquivo_origem==='string'?args.arquivo_origem:null;
 if(!sourceFile&&context.attachmentNames.length===1)sourceFile=context.attachmentNames[0];
 if(sourceFile&&!context.attachmentNames.includes(sourceFile))throw Error('Arquivo de origem não pertence aos anexos desta pergunta.');
 if(!sourceFile&&context.attachmentNames.length>1)throw Error('Informe qual anexo corresponde a este estudo.');
 const payload=normalizeFeasibilityImport(args);
 if(!payload.study.name)payload.study.name=`Estudo de viabilidade · ${project.name}`;
 const duplicates=await context.supabase.from('ai_action_proposals').select('id,status,title').eq('company_id',context.companyId).eq('project_id',project.id).eq('action_type','commercial_feasibility_import').eq('preview->>sourceFile',sourceFile??'Texto da conversa').in('status',['pending_review','executed']).limit(5);
 const warnings=feasibilityImportWarnings(payload);
 if(duplicates.data?.length)warnings.push('Já existe preparação/importação com esta origem. Confira se este documento é uma nova revisão antes de lançar.');
 const preview={kind:'commercial_feasibility_import',project:{id:project.id,label:project.name},sourceFile:sourceFile??'Texto da conversa',warnings,reported:payload.reported};
 const result=await context.supabase.from('ai_action_proposals').insert({company_id:context.companyId,project_id:project.id,turn_id:context.turnId,persona:context.persona,action_type:'commercial_feasibility_import',required_permission:'commercial.incorporation.manage',title:`Viabilidade · ${payload.study.name}`,summary:'Dados do estudo preparados para revisão e confirmação. Não aprovado nem lançado.',payload,preview,created_by:context.userId}).select('id').single();
 if(result.error||!result.data)throw Error(result.error?.message??'Não foi possível preparar o estudo.');
 if(sourceFile){const linked=await context.supabase.rpc('ai_link_action_attachment',{p_turn_id:context.turnId,p_proposal_id:result.data.id,p_file_name:sourceFile});if(linked.error)warnings.push('O anexo não pôde ser vinculado; confira o arquivo na conversa antes de confirmar.');}
 return {acao_preparada:true,action_id:result.data.id,pagina_revisao:`/elos-ia/acoes/${result.data.id}/viabilidade`,avisos:warnings,instrucao:'Informe que o estudo foi preparado para revisão na página. Ainda não foi lançado. A falta de baseline aprovado ou diferenças com unidades atuais não impedem importar um estudo em rascunho. Não use a consulta de lucro para bloquear esta preparação.'};
}
