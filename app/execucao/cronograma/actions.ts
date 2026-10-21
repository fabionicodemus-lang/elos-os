"use server";

import { revalidatePath } from "next/cache";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { extractFlowSnapshot, prepareFlowImport, type ElosFlowActivity, type ElosExistingMeasurement } from "./flow-standalone-import.mjs";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/execucao/cronograma";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key);
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function resultUrl(message: string, type: "error" | "success", baselineId?: string, date?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (baselineId) params.set("baseline", baselineId);
  if (date) params.set("date", date);
  return `${LIST_PATH}?${params.toString()}`;
}

export async function recordScheduleProgress(formData: FormData) {
  const baselineId = text(formData, "baseline_id");
  const activityId = text(formData, "activity_id");
  const measurementDate = text(formData, "measurement_date");
  const progressPercent = numberValue(formData, "progress_percent", Number.NaN);
  const actualQuantity = numberValue(formData, "actual_quantity", 0);
  const actualCost = numberValue(formData, "actual_cost", 0);
  const teamCountRaw = text(formData, "team_count");
  const teamCount = teamCountRaw ? numberValue(formData, "team_count", Number.NaN) : null;
  const currentStart = text(formData, "current_start");
  const currentFinish = text(formData, "current_finish");
  const actualStart = optional(formData, "actual_start");
  const actualFinish = optional(formData, "actual_finish");

  if (
    !baselineId ||
    !activityId ||
    !validDate(measurementDate) ||
    !validDate(currentStart) ||
    !validDate(currentFinish) ||
    (actualStart && !validDate(actualStart)) ||
    (actualFinish && !validDate(actualFinish)) ||
    !Number.isFinite(progressPercent) ||
    progressPercent < 0 ||
    progressPercent > 100 ||
    !Number.isFinite(actualQuantity) ||
    actualQuantity < 0 ||
    !Number.isFinite(actualCost) ||
    actualCost < 0 ||
    (teamCount !== null && (!Number.isFinite(teamCount) || teamCount <= 0))
  ) {
    redirect(resultUrl("Revise a data, o percentual e os valores da medição.", "error", baselineId, measurementDate));
  }

  if (currentFinish < currentStart) {
    redirect(resultUrl("O término atual não pode ser anterior ao início atual.", "error", baselineId, measurementDate));
  }

  if (actualStart && actualFinish && actualFinish < actualStart) {
    redirect(resultUrl("O término realizado não pode ser anterior ao início realizado.", "error", baselineId, measurementDate));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de registrar a medição.", "error"));

  const { error } = await supabase.rpc("record_execution_schedule_progress", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_baseline_id: baselineId,
    p_activity_id: activityId,
    p_measurement_date: measurementDate,
    p_progress_percent: progressPercent,
    p_actual_quantity: actualQuantity,
    p_actual_cost: actualCost,
    p_team_count: teamCount,
    p_current_start: currentStart,
    p_current_finish: currentFinish,
    p_actual_start: actualStart,
    p_actual_finish: actualFinish,
    p_notes: optional(formData, "notes"),
  });

  if (error) {
    redirect(resultUrl(error.message, "error", baselineId, measurementDate));
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/cronograma");
  revalidatePath("/engenharia/curvas");
  revalidatePath("/dashboard");
  redirect(resultUrl("Medição registrada e cronograma atual atualizado.", "success", baselineId, measurementDate));
}

export async function voidScheduleProgress(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("void_execution_schedule_progress", { p_company_id: companyId, p_project_id: projectId, p_measurement_id: text(formData, "measurement_id"), p_reason: text(formData, "reason") });
  for (const path of [LIST_PATH, "/dashboard", "/engenharia/curvas", "/engenharia/previsao-financeira"]) revalidatePath(path);
  redirect(resultUrl(error ? error.message : "Lançamento anulado. Histórico preservado e avanço recalculado.", error ? "error" : "success", text(formData, "baseline_id"), text(formData, "date")));
}


/**
 * Importação histórica do Flow (referência 12/10/2026).
 * Deliberadamente NÃO modifica engineering_schedule_activities, dependências,
 * quantidades ou orçamento. Datas replanejadas ficam nas medições de execução
 * com data de referência 06/10; a baseline permanece comparável.
 *
 * Um único INSERT transacional via PostgREST evita aplicação parcial.
 * O gatilho existente registra auditoria e atualiza o tracking da atividade.
 */
export async function importFlowStandaloneHistory(formData: FormData) {
  const baselineId = text(formData, "baseline_id");
  const file = formData.get("file");
  if (!baselineId || !(file instanceof File) || file.size === 0 || file.size > 8 * 1024 * 1024) {
    redirect(resultUrl("Envie o HTML do Flow (até 8 MB) e selecione uma linha de base.", "error", baselineId));
  }
  if (formData.get("confirm_history") !== "on") {
    redirect(resultUrl("Confirme a conciliação do histórico antes de importar.", "error", baselineId));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione a obra Flow Aptos.", "error", baselineId));

  const [projectQuery, baselineQuery] = await Promise.all([
    supabase.from("projects").select("id, name")
      .eq("id", projectId).eq("company_id", companyId).maybeSingle(),
    supabase.from("engineering_schedule_baselines").select("id, project_id, name, status")
      .eq("id", baselineId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle(),
  ]);
  if (projectQuery.error || baselineQuery.error || !projectQuery.data || !baselineQuery.data) {
    redirect(resultUrl("Obra ou linha de base não encontrada.", "error", baselineId));
  }
  const project = projectQuery.data;
  const baseline = baselineQuery.data;
  if (project.name !== "Flow Aptos") {
    redirect(resultUrl("Esta conciliação é exclusiva da obra Flow Aptos.", "error", baselineId));
  }
  if (baseline.status !== "approved") {
    redirect(resultUrl("Aprove a linha de base em Engenharia antes de importar o histórico de execução.", "error", baselineId));
  }

  let snapshot: ReturnType<typeof extractFlowSnapshot>;
  try {
    snapshot = extractFlowSnapshot(await file.text());
  } catch (error) {
    redirect(resultUrl(error instanceof Error ? error.message : "Não foi possível analisar o HTML.", "error", baselineId));
  }
  // O cronograma de 14/07 pode ter um nome diferente no cadastro do Elos:
  // CRONO-FLOW-LB01 no sistema e "Baseline 01 — Cronograma 14.07.2026" no HTML.
  // O nome é um rótulo editável, não uma identidade. A identificação segura usa
  // companyId, projectId, baselineId, obra/revisão do HTML e as 395 posições
  // originais comparadas à data de início da baseline.
  if (!String(snapshot.project.sourceFile ?? "").includes("14.07")
    || !String(snapshot.project.baselineName ?? "").includes("14.07.2026")) {
    redirect(resultUrl("O arquivo não identifica o cronograma Flow de 14/07/2026.", "error", baselineId));
  }

  const [activities, measurements] = await Promise.all([
    fetchAllRows<ElosFlowActivity>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_activities")
        .select("id, code, name, sort_order, planned_start, planned_finish, duration_days, quantity_snapshot")
        .eq("company_id", companyId).eq("project_id", projectId)
        .eq("baseline_id", baselineId).eq("record_status", "active").range(from, to);
      return { data: (data ?? []) as ElosFlowActivity[], error };
    }),
    fetchAllRows<ElosExistingMeasurement>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_progress_measurements")
        .select("activity_id, measurement_date, progress_percent, actual_quantity, actual_cost, team_count, actual_start, actual_finish, voided_at")
        .eq("company_id", companyId).eq("project_id", projectId)
        .eq("baseline_id", baselineId).range(from, to);
      return { data: (data ?? []) as ElosExistingMeasurement[], error };
    }),
  ]);
  if (activities.error || measurements.error) {
    redirect(resultUrl("Falha ao consultar atividades ou medições existentes. Nada foi alterado.", "error", baselineId));
  }

  let result: ReturnType<typeof prepareFlowImport>;
  try {
    result = prepareFlowImport(snapshot, activities.data, measurements.data);
  } catch (error) {
    redirect(resultUrl(error instanceof Error ? error.message : "Conciliação inválida.", "error", baselineId));
  }

  if (result.rows.length > 0) {
    const rows = result.rows.map((row) => ({
      ...row, company_id: companyId, project_id: projectId, baseline_id: baselineId,
    }));
    // A inserção em lote é atômica: caso falhe, nem uma única medição é gravada.
    // Apenas 09/2026 e 10/2026: agosto já possui histórico no Elos.
    // Registros existentes (inclusive anulados) nunca são substituídos.
    const { error } = await supabase.from("engineering_schedule_progress_measurements").insert(rows);
    if (error) {
      redirect(resultUrl("A importação não foi aplicada: " + error.message, "error", baselineId));
    }
  }

  for (const path of [LIST_PATH, "/engenharia/cronograma", "/engenharia/curvas", "/dashboard"]) revalidatePath(path);
  const s = result.summary;
  redirect(resultUrl(
    `Flow conciliado: ${s.matchedActivities} atividades, ${s.importedMeasurements} medições históricas, ${s.newReplans} reprogramações; ${s.existingPreserved} registros existentes preservados; ${s.correctedProgress} retificações auditadas. Baseline e orçamento intocados.`,
    "success", baselineId, "2026-10-06",
  ));
}
