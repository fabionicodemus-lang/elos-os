"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/execucao/diario-obras";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function checked(formData: FormData, key: string) {
  return ["1", "true", "on", "yes"].includes(text(formData, key).toLowerCase());
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function safeJson(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function monthOf(value?: string | null) {
  return value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

function resultUrl(message: string, type: "success" | "error", options: { month?: string; tab?: string; diary?: string } = {}) {
  const params = new URLSearchParams({ [type]: message });
  if (options.month) params.set("month", options.month);
  if (options.tab) params.set("tab", options.tab);
  if (options.diary) params.set("diary", options.diary);
  return `${LIST_PATH}?${params.toString()}`;
}

function safeFileName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "foto";
  return `${stem}${extension}`;
}

export async function createDailyLog(formData: FormData) {
  const logDate = text(formData, "log_date");
  const shift = text(formData, "shift") || "day";
  const diaryType = text(formData, "diary_type") || "principal";
  const copyPrevious = checked(formData, "copy_previous");
  const month = monthOf(logDate);

  if (!validDate(logDate) || !["day", "night"].includes(shift) || !["principal", "complementary"].includes(diaryType)) {
    redirect(resultUrl("Revise a data, o turno e o tipo do diário.", "error", { month }));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.daily_logs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar o diário.", "error", { month }));

  const { data, error } = await supabase.rpc("create_execution_daily_log", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_log_date: logDate,
    p_shift: shift,
    p_diary_type: diaryType,
    p_copy_previous: copyPrevious,
  });

  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível criar o diário.", "error", { month }));
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Diário aberto para preenchimento.", "success", { month, tab: "calendar", diary: String(data) }));
}

export async function saveDailyLog(formData: FormData) {
  const logId = text(formData, "daily_log_id");
  const logDate = text(formData, "log_date");
  const month = monthOf(logDate);
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.daily_logs.manage");
  if (!projectId || !logId) redirect(resultUrl("Diário ou obra não identificados.", "error", { month }));

  const { error } = await supabase.rpc("save_execution_daily_log", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_log_id: logId,
    p_work_start: optional(formData, "work_start"),
    p_work_end: optional(formData, "work_end"),
    p_general_notes: optional(formData, "general_notes"),
    p_no_occurrences: checked(formData, "no_occurrences"),
    p_no_safety_events: checked(formData, "no_safety_events"),
    p_confirmed: checked(formData, "confirmed_by_filler"),
    p_weather: safeJson(text(formData, "weather_json")),
    p_workforce: safeJson(text(formData, "workforce_json")),
    p_services: safeJson(text(formData, "services_json")),
    p_occurrences: safeJson(text(formData, "occurrences_json")),
  });

  if (error) redirect(resultUrl(error.message, "error", { month, diary: logId }));

  const caption = optional(formData, "photo_caption");
  const files = formData.getAll("photos");
  for (const value of files) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 15 * 1024 * 1024) redirect(resultUrl(`A foto ${value.name} excede 15 MB.`, "error", { month, diary: logId }));
    if (!value.type.startsWith("image/")) redirect(resultUrl(`${value.name} não é uma imagem válida.`, "error", { month, diary: logId }));
    const path = `${companyId}/${projectId}/${logId}/${crypto.randomUUID()}-${safeFileName(value.name)}`;
    const bytes = new Uint8Array(await value.arrayBuffer());
    const upload = await supabase.storage.from("daily-log-photos").upload(path, bytes, { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(`Falha ao enviar ${value.name}: ${upload.error.message}`, "error", { month, diary: logId }));
    const insert = await supabase.from("execution_daily_log_photos").insert({
      company_id: companyId,
      project_id: projectId,
      daily_log_id: logId,
      storage_path: path,
      file_name: value.name,
      mime_type: value.type,
      file_size: value.size,
      caption,
      uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("daily-log-photos").remove([path]);
      redirect(resultUrl(insert.error.message, "error", { month, diary: logId }));
    }
  }

  await supabase.rpc("refresh_execution_daily_log_completion", { p_log_id: logId });
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Diário salvo. O percentual de preenchimento foi atualizado.", "success", { month, diary: logId }));
}

export async function removeDailyLogPhoto(formData: FormData) {
  const photoId = text(formData, "photo_id");
  const logId = text(formData, "daily_log_id");
  const logDate = text(formData, "log_date");
  const month = monthOf(logDate);
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.daily_logs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", { month }));

  const { data: photo } = await supabase.from("execution_daily_log_photos").select("storage_path, execution_daily_logs!inner(status,is_current)")
    .eq("id", photoId).eq("company_id", companyId).eq("project_id", projectId).eq("daily_log_id", logId).maybeSingle();
  const log = photo?.execution_daily_logs as unknown as { status?: string; is_current?: boolean } | null;
  if (!photo || !log?.is_current || !["pending", "in_progress", "reopened"].includes(log.status ?? "")) {
    redirect(resultUrl("A foto pertence a uma versão bloqueada.", "error", { month, diary: logId }));
  }
  const deletion = await supabase.from("execution_daily_log_photos").delete().eq("id", photoId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", { month, diary: logId }));
  await supabase.storage.from("daily-log-photos").remove([photo.storage_path]);
  await supabase.rpc("refresh_execution_daily_log_completion", { p_log_id: logId });
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Foto removida.", "success", { month, diary: logId }));
}

async function statusAction(formData: FormData, permission: string, rpc: string, success: string, extra: Record<string, unknown> = {}) {
  const logId = text(formData, "daily_log_id");
  const logDate = text(formData, "log_date");
  const month = monthOf(logDate);
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", { month }));
  const { data, error } = await supabase.rpc(rpc, { p_company_id: companyId, p_project_id: projectId, p_log_id: logId, ...extra });
  if (error) redirect(resultUrl(error.message, "error", { month, diary: logId }));
  revalidatePath(LIST_PATH);
  return { data, month, logId, success };
}

export async function submitDailyLog(formData: FormData) {
  const result = await statusAction(formData, "execution.daily_logs.submit", "submit_execution_daily_log", "Diário enviado para aprovação.");
  redirect(resultUrl(result.success, "success", { month: result.month, diary: result.logId }));
}

export async function approveDailyLog(formData: FormData) {
  const result = await statusAction(formData, "execution.daily_logs.approve", "approve_execution_daily_log", "Diário aprovado e bloqueado.", {
    p_notes: optional(formData, "approval_notes"),
    p_with_reservations: checked(formData, "with_reservations"),
  });
  redirect(resultUrl(result.success, "success", { month: result.month, diary: result.logId }));
}

export async function returnDailyLog(formData: FormData) {
  const result = await statusAction(formData, "execution.daily_logs.approve", "return_execution_daily_log", "Diário devolvido para correção.", {
    p_reason: text(formData, "reason"),
  });
  redirect(resultUrl(result.success, "success", { month: result.month, diary: result.logId }));
}

export async function reopenDailyLog(formData: FormData) {
  const result = await statusAction(formData, "execution.daily_logs.reopen", "reopen_execution_daily_log", "Nova versão criada para correção.", {
    p_reason: text(formData, "reason"),
  });
  redirect(resultUrl(result.success, "success", { month: result.month, diary: String(result.data ?? result.logId) }));
}

export async function cancelDailyLog(formData: FormData) {
  const result = await statusAction(formData, "execution.daily_logs.approve", "cancel_execution_daily_log", "Diário cancelado com rastreabilidade.", {
    p_reason: text(formData, "reason"),
  });
  redirect(resultUrl(result.success, "success", { month: result.month, tab: "calendar" }));
}

export async function saveDailyLogSettings(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.daily_logs.settings");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", { tab: "settings" }));
  const workdays = formData.getAll("workdays").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const requiredPhotos = Math.max(0, Math.min(20, Number(text(formData, "required_photo_count")) || 0));
  const retroactiveDays = Math.max(0, Math.min(3650, Number(text(formData, "retroactive_days")) || 0));
  const { error } = await supabase.from("execution_daily_log_settings").upsert({
    company_id: companyId,
    project_id: projectId,
    workdays: workdays.length ? workdays : [1, 2, 3, 4, 5, 6],
    default_shift: text(formData, "default_shift") === "night" ? "night" : "day",
    day_end: text(formData, "day_end") || "18:00",
    auto_create: checked(formData, "auto_create"),
    allow_complementary: checked(formData, "allow_complementary"),
    required_photo_count: requiredPhotos,
    retroactive_days: retroactiveDays,
    updated_by: userId,
  }, { onConflict: "project_id" });
  if (error) redirect(resultUrl(error.message, "error", { tab: "settings" }));
  revalidatePath(LIST_PATH);
  redirect(resultUrl("Configurações do Diário de Obras salvas.", "success", { tab: "settings" }));
}

export async function generatePendingDailyLogs(formData: FormData) {
  const requestedMonth = text(formData, "month");
  const month = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : new Date().toISOString().slice(0, 7);
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.daily_logs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", { month }));
  const { data: settings } = await supabase.from("execution_daily_log_settings").select("workdays, default_shift, auto_create").eq("project_id", projectId).maybeSingle();
  const workdays = (settings?.workdays as number[] | null) ?? [1, 2, 3, 4, 5, 6];
  const shift = settings?.default_shift === "night" ? "night" : "day";
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let created = 0;
  for (let day = 1; day <= end; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    if (!workdays.includes(date.getUTCDay())) continue;
    const isoDate = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const before = await supabase.from("execution_daily_logs").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("log_date", isoDate).eq("shift", shift).eq("diary_type", "principal").eq("is_current", true).neq("status", "cancelled");
    if ((before.count ?? 0) > 0) continue;
    const result = await supabase.rpc("create_execution_daily_log", { p_company_id: companyId, p_project_id: projectId, p_log_date: isoDate, p_shift: shift, p_diary_type: "principal", p_copy_previous: false });
    if (!result.error) created += 1;
  }
  revalidatePath(LIST_PATH);
  redirect(resultUrl(`${created} diário(s) pendente(s) criado(s) para o mês.`, "success", { month }));
}
