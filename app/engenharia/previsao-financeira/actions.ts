"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/previsao-financeira";
const HISTORY_PATH = `${PATH}/historico`;
const ENGINE_VERSION = "forecast-engine-v1";

function pageUrl(message: string, type: "error" | "success" = "error", baselineId?: string | null) {
  const params = new URLSearchParams({ [type]: message });
  if (baselineId) params.set("baseline", baselineId);
  return `${PATH}?${params.toString()}`;
}

function historyUrl(message: string, type: "error" | "success" = "error") {
  return `${HISTORY_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function updateForecastSettings(formData: FormData) {
  const paymentDays = Number.parseInt(String(formData.get("forecast_default_payment_days") ?? ""), 10);
  if (!Number.isFinite(paymentDays) || paymentDays < 0 || paymentDays > 365) {
    redirect(pageUrl("Informe um prazo padrão entre 0 e 365 dias."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("projects.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de alterar a configuração."));

  const { error } = await supabase
    .from("projects")
    .update({ forecast_default_payment_days: paymentDays, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("company_id", companyId);

  if (error) redirect(pageUrl(error.message));

  revalidatePath(PATH);
  revalidatePath("/engenharia/curvas");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Prazo padrão da previsão atualizado.", "success"));
}

export async function updateServiceFinancialMode(formData: FormData) {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const mode = String(formData.get("financial_mode") ?? "").trim();
  const baselineId = String(formData.get("baseline_id") ?? "").trim() || null;
  const planGroup = String(formData.get("plan_group") ?? "").trim().slice(0, 120) || null;
  if (!isUuid(serviceId)) redirect(pageUrl("Serviço inválido.", "error", baselineId));
  if (mode !== "schedule" && mode !== "payment_plan") redirect(pageUrl("Modo de previsão inválido.", "error", baselineId));

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de alterar a previsão."));

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("forecast_service_settings")
    .upsert({
      company_id: companyId,
      project_id: projectId,
      service_id: serviceId,
      financial_mode: mode,
      plan_group: mode === "payment_plan" ? planGroup : null,
      created_by: userId,
      updated_by: userId,
      updated_at: now,
    }, { onConflict: "project_id,service_id" });

  if (error) redirect(pageUrl(error.message, "error", baselineId));

  revalidatePath(PATH);
  revalidatePath("/engenharia/curvas");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl(
    mode === "payment_plan"
      ? "Serviço passou a usar as parcelas do contrato na previsão financeira. O prazo continua no cronograma."
      : "Serviço voltou a ter a previsão financeira distribuída pelo cronograma.",
    "success",
    baselineId,
  ));
}

export async function createForecastSnapshot(formData: FormData) {
  const baselineId = String(formData.get("baseline_id") ?? "").trim();
  const { supabase, companyId, projectId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(pageUrl("Selecione uma obra antes de congelar a previsão."));
  if (!baselineId) redirect(pageUrl("Selecione uma linha de base antes de congelar a previsão."));

  const asOfDate = todayIso();
  const context = await loadProjectForecast({
    supabase,
    companyId,
    projectId,
    baselineId,
    asOfDate,
  });

  if (context.errors.length) {
    redirect(pageUrl(`A previsão não foi congelada porque a base está incompleta: ${context.errors.join(" · ")}`, "error", baselineId));
  }
  if (!context.forecast || !context.baseline || !context.budget) {
    redirect(pageUrl("A previsão precisa de linha de base e orçamento válidos para ser congelada.", "error", baselineId));
  }

  const rows = context.forecast.services.flatMap((service) => service.monthly.flatMap((month) => [
    {
      service_id: isUuid(service.id) ? service.id : null,
      service_key: service.id,
      service_code: service.code,
      service_name: service.name,
      service_budget_amount: service.budgetAmount,
      month: `${month.key}-01`,
      layer: "actual",
      amount: month.actual,
    },
    {
      service_id: isUuid(service.id) ? service.id : null,
      service_key: service.id,
      service_code: service.code,
      service_name: service.name,
      service_budget_amount: service.budgetAmount,
      month: `${month.key}-01`,
      layer: "committed",
      amount: month.committed,
    },
    {
      service_id: isUuid(service.id) ? service.id : null,
      service_key: service.id,
      service_code: service.code,
      service_name: service.name,
      service_budget_amount: service.budgetAmount,
      month: `${month.key}-01`,
      layer: "to_commit",
      amount: month.toCommit,
    },
  ]));

  if (!rows.length) {
    redirect(pageUrl("A previsão não possui competências mensais para congelar.", "error", baselineId));
  }

  const forecast = context.forecast;
  const { error } = await supabase.rpc("create_forecast_snapshot", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_baseline_id: context.baseline.id,
    p_budget_id: context.budget.id,
    p_reference_month: `${asOfDate.slice(0, 7)}-01`,
    p_forecast_as_of_date: asOfDate,
    p_source: "manual",
    p_budget_total: forecast.totals.budget,
    p_actual_total: forecast.totals.actual,
    p_committed_total: forecast.totals.committed,
    p_to_commit_total: forecast.totals.toCommit,
    p_projected_cost_total: forecast.totals.projectedCost,
    p_deviation_total: forecast.totals.deviation,
    p_default_payment_days: forecast.defaultPaymentDays,
    p_engine_version: ENGINE_VERSION,
    p_baseline_label: `${context.baseline.code} · ${context.baseline.version} · ${context.baseline.name}`,
    p_budget_label: `${context.budget.code} · ${context.budget.version} · ${context.budget.name}`,
    p_warnings: forecast.warnings,
    p_rows: rows,
  });

  if (error) redirect(pageUrl(error.message, "error", baselineId));

  revalidatePath(PATH);
  revalidatePath(HISTORY_PATH);
  redirect(pageUrl("Previsão do mês congelada. O registro histórico não será alterado por mudanças futuras.", "success", baselineId));
}

export async function archiveForecastSnapshot(formData: FormData) {
  const snapshotId = String(formData.get("snapshot_id") ?? "").trim();
  if (!snapshotId) redirect(historyUrl("Snapshot não informado."));

  const { supabase } = await requireCompanyPermission("schedule.manage");
  const { error } = await supabase.rpc("archive_forecast_snapshot", { p_snapshot_id: snapshotId });
  if (error) redirect(historyUrl(error.message));

  revalidatePath(HISTORY_PATH);
  redirect(historyUrl("Snapshot arquivado. O conteúdo congelado foi preservado.", "success"));
}

const FIXED_TERM_PATH = `${PATH}/prazo-fixo`;

function fixedTermUrl(message: string, type: "error" | "success" = "error") {
  return `${FIXED_TERM_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function monthToDate(value: FormDataEntryValue | null, end = false) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  if (!end) return `${raw}-01`;
  const [year, month] = raw.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${raw}-${String(last).padStart(2, "0")}`;
}

/** Marca (ou atualiza) um serviço como prazo fixo: saldo dividido igualmente entre os meses informados. */
export async function saveFixedTermService(formData: FormData) {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const start = monthToDate(formData.get("distribution_start"));
  const end = monthToDate(formData.get("distribution_end"), true);
  if (!isUuid(serviceId)) redirect(fixedTermUrl("Escolha o serviço."));
  if (!start || !end) redirect(fixedTermUrl("Informe o mês de início e o mês de fim."));
  if (end < start) redirect(fixedTermUrl("O mês de fim precisa ser igual ou posterior ao de início."));

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(fixedTermUrl("Selecione uma obra."));

  const { error } = await supabase
    .from("forecast_service_settings")
    .upsert({
      company_id: companyId,
      project_id: projectId,
      service_id: serviceId,
      financial_mode: "fixed_term",
      plan_group: null,
      distribution_start: start,
      distribution_end: end,
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id,service_id" });
  if (error) redirect(fixedTermUrl(error.message));

  revalidatePath(PATH);
  revalidatePath(FIXED_TERM_PATH);
  revalidatePath("/engenharia/curvas");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(fixedTermUrl("Prazo fixo salvo. O saldo do serviço foi redistribuído por mês.", "success"));
}

/** Tira o serviço do prazo fixo: volta a ser distribuído pelo cronograma. */
export async function removeFixedTermService(formData: FormData) {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!isUuid(serviceId)) redirect(fixedTermUrl("Serviço inválido."));
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(fixedTermUrl("Selecione uma obra."));

  const { error } = await supabase
    .from("forecast_service_settings")
    .update({ financial_mode: "schedule", distribution_start: null, distribution_end: null, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("service_id", serviceId);
  if (error) redirect(fixedTermUrl(error.message));

  revalidatePath(PATH);
  revalidatePath(FIXED_TERM_PATH);
  redirect(fixedTermUrl("Serviço voltou a seguir o cronograma.", "success"));
}
