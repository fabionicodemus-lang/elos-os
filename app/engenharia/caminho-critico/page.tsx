import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { calculateCpm } from "@/lib/preconstruction/cpm.mjs";
import { requireCompanyPermission } from "@/lib/workspace";
import "../../preconstruction-95.css";

type Baseline = { id: string; code: string; version: string; name: string; status: string; start_date: string };
type Activity = { id: string; code: string; name: string; duration_days: number; planned_start: string; planned_finish: string; record_status: string; planning_status: string };
type Dependency = { predecessor_id: string; successor_id: string; relation_type: "FS" | "SS" | "FF" | "SF"; lag_days: number };

function dateBR(value: string | null | undefined) { if (!value) return "—"; const [y,m,d] = value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }
function integer(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0)); }

export default async function CriticalPathPage({ searchParams }: { searchParams: Promise<{ baseline?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");
  const baselinesResult = projectId
    ? await supabase.from("engineering_schedule_baselines").select("id, code, version, name, status, start_date").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100)
    : { data: [], error: null };
  const baselines = (baselinesResult.data ?? []) as Baseline[];
  const baseline = baselines.find((item) => item.id === params.baseline) ?? baselines.find((item) => item.status === "approved") ?? baselines[0] ?? null;
  const [activitiesResult, dependenciesResult] = baseline ? await Promise.all([
    fetchAllRows<Activity>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_activities").select("id, code, name, duration_days, planned_start, planned_finish, record_status, planning_status").eq("company_id", companyId).eq("baseline_id", baseline.id).order("sort_order").range(from, to);
      return { data: (data ?? []) as Activity[], error };
    }),
    fetchAllRows<Dependency>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_dependencies").select("predecessor_id, successor_id, relation_type, lag_days").eq("company_id", companyId).eq("baseline_id", baseline.id).range(from, to);
      return { data: (data ?? []) as Dependency[], error };
    }),
  ]) : [{ data: [] as Activity[], error: null }, { data: [] as Dependency[], error: null }];

  const cpm = calculateCpm(activitiesResult.data, dependenciesResult.data);
  const critical = cpm.rows.filter((row) => row.critical);
  const nearCritical = cpm.rows.filter((row) => !row.critical && row.totalFloat <= 5);
  const maxFloat = cpm.rows.reduce((max, row) => Math.max(max, row.totalFloat), 0);

  return (
    <AppShell activeGroup="engineering" activeItem="critical-path" eyebrow="Engenharia · Planejamento" title="Caminho crítico"
      description={`${company.name} · CPM, folga total e folga livre do cronograma.`}
      actions={<><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link>{baseline ? <Link prefetch={false} className="elos-button" href={`/engenharia/cronograma?baseline=${baseline.id}`}>Abrir Gantt</Link> : null}</>}>
      {!projectId ? <div className="pre95-empty">Selecione uma obra.</div> : null}
      {projectId && !baseline ? <div className="pre95-empty">Crie uma linha de base para calcular o caminho crítico.</div> : null}
      {(activitiesResult.error || dependenciesResult.error) ? <div className="auth-message error workspace-message">Não foi possível carregar toda a rede lógica.</div> : null}
      {baseline ? <>
        <section className="pre95-selector"><div><span>Linha de base</span><strong>{baseline.code} · {baseline.version} · {baseline.name}</strong><small>{baseline.status === "approved" ? "Oficializada" : "Em planejamento"} · início {dateBR(baseline.start_date)}</small></div>{baselines.length > 1 ? <form method="get"><select name="baseline" defaultValue={baseline.id}>{baselines.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>)}</select><button type="submit">Abrir</button></form> : null}</section>

        {cpm.cycleDetected ? <div className="auth-message error workspace-message">A rede possui dependência circular. Corrija o ciclo antes de usar CPM.</div> : null}

        <section className="pre95-summary">
          <article><span>Atividades</span><strong>{cpm.rows.length}</strong><small>{dependenciesResult.data.length} vínculo(s) lógico(s)</small></article>
          <article className="negative"><span>Críticas</span><strong>{critical.length}</strong><small>folga total = 0</small></article>
          <article><span>Quase críticas</span><strong>{nearCritical.length}</strong><small>folga ≤ 5 dias</small></article>
          <article><span>Duração lógica</span><strong>{integer(cpm.projectDuration)} dias</strong><small>pela rede de precedências</small></article>
          <article><span>Maior folga</span><strong>{integer(maxFloat)} dias</strong><small>flexibilidade máxima</small></article>
        </section>

        {!cpm.cycleDetected ? <section className="pre95-card">
          <div className="pre95-heading"><div><span>CPM</span><h2>Atividades, datas lógicas e folgas</h2></div><p>FS, SS, FF e SF com lag são considerados no cálculo.</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Situação</th><th>Código</th><th>Atividade</th><th>Plano atual</th><th>Duração</th><th>Início cedo</th><th>Fim cedo</th><th>Início tarde</th><th>Fim tarde</th><th>Folga total</th><th>Folga livre</th></tr></thead><tbody>
            {cpm.rows.map((row) => <tr key={row.id} className={row.critical ? "cpm-critical" : row.totalFloat <= 5 ? "cpm-near" : ""}><td><strong className={row.critical ? "cpm-badge critical" : row.totalFloat <= 5 ? "cpm-badge near" : "cpm-badge"}>{row.critical ? "CRÍTICA" : row.totalFloat <= 5 ? "QUASE CRÍTICA" : "COM FOLGA"}</strong></td><td><strong>{row.code}</strong></td><td>{row.name}</td><td><small>{dateBR(row.planned_start)} → {dateBR(row.planned_finish)}</small></td><td>{integer(Number(row.duration_days))} d</td><td>D+{integer(row.earlyStart)}</td><td>D+{integer(row.earlyFinish)}</td><td>D+{integer(row.lateStart)}</td><td>D+{integer(row.lateFinish)}</td><td><strong>{integer(row.totalFloat)} d</strong></td><td>{integer(row.freeFloat)} d</td></tr>)}
            {!cpm.rows.length ? <tr><td colSpan={11}>Nenhuma atividade ativa na linha de base.</td></tr> : null}
          </tbody></table></div>
        </section> : null}
      </> : null}
    </AppShell>
  );
}