import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { applyProductivityToBaseline, saveServiceProductivity } from "./actions";
import "../../preconstruction-95.css";

type Service = {
  id: string;
  code: string;
  description: string;
  unit: string;
  default_productivity_per_team_day: number | null;
  default_team_count: number | null;
  productivity_notes: string | null;
};
type History = {
  service_id: string;
  sample_count: number;
  avg_productivity_per_team_day: number;
  min_productivity_per_team_day: number;
  max_productivity_per_team_day: number;
  last_actual_finish: string | null;
};
type Baseline = { id: string; code: string; version: string; name: string; status: string };

function decimal(value: number | null | undefined, digits = 2) {
  return value == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value));
}
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default async function ProductivityPage({ searchParams }: {
  searchParams: Promise<{ q?: string; baseline?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("services.view");
  const [servicesResult, historyResult, baselinesResult, servicesManage, scheduleManage] = await Promise.all([
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_services")
        .select("id, code, description, unit, default_productivity_per_team_day, default_team_count, productivity_notes")
        .eq("company_id", companyId).eq("status", "active").order("code").range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<History>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_service_productivity_history")
        .select("service_id, sample_count, avg_productivity_per_team_day, min_productivity_per_team_day, max_productivity_per_team_day, last_actual_finish")
        .eq("company_id", companyId).range(from, to);
      return { data: (data ?? []) as History[], error };
    }),
    projectId
      ? supabase.from("engineering_schedule_baselines").select("id, code, version, name, status")
          .eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "services.manage" }),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "schedule.manage" }),
  ]);

  const historyMap = new Map(historyResult.data.map((item) => [item.service_id, item]));
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const services = servicesResult.data.filter((item) => !query || `${item.code} ${item.description}`.toLocaleLowerCase("pt-BR").includes(query));
  const baselines = (baselinesResult.data ?? []) as Baseline[];
  const baseline = baselines.find((item) => item.id === params.baseline)
    ?? baselines.find((item) => item.status !== "approved")
    ?? baselines[0]
    ?? null;
  const withStandard = servicesResult.data.filter((item) => Number(item.default_productivity_per_team_day ?? 0) > 0).length;
  const withHistory = historyResult.data.filter((item) => item.sample_count > 0).length;
  const canManageServices = servicesManage.data === true || roleKey === "owner" || roleKey === "admin";
  const canManageSchedule = scheduleManage.data === true || roleKey === "owner" || roleKey === "admin";

  return (
    <AppShell activeGroup="engineering" activeItem="productivity" eyebrow="Engenharia · Planejamento" title="Produtividade"
      description={`${company.name} · padrões por serviço e aprendizado com o realizado.`}
      actions={<><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link><Link prefetch={false} className="elos-button" href="/engenharia/cronograma">Cronograma</Link></>}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {(servicesResult.error || historyResult.error) ? <div className="auth-message error workspace-message">A tela de produtividade exige a migration do pacote Pré-Obra 9.5.</div> : null}

      <section className="pre95-summary">
        <article><span>Serviços ativos</span><strong>{servicesResult.data.length}</strong><small>catálogo corporativo</small></article>
        <article><span>Com padrão definido</span><strong>{withStandard}</strong><small>{servicesResult.data.length ? decimal(withStandard / servicesResult.data.length * 100, 0) : "0"}% do catálogo</small></article>
        <article><span>Com histórico real</span><strong>{withHistory}</strong><small>serviços concluídos medidos</small></article>
        <article><span>Sem padrão</span><strong>{Math.max(0, servicesResult.data.length - withStandard)}</strong><small>precisam de premissa</small></article>
      </section>

      {projectId && baseline && canManageSchedule && baseline.status !== "approved" ? (
        <section className="pre95-card pre95-apply">
          <div><span>Aplicar na linha de base</span><strong>{baseline.code} · {baseline.version} · {baseline.name}</strong><small>Recalcula duração e término das atividades com padrão definido.</small></div>
          <form action={applyProductivityToBaseline}>
            <select name="baseline_id" defaultValue={baseline.id}>{baselines.filter((item) => item.status !== "approved").map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>)}</select>
            <button type="submit">Aplicar padrões</button>
          </form>
        </section>
      ) : null}

      <section className="pre95-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar serviço" /><button type="submit">Filtrar</button><Link prefetch={false} href="/engenharia/produtividade">Limpar</Link></form></section>

      <section className="pre95-card">
        <div className="pre95-heading"><div><span>Base de produtividade</span><h2>Padrão planejado × realizado histórico</h2></div><p>O gerador automático usa o padrão salvo; o histórico ajuda a calibrar novas obras.</p></div>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Serviço</th><th>Un.</th><th>Padrão/equipe/dia</th><th>Equipes padrão</th><th>Histórico médio</th><th>Amostras</th><th>Faixa histórica</th><th>Último realizado</th><th>Ação</th></tr></thead><tbody>
          {services.map((service) => {
            const history = historyMap.get(service.id);
            return <tr key={service.id}>
              <td><strong>{service.code}</strong><span>{service.description}</span>{service.productivity_notes ? <small>{service.productivity_notes}</small> : null}</td>
              <td>{service.unit}</td>
              <td><strong>{decimal(service.default_productivity_per_team_day, 3)}</strong></td>
              <td>{decimal(service.default_team_count, 1)}</td>
              <td><strong>{decimal(history?.avg_productivity_per_team_day, 3)}</strong></td>
              <td>{history?.sample_count ?? 0}</td>
              <td>{history ? `${decimal(history.min_productivity_per_team_day, 3)} — ${decimal(history.max_productivity_per_team_day, 3)}` : "—"}</td>
              <td>{dateBR(history?.last_actual_finish)}</td>
              <td>{canManageServices ? <details className="pre95-edit"><summary>Calibrar</summary><form action={saveServiceProductivity}>
                <input type="hidden" name="service_id" value={service.id} />
                <label><span>Produtividade/equipe/dia</span><input name="productivity" inputMode="decimal" defaultValue={service.default_productivity_per_team_day ?? history?.avg_productivity_per_team_day ?? ""} /></label>
                <label><span>Equipes padrão</span><input name="team_count" inputMode="decimal" defaultValue={service.default_team_count ?? 1} /></label>
                <label><span>Premissa</span><textarea name="notes" rows={3} defaultValue={service.productivity_notes ?? ""} /></label>
                <button type="submit">Salvar</button>
              </form></details> : "—"}</td>
            </tr>;
          })}
          {!services.length ? <tr><td colSpan={9}>Nenhum serviço encontrado.</td></tr> : null}
        </tbody></table></div>
      </section>
    </AppShell>
  );
}