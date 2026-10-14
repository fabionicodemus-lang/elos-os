"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/calendario";
function go(message: string, type: "success" | "error" = "success", year?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (year) params.set("year", year);
  redirect(`${PATH}?${params.toString()}`);
}
function iso(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nationalCalendar(year: number) {
  const easter = easterSunday(year);
  return [
    [`${year}-01-01`, "Confraternização Universal"],
    [iso(addDays(easter, -48)), "Carnaval · segunda-feira"],
    [iso(addDays(easter, -47)), "Carnaval · terça-feira"],
    [iso(addDays(easter, -2)), "Paixão de Cristo"],
    [`${year}-04-21`, "Tiradentes"],
    [`${year}-05-01`, "Dia do Trabalho"],
    [iso(addDays(easter, 60)), "Corpus Christi"],
    [`${year}-09-07`, "Independência do Brasil"],
    [`${year}-10-12`, "Nossa Senhora Aparecida"],
    [`${year}-11-02`, "Finados"],
    [`${year}-11-15`, "Proclamação da República"],
    [`${year}-11-20`, "Dia Nacional de Zumbi e da Consciência Negra"],
    [`${year}-12-25`, "Natal"],
  ] as const;
}

export async function saveCalendarException(formData: FormData) {
  const date = String(formData.get("exception_date") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const exceptionType = String(formData.get("exception_type") ?? "non_working");
  const year = date.slice(0, 4);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !["non_working", "working"].includes(exceptionType)) go("Revise a data, o nome e o tipo.", "error", year);
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) go("Selecione uma obra.", "error", year);
  const { error } = await supabase.from("engineering_schedule_calendar_exceptions").upsert({
    company_id: companyId,
    project_id: projectId,
    exception_date: date,
    exception_type: exceptionType,
    name,
    source: "manual",
    notes: String(formData.get("notes") ?? "").trim() || null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "project_id,exception_date" });
  if (error) go(error.message, "error", year);
  revalidatePath(PATH);
  go("Exceção do calendário salva.", "success", year);
}

export async function deleteCalendarException(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const year = String(formData.get("year") ?? "").trim();
  const { supabase, companyId, projectId } = await requireCompanyPermission("schedule.manage");
  if (!projectId || !id) go("Registro inválido.", "error", year);
  const { error } = await supabase.from("engineering_schedule_calendar_exceptions").delete().eq("id", id).eq("company_id", companyId).eq("project_id", projectId);
  if (error) go(error.message, "error", year);
  revalidatePath(PATH);
  go("Exceção removida.", "success", year);
}

export async function seedNationalHolidays(formData: FormData) {
  const year = Number.parseInt(String(formData.get("year") ?? ""), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) go("Ano inválido.", "error");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) go("Selecione uma obra.", "error", String(year));
  const rows = nationalCalendar(year).map(([date, name]) => ({
    company_id: companyId,
    project_id: projectId,
    exception_date: date,
    exception_type: "non_working",
    name,
    source: "feriados_br",
    created_by: userId,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("engineering_schedule_calendar_exceptions").upsert(rows, { onConflict: "project_id,exception_date", ignoreDuplicates: true });
  if (error) go(error.message, "error", String(year));
  revalidatePath(PATH);
  go(`${rows.length} feriado(s) e data(s) nacionais carregados. Revise feriados estaduais, municipais e recessos da obra.`, "success", String(year));
}