import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { resolveElosIaAccess } from "@/lib/elos-ia/server";
import { elosIaDocumentActionsEnabled, isDocumentActionType } from "@/lib/elos-ia/document-action-shared";
import { ElosIaActionCard,type ElosIaClientAction } from "../elos-ia-action-card";
import "../../elos-ia.css";
import "../../elos-ia-actions.css";

type Row={id:string;action_type:string;title:string;summary:string|null;preview:Record<string,unknown>;status:string;required_permission:string;created_at:string;expires_at:string;created_by:string};

export default async function ElosIaActionsPage({searchParams}:{searchParams:Promise<{status?:string;page?:string}>}){
  const access=await resolveElosIaAccess();
  if(!access.allowed)redirect("/dashboard?error=Você%20não%20possui%20acesso%20ao%20Elos%20IA.");
  const {workspace}=access;
  const filters=await searchParams;
  const status=["executed","rejected"].includes(filters.status??"")?filters.status!:"pending_review";
  const parsedPage=Number(filters.page??1);
  const page=Number.isSafeInteger(parsedPage)?Math.min(10000,Math.max(1,parsedPage)):1;
  const pageSize=25;
  let request=workspace.supabase.from("ai_action_proposals")
    .select("id,action_type,title,summary,preview,status,required_permission,created_at,expires_at,created_by")
    .eq("company_id",workspace.companyId).eq("status",status).order("created_at",{ascending:false}).range((page-1)*pageSize,page*pageSize);
  if(status==="pending_review")request=request.gt("expires_at",new Date().toISOString());
  const query=await request;
  const rows=((query.data??[]) as Row[]).slice(0,pageSize);
  const hasNext=(query.data?.length??0)>pageSize;
  return <AppShell activeGroup="ai" eyebrow="Elos IA · Governança" title="Revisão e histórico de ações"
    description={`${workspace.company.name} · confira os lançamentos e os documentos que deram origem a eles.`}
    actions={<Link className="elos-button" prefetch={false} href="/elos-ia">Voltar ao Elos IA</Link>}>
    {query.error?<div className="auth-message error workspace-message">A fila de ações ainda não está disponível: {query.error.message}</div>:null}
    <nav className="elos-ia-pending-head" aria-label="Filtrar ações"><Link className={`elos-button ${status==="pending_review"?"primary":""}`} href="/elos-ia/acoes">Aguardando revisão</Link><Link className={`elos-button ${status==="executed"?"primary":""}`} href="/elos-ia/acoes?status=executed">Confirmadas</Link><Link className={`elos-button ${status==="rejected"?"primary":""}`} href="/elos-ia/acoes?status=rejected">Descartadas</Link></nav>
    <section className="elos-ia-pending-head"><div><strong>{rows.length}</strong><span>ação(ões) nesta página</span></div><p>Revise os dados e os efeitos. O registro operacional só é gerado após o botão de confirmação.</p></section>
    <div className="elos-ia-pending-list">{rows.map((row)=>{
      const action:ElosIaClientAction={id:row.id,actionType:row.action_type,title:row.title,summary:row.summary,preview:row.preview??{},status:row.status,requiredPermission:row.required_permission,canExecute:access.can(row.required_permission)&&(!isDocumentActionType(row.action_type)||elosIaDocumentActionsEnabled()),createdAt:row.created_at,expiresAt:row.expires_at};
      return <ElosIaActionCard key={row.id} action={action}/>;
    })}</div>
    {!query.error&&!rows.length?<section className="result-empty"><strong>Nenhuma ação neste filtro.</strong><p>Os rascunhos, confirmações e descartes ficam disponíveis nesta tela.</p></section>:null}
    {page>1||hasNext?<nav className="elos-ia-pending-head" aria-label="Paginação das ações">{page>1?<Link className="elos-button" href={`/elos-ia/acoes?status=${status}&page=${page-1}`}>Anterior</Link>:null}<span>Página {page}</span>{hasNext?<Link className="elos-button" href={`/elos-ia/acoes?status=${status}&page=${page+1}`}>Próxima</Link>:null}</nav>:null}
  </AppShell>;
}
