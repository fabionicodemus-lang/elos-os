import {requireCompanyPermission} from '@/lib/workspace';
import {loadCashflow} from '@/lib/finance-core/cashflow-server';
import {isoDay,isCashflowScopeError} from '@/lib/finance-core/cashflow.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Read-only export of the same authorized position shown by the cash dashboard.
// Unknown values stay JSON null. This is not a fiscal export or financial acceptance.
export async function GET(request:Request){
 const {supabase,companyId,projectId}=await requireCompanyPermission('cashflow.view');
 const params=new URL(request.url).searchParams;
 const headers={'Cache-Control':'private, no-store'};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let cutoff:string,from:string;
 try{
  if(params.has('known_at'))throw Error('Corte de conhecimento histórico não suportado por esta exportação');
  cutoff=isoDay(params.get('cutoff')??today);from=isoDay(params.get('from')??cutoff.slice(0,7)+'-01');
  if(cutoff>today||from>cutoff)throw Error('Período inválido');
 }catch{return Response.json({error:'Período inválido ou corte histórico não suportado'},{status:400,headers});}
 // Authorization/read errors propagate: never turn them into an empty position.
 let view;
 try{view=await loadCashflow({supabase,companyId,projectId,entityId:params.get('entity')||null,scenarioId:params.get('version')||null,cutoff,from});}
 catch(error){if(isCashflowScopeError(error))return Response.json({error:'Perímetro financeiro indisponível para esta sessão.'},{status:403,headers});throw error;}
 return Response.json({company_id:companyId,entity_id:view.selectedEntity,project_id:projectId,
  version_id:view.scenario?.id??null,indicators:view.financialCoverage,sources:view.financialSources,
  warnings:view.warnings,financial_acceptance:'Pendente'},
  {headers:{...headers,'Content-Disposition':'attachment; filename="elos-posicao-financeira.json"'}});
}
