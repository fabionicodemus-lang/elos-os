import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { resolveElosIaAccess } from "@/lib/elos-ia/server";
import { ElosIaActionCard,type ElosIaClientAction } from "../elos-ia-action-card";
import "../../elos-ia.css";
import "../../elos-ia-actions.css";

type Row={id:string;action_type:string;title:string;summary:string|null;preview:Record<string,unknown>;status:string;required_permission:string;created_at:string;expires_at:string;created_by:string};

export default async function ElosIaActionsPage(){
  const access=await resolveElosIaAccess();
  if(!access.allowed)redirect("/dashboard?error=Você%20não%20possui%20acesso%20ao%20Elos%20IA.");
  const {workspace}=access;
  const query=await workspace.supabase.from("ai_action_proposals")
    .select("id,action_type,title,summary,preview,status,required_permission,created_at,expires_at,created_by")
    .eq("company_id",workspace.companyId).eq("status","pending_review").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(100);
  const rows=(query.data??[]) as Row[];
  return <AppShell activeGroup="ai" eyebrow="Elos IA · Governança" title="Ações pendentes"
    description={`${workspace.company.name} · lançamentos preparados pela IA aguardando conferência humana.`}
    actions={<Link className="elos-button" prefetch={false} href="/elos-ia">Voltar ao Elos IA</Link>}>
    {query.error?<div className="auth-message error workspace-message">A fila de ações ainda não está disponível: {query.error.message}</div>:null}
    <section className="elos-ia-pending-head"><div><strong>{rows.length}</strong><span>ação(ões) aguardando revisão</span></div><p>A permissão é verificada novamente no clique. O lançamento usa as mesmas regras e RPCs das telas manuais.</p></section>
    <div className="elos-ia-pending-list">{rows.map((row)=>{
      const action:ElosIaClientAction={id:row.id,actionType:row.action_type,title:row.title,summary:row.summary,preview:row.preview??{},status:row.status,requiredPermission:row.required_permission,canExecute:access.can(row.required_permission),createdAt:row.created_at,expiresAt:row.expires_at};
      return <ElosIaActionCard key={row.id} action={action}/>;
    })}</div>
    {!query.error&&!rows.length?<section className="result-empty"><strong>Nenhuma ação pendente.</strong><p>Quando a Elos IA preparar uma cotação ou medição, ela aparecerá aqui até ser lançada ou descartada.</p></section>:null}
  </AppShell>;
}
