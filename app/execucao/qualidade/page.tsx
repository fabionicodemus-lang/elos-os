import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  reportCorrection,
  reinspectNonconformity,
  saveQualitySettings,
  syncQualityInspections,
} from "./actions";
import {
  InspectionEditor,
  ManualInspectionDialog,
  RuleDialog,
  TemplateDialog,
  type ActivityOption,
  type AttachmentRecord,
  type CriterionRecord,
  type InspectionItemRecord,
  type InspectionRecord,
  type LocationOption,
  type ServiceOption,
  type SupplierOption,
  type TemplateRecord,
} from "./quality-client";
import "../../execution-quality.css";

type Project = { id: string; code: string | null; name: string };
type Rule = {
  id: string;
  template_id: string;
  service_id: string;
  event_type: string;
  stage_name: string;
  due_offset_days: number;
  location_scope: string;
  only_first_location: boolean;
  active: boolean;
};
type Version = {
  id: string;
  template_id: string;
  version_no: number;
  status: string;
  published_at: string | null;
};
type Inspection = InspectionRecord & {
  project_id: string;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};
type Item = InspectionItemRecord & { inspection_id: string };
type Nonconformity = {
  id: string;
  inspection_id: string;
  inspection_item_id: string;
  service_id: string;
  location_id: string | null;
  supplier_id: string | null;
  nc_number: string;
  description: string;
  severity: string;
  is_blocking: boolean;
  responsible_team: string | null;
  opened_at: string;
  due_at: string;
  probable_cause: string | null;
  corrective_action: string | null;
  estimated_rework_cost: number;
  correction_report: string | null;
  correction_reported_at: string | null;
  status: string;
  closed_at: string | null;
};
type Settings = {
  responsible_engineer_user_id: string | null;
  first_inspection_weight: number;
  on_time_correction_weight: number;
  non_recurrence_weight: number;
  critical_due_hours: number;
  serious_due_days: number;
  light_due_days: number;
  auto_sync: boolean;
};
type Profile = { id: string; full_name: string | null };
type AttachmentDb = Omit<AttachmentRecord, "signed_url"> & { storage_path: string };

type TabKey =
  | "overview"
  | "my"
  | "all"
  | "nc"
  | "blocked"
  | "map"
  | "indicators"
  | "templates"
  | "settings";

const tabs: Array<[TabKey, string]> = [
  ["overview", "Visão geral"],
  ["my", "Minhas vistorias"],
  ["all", "Todas as vistorias"],
  ["nc", "Não conformidades"],
  ["blocked", "Serviços bloqueados"],
  ["map", "Mapa da obra"],
  ["indicators", "Indicadores"],
  ["templates", "Modelos e regras"],
  ["settings", "Configurações"],
];

const statusLabels: Record<string, string> = {
  pending: "Pendente",
  in_progress: "Em preenchimento",
  approved: "Aprovada",
  approved_with_reservations: "Aprovada com ressalvas",
  nonconforming: "Com não conformidade",
  blocked: "Serviço bloqueado",
  awaiting_reinspection: "Aguardando reinspeção",
  closed: "Encerrada",
  cancelled: "Cancelada",
};

const ncLabels: Record<string, string> = {
  open: "Aberta",
  in_correction: "Em correção",
  awaiting_reinspection: "Aguardando reinspeção",
  closed: "Encerrada",
  overdue: "Vencida",
};

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateBR(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(`${value.slice(0, 10)}T12:00:00Z`),
      )
    : "—";
}

function dateTimeBR(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "—";
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function decimal(value: number, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function scoreClass(value: number | null) {
  if (value === null) return "neutral";
  if (value >= 90) return "excellent";
  if (value >= 80) return "good";
  if (value >= 70) return "attention";
  return "critical";
}

function inspectionHref(id: string, tab: string) {
  return `?tab=${tab}&inspection=${id}`;
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    inspection?: string;
    nc?: string;
    q?: string;
    status?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const tab = (tabs.some(([key]) => key === params.tab)
    ? params.tab
    : "overview") as TabKey;
  const currentDate = today();
  const { supabase, company, companyId, projectId, userId, roleKey } =
    await requireCompanyPermission("execution.quality.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) =>
    privileged
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: key,
        });
  const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });

  const projectPromise = projectId
    ? supabase
        .from("projects")
        .select("id,code,name")
        .eq("id", projectId)
        .eq("company_id", companyId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [
    projectResult,
    settingsResult,
    templatesResult,
    versionsResult,
    criteriaResult,
    rulesResult,
    inspectionsResult,
    itemsResult,
    ncResult,
    attachmentsResult,
    servicesResult,
    locationsResult,
    suppliersResult,
    baselinesResult,
    membersResult,
    fillPermission,
    completePermission,
    ncPermission,
    reinspectPermission,
    cancelPermission,
    exceptionPermission,
    templatesPermission,
    settingsPermission,
    indicatorsPermission,
  ] = await Promise.all([
    projectPromise,
    projectId
      ? supabase
          .from("quality_settings")
          .select(
            "responsible_engineer_user_id,first_inspection_weight,on_time_correction_weight,non_recurrence_weight,critical_due_hours,serious_due_days,light_due_days,auto_sync",
          )
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    fetchAllRows<TemplateRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("quality_checklist_templates")
        .select(
          "id,service_id,code,name,description,criticality,service_weight,inspection_unit,periodicity,sampling_rule,evidence_rule,has_blocking_gate,current_version_id",
        )
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as TemplateRecord[], error };
    }),
    fetchAllRows<Version>(async (from, to) => {
      const { data, error } = await supabase
        .from("quality_checklist_versions")
        .select("id,template_id,version_no,status,published_at")
        .eq("company_id", companyId)
        .order("version_no", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as Version[], error };
    }),
    fetchAllRows<CriterionRecord & { version_id: string }>(async (from, to) => {
      const { data, error } = await supabase
        .from("quality_checklist_criteria")
        .select(
          "id,version_id,group_name,code,description,verification_method,acceptance_criterion,verification_moment,weight,failure_severity,is_blocking,requires_photo,requires_measurement,measurement_unit,allow_reservation,is_required,guidance,sort_order",
        )
        .eq("company_id", companyId)
        .order("sort_order")
        .range(from, to);
      return {
        data: (data ?? []) as Array<CriterionRecord & { version_id: string }>,
        error,
      };
    }),
    projectId
      ? fetchAllRows<Rule>(async (from, to) => {
          const { data, error } = await supabase
            .from("quality_inspection_rules")
            .select(
              "id,template_id,service_id,event_type,stage_name,due_offset_days,location_scope,only_first_location,active",
            )
            .eq("company_id", companyId)
            .or(`project_id.is.null,project_id.eq.${projectId}`)
            .order("stage_name")
            .range(from, to);
          return { data: (data ?? []) as Rule[], error };
        })
      : empty<Rule>(),
    projectId
      ? fetchAllRows<Inspection>(async (from, to) => {
          const { data, error } = await supabase
            .from("quality_inspections")
            .select(
              "id,project_id,template_id,checklist_version_id,rule_id,schedule_activity_id,service_id,location_id,supplier_id,stage_name,tower,unit_name,environment_name,executor_team,responsible_engineer_user_id,inspection_number,origin,due_date,status,completion_percent,current_score,first_inspection_score,release_status,general_notes,executor_confirmed,created_at,completed_at,cancelled_at",
            )
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("due_date")
            .range(from, to);
          return { data: (data ?? []) as Inspection[], error };
        })
      : empty<Inspection>(),
    projectId
      ? fetchAllRows<Item>(async (from, to) => {
          const { data, error } = await supabase
            .from("quality_inspection_items")
            .select(
              "id,inspection_id,group_name_snapshot,code_snapshot,description_snapshot,verification_method_snapshot,acceptance_criterion_snapshot,weight_snapshot,failure_severity_snapshot,is_blocking_snapshot,requires_photo_snapshot,requires_measurement_snapshot,measurement_unit_snapshot,allow_reservation_snapshot,is_required_snapshot,guidance_snapshot,response,measurement_value,observation,sort_order",
            )
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as Item[], error };
        })
      : empty<Item>(),
    projectId
      ? fetchAllRows<Nonconformity>(async (from, to) => {
          const { data, error } = await supabase
            .from("quality_nonconformities")
            .select(
              "id,inspection_id,inspection_item_id,service_id,location_id,supplier_id,nc_number,description,severity,is_blocking,responsible_team,opened_at,due_at,probable_cause,corrective_action,estimated_rework_cost,correction_report,correction_reported_at,status,closed_at",
            )
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("opened_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Nonconformity[], error };
        })
      : empty<Nonconformity>(),
    projectId
      ? fetchAllRows<AttachmentDb>(async (from, to) => {
          const { data, error } = await supabase
            .from("quality_attachments")
            .select(
              "id,inspection_id,inspection_item_id,nonconformity_id,attachment_type,file_name,caption,storage_path",
            )
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("uploaded_at")
            .range(from, to);
          return { data: (data ?? []) as AttachmentDb[], error };
        })
      : empty<AttachmentDb>(),
    fetchAllRows<ServiceOption>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id,code,description")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ServiceOption[], error };
    }),
    projectId
      ? fetchAllRows<LocationOption>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoff_locations")
            .select("id,code,name")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as LocationOption[], error };
        })
      : empty<LocationOption>(),
    fetchAllRows<SupplierOption>(async (from, to) => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,legal_name,trade_name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("legal_name")
        .range(from, to);
      return { data: (data ?? []) as SupplierOption[], error };
    }),
    projectId
      ? fetchAllRows<{ id: string; status: string }>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id,status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .neq("status", "archived")
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Array<{ id: string; status: string }>, error };
        })
      : empty<{ id: string; status: string }>(),
    supabase
      .from("company_memberships")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("status", "active"),
    permission("execution.quality.fill"),
    permission("execution.quality.complete"),
    permission("execution.quality.nonconformity"),
    permission("execution.quality.reinspect"),
    permission("execution.quality.cancel"),
    permission("execution.quality.exception"),
    permission("execution.quality.templates"),
    permission("execution.quality.settings"),
    permission("execution.quality.indicators"),
  ]);

  const memberIds = (membersResult.data ?? []).map(
    (row: { user_id: string }) => row.user_id,
  );
  const profilesResult = memberIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", memberIds)
    : { data: [] };
  const profiles = (profilesResult.data ?? []) as Profile[];
  const selectedBaseline =
    baselinesResult.data.find((row) => row.status === "approved") ??
    baselinesResult.data[0] ??
    null;
  const activitiesResult =
    selectedBaseline && projectId
      ? await fetchAllRows<ActivityOption>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_activities")
            .select(
              "id,service_id,location_id,code,name,planned_start,planned_finish",
            )
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("baseline_id", selectedBaseline.id)
            .eq("record_status", "active")
            .order("planned_start")
            .range(from, to);
          return { data: (data ?? []) as ActivityOption[], error };
        })
      : { data: [] as ActivityOption[], error: null };

  const project = projectResult.data as Project | null;
  const settings = (settingsResult.data as Settings | null) ?? {
    responsible_engineer_user_id: null,
    first_inspection_weight: 85,
    on_time_correction_weight: 10,
    non_recurrence_weight: 5,
    critical_due_hours: 24,
    serious_due_days: 3,
    light_due_days: 7,
    auto_sync: true,
  };
  const templates = templatesResult.data.map((template) => ({
    ...template,
    version_no:
      versionsResult.data.find(
        (version) => version.id === template.current_version_id,
      )?.version_no ?? 1,
  }));
  const serviceMap = new Map(servicesResult.data.map((row) => [row.id, row]));
  const locationMap = new Map(locationsResult.data.map((row) => [row.id, row]));
  const supplierMap = new Map(suppliersResult.data.map((row) => [row.id, row]));
  const profileMap = new Map(
    profiles.map((row) => [row.id, row.full_name || "Usuário"]),
  );
  const selectedInspection = params.inspection
    ? inspectionsResult.data.find((row) => row.id === params.inspection) ?? null
    : null;
  const selectedNc = params.nc
    ? ncResult.data.find((row) => row.id === params.nc) ?? null
    : null;

  let selectedAttachments: AttachmentRecord[] = [];
  if (selectedInspection) {
    const records = attachmentsResult.data.filter(
      (row) => row.inspection_id === selectedInspection.id,
    );
    const signed = records.length
      ? await supabase.storage
          .from("quality-evidence")
          .createSignedUrls(
            records.map((row) => row.storage_path),
            3600,
          )
      : { data: [], error: null };
    const urlMap = new Map(
      (signed.data ?? []).map((row) => [row.path, row.signedUrl]),
    );
    selectedAttachments = records.map(({ storage_path, ...row }) => ({
      ...row,
      signed_url: urlMap.get(storage_path) ?? null,
    }));
  }

  const canFill = fillPermission.data === true || privileged;
  const canComplete = completePermission.data === true || privileged;
  const canNc = ncPermission.data === true || privileged;
  const canReinspect = reinspectPermission.data === true || privileged;
  const canCancel = cancelPermission.data === true || privileged;
  const canException = exceptionPermission.data === true || privileged;
  const canTemplates = templatesPermission.data === true || privileged;
  const canSettings = settingsPermission.data === true || privileged;
  const canIndicators = indicatorsPermission.data === true || privileged;

  // Indicadores agregados no banco, cobrindo toda a obra sem depender das linhas
  // carregadas nesta página.
  const qualityIndicatorsResult = projectId
    ? await supabase.rpc("quality_indicators", { p_company_id: companyId, p_project_id: projectId })
    : { data: null, error: null };
  const qualityIndicators = (qualityIndicatorsResult.data as QualityIndicatorData | null) ?? {
    inspection_count: 0, completed_count: 0, average_score: 0, first_pass_count: 0,
    open_nc_count: 0, closed_nc_count: 0, on_time_nc_count: 0, blocked_count: 0,
    score_by_service: [], nc_by_severity: {},
  };
  const structureError =
    templatesResult.error ||
    inspectionsResult.error ||
    itemsResult.error ||
    ncResult.error;
  const actions = projectId ? (
    <div className="quality-page-actions">
      {canFill ? (
        <form action={syncQualityInspections}>
          <button type="submit">↻ Sincronizar cronograma</button>
        </form>
      ) : null}
      {canFill ? (
        <ManualInspectionDialog
          templates={templates}
          activities={activitiesResult.data}
          locations={locationsResult.data}
          suppliers={suppliersResult.data}
        />
      ) : null}
    </div>
  ) : undefined;
  const context = project
    ? `${project.code ? `${project.code} · ` : ""}${project.name}`
    : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="execution"
      activeItem="quality"
      eyebrow="Execução · Controle de Qualidade"
      title="Qualidade"
      description={`${company.name} · ${context} · vistorias, não conformidades, bloqueios, reinspeções e liberação dos serviços.`}
      actions={actions}
    >
      {params.success ? (
        <div className="auth-message success workspace-message">
          {params.success}
        </div>
      ) : null}
      {params.error ? (
        <div className="auth-message error workspace-message">
          {params.error}
        </div>
      ) : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          A estrutura da Qualidade ainda não está instalada. Execute a migration{" "}
          <strong>20260728_0036_execution_quality.sql</strong>.
        </div>
      ) : null}
      {!projectId ? (
        <div className="quality-empty">Selecione uma obra no topo.</div>
      ) : (
        <>
          <nav className="quality-tabs">
            {tabs
              .filter(
                ([key]) =>
                  (key !== "templates" || canTemplates) &&
                  (key !== "settings" || canSettings) &&
                  (key !== "indicators" || canIndicators),
              )
              .map(([key, label]) => (
                <Link
                  className={tab === key ? "active" : ""}
                  href={`?tab=${key}`}
                  key={key}
                >
                  {label}
                </Link>
              ))}
          </nav>

          {!settings.responsible_engineer_user_id ? (
            <div className="quality-setup-alert">
              <strong>Defina o engenheiro responsável.</strong>
              <span>
                Até a configuração, novas vistorias serão atribuídas ao usuário
                que executar a sincronização.
              </span>
              {canSettings ? <Link href="?tab=settings">Configurar agora</Link> : null}
            </div>
          ) : null}

          {selectedInspection ? (
            <>
              <div className="quality-back">
                <Link href={`?tab=${tab}`}>← Voltar</Link>
                <span>{selectedInspection.inspection_number}</span>
              </div>
              <InspectionEditor
                inspection={selectedInspection}
                items={itemsResult.data.filter(
                  (row) => row.inspection_id === selectedInspection.id,
                )}
                attachments={selectedAttachments}
                suppliers={suppliersResult.data}
                serviceName={
                  serviceMap.get(selectedInspection.service_id)?.description ??
                  "Serviço"
                }
                locationName={
                  selectedInspection.location_id
                    ? `${locationMap.get(selectedInspection.location_id)?.code ?? ""} · ${locationMap.get(selectedInspection.location_id)?.name ?? "Local"}`
                    : "Obra inteira"
                }
                responsibleName={
                  profileMap.get(selectedInspection.responsible_engineer_user_id) ??
                  "Engenheiro responsável"
                }
                canFill={canFill}
                canComplete={canComplete}
                canCancel={canCancel}
                canException={canException}
              />
            </>
          ) : selectedNc ? (
            <>
              <div className="quality-back">
                <Link href="?tab=nc">← Voltar às não conformidades</Link>
                <span>{selectedNc.nc_number}</span>
              </div>
              <NonconformityDetail
                nc={selectedNc}
                inspection={
                  inspectionsResult.data.find(
                    (row) => row.id === selectedNc.inspection_id,
                  ) ?? null
                }
                serviceName={
                  serviceMap.get(selectedNc.service_id)?.description ?? "Serviço"
                }
                locationName={
                  selectedNc.location_id
                    ? locationMap.get(selectedNc.location_id)?.name ?? "Local"
                    : "Obra"
                }
                supplierName={
                  selectedNc.supplier_id
                    ? supplierMap.get(selectedNc.supplier_id)?.trade_name ||
                      supplierMap.get(selectedNc.supplier_id)?.legal_name ||
                      "Equipe"
                    : "Equipe não cadastrada"
                }
                canManage={canNc}
                canReinspect={canReinspect}
              />
            </>
          ) : (
            <>
              {tab === "overview" ? (
                <Overview
                  inspections={inspectionsResult.data}
                  ncs={ncResult.data}
                  services={serviceMap}
                  locations={locationMap}
                  now={currentDate}
                />
              ) : null}
              {tab === "my" ? (
                <InspectionList
                  title="Minhas vistorias"
                  inspections={inspectionsResult.data.filter(
                    (row) => row.responsible_engineer_user_id === userId,
                  )}
                  serviceMap={serviceMap}
                  locationMap={locationMap}
                  now={currentDate}
                  tab="my"
                  q={params.q ?? ""}
                  status={params.status ?? ""}
                />
              ) : null}
              {tab === "all" ? (
                <InspectionList
                  title="Todas as vistorias"
                  inspections={inspectionsResult.data}
                  serviceMap={serviceMap}
                  locationMap={locationMap}
                  now={currentDate}
                  tab="all"
                  q={params.q ?? ""}
                  status={params.status ?? ""}
                />
              ) : null}
              {tab === "nc" ? (
                <NonconformityList
                  rows={ncResult.data}
                  inspections={inspectionsResult.data}
                  serviceMap={serviceMap}
                  locationMap={locationMap}
                  now={currentDate}
                />
              ) : null}
              {tab === "blocked" ? (
                <BlockedList
                  inspections={inspectionsResult.data.filter(
                    (row) => row.release_status === "blocked",
                  )}
                  ncs={ncResult.data}
                  serviceMap={serviceMap}
                  locationMap={locationMap}
                />
              ) : null}
              {tab === "map" ? (
                <QualityMap
                  inspections={inspectionsResult.data}
                  ncs={ncResult.data}
                  locations={locationsResult.data}
                  services={serviceMap}
                />
              ) : null}
              {tab === "indicators" && canIndicators ? (
                <Indicators
                  indicators={qualityIndicators}
                  serviceMap={serviceMap}
                />
              ) : null}
              {tab === "templates" && canTemplates ? (
                <TemplatesArea
                  templates={templates}
                  versions={versionsResult.data}
                  criteria={criteriaResult.data}
                  rules={rulesResult.data}
                  services={servicesResult.data}
                />
              ) : null}
              {tab === "settings" && canSettings ? (
                <SettingsArea settings={settings} profiles={profiles} />
              ) : null}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function Overview({
  inspections,
  ncs,
  services,
  locations,
  now,
}: {
  inspections: Inspection[];
  ncs: Nonconformity[];
  services: Map<string, ServiceOption>;
  locations: Map<string, LocationOption>;
  now: string;
}) {
  const active = inspections.filter((row) => row.status !== "cancelled");
  const pending = active.filter((row) =>
    ["pending", "in_progress"].includes(row.status),
  );
  const overdue = pending.filter((row) => row.due_date < now);
  const todayRows = pending.filter((row) => row.due_date === now);
  const reinspection = active.filter(
    (row) => row.status === "awaiting_reinspection",
  );
  const openNc = ncs.filter((row) => row.status !== "closed");
  const expiredNc = openNc.filter((row) => row.due_at.slice(0, 10) < now);
  const blocked = active.filter((row) => row.release_status === "blocked");
  const scored = active.filter((row) => row.first_inspection_score !== null);
  const score = scored.length
    ? scored.reduce(
        (sum, row) => sum + Number(row.first_inspection_score),
        0,
      ) / scored.length
    : null;
  const firstApproved = scored.length
    ? (scored.filter(
        (row) =>
          Number(row.first_inspection_score) >= 80 && row.status !== "blocked",
      ).length /
        scored.length) *
      100
    : 0;
  const priorities = [
    ...overdue,
    ...todayRows,
    ...pending.filter((row) => row.due_date > now),
  ].filter(
    (row, index, rows) => rows.findIndex((item) => item.id === row.id) === index,
  );

  return (
    <>
      <section className="quality-kpis">
        <article>
          <span>Pendentes</span><strong>{pending.length}</strong>
          <small>permanecem até 100%</small>
        </article>
        <article className={overdue.length ? "danger" : ""}>
          <span>Vencidas</span><strong>{overdue.length}</strong>
          <small>prazo ultrapassado</small>
        </article>
        <article>
          <span>Para hoje</span><strong>{todayRows.length}</strong>
          <small>vistorias previstas</small>
        </article>
        <article>
          <span>Em preenchimento</span>
          <strong>{active.filter((row) => row.status === "in_progress").length}</strong>
          <small>salvas parcialmente</small>
        </article>
        <article>
          <span>Aguardando reinspeção</span><strong>{reinspection.length}</strong>
          <small>correções informadas</small>
        </article>
        <article className={openNc.length ? "warning" : ""}>
          <span>NCs abertas</span><strong>{openNc.length}</strong>
          <small>{expiredNc.length} vencida(s)</small>
        </article>
        <article className={blocked.length ? "danger" : ""}>
          <span>Serviços bloqueados</span><strong>{blocked.length}</strong>
          <small>gate da qualidade</small>
        </article>
        <article className={scoreClass(score)}>
          <span>Nota acumulada</span>
          <strong>{score === null ? "—" : decimal(score)}</strong>
          <small>{scored.length} vistoria(s)</small>
        </article>
        <article>
          <span>Aprovação inicial</span><strong>{decimal(firstApproved)}%</strong>
          <small>primeira inspeção</small>
        </article>
      </section>
      <section className="quality-overview-grid">
        <article>
          <header>
            <div><span>Prioridade</span><h2>Vistorias que exigem atenção</h2></div>
            <Link href="?tab=my">Ver minhas vistorias</Link>
          </header>
          {priorities.slice(0, 8).map((row) => (
            <Link
              className="quality-task"
              href={inspectionHref(row.id, "overview")}
              key={row.id}
            >
              <div>
                <strong>
                  {row.inspection_number} · {services.get(row.service_id)?.description}
                </strong>
                <span>
                  {row.stage_name} · {row.location_id
                    ? locations.get(row.location_id)?.name
                    : "Obra"}
                </span>
              </div>
              <div>
                <span
                  className={`quality-status ${row.due_date < now ? "overdue" : row.status}`}
                >
                  {row.due_date < now ? "Vencida" : statusLabels[row.status]}
                </span>
                <small>{dateBR(row.due_date)}</small>
              </div>
            </Link>
          ))}
          {pending.length === 0 ? (
            <p className="quality-empty-row">Nenhuma vistoria pendente.</p>
          ) : null}
        </article>
        <article>
          <header>
            <div><span>Não conformidades</span><h2>Correções e bloqueios</h2></div>
            <Link href="?tab=nc">Abrir painel</Link>
          </header>
          {openNc.slice(0, 8).map((row) => (
            <Link
              className="quality-task"
              href={`?tab=nc&nc=${row.id}`}
              key={row.id}
            >
              <div>
                <strong>
                  {row.nc_number} · {services.get(row.service_id)?.description}
                </strong>
                <span>{row.description}</span>
              </div>
              <div>
                <span className={`quality-severity ${row.severity}`}>
                  {row.severity}
                </span>
                <small>{dateTimeBR(row.due_at)}</small>
              </div>
            </Link>
          ))}
          {openNc.length === 0 ? (
            <p className="quality-empty-row">Nenhuma não conformidade aberta.</p>
          ) : null}
        </article>
      </section>
    </>
  );
}

function InspectionList({
  title,
  inspections,
  serviceMap,
  locationMap,
  now,
  tab,
  q,
  status,
}: {
  title: string;
  inspections: Inspection[];
  serviceMap: Map<string, ServiceOption>;
  locationMap: Map<string, LocationOption>;
  now: string;
  tab: string;
  q: string;
  status: string;
}) {
  const query = q.trim().toLowerCase();
  const filtered = inspections
    .filter((row) => !status || row.status === status)
    .filter(
      (row) =>
        !query ||
        [
          row.inspection_number,
          row.stage_name,
          serviceMap.get(row.service_id)?.description,
          locationMap.get(row.location_id ?? "")?.name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );

  return (
    <>
      <section className="quality-toolbar">
        <form method="get">
          <input type="hidden" name="tab" value={tab} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar vistoria, serviço, etapa ou local"
          />
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option value={key} key={key}>{label}</option>
            ))}
          </select>
          <button type="submit">Filtrar</button>
          <Link href={`?tab=${tab}`}>Limpar</Link>
        </form>
      </section>
      <section className="quality-table-card">
        <header>
          <div><span>Execução · Qualidade</span><h2>{title}</h2></div>
          <strong>{filtered.length} registro(s)</strong>
        </header>
        <div className="registry-table-wrap">
          <table className="registry-table quality-table">
            <thead>
              <tr>
                <th>Vistoria</th><th>Serviço / etapa</th><th>Local</th>
                <th>Prazo</th><th>Preenchimento</th><th>Nota inicial</th>
                <th>Resultado</th><th>Liberação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isOverdue =
                  row.due_date < now &&
                  ["pending", "in_progress"].includes(row.status);
                return (
                  <tr
                    key={row.id}
                    className={row.release_status === "blocked" ? "blocked-row" : ""}
                  >
                    <td>
                      <Link href={inspectionHref(row.id, tab)}>
                        <strong>{row.inspection_number}</strong>
                        <span>{row.origin}</span>
                      </Link>
                    </td>
                    <td>
                      <strong>
                        {serviceMap.get(row.service_id)?.description ?? "Serviço"}
                      </strong>
                      <span>{row.stage_name}</span>
                    </td>
                    <td>
                      {row.location_id
                        ? locationMap.get(row.location_id)?.name ?? "Local"
                        : "Obra inteira"}
                    </td>
                    <td>
                      <strong className={isOverdue ? "text-danger" : ""}>
                        {dateBR(row.due_date)}
                      </strong>
                    </td>
                    <td>
                      <div className="quality-table-progress">
                        <i style={{ width: `${row.completion_percent}%` }} />
                      </div>
                      <small>{Number(row.completion_percent).toFixed(0)}%</small>
                    </td>
                    <td>
                      {row.first_inspection_score === null
                        ? "—"
                        : decimal(row.first_inspection_score)}
                    </td>
                    <td>
                      <span
                        className={`quality-status ${isOverdue ? "overdue" : row.status}`}
                      >
                        {isOverdue ? "Vencida" : statusLabels[row.status]}
                      </span>
                    </td>
                    <td>
                      <span className={`quality-release ${row.release_status}`}>
                        {row.release_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="quality-empty-row">
                    Nenhuma vistoria encontrada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function NonconformityList({
  rows,
  inspections,
  serviceMap,
  locationMap,
  now,
}: {
  rows: Nonconformity[];
  inspections: Inspection[];
  serviceMap: Map<string, ServiceOption>;
  locationMap: Map<string, LocationOption>;
  now: string;
}) {
  return (
    <section className="quality-table-card">
      <header>
        <div><span>Tratamento e reinspeção</span><h2>Não conformidades</h2></div>
        <strong>{rows.filter((row) => row.status !== "closed").length} aberta(s)</strong>
      </header>
      <div className="registry-table-wrap">
        <table className="registry-table quality-table">
          <thead>
            <tr>
              <th>NC / origem</th><th>Serviço e local</th><th>Descrição</th>
              <th>Gravidade</th><th>Prazo</th><th>Status</th><th>Retrabalho</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const inspection = inspections.find(
                (item) => item.id === row.inspection_id,
              );
              const overdue =
                row.status !== "closed" && row.due_at.slice(0, 10) < now;
              return (
                <tr key={row.id} className={row.is_blocking ? "blocked-row" : ""}>
                  <td>
                    <Link href={`?tab=nc&nc=${row.id}`}>
                      <strong>{row.nc_number}</strong>
                      <span>{inspection?.inspection_number}</span>
                    </Link>
                  </td>
                  <td>
                    <strong>{serviceMap.get(row.service_id)?.description}</strong>
                    <span>
                      {row.location_id
                        ? locationMap.get(row.location_id)?.name
                        : "Obra"}
                    </span>
                  </td>
                  <td>{row.description}</td>
                  <td>
                    <span className={`quality-severity ${row.severity}`}>
                      {row.severity}{row.is_blocking ? " · bloqueante" : ""}
                    </span>
                  </td>
                  <td className={overdue ? "text-danger" : ""}>
                    {dateTimeBR(row.due_at)}
                  </td>
                  <td>
                    <span className={`quality-status ${overdue ? "overdue" : row.status}`}>
                      {overdue ? "Vencida" : ncLabels[row.status]}
                    </span>
                  </td>
                  <td>{money(row.estimated_rework_cost)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="quality-empty-row">
                  Nenhuma não conformidade registrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NonconformityDetail({
  nc,
  inspection,
  serviceName,
  locationName,
  supplierName,
  canManage,
  canReinspect,
}: {
  nc: Nonconformity;
  inspection: Inspection | null;
  serviceName: string;
  locationName: string;
  supplierName: string;
  canManage: boolean;
  canReinspect: boolean;
}) {
  const overdue = nc.status !== "closed" && new Date(nc.due_at) < new Date();
  return (
    <section className="quality-nc-detail">
      <header className={nc.is_blocking ? "blocked" : ""}>
        <div>
          <span>{nc.nc_number} · {inspection?.inspection_number}</span>
          <h2>{serviceName}</h2>
          <p>{locationName} · {supplierName}</p>
        </div>
        <div>
          <span className={`quality-severity ${nc.severity}`}>{nc.severity}</span>
          <strong>{overdue ? "Vencida" : ncLabels[nc.status]}</strong>
        </div>
      </header>
      <div className="quality-nc-grid">
        <article><span>Descrição</span><p>{nc.description}</p></article>
        <article>
          <span>Prazo</span><strong>{dateTimeBR(nc.due_at)}</strong>
          <small>Abertura: {dateTimeBR(nc.opened_at)}</small>
        </article>
        <article>
          <span>Equipe responsável</span>
          <strong>{nc.responsible_team || supplierName}</strong>
        </article>
        <article>
          <span>Custo estimado</span>
          <strong>{money(nc.estimated_rework_cost)}</strong>
        </article>
        {nc.probable_cause ? (
          <article className="span2"><span>Causa provável</span><p>{nc.probable_cause}</p></article>
        ) : null}
        {nc.corrective_action ? (
          <article className="span2"><span>Ação corretiva</span><p>{nc.corrective_action}</p></article>
        ) : null}
        {nc.correction_report ? (
          <article className="span2"><span>Evidência informada</span><p>{nc.correction_report}</p></article>
        ) : null}
      </div>
      {canManage && ["open", "in_correction", "overdue"].includes(nc.status) ? (
        <form
          action={reportCorrection}
          encType="multipart/form-data"
          className="quality-action-card"
        >
          <input type="hidden" name="nonconformity_id" value={nc.id} />
          <input type="hidden" name="inspection_id" value={nc.inspection_id} />
          <h3>Informar correção</h3>
          <label>Causa provável<textarea name="probable_cause" rows={2} /></label>
          <label>Ação corretiva<textarea name="corrective_action" rows={2} required /></label>
          <label>
            Relato e evidência da correção
            <textarea name="correction_report" rows={3} required />
          </label>
          <label>
            Custo estimado de retrabalho (R$)
            <input
              name="estimated_rework_cost"
              type="number"
              min="0"
              step="0.01"
              defaultValue={nc.estimated_rework_cost}
            />
          </label>
          <label>
            Fotos ou documentos
            <input
              name="correction_files"
              type="file"
              accept="image/*,application/pdf"
              multiple
            />
          </label>
          <button className="elos-button" type="submit">
            Enviar para reinspeção
          </button>
        </form>
      ) : null}
      {canReinspect && nc.status === "awaiting_reinspection" ? (
        <form action={reinspectNonconformity} className="quality-action-card">
          <input type="hidden" name="nonconformity_id" value={nc.id} />
          <input type="hidden" name="inspection_id" value={nc.inspection_id} />
          <h3>Realizar reinspeção</h3>
          <label>
            Resultado
            <select name="result">
              <option value="approved">Correção aprovada</option>
              <option value="rejected">Correção reprovada</option>
            </select>
          </label>
          <label>
            Registro da reinspeção
            <textarea name="notes" rows={3} required />
          </label>
          <button className="elos-button" type="submit">
            Registrar reinspeção
          </button>
        </form>
      ) : null}
    </section>
  );
}

function BlockedList({
  inspections,
  ncs,
  serviceMap,
  locationMap,
}: {
  inspections: Inspection[];
  ncs: Nonconformity[];
  serviceMap: Map<string, ServiceOption>;
  locationMap: Map<string, LocationOption>;
}) {
  return (
    <section className="quality-blocked-grid">
      {inspections.map((inspection) => {
        const related = ncs.filter(
          (row) => row.inspection_id === inspection.id && row.status !== "closed",
        );
        return (
          <article key={inspection.id}>
            <div className="quality-blocked-icon">!</div>
            <span>Serviço bloqueado pela Qualidade</span>
            <h2>{serviceMap.get(inspection.service_id)?.description}</h2>
            <p>
              {inspection.stage_name} · {inspection.location_id
                ? locationMap.get(inspection.location_id)?.name
                : "Obra"}
            </p>
            {related.map((row) => (
              <div className="quality-block-reason" key={row.id}>
                <strong>{row.nc_number} · {row.description}</strong>
                <span>{row.severity} · prazo {dateTimeBR(row.due_at)}</span>
              </div>
            ))}
            <Link href={inspectionHref(inspection.id, "blocked")}>
              Abrir vistoria e bloqueio
            </Link>
          </article>
        );
      })}
      {inspections.length === 0 ? (
        <div className="quality-empty">Nenhum serviço bloqueado.</div>
      ) : null}
    </section>
  );
}

function QualityMap({
  inspections,
  ncs,
  locations,
  services,
}: {
  inspections: Inspection[];
  ncs: Nonconformity[];
  locations: LocationOption[];
  services: Map<string, ServiceOption>;
}) {
  return (
    <section className="quality-map-grid">
      {locations.map((location) => {
        const rows = inspections.filter(
          (row) => row.location_id === location.id && row.status !== "cancelled",
        );
        const open = ncs.filter(
          (row) => row.location_id === location.id && row.status !== "closed",
        );
        const scores = rows.filter((row) => row.first_inspection_score !== null);
        const score = scores.length
          ? scores.reduce(
              (sum, row) => sum + Number(row.first_inspection_score),
              0,
            ) / scores.length
          : null;
        const blocked = rows.some((row) => row.release_status === "blocked");
        return (
          <article
            className={`${scoreClass(score)} ${blocked ? "blocked" : ""}`}
            key={location.id}
          >
            <header>
              <div><span>{location.code}</span><h3>{location.name}</h3></div>
              <strong>{score === null ? "—" : decimal(score)}</strong>
            </header>
            <div>
              <span>{rows.length} vistoria(s)</span>
              <span>
                {rows.filter((row) => ["pending", "in_progress"].includes(row.status)).length}{" "}
                pendente(s)
              </span>
              <span>{open.length} NC aberta(s)</span>
            </div>
            {blocked ? <b>Serviço bloqueado</b> : null}
            <details>
              <summary>Serviços avaliados</summary>
              {[...new Set(rows.map((row) => row.service_id))].map((id) => (
                <p key={id}>{services.get(id)?.description}</p>
              ))}
            </details>
          </article>
        );
      })}
      {locations.length === 0 ? (
        <div className="quality-empty">
          Cadastre os locais/pavimentos da obra para visualizar o mapa.
        </div>
      ) : null}
    </section>
  );
}

// Os números vêm de quality_indicators, que agrega toda a obra no Postgres.
// Antes eram somados aqui sobre as inspeções e NCs carregadas por inteiro.
// Equivalência coberta por supabase/tests/20260806_0081_quality_indicators.sql.
type QualityIndicatorData = {
  inspection_count: number;
  completed_count: number;
  average_score: number;
  first_pass_count: number;
  open_nc_count: number;
  closed_nc_count: number;
  on_time_nc_count: number;
  blocked_count: number;
  score_by_service: { service_id: string; average: number; count: number }[];
  nc_by_severity: Record<string, { total: number; open: number }>;
};

function Indicators({
  indicators,
  serviceMap,
}: {
  indicators: QualityIndicatorData;
  serviceMap: Map<string, ServiceOption>;
}) {
  const completed = Number(indicators.completed_count);
  const total = Number(indicators.inspection_count);
  const closed = Number(indicators.closed_nc_count);
  const average = Number(indicators.average_score);

  return (
    <>
      <section className="quality-indicators">
        <article className={scoreClass(average)}>
          <span>Nota acumulada</span>
          <strong>{completed ? decimal(average) : "\u2014"}</strong>
          <small>{completed} inspeção(ões)</small>
        </article>
        <article>
          <span>Aprovação na 1ª inspeção</span>
          <strong>{completed ? decimal((Number(indicators.first_pass_count) / completed) * 100) : 0}%</strong>
        </article>
        <article>
          <span>Correções no prazo</span>
          <strong>{closed ? decimal((Number(indicators.on_time_nc_count) / closed) * 100) : 0}%</strong>
        </article>
        <article><span>NCs abertas</span><strong>{indicators.open_nc_count}</strong></article>
        <article>
          <span>Bloqueios ativos</span>
          <strong>{indicators.blocked_count}</strong>
        </article>
        <article>
          <span>Cobertura</span>
          <strong>{total ? decimal((completed / total) * 100) : 0}%</strong>
          <small>realizadas / previstas</small>
        </article>
      </section>
      <section className="quality-chart-card">
        <header><div><span>Desempenho</span><h2>Nota por serviço</h2></div></header>
        {indicators.score_by_service.map((row) => {
          const value = Number(row.average);
          return (
            <div className="quality-bar-row" key={row.service_id}>
              <span>{serviceMap.get(row.service_id)?.description}</span>
              <i><em className={scoreClass(value)} style={{ width: `${value}%` }} /></i>
              <strong>{decimal(value)}</strong>
              <small>{row.count}</small>
            </div>
          );
        })}
        {indicators.score_by_service.length === 0 ? (
          <p className="quality-empty-row">Ainda não existem vistorias concluídas.</p>
        ) : null}
      </section>
      <section className="quality-chart-card">
        <header><div><span>Gravidade</span><h2>Não conformidades</h2></div></header>
        {["critical", "serious", "light"].map((severity) => (
          <div className="quality-severity-line" key={severity}>
            <span className={`quality-severity ${severity}`}>{severity}</span>
            <strong>{indicators.nc_by_severity[severity]?.total ?? 0}</strong>
            <i>
              {indicators.nc_by_severity[severity]?.open ?? 0}{" "}
              aberta(s)
            </i>
          </div>
        ))}
      </section>
    </>
  );
}

function TemplatesArea({
  templates,
  versions,
  criteria,
  rules,
  services,
}: {
  templates: TemplateRecord[];
  versions: Version[];
  criteria: Array<CriterionRecord & { version_id: string }>;
  rules: Rule[];
  services: ServiceOption[];
}) {
  return (
    <>
      <section className="quality-admin-head">
        <div>
          <span>Checklists dinâmicos e versionados</span>
          <h2>Modelos de checklist</h2>
          <p>Vistorias existentes preservam a versão publicada no momento da criação.</p>
        </div>
        <div>
          <TemplateDialog services={services} />
          <RuleDialog templates={templates} services={services} />
        </div>
      </section>
      <section className="quality-template-grid">
        {templates.map((template) => {
          const version = versions.find(
            (row) => row.id === template.current_version_id,
          );
          const rows = criteria.filter(
            (row) => row.version_id === template.current_version_id,
          );
          return (
            <article key={template.id}>
              <header>
                <div>
                  <span>{template.code} · v{version?.version_no ?? 1}</span>
                  <h3>{template.name}</h3>
                </div>
                <span className={`quality-criticality ${template.criticality}`}>
                  {template.criticality}
                </span>
              </header>
              <p>{template.description || "Sem descrição."}</p>
              <div className="quality-template-meta">
                <span>{rows.length} critérios</span>
                <span>Peso {decimal(template.service_weight, 2)}</span>
                <span>{template.has_blocking_gate ? "Com gate" : "Sem gate"}</span>
              </div>
              <div className="quality-template-criteria">
                {rows.slice(0, 5).map((row) => (
                  <span key={row.id}>{row.code} · {row.description}</span>
                ))}
                {rows.length > 5 ? <small>+ {rows.length - 5} critérios</small> : null}
              </div>
              <TemplateDialog
                services={services}
                initial={template}
                criteria={rows}
                label="Publicar nova versão"
              />
            </article>
          );
        })}
        {templates.length === 0 ? (
          <div className="quality-empty">
            Nenhum modelo publicado. Cadastre o primeiro checklist para ativar as
            vistorias.
          </div>
        ) : null}
      </section>
      <section className="quality-table-card">
        <header>
          <div><span>Eventos do cronograma</span><h2>Regras automáticas</h2></div>
          <strong>{rules.filter((row) => row.active).length} ativa(s)</strong>
        </header>
        <div className="registry-table-wrap">
          <table className="registry-table quality-table">
            <thead>
              <tr>
                <th>Modelo</th><th>Serviço</th><th>Etapa</th><th>Evento</th>
                <th>Prazo</th><th>Escopo</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{templates.find((row) => row.id === rule.template_id)?.name}</td>
                  <td>{services.find((row) => row.id === rule.service_id)?.description}</td>
                  <td>{rule.stage_name}</td>
                  <td>{rule.event_type}</td>
                  <td>{rule.due_offset_days >= 0 ? "+" : ""}{rule.due_offset_days} dia(s)</td>
                  <td>{rule.location_scope}{rule.only_first_location ? " · primeiro local" : ""}</td>
                  <td>{rule.active ? "Ativa" : "Inativa"}</td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="quality-empty-row">
                    Crie uma regra para gerar vistorias a partir do cronograma.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SettingsArea({
  settings,
  profiles,
}: {
  settings: Settings;
  profiles: Profile[];
}) {
  return (
    <form action={saveQualitySettings} className="quality-settings-card">
      <header><div><span>Regras por obra</span><h2>Configurações da Qualidade</h2></div></header>
      <label>
        Engenheiro responsável
        <select
          name="responsible_engineer_user_id"
          defaultValue={settings.responsible_engineer_user_id ?? ""}
        >
          <option value="">Definir na primeira sincronização</option>
          {profiles.map((profile) => (
            <option value={profile.id} key={profile.id}>
              {profile.full_name || profile.id}
            </option>
          ))}
        </select>
      </label>
      <div className="quality-form-grid">
        <label>
          Peso da 1ª inspeção (%)
          <input
            name="first_inspection_weight"
            type="number"
            step="0.1"
            defaultValue={settings.first_inspection_weight}
          />
        </label>
        <label>
          Correções no prazo (%)
          <input
            name="on_time_correction_weight"
            type="number"
            step="0.1"
            defaultValue={settings.on_time_correction_weight}
          />
        </label>
        <label>
          Ausência de reincidência (%)
          <input
            name="non_recurrence_weight"
            type="number"
            step="0.1"
            defaultValue={settings.non_recurrence_weight}
          />
        </label>
        <label>
          Prazo crítico (horas)
          <input
            name="critical_due_hours"
            type="number"
            min="1"
            defaultValue={settings.critical_due_hours}
          />
        </label>
        <label>
          Prazo grave (dias)
          <input
            name="serious_due_days"
            type="number"
            min="1"
            defaultValue={settings.serious_due_days}
          />
        </label>
        <label>
          Prazo leve (dias)
          <input
            name="light_due_days"
            type="number"
            min="1"
            defaultValue={settings.light_due_days}
          />
        </label>
      </div>
      <label className="quality-check">
        <input
          name="auto_sync"
          type="checkbox"
          defaultChecked={settings.auto_sync}
        />
        Sincronização automática habilitada para a obra
      </label>
      <div className="quality-settings-note">
        Os três pesos da nota do serviço precisam somar exatamente 100%.
      </div>
      <button className="elos-button" type="submit">
        Salvar configurações
      </button>
    </form>
  );
}
