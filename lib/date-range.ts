export type DateRangePreset = "all" | "today" | "current_week" | "current_month" | "last_7_days" | "last_30_days" | "custom";

const validPresets = new Set<DateRangePreset>([
  "all",
  "today",
  "current_week",
  "current_month",
  "last_7_days",
  "last_30_days",
  "custom",
]);

function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function localIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  const distanceToMonday = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - distanceToMonday);
  return result;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

export function normalizeDateRangePreset(
  value: string | null | undefined,
  from?: string | null,
  to?: string | null,
): DateRangePreset {
  if (value && validPresets.has(value as DateRangePreset)) return value as DateRangePreset;
  if (cleanDate(from) || cleanDate(to)) return "custom";
  return "all";
}

export function resolveDateRange(
  value: string | null | undefined,
  customFrom?: string | null,
  customTo?: string | null,
  referenceDate = new Date(),
) {
  const preset = normalizeDateRangePreset(value, customFrom, customTo);
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  if (preset === "all") return { preset, from: "", to: "" };
  if (preset === "custom") return { preset, from: cleanDate(customFrom), to: cleanDate(customTo) };
  if (preset === "today") {
    const date = localIso(today);
    return { preset, from: date, to: date };
  }
  if (preset === "current_week") {
    const from = startOfWeek(today);
    return { preset, from: localIso(from), to: localIso(addDays(from, 6)) };
  }
  if (preset === "current_month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { preset, from: localIso(from), to: localIso(to) };
  }
  if (preset === "last_7_days") return { preset, from: localIso(addDays(today, -6)), to: localIso(today) };
  return { preset, from: localIso(addDays(today, -29)), to: localIso(today) };
}

export const dateRangePresetLabels: Record<DateRangePreset, string> = {
  all: "Todos",
  today: "Hoje",
  current_week: "Semana atual",
  current_month: "Mês atual",
  last_7_days: "Últimos 7 dias",
  last_30_days: "Últimos 30 dias",
  custom: "Período específico",
};
