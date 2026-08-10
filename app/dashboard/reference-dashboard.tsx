import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { resolveActiveWorkspace } from "@/lib/workspace";
import { selectWorkspace } from "./actions";
import "../dashboard-reference.css";

type Project = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  city: string | null;
  state: string | null;
  built_area_m2: number | null;
  total_floors: number | null;
};

type Service = { id: string; status: string };
type Takeoff = { id: string; project_id: string; status: string; record_status: string };
type Permission = { key: string };
type RolePermission = { permission_key: string };

const projectStatusLabels: Record<string, string> = {
  planning: "Planejamento",
  active: "Em construção",
  paused: "Pausado",
  completed: "Concluído",
  archived: "Arquivado",
};

const projectStatusTone: Record<string, string> = {
  planning: "yellow",
  active: "green",
  paused: "yellow",
  completed: "blue",
  archived: "gray",
};

function decimal(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export default async function ReferenceDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, role } = await resolveActiveWorkspace();
  const privileged = role.key === "owner" || role.key === "admin";

  const permissionResult = privileged
    ? await supabase.from("permissions").select("key")
    : role.id
      ? await supabase.from("role_permissions").select("permission_key").eq("role_id", role.id).eq("allowed", true)
      : { data: [], error: null };

  const permissions = new Set(
    privileged
      ? ((permissionResult.data ?? []) as Permission[]).map((item) => item.key)
      : ((permissionResult.data ?? []) as RolePermission[]).map((item) => item.permission_key),
  );
  const can = (permission: string) => privileged || permissions.has(permission);

  const [projectsResult, servicesResult, takeoffsResult] = await Promise.all([
    can("projects.view")
      ? fetchAllRows<Project>(async (from, to) => {
          const { data, error } = await supabase
            .from("projects")
            .select("id,name,code,status,city,state,built_area_m2,total_floors")
            .eq("company_id", companyId)
            .neq("status", "archived")
            .order("name")
            .range(from, to);
          return { data: (data ?? []) as Project[], error };
        })
      : Promise.resolve({ data: [] as Project[], error: null }),
    can("services.view")
      ? fetchAllRows<Service>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_services")
            .select("id,status")
            .eq("company_id", companyId)
            .range(from, to);
          return { data: (data ?? []) as Service[], error };
        })
      : Promise.resolve({ data: [] as Service[], error: null }),
    can("takeoffs.view")
      ? fetchAllRows<Takeoff>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoffs")
            .select("id,project_id,status,record_status")
            .eq("company_id", companyId)
            .range(from, to);
          return { data: (data ?? []) as Takeoff[], error };
        })
      : Promise.resolve({ data: [] as Takeoff[], error: null }),
  ]);

  const projects = projectsResult.data;
  const activeServices = servicesResult.data.filter((service) => service.status === "active");
  const activeTakeoffs = takeoffsResult.data.filter((takeoff) => takeoff.record_status === "active");
  const approvedTakeoffs = activeTakeoffs.filter((takeoff) => takeoff.status === "approved");
  const activeProjects = projects.filter((project) => project.status === "active");
  const memoriesByProject = new Map<string, number>();
  activeTakeoffs.forEach((takeoff) => memoriesByProject.set(takeoff.project_id, (memoriesByProject.get(takeoff.project_id) ?? 0) + 1));

  const moduleCards = [
    { label: "Pré-Obra", description: "Orçamentos, levantamento e planejamento", href: can("budgets.view") ? "/engenharia/orcamentos" : undefined },
    { label: "Controle", description: "Custos, cronograma e contratos", href: can("budgets.view") ? "/engenharia/custo-orcamento" : can("schedule.view") ? "/execucao/cronograma" : undefined },
    { label: "Execução", description: "Produção, qualidade e rotina da obra", href: can("execution.daily_logs.view") ? "/execucao/diario-obras" : undefined },
    { label: "Suprimentos", description: "Cotações, compras e estoque", href: can("procurement.quotations.view") ? "/suprimentos/orcamentos-materiais" : undefined },
    { label: "Financeiro", description: "Contas, notas fiscais e impostos", href: can("payables.view") ? "/financeiro/contas-a-pagar" : undefined },
    { label: "Comercial", description: "Clientes, propostas e vendas", href: can("commercial.proposals.view") ? "/comercial/propostas" : undefined },
    { label: "Pós-Obra", description: "Assistências técnicas e garantias", href: can("postwork.assistance.view") ? "/pos-obra/assistencias" : undefined },
  ];

  const kpis = [
    { label: "Empreendimentos ativos", value: activeProjects.length, hint: "cadastros em operação" },
    { label: "Serviços ativos", value: activeServices.length, hint: "catálogo mestre" },
    { label: "Memórias de cálculo", value: activeTakeoffs.length, hint: "levantamentos cadastrados" },
    {
      label: "Memórias aprovadas",
      value: approvedTakeoffs.length,
      hint: activeTakeoffs.length ? `${Math.round((approvedTakeoffs.length / activeTakeoffs.length) * 100)}% do total` : "sem memórias",
    },
  ];

  return (
    <AppShell
      activeGroup="home"
      eyebrow="Início"
      title="Dashboard Geral"
      description="Visão consolidada de todos os módulos, empreendimentos e atividades do Elos OS."
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      <section className="reference-dashboard">
        <div className="reference-dashboard-welcome">
          <div>
            <span>VISÃO GERAL DO SISTEMA</span>
            <h2>Gestão conectada da incorporação ao pós-obra</h2>
            <p>Use o menu lateral para acessar os módulos. Cada módulo abre somente suas próprias divisões.</p>
          </div>
          <Link className="reference-dashboard-primary" href="/empreendimentos">Abrir empreendimentos</Link>
        </div>

        <div className="reference-module-grid">
          {moduleCards.map((module) => module.href ? (
            <Link className="reference-module-card" href={module.href} key={module.label}>
              <b>{module.label}</b>
              <span>{module.description}</span>
            </Link>
          ) : (
            <div className="reference-module-card is-disabled" key={module.label}>
              <b>{module.label}</b>
              <span>{module.description}</span>
            </div>
          ))}
        </div>

        <div className="reference-kpi-grid">
          {kpis.map((kpi) => (
            <div className="reference-card reference-kpi" key={kpi.label}>
              <div className="reference-kpi-label">{kpi.label}</div>
              <div className="reference-kpi-value">{kpi.value}</div>
              <div className="reference-kpi-hint">{kpi.hint}</div>
            </div>
          ))}
        </div>

        <div className="reference-section-heading">
          <div>
            <h2>Empreendimentos cadastrados</h2>
            <div className="reference-sub">Abra um empreendimento ou cadastre um novo.</div>
          </div>
          {can("projects.manage") || privileged ? (
            <Link className="reference-dashboard-primary" href="/empreendimentos">+ Novo empreendimento</Link>
          ) : null}
        </div>

        <div className="reference-card reference-table-wrap">
          <table className="reference-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Obra</th>
                <th>Local</th>
                <th>Área</th>
                <th>Pavimentos</th>
                <th>Memórias</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr className={project.id === projectId ? "is-active-project" : undefined} key={project.id}>
                  <td className="reference-code">{project.code || "—"}</td>
                  <td><b>{project.name}</b></td>
                  <td>{[project.city, project.state].filter(Boolean).join(" • ") || "—"}</td>
                  <td>{Number(project.built_area_m2) > 0 ? `${decimal(project.built_area_m2)} m²` : "—"}</td>
                  <td>{project.total_floors || "—"}</td>
                  <td>{memoriesByProject.get(project.id) ?? 0}</td>
                  <td><span className={`reference-badge ${projectStatusTone[project.status] ?? "gray"}`}>{projectStatusLabels[project.status] ?? project.status}</span></td>
                  <td>
                    <form action={selectWorkspace}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="return_to" value="/dashboard" />
                      <button className="reference-open-button" type="submit">Abrir</button>
                    </form>
                  </td>
                </tr>
              ))}
              {projects.length === 0 ? (
                <tr><td className="reference-empty" colSpan={8}>Nenhum empreendimento cadastrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {(projectsResult.error || servicesResult.error || takeoffsResult.error) ? (
          <div className="dashboard-data-note">Alguns indicadores não puderam ser carregados. Os demais dados continuam disponíveis normalmente.</div>
        ) : null}
        <span className="dashboard-context-note">Contexto atual: {company.name}</span>
      </section>
    </AppShell>
  );
}
