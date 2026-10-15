"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const BASE = "/comercial/incorporacao/viabilidade";
const PHASE_KEYS = ["prelaunch","launch","construction_start","mid_construction","ready"] as const;
type PhaseKey = typeof PHASE_KEYS[number];

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}
function integerValue(formData: FormData, key: string, fallback = Number.NaN) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
}
function detail(studyId: string) { return `${BASE}/${studyId}`; }
function go(studyId: string, message: string, type: "success" | "error" = "success"): never {
  redirect(`${detail(studyId)}?${new URLSearchParams({ [type]: message }).toString()}`);
}
function refresh(studyId: string) {
  revalidatePath(detail(studyId));
  revalidatePath(BASE);
}
function phaseKey(value: string): PhaseKey | null {
  return PHASE_KEYS.includes(value as PhaseKey) ? value as PhaseKey : null;
}

async function requireDraftStudy(
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
  companyId: string,
  studyId: string,
) {
  const { data } = await supabase.from("commercial_feasibility_studies")
    .select("id,status,construction_duration_months,sales_start_offset_months,sales_velocity_units_month,entry_pct,during_construction_pct,keys_pct,post_keys_pct,post_keys_months")
    .eq("id", studyId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) go(studyId, "Estudo não localizado.", "error");
  if (data.status !== "draft") go(studyId, "O estudo aprovado é imutável.", "error");
  return data;
}

export async function initializeFeasibilitySalesPlan(formData: FormData) {
  const studyId = text(formData, "study_id");
  if (!studyId) redirect(`${BASE}?error=Estudo%20inv%C3%A1lido.`);
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  const study = await requireDraftStudy(supabase, companyId, studyId);

  const { count } = await supabase.from("commercial_feasibility_sales_velocities")
    .select("id", { count:"exact", head:true })
    .eq("company_id", companyId)
    .eq("study_id", studyId)
    .not("phase_key", "is", null);
  if ((count ?? 0) > 0) go(studyId, "O plano de vendas em fases já está ativo.");

  const duration = Math.max(2, Number(study.construction_duration_months ?? 36));
  const baseVelocity = Math.max(0.01, Number(study.sales_velocity_units_month ?? 2));
  const entry = Math.max(0, Number(study.entry_pct ?? 10));
  const keys = Math.max(0, Number(study.keys_pct ?? 20));
  const monthly = Math.max(0, 100 - entry - keys);
  const installments = Math.min(240, Math.max(1, Number(study.post_keys_months ?? 24)));
  const prelaunchOffset = Math.min(-6, Number(study.sales_start_offset_months ?? -3));

  const phases = [
    { phase_key:"prelaunch", name:"Pré-lançamento", start_offset_months:prelaunchOffset, sort_order:10 },
    { phase_key:"launch", name:"Lançamento", start_offset_months:-3, sort_order:20 },
    { phase_key:"construction_start", name:"Início das obras", start_offset_months:0, sort_order:30 },
    { phase_key:"mid_construction", name:"Meio das obras", start_offset_months:Math.max(1, Math.round(duration / 2)), sort_order:40 },
    { phase_key:"ready", name:"Pronto", start_offset_months:duration, sort_order:50 },
  ].map(item => ({
    ...item,
    company_id:companyId,
    study_id:studyId,
    target_units_pct:20,
    units_per_month:baseVelocity,
    price_appreciation_pct:0,
    entry_pct:entry,
    monthly_pct:monthly,
    keys_pct:keys,
    monthly_installments:installments,
    created_by:userId,
  }));

  const { error } = await supabase.from("commercial_feasibility_sales_velocities").insert(phases);
  if (error) go(studyId, error.message, "error");
  refresh(studyId);
  go(studyId, "Plano de Vendas e Recebimentos ativado em 5 fases. Agora ajuste metas, velocidade, valorização e condições.");
}

export async function updateFeasibilitySalesPhase(formData: FormData) {
  const studyId = text(formData, "study_id");
  const phaseId = text(formData, "sales_phase_id");
  const key = phaseKey(text(formData, "phase_key"));
  const startOffset = integerValue(formData, "start_offset_months");
  const targetPct = numberValue(formData, "target_units_pct");
  const unitsPerMonth = numberValue(formData, "units_per_month");
  const appreciationPct = numberValue(formData, "price_appreciation_pct", 0);
  const entryPct = numberValue(formData, "entry_pct");
  const monthlyPct = numberValue(formData, "monthly_pct");
  const keysPct = numberValue(formData, "keys_pct");
  const monthlyInstallments = integerValue(formData, "monthly_installments");
  const paymentTotal = entryPct + monthlyPct + keysPct;

  const valid = Boolean(
    studyId && phaseId && key &&
    Number.isFinite(startOffset) && startOffset >= -60 && startOffset <= 240 &&
    Number.isFinite(targetPct) && targetPct >= 0 && targetPct <= 100 &&
    Number.isFinite(unitsPerMonth) && unitsPerMonth > 0 &&
    Number.isFinite(appreciationPct) && appreciationPct >= -90 && appreciationPct <= 500 &&
    Number.isFinite(entryPct) && entryPct >= 0 && entryPct <= 100 &&
    Number.isFinite(monthlyPct) && monthlyPct >= 0 && monthlyPct <= 100 &&
    Number.isFinite(keysPct) && keysPct >= 0 && keysPct <= 100 &&
    Number.isFinite(monthlyInstallments) && monthlyInstallments >= 1 && monthlyInstallments <= 240 &&
    Math.abs(paymentTotal - 100) < 0.001
  );
  if (!valid) go(studyId || "invalido", "Revise a fase. Entrada + mensais + chaves precisam somar 100%.", "error");

  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);

  const { error } = await supabase.from("commercial_feasibility_sales_velocities").update({
    start_offset_months:startOffset,
    target_units_pct:targetPct,
    units_per_month:unitsPerMonth,
    price_appreciation_pct:appreciationPct,
    entry_pct:entryPct,
    monthly_pct:monthlyPct,
    keys_pct:keysPct,
    monthly_installments:monthlyInstallments,
    notes:text(formData, "notes") || null,
    updated_at:new Date().toISOString(),
  }).eq("id", phaseId).eq("study_id", studyId).eq("company_id", companyId).eq("phase_key", key);
  if (error) go(studyId, error.message, "error");
  refresh(studyId);
  go(studyId, "Fase comercial atualizada.");
}

export async function copyPreviousFeasibilitySalesPhaseTerms(formData: FormData) {
  const studyId = text(formData, "study_id");
  const phaseId = text(formData, "sales_phase_id");
  if (!studyId || !phaseId) go(studyId || "invalido", "Fase inválida.", "error");

  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { data: phases, error: loadError } = await supabase.from("commercial_feasibility_sales_velocities")
    .select("id,sort_order,entry_pct,monthly_pct,keys_pct,monthly_installments")
    .eq("company_id", companyId)
    .eq("study_id", studyId)
    .not("phase_key", "is", null)
    .order("sort_order");
  if (loadError) go(studyId, loadError.message, "error");
  const currentIndex = (phases ?? []).findIndex(item => item.id === phaseId);
  if (currentIndex <= 0) go(studyId, "Esta é a primeira fase e não possui condição anterior para copiar.", "error");
  const previous = phases![currentIndex - 1];
  const { error } = await supabase.from("commercial_feasibility_sales_velocities").update({
    entry_pct:previous.entry_pct,
    monthly_pct:previous.monthly_pct,
    keys_pct:previous.keys_pct,
    monthly_installments:previous.monthly_installments,
    updated_at:new Date().toISOString(),
  }).eq("id", phaseId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(studyId, error.message, "error");
  refresh(studyId);
  go(studyId, "Condição comercial copiada da fase anterior.");
}
