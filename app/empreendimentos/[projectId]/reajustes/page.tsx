import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { saveProjectAdjustments } from "./actions";

export default async function ProjectAdjustmentsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>; searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const { supabase, companyId, company } = await requireCompanyPermission("projects.view");
  const [project, settings, indices, budgets, events, permissions] = await Promise.all([
    supabase.from("projects").select("id,name").eq("id", projectId).eq("company_id", companyId).maybeSingle(),
    supabase.from("project_adjustment_settings").select("budget_enabled,budget_index_id,budget_base_month,installments_enabled").eq("project_id", projectId).eq("company_id", companyId).maybeSingle(),
    supabase.from("correction_indices").select("id,code,name").eq("company_id", companyId).eq("status", "active").order("code"),
    supabase.from("engineering_budgets").select("id,code,name,version,adjustment_enabled").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(50),
    supabase.from("adjustment_policy_events").select("id,event,created_at,detail").eq("company_id", companyId).eq("project_id", projectId).is("sale_id", null).order("created_at", { ascending: false }).limit(10),
    Promise.all(["projects.manage", "budgets.manage", "sales.manage"].map(permission => supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: permission }))),
  ]);
  if (!project.data) notFound();
  const cfg = settings.data;
  const canManage = permissions.every(result => result.data === true);
  return <AppShell activeGroup="projects" activeItem="projects" eyebrow="Empreendimentos · Reajustes" title={`Reajustes · ${project.data.name}`} description={company.name}
    actions={<Link prefetch={false} className="elos-button" href="/empreendimentos">Empreendimentos</Link>}>
    {query.success ? <div className="auth-message success workspace-message">{query.success}</div> : null}
    {query.error ? <div className="auth-message error workspace-message">{query.error}</div> : null}
    {settings.error ? <div className="auth-message error workspace-message">Configuração de reajustes indisponível.</div> : <>
      <section className="registry-table-panel registry-create">
        <div className="section-heading"><div><span>Padrões deste empreendimento</span><h2>Orçamento e parcelas são escolhas independentes</h2></div></div>
        <p>As condições já negociadas nos contratos existentes são preservadas. Os padrões abaixo orientam os novos cadastros; cada contrato possui suas próprias regras até e após as chaves.</p>
        {!cfg ? <p>Nenhum padrão definido. Os cadastros atuais continuam com as regras que já possuem.</p> : null}
        {canManage ? <form action={saveProjectAdjustments}>
          <input type="hidden" name="project_id" value={projectId} />
          <div className="registry-form-grid">
            <label>Reajuste dos novos orçamentos<select name="budget_enabled" defaultValue={String(cfg?.budget_enabled ?? false)}><option value="false">Sem reajuste</option><option value="true">Com reajuste por índice</option></select></label>
            <label>Índice do orçamento<select name="budget_index_id" defaultValue={cfg?.budget_index_id ?? ""}><option value="">Selecione se houver reajuste</option>{indices.data?.map(index => <option key={index.id} value={index.id}>{index.code} · {index.name}</option>)}</select></label>
            <label>Mês-base do orçamento<input type="month" name="budget_base_month" defaultValue={cfg?.budget_base_month?.slice(0, 7) ?? ""} /><small>Em branco: usa a data de referência de cada orçamento.</small></label>
            <label>Aplicar aos orçamentos já cadastrados?<select name="apply_budgets" defaultValue="false"><option value="false">Não, preservar configurações atuais</option><option value="true">Sim, atualizar orçamentos não arquivados</option></select></label>
            <label>Reajuste das parcelas nos novos contratos<select name="installments_enabled" defaultValue={String(cfg?.installments_enabled ?? false)}><option value="false">Sem reajuste por padrão</option><option value="true">Definir reajustes na negociação de cada contrato</option></select></label>
          </div>
          <p>O orçamento nominal, os custos realizados e os compromissos permanecem históricos. O reajuste é apresentado separadamente no controle do orçamento. Nos contratos, o financeiro pode negociar condições diferentes do padrão.</p>
          <button className="auth-primary" type="submit">Salvar padrões do empreendimento</button>
        </form> : <p>Orçamentos: {cfg?.budget_enabled ? "com reajuste" : "sem reajuste"}. Novos contratos: {cfg?.installments_enabled ? "definir na negociação" : "sem reajuste"}. A alteração exige permissão de gestão de empreendimentos, orçamentos e vendas.</p>}
      </section>
      <section className="registry-table-panel"><div className="section-heading"><div><span>Orçamentos do empreendimento</span><h2>Conferir o reajuste de cada revisão</h2></div></div>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Orçamento</th><th>Revisão</th><th>Reajuste</th><th>Ação</th></tr></thead><tbody>
          {budgets.data?.map(b => <tr key={b.id}><td>{b.code} · {b.name}</td><td>{b.version}</td><td>{b.adjustment_enabled ? "Ativo" : "Sem reajuste"}</td><td><Link prefetch={false} href={`/engenharia/orcamentos/${b.id}/reajuste`}>Configuração e memória</Link></td></tr>)}
          {!budgets.data?.length ? <tr><td colSpan={4}>Nenhum orçamento disponível.</td></tr> : null}
        </tbody></table></div><p>Até 50 revisões recentes. Consulte as demais em Engenharia → Orçamentos.</p>
      </section>
      {events.data?.length ? <section className="registry-table-panel"><h2>Histórico dos padrões</h2><ul>{events.data.map(e => <li key={e.id}>{new Date(e.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Padrões revisados · {e.detail.updated_budgets ?? 0} orçamento(s) atualizado(s) · contratos anteriores preservados.</li>)}</ul></section> : null}
    </>}
  </AppShell>;
}
