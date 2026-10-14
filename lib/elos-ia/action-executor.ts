import type { resolveActiveWorkspace } from "@/lib/workspace";
import { ELOS_IA_ATTACHMENT_BUCKET } from "./attachments";

type SupabaseClientLike=Awaited<ReturnType<typeof resolveActiveWorkspace>>["supabase"];
export type ElosIaActionProposal={
  id:string;company_id:string;project_id:string|null;turn_id:string;persona:string;action_type:string;required_permission:string;
  title:string;summary:string|null;payload:Record<string,unknown>;preview:Record<string,unknown>;status:string;created_by:string;
  created_at:string;expires_at:string;result:Record<string,unknown>|null;last_error:string|null;
};

function safeName(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-150)||"arquivo";}
function stringValue(value:unknown){return typeof value==="string"?value:"";}

async function officialDocumentExists(supabase:SupabaseClientLike,proposal:ElosIaActionProposal,fileName:string,result:Record<string,unknown>){
  const caption=`Elos IA · ${proposal.id}`;
  if(proposal.action_type==="procurement_supplier_offer"){
    const query=await supabase.from("procurement_material_quotation_documents").select("id").eq("quotation_id",stringValue(result.quotation_id)).eq("file_name",fileName).eq("caption",caption).maybeSingle();
    return Boolean(query.data);
  }
  if(proposal.action_type==="execution_contract_measurement"){
    const query=await supabase.from("execution_contract_measurement_documents").select("id").eq("measurement_id",stringValue(result.measurement_id)).eq("file_name",fileName).eq("caption",caption).maybeSingle();
    return Boolean(query.data);
  }
  if(proposal.action_type==="finance_manual_invoice"){
    const query=await supabase.from("finance_manual_invoice_documents").select("id").eq("invoice_id",stringValue(result.invoice_id)).eq("file_name",fileName).eq("caption",caption).maybeSingle();
    return Boolean(query.data);
  }
  return true;
}

async function copyOfficialDocuments(supabase:SupabaseClientLike,proposal:ElosIaActionProposal,result:Record<string,unknown>){
  const warnings:string[]=[];
  const attachments=await supabase.from("ai_action_attachments").select("id,storage_path,file_name,mime_type,file_size").eq("proposal_id",proposal.id).order("created_at");
  if(attachments.error){warnings.push("Não foi possível conferir o documento-fonte no histórico oficial.");return warnings;}
  for(const file of attachments.data??[]){
    try{
      if(await officialDocumentExists(supabase,proposal,file.file_name,result))continue;
      const downloaded=await supabase.storage.from(ELOS_IA_ATTACHMENT_BUCKET).download(file.storage_path);
      if(downloaded.error||!downloaded.data)throw new Error(downloaded.error?.message||"download");
      const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
      const caption=`Elos IA · ${proposal.id}`;
      let bucket="";let path="";let insertError:{message:string}|null=null;
      if(proposal.action_type==="procurement_supplier_offer"){
        const quotationId=stringValue(result.quotation_id);const supplierId=stringValue(result.supplier_id);
        if(!proposal.project_id||!quotationId||!supplierId)throw new Error("destino");
        bucket="material-quotation-documents";
        path=`${proposal.company_id}/${proposal.project_id}/${quotationId}/${crypto.randomUUID()}-${safeName(file.file_name)}`;
        const uploaded=await supabase.storage.from(bucket).upload(path,bytes,{contentType:file.mime_type||undefined,upsert:false});
        if(uploaded.error)throw new Error(uploaded.error.message);
        const inserted=await supabase.from("procurement_material_quotation_documents").insert({company_id:proposal.company_id,project_id:proposal.project_id,quotation_id:quotationId,supplier_id:supplierId,document_type:"proposal",storage_path:path,file_name:file.file_name,mime_type:file.mime_type,file_size:file.file_size,caption});
        insertError=inserted.error;
      }else if(proposal.action_type==="execution_contract_measurement"){
        const measurementId=stringValue(result.measurement_id);
        if(!proposal.project_id||!measurementId)throw new Error("destino");
        bucket="contract-measurement-documents";
        path=`${proposal.company_id}/${proposal.project_id}/${measurementId}/${crypto.randomUUID()}-${safeName(file.file_name)}`;
        const uploaded=await supabase.storage.from(bucket).upload(path,bytes,{contentType:file.mime_type||undefined,upsert:false});
        if(uploaded.error)throw new Error(uploaded.error.message);
        const inserted=await supabase.from("execution_contract_measurement_documents").insert({company_id:proposal.company_id,project_id:proposal.project_id,measurement_id:measurementId,document_type:"evidence",storage_path:path,file_name:file.file_name,mime_type:file.mime_type,file_size:file.file_size,caption,uploaded_by:proposal.created_by});
        insertError=inserted.error;
      }else if(proposal.action_type==="finance_manual_invoice"){
        const invoiceId=stringValue(result.invoice_id);
        if(!proposal.project_id||!invoiceId)throw new Error("destino");
        bucket="manual-invoice-documents";
        path=`${proposal.company_id}/${proposal.project_id}/${invoiceId}/${crypto.randomUUID()}-${safeName(file.file_name)}`;
        const uploaded=await supabase.storage.from(bucket).upload(path,bytes,{contentType:file.mime_type||undefined,upsert:false});
        if(uploaded.error)throw new Error(uploaded.error.message);
        const inserted=await supabase.from("finance_manual_invoice_documents").insert({company_id:proposal.company_id,project_id:proposal.project_id,invoice_id:invoiceId,document_type:"invoice",storage_path:path,file_name:file.file_name,mime_type:file.mime_type,file_size:file.file_size,caption,uploaded_by:proposal.created_by});
        insertError=inserted.error;
      }
      if(insertError){if(bucket&&path)await supabase.storage.from(bucket).remove([path]);throw new Error(insertError.message);}
    }catch(error){console.error("[elos-ia] Falha ao copiar documento da ação",proposal.id,error);warnings.push(`O lançamento foi concluído, mas ${file.file_name} não pôde ser copiado para os documentos oficiais.`);}
  }
  return warnings;
}

export async function loadElosIaActionProposal(supabase:SupabaseClientLike,companyId:string,proposalId:string){
  const result=await supabase.from("ai_action_proposals").select("id,company_id,project_id,turn_id,persona,action_type,required_permission,title,summary,payload,preview,status,created_by,created_at,expires_at,result,last_error").eq("company_id",companyId).eq("id",proposalId).maybeSingle();
  if(result.error)throw new Error(result.error.message);
  return result.data as ElosIaActionProposal|null;
}

export async function executeElosIaActionProposal(input:{supabase:SupabaseClientLike;companyId:string;proposalId:string}){
  const proposal=await loadElosIaActionProposal(input.supabase,input.companyId,input.proposalId);
  if(!proposal)throw new Error("A ação preparada não foi encontrada ou você não possui acesso.");
  const executed=await input.supabase.rpc("ai_execute_action_proposal",{p_proposal_id:proposal.id});
  if(executed.error)throw new Error(executed.error.message);
  const result=(executed.data??{}) as Record<string,unknown>;
  const warnings=await copyOfficialDocuments(input.supabase,proposal,result);
  return {proposal:{...proposal,status:"executed",result},result,warnings};
}

export async function rejectElosIaActionProposal(input:{supabase:SupabaseClientLike;companyId:string;proposalId:string}){
  const proposal=await loadElosIaActionProposal(input.supabase,input.companyId,input.proposalId);
  if(!proposal)throw new Error("A ação preparada não foi encontrada ou você não possui acesso.");
  const rejected=await input.supabase.rpc("ai_reject_action_proposal",{p_proposal_id:proposal.id});
  if(rejected.error)throw new Error(rejected.error.message);
  return {proposal:{...proposal,status:"rejected"}};
}