"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/execucao/cronograma";
const methods = new Set(["quantity", "cost", "duration", "equal"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function resultUrl(message: string, type: "error" | "success", baselineId?: string, date?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (baselineId) params.set("baseline", baselineId);
  if (date) params.set("date", date);
  return `${LIST_PATH}?${params.toString()}`;
}

export async function saveScheduleServiceWeights(formData: FormData) {
  const baselineId = text(formData, "baseline_id");
  const selectedDate = text(formData, "selected_date");
  const rawRows = text(formData, "weights_json");

  let rows: Array<{
    service_id: string;
    physical_weight_percent: number;
    distribution_method: string;
    source: string;
    notes?: string;
  }> = [];

  try {
    rows = JSON.parse(rawRows) as typeof rows;
  } catch {
    redirect(resultUrl("Não foi possível interpretar os pesos informados.", "error", baselineId, selectedDate));
  }

  const total = rows.reduce((sum, row) => sum + Number(row.physical_weight_percent), 0);
  const valid = Boolean(
    baselineId &&
    rows.length &&
    rows.every((row) =>
      /^[0-9a-f-]{36}$/i.test(row.service_id) &&
      Number.isFinite(Number(row.physical_weight_percent)) &&
      Number(row.physical_weight_percent) >= 0 &&
      Number(row.physical_weight_percent) <= 100 &&
      methods.has(row.distribution_method),
    ) &&
    Math.abs(total - 100) <= 0.01
  );

  if (!valid) {
    redirect(resultUrl(`Revise os pesos. A soma precisa fechar 100% e está em ${total.toFixed(2)}%.`, "error", baselineId, selectedDate));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de definir os pesos físicos.", "error"));

  const { error } = await supabase.rpc("save_schedule_service_weights", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_baseline_id: baselineId,
    p_rows: rows.map((row) => ({
      service_id: row.service_id,
      physical_weight_percent: Number(row.physical_weight_percent),
      distribution_method: row.distribution_method,
      source: row.source || "manual",
      notes: row.notes || "",
    })),
  });

  if (error) redirect(resultUrl(error.message, "error", baselineId, selectedDate));

  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/cronograma");
  revalidatePath("/engenharia/curvas");
  revalidatePath("/dashboard");
  redirect(resultUrl("Pesos físicos salvos. O andamento da obra foi recalculado.", "success", baselineId, selectedDate));
}
