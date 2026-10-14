import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { createFeasibilityStudy } from "./actions";
import "./feasibility.css";

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

type Study = {
  id:string; name:string; code:string|null; city:string|null; state:string|null; status:string;
  converted_project_id:string|null; updated_at:string; approved_at:string|null;
  approved_metrics: Record<string, number | null> | null;
};

export default async function FeasibilityListPage({ searchParams }: { searchParams: Promise<{ error?:string; success?:string }> }) {
  const messages = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("commercial.incorporation.view");
  const { data, error } = await supabase.from("commercial_feasibility_studies")
    .select("id,name,code,city,state,status,converted_project_id,updated_at,approved_at,approved_metrics")
    .eq("company_id", companyId).order("updated_at", { ascending:false }).limit(200);
  const studies = (data ?? []) as Study[];

  return <AppShell activeGroup="commercial" activeItem="feasibility"
    eyebrow="Comercial · Incorporação" title="Estudo de Viabilidade de Permuta"
    description={`${company.name} · analise o terreno, permuta, VGV, custos, margem, exposição e TIR antes de transformar a oportunidade em empreendimento.`}
    actions={<><Link className="elos-button" prefetch={false} href="/comercial/incorporacao">Carteira da incorporadora</Link></>}>
    {messages.error ? <div className="auth-message error workspace-message">{messages.error}</div> : null}
    {messages.success ? <div className="auth-message success workspace-message">{messages.success}</div> : null}
    {error ? <div className="auth-message error workspace-message">A migration de viabilidade precisa estar aplicada antes de usar esta tela.</div> : null}

    <section className="feasibility-card">
      <div className="feasibility-section-title"><div><span>Nova oportunidade</span><h2>Criar estudo</h2></div><p>Comece com o terreno; as premissas econômicas são preenchidas na próxima tela.</p></div>
      <form action={createFeasibilityStudy} className="feasibility-form">
        <label className="span-2">Nome do empreendimento<input name="name" required placeholder="Ex.: Tom Jobim" /></label>
        <label>Código<input name="code" placeholder="TJ" /></label>
        <label>Cidade<input name="city" /></label>
        <label>UF<input name="state" maxLength={2} placeholder="SC" /></label>
        <div className="span-4 feasibility-actions"><button className="feasibility-primary" type="submit">Criar estudo de viabilidade</button></div>
      </form>
    </section>

    <section className="registry-table-panel feasibility-section">
      <div className="section-heading"><div><span>Pipeline de terrenos</span><h2>Estudos de viabilidade</h2></div><small>{studies.length} estudo(s)</small></div>
      <div className="registry-table-wrap"><table className="registry-table">
        <thead><tr><th>Estudo</th><th>Local</th><th>Status</th><th>VGV disponível</th><th>Lucro</th><th>Margem</th><th>TIR a.a.</th><th>Atualização</th><th></th></tr></thead>
        <tbody>{studies.map(study => {
          const metrics = study.approved_metrics ?? {};
          const money = (value: unknown) => new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", maximumFractionDigits:0 }).format(Number(value ?? 0));
          const pct = (value: unknown) => value == null ? "—" : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits:1 })}%`;
          return <tr key={study.id}>
            <td><strong>{study.code ? `${study.code} · ` : ""}{study.name}</strong>{study.converted_project_id ? <><br/><small>Empreendimento criado</small></> : null}</td>
            <td>{[study.city,study.state].filter(Boolean).join(" / ") || "—"}</td>
            <td><span className={`feasibility-status ${study.status}`}>{study.status === "converted" ? "Aprovado / convertido" : study.status === "rejected" ? "Rejeitado" : "Em estudo"}</span></td>
            <td>{metrics.available_vgv != null ? money(metrics.available_vgv) : "—"}</td>
            <td>{metrics.profit != null ? money(metrics.profit) : "—"}</td>
            <td>{pct(metrics.margin_pct)}</td>
            <td>{pct(metrics.irr_annual_pct)}</td>
            <td>{dateBR(study.updated_at)}</td>
            <td><Link prefetch={false} href={`/comercial/incorporacao/viabilidade/${study.id}`}>Abrir estudo</Link></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!studies.length ? <p>Nenhum estudo criado. Cadastre a primeira oportunidade acima.</p> : null}
    </section>
  </AppShell>;
}
