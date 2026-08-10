import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { buildDashboardPhysicalMonths } from "@/lib/dashboard-physical-curve.mjs";
import ModelDashboard from "./model-dashboard";
import { PhysicalCurve, type PhysicalMonth } from "./dashboard-model-components";

type MembershipRow = { company_id: string };
type ProjectRow = { id: string; company_id: string };
type BaselineRow = { id: string; status: string; updated_at: string };
type ActivityRow = {
  id: string;
  service_id: string | null;
  quantity_snapshot: number;
  duration_days: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
  record_status: string;
};
type MeasurementRow = {
  activity_id: string;
  measurement_date: string;
  progress_percent: number;
  created_at: string;
};
type WeightRow = {
  service_id: string;
  physical_weight_percent: number;
  distribution_method: "quantity" | "cost" | "duration" | "equal";
};

type PhysicalCurveInput = {
  activities: ActivityRow[];
  measurements: MeasurementRow[];
  serviceWeights: WeightRow[];
  today: string;
  maxMonths?: number;
};

const buildPhysicalMonths = buildDashboardPhysicalMonths as unknown as (
  input: PhysicalCurveInput,
) => PhysicalMonth[];

function localDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function loadPhysicalMonths(): Promise<PhysicalMonth[] | null> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || !authData?.claims) return null;
  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  if (!userId) return null;

  const { data: membershipData, error: membershipError } = await supabase
    .from("company_memberships")
    .select("company_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at");
  if (membershipError) return null;

  const memberships = (membershipData ?? []) as MembershipRow[];
  if (!memberships.length) return null;
  const cookieStore = await cookies();
  const requestedCompanyId = cookieStore.get("elos_company_id")?.value;
  const requestedProjectId = cookieStore.get("elos_project_id")?.value;
  const companyId = memberships.some((row) => row.company_id === requestedCompanyId)
    ? requestedCompanyId!
    : memberships[0].company_id;

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("id,company_id")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("name");
  if (projectError) return null;
  const projects = (projectData ?? []) as ProjectRow[];
  const projectId = projects.some((row) => row.id === requestedProjectId)
    ? requestedProjectId!
    : projects[0]?.id ?? null;
  if (!projectId) return null;

  const { data: baselineData, error: baselineError } = await supabase
    .from("engineering_schedule_baselines")
    .select("id,status,updated_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (baselineError) return null;
  const baselines = (baselineData ?? []) as BaselineRow[];
  const baseline = baselines.find((row) => row.status === "approved") ?? baselines[0] ?? null;
  if (!baseline) return [];

  const [activitiesResult, measurementsResult, weightsResult] = await Promise.all([
    fetchAllRows<ActivityRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_activities")
        .select("id,service_id,quantity_snapshot,duration_days,planned_start,planned_finish,planned_cost,record_status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .eq("record_status", "active")
        .range(from, to);
      return { data: (data ?? []) as ActivityRow[], error };
    }),
    fetchAllRows<MeasurementRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_progress_measurements")
        .select("activity_id,measurement_date,progress_percent,created_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("measurement_date")
        .order("created_at")
        .range(from, to);
      return { data: (data ?? []) as MeasurementRow[], error };
    }),
    fetchAllRows<WeightRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_service_weights")
        .select("service_id,physical_weight_percent,distribution_method")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .range(from, to);
      return { data: (data ?? []) as WeightRow[], error };
    }),
  ]);

  if (activitiesResult.error || measurementsResult.error || weightsResult.error) return null;

  return buildPhysicalMonths({
    activities: activitiesResult.data,
    measurements: measurementsResult.data,
    serviceWeights: weightsResult.data,
    today: localDateIso(),
  });
}

function replacePhysicalCurve(node: ReactNode, rows: PhysicalMonth[]): ReactNode {
  if (Array.isArray(node)) return node.map((child) => replacePhysicalCurve(child, rows));
  if (!isValidElement(node)) return node;
  if (node.type === PhysicalCurve) return <PhysicalCurve rows={rows} />;

  const element = node as ReactElement<{ children?: ReactNode }>;
  if (!("children" in element.props)) return node;
  const children = replacePhysicalCurve(element.props.children, rows);
  return cloneElement(element, undefined, children);
}

export default async function DashboardWithPhysicalCurve({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const [dashboard, curveRows] = await Promise.all([
    ModelDashboard({ searchParams }),
    loadPhysicalMonths(),
  ]);

  if (curveRows === null) return dashboard;
  return replacePhysicalCurve(dashboard, curveRows);
}
