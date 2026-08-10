import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { resolveActiveWorkspace } from "@/lib/workspace";
import { ReferenceProjects, type DashboardProjectCard } from "./reference-projects";
import "../dashboard-reference.css";

const IMAGE_BUCKET = "project-images";
const FALSE_ACCESS_MESSAGE = "Você não possui acesso ativo a esta empresa.";

type Project = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  city: string | null;
  state: string | null;
  built_area_m2: number | null;
  total_units: number | null;
  total_floors: number | null;
  delivery_date: string | null;
  cover_image_path: string | null;
};

type Takeoff = { project_id: string; record_status: string };
type Baseline = { id: string; project_id: string; status: string; updated_at: string };
type Activity = { id: string; project_id: string; baseline_id: string; planned_cost: number | null; record_status: string };
type Measurement = { activity_id: string; project_id: string; progress_percent: number; measurement_date: string; created_at: string };

function progressForProject(
  projectId: string,
  selectedBaselineId: string | null,
  activities: Activity[],
  latestMeasurementByActivity: Map<string, Measurement>,
) {
  if (!selectedBaselineId) return 0;
  const projectActivities = activities.filter(
    (activity) => activity.project_id === projectId && activity.baseline_id === selectedBaselineId && activity.record_status === "active",
  );
  if (!projectActivities.length) return 0;

  const totalWeight = projectActivities.reduce((sum, activity) => sum + Math.max(0, Number(activity.planned_cost ?? 0)), 0);
  if (totalWeight > 0) {
    return projectActivities.reduce((sum, activity) => {
      const weight = Math.max(0, Number(activity.planned_cost ?? 0));
      const progress = Math.max(0, Math.min(100, Number(latestMeasurementByActivity.get(activity.id)?.progress_percent ?? 0)));
      return sum + progress * weight;
    }, 0) / totalWeight;
  }

  return projectActivities.reduce((sum, activity) => {
    return sum + Math.max(0, Math.min(100, Number(latestMeasurementByActivity.get(activity.id)?.progress_percent ?? 0)));
  }, 0) / projectActivities.length;
}

export default async function ReferenceDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, role } = await resolveActiveWorkspace();
  const privileged = role.key === "owner" || role.key === "admin";

  const [viewProjectsResult, manageProjectsResult] = privileged
    ? [{ data: true, error: null }, { data: true, error: null }]
    : await Promise.all([
        supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "projects.view" }),
        supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "projects.manage" }),
      ]);

  const canViewProjects = privileged || viewProjectsResult.data === true;
  const canManageProjects = privileged || manageProjectsResult.data === true;

  const [projectsResult, takeoffsResult, baselinesResult, activitiesResult, measurementsResult] = await Promise.all([
    canViewProjects
      ? fetchAllRows<Project>(async (from, to) => {
          const { data, error } = await supabase
            .from("projects")
            .select("id,name,code,status,city,state,built_area_m2,total_units,total_floors,delivery_date,cover_image_path")
            .eq("company_id", companyId)
            .neq("status", "archived")
            .order("name")
            .range(from, to);
          return { data: (data ?? []) as Project[], error };
        })
      : Promise.resolve({ data: [] as Project[], error: null }),
    canViewProjects
      ? fetchAllRows<Takeoff>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoffs")
            .select("project_id,record_status")
            .eq("company_id", companyId)
            .eq("record_status", "active")
            .range(from, to);
          return { data: (data ?? []) as Takeoff[], error };
        })
      : Promise.resolve({ data: [] as Takeoff[], error: null }),
    canViewProjects
      ? fetchAllRows<Baseline>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id,project_id,status,updated_at")
            .eq("company_id", companyId)
            .neq("status", "archived")
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Baseline[], error };
        })
      : Promise.resolve({ data: [] as Baseline[], error: null }),
    canViewProjects
      ? fetchAllRows<Activity>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_activities")
            .select("id,project_id,baseline_id,planned_cost,record_status")
            .eq("company_id", companyId)
            .eq("record_status", "active")
            .range(from, to);
          return { data: (data ?? []) as Activity[], error };
        })
      : Promise.resolve({ data: [] as Activity[], error: null }),
    canViewProjects
      ? fetchAllRows<Measurement>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_progress_measurements")
            .select("activity_id,project_id,progress_percent,measurement_date,created_at")
            .eq("company_id", companyId)
            .order("measurement_date", { ascending: false })
            .order("created_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Measurement[], error };
        })
      : Promise.resolve({ data: [] as Measurement[], error: null }),
  ]);

  const memoryCountByProject = new Map<string, number>();
  for (const takeoff of takeoffsResult.data) {
    memoryCountByProject.set(takeoff.project_id, (memoryCountByProject.get(takeoff.project_id) ?? 0) + 1);
  }

  const baselinesByProject = new Map<string, Baseline[]>();
  for (const baseline of baselinesResult.data) {
    const list = baselinesByProject.get(baseline.project_id) ?? [];
    list.push(baseline);
    baselinesByProject.set(baseline.project_id, list);
  }

  const selectedBaselineByProject = new Map<string, string>();
  for (const project of projectsResult.data) {
    const baselines = baselinesByProject.get(project.id) ?? [];
    const selected = baselines.find((baseline) => baseline.status === "approved") ?? baselines[0] ?? null;
    if (selected) selectedBaselineByProject.set(project.id, selected.id);
  }

  const latestMeasurementByActivity = new Map<string, Measurement>();
  for (const measurement of measurementsResult.data) {
    if (!latestMeasurementByActivity.has(measurement.activity_id)) {
      latestMeasurementByActivity.set(measurement.activity_id, measurement);
    }
  }

  const projects: DashboardProjectCard[] = projectsResult.data.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    status: project.status,
    city: project.city,
    state: project.state,
    coverImageUrl: project.cover_image_path
      ? supabase.storage.from(IMAGE_BUCKET).getPublicUrl(project.cover_image_path).data.publicUrl
      : null,
    deliveryDate: project.delivery_date,
    builtAreaM2: project.built_area_m2,
    totalUnits: project.total_units,
    totalFloors: project.total_floors,
    progressPercent: progressForProject(
      project.id,
      selectedBaselineByProject.get(project.id) ?? null,
      activitiesResult.data,
      latestMeasurementByActivity,
    ),
    memoryCount: memoryCountByProject.get(project.id) ?? 0,
    isActiveProject: project.id === projectId,
  }));

  const visibleError = privileged && params.error === FALSE_ACCESS_MESSAGE ? null : params.error;
  const partialData = Boolean(
    projectsResult.error || takeoffsResult.error || baselinesResult.error || activitiesResult.error || measurementsResult.error,
  );

  return (
    <AppShell
      activeGroup="home"
      eyebrow="Início"
      title="Dashboard"
      description="Acompanhe os empreendimentos e acesse rapidamente o contexto de cada obra."
      actions={canManageProjects ? <Link className="approved-dashboard-new" href="/empreendimentos">+ Novo empreendimento</Link> : undefined}
    >
      {visibleError ? <div className="auth-message error workspace-message">{visibleError}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      <section className="approved-dashboard">
        <ReferenceProjects projects={projects} companyId={companyId} />
        {partialData ? (
          <div className="approved-dashboard-data-note">
            Alguns dados de cronograma ainda não estão disponíveis; os empreendimentos continuam acessíveis normalmente.
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
