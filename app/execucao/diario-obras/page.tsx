import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  DailyLogCreateDialog,
  DailyLogEditor,
  type ActivityOption,
  type LocationOption,
  type OccurrenceRow,
  type PhotoRow,
  type ServiceRow,
  type SupplierOption,
  type WeatherRow,
  type WorkforceRow,
} from "./daily-log-client";
import {
  DailyCalendar,
  DailyLogIndicators,
  DailyLogKpis,
  DailyLogList,
  DailyLogSettings,
  mapByLog,
  type DailyLogSettingsRecord,
  type DailyLogViewRecord,
  type PhotoRecord,
  type WithLog,
} from "./daily-log-views";
import "../../execution-daily-logs.css";

type Project = { id: string; code: string | null; name: string };
type Baseline = { id: string; status: string };

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function monthValue(value?: string) { return value && /^\d{4}-\d{2}$/.test(value) ? value : todayIso().slice(0, 7); }

export default async function DailyLogsPage({ searchParams }: {
  searchParams: Promise<{ month?: string; tab?: string; diary?: string; create?: string; q?: string; status?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const month = monthValue(params.month);
  const tab = ["calendar", "list", "indicators", "settings"].includes(params.tab ?? "") ? params.tab! : "calendar";
  const today = todayIso();
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.daily_logs.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [
    projectResult, settingsResult, diariesResult, weatherResult, workforceResult, servicesResult,
    occurrencesResult, photosResult, suppliersResult, locationsResult, baselinesResult,
    manageResult, submitResult, approveResult, reopenResult, settingsPermissionResult,
  ] = await Promise.all([
    projectPromise,
    projectId ? supabase.from("execution_daily_log_settings").select("workdays, default_shift, day_end, auto_create, allow_complementary, required_photo_count, retroactive_days").eq("company_id", companyId).eq("project_id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<DailyLogViewRecord>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_logs")
        .select("id, log_date, shift, diary_type, log_number, version, is_current, status, work_start, work_end, general_notes, no_occurrences, no_safety_events, confirmed_by_filler, completion_percent, responsible_name, submitted_at, approved_at, approval_notes, reopened_reason, cancellation_reason, created_at")
        .eq("company_id", companyId).eq("project_id", projectId).order("log_date", { ascending: false }).order("version", { ascending: false }).range(from, to);
      return { data: (data ?? []) as DailyLogViewRecord[], error };
    }) : Promise.resolve({ data: [] as DailyLogViewRecord[], error: null }),
    projectId ? fetchAllRows<WeatherRow & WithLog>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_log_weather").select("id, daily_log_id, period, condition, temperature_c, rain_mm, stopped_hours, notes").eq("company_id", companyId).eq("project_id", projectId).range(from, to);
      return { data: (data ?? []) as (WeatherRow & WithLog)[], error };
    }) : Promise.resolve({ data: [] as (WeatherRow & WithLog)[], error: null }),
    projectId ? fetchAllRows<WorkforceRow & WithLog>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_log_workforce").select("id, daily_log_id, supplier_id, company_name, role_name, worker_count, work_start, work_end, break_hours, notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as (WorkforceRow & WithLog)[], error };
    }) : Promise.resolve({ data: [] as (WorkforceRow & WithLog)[], error: null }),
    projectId ? fetchAllRows<ServiceRow & WithLog>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_log_services").select("id, daily_log_id, schedule_activity_id, service_id, location_id, service_code, service_name, location_name, unit_snapshot, planned_quantity, executed_quantity, progress_percent, notes, source").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as (ServiceRow & WithLog)[], error };
    }) : Promise.resolve({ data: [] as (ServiceRow & WithLog)[], error: null }),
    projectId ? fetchAllRows<OccurrenceRow & WithLog>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_log_occurrences").select("id, daily_log_id, occurrence_type, impact, title, description, action_taken, status, affects_schedule, is_safety_event, is_critical, occurred_at").eq("company_id", companyId).eq("project_id", projectId).order("created_at").range(from, to);
      return { data: (data ?? []) as (OccurrenceRow & WithLog)[], error };
    }) : Promise.resolve({ data: [] as (OccurrenceRow & WithLog)[], error: null }),
    projectId ? fetchAllRows<PhotoRecord>(async (from, to) => {
      const { data, error } = await supabase.from("execution_daily_log_photos").select("id, daily_log_id, storage_path, file_name, caption").eq("company_id", companyId).eq("project_id", projectId).order("uploaded_at").range(from, to);
      return { data: (data ?? []) as PhotoRecord[], error };
    }) : Promise.resolve({ data: [] as PhotoRecord[], error: null }),
    fetchAllRows<SupplierOption>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id, legal_name, trade_name").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to);
      return { data: (data ?? []) as SupplierOption[], error };
    }),
    projectId ? fetchAllRows<LocationOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_takeoff_locations").select("id, code, name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "active").order("sort_order").range(from, to);
      return { data: (data ?? []) as LocationOption[], error };
    }) : Promise.resolve({ data: [] as LocationOption[], error: null }),
    projectId ? fetchAllRows<Baseline>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_baselines").select("id, status").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Baseline[], error };
    }) : Promise.resolve({ data: [] as Baseline[], error: null }),
    permission("execution.daily_logs.manage"), permission("execution.daily_logs.submit"),
    permission("execution.daily_logs.approve"), permission("execution.daily_logs.reopen"),
    permission("execution.daily_logs.settings"),
  ]);

  const project = projectResult.data as Project | null;
  const settings: DailyLogSettingsRecord = (settingsResult.data as DailyLogSettingsRecord | null) ?? {
    workdays: [1, 2, 3, 4, 5, 6], default_shift: "day", day_end: "18:00", auto_create: true,
    allow_complementary: false, required_photo_count: 1, retroactive_days: 30,
  };
  const canManage = manageResult.data === true || privileged;
  const canSubmit = submitResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canReopen = reopenResult.data === true || privileged;
  const canSettings = settingsPermissionResult.data === true || privileged;
  const structureError = diariesResult.error || weatherResult.error || workforceResult.error || servicesResult.error || occurrencesResult.error || photosResult.error;

  const diaries = diariesResult.data;
  const current = diaries.filter((item) => item.is_current);
  const weatherMap = mapByLog(weatherResult.data);
  const workforceMap = mapByLog(workforceResult.data);
  const servicesMap = mapByLog(servicesResult.data);
  const occurrencesMap = mapByLog(occurrencesResult.data);
  const photosMap = mapByLog(photosResult.data);
  const selectedDiary = params.diary ? diaries.find((item) => item.id === params.diary) ?? null : null;
  const selectedBaseline = baselinesResult.data.find((item) => item.status === "approved") ?? baselinesResult.data[0] ?? null;

  const activitiesResult = selectedBaseline && projectId ? await fetchAllRows<ActivityOption>(async (from, to) => {
    const { data, error } = await supabase.from("engineering_schedule_activities")
      .select("id, service_id, location_id, code, name, unit_snapshot, quantity_snapshot, planned_start, planned_finish")
      .eq("company_id", companyId).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id)
      .eq("record_status", "active").order("planned_start").range(from, to);
    return { data: (data ?? []) as ActivityOption[], error };
  }) : { data: [] as ActivityOption[], error: null };

  let selectedPhotos: PhotoRow[] = [];
  if (selectedDiary) {
    const records = photosMap.get(selectedDiary.id) ?? [];
    const signed = records.length ? await supabase.storage.from("daily-log-photos").createSignedUrls(records.map((item) => item.storage_path), 3600) : { data: [], error: null };
    const urlMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    selectedPhotos = records.map((item) => ({ id: item.id, file_name: item.file_name, caption: item.caption, signed_url: urlMap.get(item.storage_path) ?? null }));
  }

  const monthLogs = current.filter((item) => item.log_date.startsWith(month) && item.diary_type === "principal" && item.status !== "cancelled");
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell
    activeGroup="execution" activeItem="daily-logs" eyebrow="Execução · Controle de Campo" title="Diário de Obras"
    description={`${company.name} · ${context} · registro oficial diário de clima, equipes, serviços, ocorrências e evidências.`}
    actions={canManage && projectId ? <DailyLogCreateDialog defaultShift={settings.default_shift} allowComplementary={settings.allow_complementary} /> : undefined}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura do Diário de Obras ainda não está instalada. Execute a migration <strong>20260728_0034_execution_daily_logs.sql</strong>.</div> : null}
    {!projectId ? <div className="daily-log-empty-page">Selecione uma obra no topo.</div> : null}
    {params.create && canManage ? <DailyLogCreateDialog defaultDate={params.create} defaultShift={settings.default_shift} allowComplementary={settings.allow_complementary} autoOpen buttonLabel="Criar diário desta data" /> : null}

    {projectId ? <>
      <nav className="daily-log-tabs">
        <Link className={tab === "calendar" ? "active" : ""} href={`?month=${month}&tab=calendar`}>Calendário</Link>
        <Link className={tab === "list" ? "active" : ""} href={`?month=${month}&tab=list`}>Lista de diários</Link>
        <Link className={tab === "indicators" ? "active" : ""} href={`?month=${month}&tab=indicators`}>Indicadores</Link>
        <Link className={tab === "settings" ? "active" : ""} href={`?month=${month}&tab=settings`}>Configurações</Link>
      </nav>

      {selectedDiary ? <>
        <div className="daily-log-back"><Link href={`?month=${selectedDiary.log_date.slice(0, 7)}&tab=${tab}`}>← Voltar</Link><span>{diaries.filter((item) => item.log_number === selectedDiary.log_number).length} versão(ões) preservada(s)</span></div>
        <DailyLogEditor
          diary={selectedDiary}
          initialWeather={weatherMap.get(selectedDiary.id) ?? []}
          initialWorkforce={workforceMap.get(selectedDiary.id) ?? []}
          initialServices={servicesMap.get(selectedDiary.id) ?? []}
          initialOccurrences={occurrencesMap.get(selectedDiary.id) ?? []}
          photos={selectedPhotos}
          suppliers={suppliersResult.data}
          activities={activitiesResult.data}
          locations={locationsResult.data}
          canManage={canManage} canSubmit={canSubmit} canApprove={canApprove} canReopen={canReopen}
        />
      </> : <>
        <DailyLogKpis logs={monthLogs} workforceMap={workforceMap} today={today} />
        {tab === "calendar" ? <DailyCalendar month={month} logs={monthLogs} weatherMap={weatherMap} workforceMap={workforceMap} servicesMap={servicesMap} occurrencesMap={occurrencesMap} photosMap={photosMap} today={today} canManage={canManage} /> : null}
        {tab === "list" ? <DailyLogList month={month} logs={current} weatherMap={weatherMap} workforceMap={workforceMap} servicesMap={servicesMap} occurrencesMap={occurrencesMap} photosMap={photosMap} q={params.q ?? ""} status={params.status ?? ""} /> : null}
        {tab === "indicators" ? <DailyLogIndicators logs={current} weatherMap={weatherMap} workforceMap={workforceMap} servicesMap={servicesMap} occurrencesMap={occurrencesMap} photosMap={photosMap} /> : null}
        {tab === "settings" ? <DailyLogSettings settings={settings} canSettings={canSettings} month={month} /> : null}
      </>}
    </> : null}
  </AppShell>;
}
