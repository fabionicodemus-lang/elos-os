import { NextRequest,NextResponse } from "next/server";
import { executeElosIaActionProposal,rejectElosIaActionProposal } from "@/lib/elos-ia/action-executor";
import { resolveElosIaAccess } from "@/lib/elos-ia/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration=120;
function json(body:Record<string,unknown>,status=200){return NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});}
function sameHost(origin:string,host:string){try{return new URL(origin).host===host.split(",")[0].trim();}catch{return false;}}

export async function POST(request:NextRequest,{params}:{params:Promise<{proposalId:string}>}){
  const origin=request.headers.get("origin");const host=request.headers.get("x-forwarded-host")??request.headers.get("host");
  if(origin&&host&&!sameHost(origin,host))return json({ok:false,error:"Origem não permitida."},403);
  if(!(request.headers.get("content-type")??"").includes("application/json"))return json({ok:false,error:"Formato de requisição inválido."},415);
  const authClient=await createClient();
  const auth=await authClient.auth.getClaims();
  if(auth.error||typeof auth.data?.claims?.sub!=="string")return json({ok:false,error:"Sua sessão expirou. Entre novamente no Elos OS."},401);
  const access=await resolveElosIaAccess();
  if(!access.allowed)return json({ok:false,error:"Você não tem permissão para usar o Elos IA."},403);
  const {proposalId}=await params;
  const body=(await request.json().catch(()=>null)) as {decision?:unknown}|null;
  const decision=body?.decision;
  try{
    if(decision==="reject"){
      const result=await rejectElosIaActionProposal({supabase:access.workspace.supabase,companyId:access.workspace.companyId,proposalId});
      return json({ok:true,status:"rejected",proposal:result.proposal});
    }
    if(decision!=="execute")return json({ok:false,error:"Decisão inválida."},400);
    const result=await executeElosIaActionProposal({supabase:access.workspace.supabase,companyId:access.workspace.companyId,proposalId});
    return json({ok:true,status:"executed",proposal:result.proposal,result:result.result,warnings:result.warnings});
  }catch(error){
    const message=error instanceof Error?error.message:"Não foi possível executar esta ação.";
    const denied=/permissão|acesso/i.test(message);
    return json({ok:false,error:message},denied?403:409);
  }
}
