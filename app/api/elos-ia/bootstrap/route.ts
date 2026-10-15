import { NextResponse } from "next/server";
import { getElosIaConfig } from "@/lib/elos-ia/config";
import { defaultPersonaForRole, ELOS_IA_PERSONAS } from "@/lib/elos-ia/personas";
import { loadElosIaProjects, resolveElosIaAccess } from "@/lib/elos-ia/server";
import { loadElosIaUsage, quotaView } from "@/lib/elos-ia/usage";

function json(body:Record<string,unknown>,status=200){return NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});}

export async function GET(){
  const access=await resolveElosIaAccess();
  if(!access.allowed)return json({ok:false,error:"Você não tem permissão para usar o Elos IA."},403);
  const {workspace}=access;
  const config=getElosIaConfig();
  const [projects,usage]=await Promise.all([
    loadElosIaProjects(workspace),
    loadElosIaUsage(workspace.supabase,workspace.companyId).catch(()=>({tracking:false,costTracking:false,userTokensToday:0,companyTokensMonth:0,companyUsdMonth:0,companyUsdLimit:null})),
  ]);
  const activeProject=projects.find((project)=>project.id===workspace.projectId)??null;
  const activeProjectLabel=activeProject?[activeProject.code,activeProject.name].filter(Boolean).join(" · "):null;
  return json({
    ok:true,
    configured:Boolean(config.apiKey),
    personas:ELOS_IA_PERSONAS.map((persona)=>({key:persona.key,label:persona.label,tagline:persona.tagline,pilotNote:persona.pilotNote??null,suggestions:persona.suggestions,sources:[]})),
    defaultPersona:defaultPersonaForRole(workspace.roleKey),
    activeProjectLabel,
    initialQuota:quotaView(config,usage),
    maxQuestionChars:config.maxQuestionChars,
    companyId:workspace.companyId,
    userId:workspace.userId,
  });
}
