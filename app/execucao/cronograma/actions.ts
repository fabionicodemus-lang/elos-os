"use server";

import { revalidatePath } from "next/cache";
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
