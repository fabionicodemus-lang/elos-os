import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import "../../preconstruction-95.css";

type Budget = { id: string; code: string; version: string; name: string; status: string; is_base: boolean; updated_at: string };
type Baseline = { id: string; code: string; version: string; name: string; status: string };

export default async function PreconstructionHubPage() {
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("budgets.view");
  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("company_id", companyId).eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const budgetsPromise = projectId
    ? supabase.from("engineering_budgets").select("id, code, version, name, status, is_base, updated_at").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100)
    : Promise.resolve({ data: [], error: null });
  const baselinesPromise = projectId
    ? supabase.from("engineering_schedule_baselines").select("id, code, version, name, status").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100)
    : Promise.resolve({ data: [], error: null });
  const [projectResult, budgetsResult, baselinesResult] = await Promise.all([projectPromise, budgetsPromise, baselinesPromise]);
  const budgets = (budgetsResult.data ?? []) as Budget[];
  const baselines = (baselinesResult.data ?? []) as Baseline[];
  const baseBudget = budgets.find((item) => item.is_base && item.status === "approved") ?? budgets.find((item) => item.status === "approved") ?? budgets[0] ?? null;
  const baseline = baselines.find((item) => item.status === "approved") ?? baselines[0] ?? null;
  const project = projectResult.data as { id: string; code: string | null; name: string } | null;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return (
    <AppShell activeGroup="engineering" activeItem="preconstruction-hub" eyebrow="Engenharia · Pré-Obra" title="Pré-Obra 9.5"
      description={`${company.name} · ${context} · orçamento, planejamento e inteligência antes da execução.`}>
      {!projectId ? <div className="pre95-empty">Selecione uma obra no topo para abrir o painel de pré-obra.</div> : null}
      {projectId ? <>
        <section className="pre95-summary">
          <article><span>Orçamento de referência</span><strong>{baseBudget ? `${baseBudget.code} · ${baseBudget.version}` : "—"}</strong><small>{baseBudget?.name ?? "Nenhuma revisão encontrada"}</small></article>
          <article><span>Linha de base</span><strong>{baseline ? `${baseline.code} · ${baseline.version}` : "—"}</strong><small>{baseline?.status === "approved" ? "Oficializada e imutável" : baseline ? "Em planejamento" : "Nenhuma linha de base"}</small></article>
          <article><span>Revisões de orçamento</span><strong>{budgets.length}</strong><small>{budgets.filter((item) => item.status === "approved").length} aprovada(s)</small></article>
          <article><span>Linhas de base</span><strong>{baselines.length}</strong><small>{baselines.filter((item) => item.status === "approved").length} oficializada(s)</small></article>
        </section>

        <section className="pre95-grid">
          <Link prefetch={false} href={baseBudget ? `/engenharia/curva-abc?budget=${baseBudget.id}` : "/engenharia/curva-abc"}><b>ABC</b><div><strong>Curva ABC</strong><span>Priorize serviços e insumos que concentram o orçamento.</span></div></Link>
          <Link prefetch={false} href={baseBudget ? `/engenharia/orcamentos/${baseBudget.id}/comparar` : "/engenharia/orcamentos"}><b>Δ</b><div><strong>Revisões e comparador</strong><span>Compare quantidade, preço e impacto financeiro entre snapshots.</span></div></Link>
          <Link prefetch={false} href="/engenharia/produtividade"><b>∑</b><div><strong>Produtividade</strong><span>Defina padrões por serviço e compare com o histórico real da obra.</span></div></Link>
          <Link prefetch={false} href={baseline ? `/engenharia/caminho-critico?baseline=${baseline.id}` : "/engenharia/caminho-critico"}><b>CP</b><div><strong>Caminho crítico</strong><span>CPM, folga total, folga livre e atividades críticas.</span></div></Link>
          <Link prefetch={false} href="/engenharia/calendario"><b>▣</b><div><strong>Calendário da obra</strong><span>Feriados, recessos e dias de trabalho excepcionais.</span></div></Link>
          <Link prefetch={false} href="/engenharia/sinapi"><b>BR</b><div><strong>Referências SINAPI</strong><span>Competências versionadas, por UF, preservando estrutura e preços disponíveis.</span></div></Link>
        </section>

        <section className="pre95-governance">
          <div><span>Governança</span><h2>Snapshots oficiais não são reescritos</h2></div>
          <p>Orçamentos aprovados e linhas de base aprovadas passam a ser imutáveis. Mudanças de escopo ou planejamento devem nascer em uma nova revisão, preservando a memória usada pela execução.</p>
        </section>
      </> : null}
    </AppShell>
  );
}