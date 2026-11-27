'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireCompanyPermission } from '@/lib/workspace';
import { normalizeFeasibilityImport } from '@/lib/elos-ia/feasibility-import.mjs';
export async function confirmFeasibilityImport(_previous:{error:string|null},form:FormData):Promise<{error:string|null}>{
 const {supabase,companyId}=await requireCompanyPermission('commercial.incorporation.manage');
 if(form.get('confirmed')!=='yes')return {error:'Confirme a conferência dos dados antes de lançar.'};
 const proposalId=String(form.get('proposal_id')??'');
 if(!/^[0-9a-f-]{36}$/i.test(proposalId))return {error:'Preparação inválida.'};
 let payload;
 try{const raw=String(form.get('reviewed_payload')??'');if(raw.length>250000)throw Error('Documento muito extenso.');payload=normalizeFeasibilityImport(JSON.parse(raw));if(!payload.study.name)throw Error('Informe o nome do estudo.');}
 catch(error){return {error:error instanceof Error?error.message:'Revise os dados.'};}
 const result=await supabase.rpc('ai_confirm_feasibility_import',{p_company:companyId,p_proposal:proposalId,p_reviewed:payload});
 if(result.error)return {error:result.error.message};
 const studyId=result.data?.study_id;
 if(typeof studyId!=='string'||!/^[0-9a-f-]{36}$/i.test(studyId))return {error:'Não foi possível localizar o estudo cadastrado.'};
 for(const path of ['/elos-ia/acoes','/comercial/incorporacao/viabilidade',`/elos-ia/acoes/${proposalId}/viabilidade`])revalidatePath(path);
 redirect(`/comercial/incorporacao/viabilidade/${studyId}?success=${encodeURIComponent('Estudo importado em rascunho. Dados declarados e sua revisão preservados; baseline atual mantido.')}`);
}
