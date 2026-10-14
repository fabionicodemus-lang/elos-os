"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { calculateFeasibility } from "@/lib/commercial/feasibility.mjs";
import { requireCompanyPermission } from "@/lib/workspace";

const BASE = "/comercial/incorporacao/viabilidade";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numberValue(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}
function integerValue(formData: FormData, key: string, fallback = 0) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
}
function go(path: string, message: string, type: "success" | "error" = "success"): never {
  redirect(`${path}?${new URLSearchParams({ [type]: message }).toString()}`);
}
function detail(studyId: string) { return `${BASE}/${studyId}`; }
function refreshStudy(studyId: string) {
  revalidatePath(detail(studyId));
  revalidatePath(BASE);
}

function studyPayload(formData: FormData) {
  const taxRegime = text(formData, "tax_regime") === "common" ? "common" : "ret";
  return {
    name: text(formData, "name"),
    code: optional(formData, "code")?.toUpperCase() ?? null,
    city: optional(formData, "city"),
    state: optional(formData, "state")?.toUpperCase() ?? null,
    project_type: ["residential","commercial","mixed","land","industrial","other"].includes(text(formData, "project_type")) ? text(formData, "project_type") : "residential",
    legal_entity_id: optional(formData, "legal_entity_id"),
    garage_stairs_area_m2: numberValue(formData, "garage_stairs_area_m2"),
    garage_stairs_cost_m2: numberValue(formData, "garage_stairs_cost_m2"),
    lobby_area_m2: numberValue(formData, "lobby_area_m2"),
    lobby_cost_m2: numberValue(formData, "lobby_cost_m2"),
    decorated_common_area_m2: numberValue(formData, "decorated_common_area_m2"),
    decorated_common_cost_m2: numberValue(formData, "decorated_common_cost_m2"),
    apartment_cost_m2: numberValue(formData, "apartment_cost_m2"),
    design_cost_m2: numberValue(formData, "design_cost_m2"),
    land_cash_amount: numberValue(formData, "land_cash_amount"),
    iptu_amount: numberValue(formData, "iptu_amount"),
    onerous_grant_amount: numberValue(formData, "onerous_grant_amount"),
    other_land_amount: numberValue(formData, "other_land_amount"),
    commission_pct: numberValue(formData, "commission_pct", 6),
    tax_regime: taxRegime,
    tax_rate_pct: numberValue(formData, "tax_rate_pct", taxRegime === "ret" ? 4 : 0),
    marketing_amount: numberValue(formData, "marketing_amount"),
    central_office_amount: numberValue(formData, "central_office_amount"),
    financial_cost_amount: numberValue(formData, "financial_cost_amount"),
    contingency_pct: numberValue(formData, "contingency_pct"),
    preconstruction_months: integerValue(formData, "preconstruction_months", 6),
    construction_duration_months: integerValue(formData, "construction_duration_months", 36),
    construction_start_date: optional(formData, "construction_start_date"),
    sales_start_offset_months: integerValue(formData, "sales_start_offset_months", -3),
    sales_velocity_units_month: numberValue(formData, "sales_velocity_units_month", 2),
    entry_pct: numberValue(formData, "entry_pct", 10),
    during_construction_pct: numberValue(formData, "during_construction_pct", 40),
    keys_pct: numberValue(formData, "keys_pct", 20),
    post_keys_pct: numberValue(formData, "post_keys_pct", 30),
    post_keys_months: integerValue(formData, "post_keys_months", 24),
    discount_rate_annual_pct: numberValue(formData, "discount_rate_annual_pct", 15),
    notes: optional(formData, "notes"),
  };
}

function validateStudyPayload(payload: ReturnType<typeof studyPayload>) {
  const numerics = Object.entries(payload).filter(([, value]) => typeof value === "number").map(([, value]) => value as number);
  const payment = payload.entry_pct + payload.during_construction_pct + payload.keys_pct + payload.post_keys_pct;
  return Boolean(
    payload.name &&
    numerics.every(Number.isFinite) &&
    payload.commission_pct >= 0 && payload.commission_pct <= 100 &&
    payload.tax_rate_pct >= 0 && payload.tax_rate_pct <= 100 &&
    payload.contingency_pct >= 0 && payload.contingency_pct <= 100 &&
    payload.sales_velocity_units_month > 0 &&
    payload.construction_duration_months > 0 &&
    Math.abs(payment - 100) < 0.001 &&
    (!payload.state || payload.state.length === 2)
  );
}

async function requireDraftStudy(
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
  companyId: string,
  studyId: string,
) {
  const { data: study } = await supabase.from("commercial_feasibility_studies")
    .select("id,status")
    .eq("id", studyId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!study) go(BASE, "Estudo não localizado.", "error");
  if (study.status !== "draft") go(detail(studyId), "O estudo aprovado é imutável.", "error");
  return study;
}

export async function createFeasibilityStudy(formData: FormData) {
  const name = text(formData, "name");
  if (!name) go(BASE, "Informe o nome do estudo.", "error");
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  const { data, error } = await supabase.from("commercial_feasibility_studies").insert({
    company_id: companyId,
    name,
    code: optional(formData, "code")?.toUpperCase() ?? null,
    city: optional(formData, "city"),
    state: optional(formData, "state")?.toUpperCase() ?? null,
    created_by: userId,
  }).select("id").single();
  if (error || !data?.id) go(BASE, error?.message ?? "Não foi possível criar o estudo.", "error");

  // A migration nova também cria a fase padrão por trigger. Este insert cobre ambientes
  // em que o trigger ainda não esteja ativo e é ignorado se a linha já existir.
  await supabase.from("commercial_feasibility_sales_velocities").upsert({
    company_id: companyId,
    study_id: data.id,
    name: "Velocidade padrão",
    start_offset_months: -3,
    units_per_month: 2,
    sort_order: 10,
    created_by: userId,
  }, { onConflict: "study_id,start_offset_months", ignoreDuplicates: true });

  go(detail(data.id), "Estudo criado. Preencha as premissas da permuta.");
}

export async function updateFeasibilityStudy(formData: FormData) {
  const studyId = text(formData, "study_id");
  const payload = studyPayload(formData);
  if (!studyId || !validateStudyPayload(payload)) go(detail(studyId || "invalido"), "Revise as premissas. As parcelas da venda precisam somar 100%.", "error");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_studies").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Premissas salvas e indicadores recalculados.");
}

export async function addFeasibilityUnitType(formData: FormData) {
  const studyId = text(formData, "study_id");
  const name = text(formData, "name");
  const quantity = integerValue(formData, "quantity");
  const area = numberValue(formData, "private_area_m2");
  const price = numberValue(formData, "sale_price_m2");
  const barter = integerValue(formData, "barter_units");
  if (!studyId || !name || quantity <= 0 || area <= 0 || price <= 0 || barter < 0 || barter > quantity) go(detail(studyId || "invalido"), "Revise a tipologia, quantidade, área, preço e unidades de permuta.", "error");
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_unit_types").insert({
    company_id: companyId, study_id: studyId, name, quantity, private_area_m2: area, sale_price_m2: price,
    barter_units: barter, sort_order: integerValue(formData, "sort_order"), notes: optional(formData, "notes"), created_by: userId,
  });
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Tipologia incluída.");
}

export async function updateFeasibilityUnitType(formData: FormData) {
  const studyId = text(formData, "study_id");
  const unitTypeId = text(formData, "unit_type_id");
  const name = text(formData, "name");
  const quantity = integerValue(formData, "quantity");
  const area = numberValue(formData, "private_area_m2");
  const price = numberValue(formData, "sale_price_m2");
  const barter = integerValue(formData, "barter_units");
  if (!studyId || !unitTypeId || !name || quantity <= 0 || area <= 0 || price <= 0 || barter < 0 || barter > quantity) go(detail(studyId || "invalido"), "Revise os dados da tipologia.", "error");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_unit_types").update({
    name, quantity, private_area_m2: area, sale_price_m2: price, barter_units: barter,
    sort_order: integerValue(formData, "sort_order"), notes: optional(formData, "notes"), updated_at: new Date().toISOString(),
  }).eq("id", unitTypeId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Tipologia atualizada.");
}

export async function deleteFeasibilityUnitType(formData: FormData) {
  const studyId = text(formData, "study_id");
  const unitTypeId = text(formData, "unit_type_id");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_unit_types").delete().eq("id", unitTypeId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Tipologia removida.");
}

export async function addFeasibilityConstructionArea(formData: FormData) {
  const studyId = text(formData, "study_id");
  const name = text(formData, "name");
  const areaM2 = numberValue(formData, "area_m2", Number.NaN);
  const costM2 = numberValue(formData, "cost_m2", Number.NaN);
  if (!studyId || !name || !Number.isFinite(areaM2) || !Number.isFinite(costM2) || areaM2 < 0 || costM2 < 0) {
    go(detail(studyId || "invalido"), "Revise o nome, a área e o custo por m².", "error");
  }
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_construction_areas").insert({
    company_id: companyId,
    study_id: studyId,
    name,
    area_m2: areaM2,
    cost_m2: costM2,
    sort_order: integerValue(formData, "sort_order"),
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Área de construção adicionada.");
}

export async function updateFeasibilityConstructionArea(formData: FormData) {
  const studyId = text(formData, "study_id");
  const areaId = text(formData, "construction_area_id");
  const name = text(formData, "name");
  const areaM2 = numberValue(formData, "area_m2", Number.NaN);
  const costM2 = numberValue(formData, "cost_m2", Number.NaN);
  if (!studyId || !areaId || !name || !Number.isFinite(areaM2) || !Number.isFinite(costM2) || areaM2 < 0 || costM2 < 0) {
    go(detail(studyId || "invalido"), "Revise os dados da área de construção.", "error");
  }
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_construction_areas").update({
    name,
    area_m2: areaM2,
    cost_m2: costM2,
    sort_order: integerValue(formData, "sort_order"),
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  }).eq("id", areaId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Área de construção atualizada.");
}

export async function deleteFeasibilityConstructionArea(formData: FormData) {
  const studyId = text(formData, "study_id");
  const areaId = text(formData, "construction_area_id");
  if (!studyId || !areaId) go(detail(studyId || "invalido"), "Área de construção inválida.", "error");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_construction_areas").delete().eq("id", areaId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Área de construção removida.");
}

export async function addFeasibilitySalesVelocity(formData: FormData) {
  const studyId = text(formData, "study_id");
  const name = text(formData, "name");
  const startOffset = integerValue(formData, "start_offset_months", Number.NaN);
  const unitsPerMonth = numberValue(formData, "units_per_month", Number.NaN);
  if (!studyId || !name || !Number.isFinite(startOffset) || startOffset < -60 || startOffset > 240 || !Number.isFinite(unitsPerMonth) || unitsPerMonth <= 0) {
    go(detail(studyId || "invalido"), "Revise o nome, o início e a velocidade de vendas.", "error");
  }
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_sales_velocities").insert({
    company_id: companyId,
    study_id: studyId,
    name,
    start_offset_months: startOffset,
    units_per_month: unitsPerMonth,
    sort_order: integerValue(formData, "sort_order"),
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Velocidade de vendas adicionada.");
}

export async function updateFeasibilitySalesVelocity(formData: FormData) {
  const studyId = text(formData, "study_id");
  const velocityId = text(formData, "sales_velocity_id");
  const name = text(formData, "name");
  const startOffset = integerValue(formData, "start_offset_months", Number.NaN);
  const unitsPerMonth = numberValue(formData, "units_per_month", Number.NaN);
  if (!studyId || !velocityId || !name || !Number.isFinite(startOffset) || startOffset < -60 || startOffset > 240 || !Number.isFinite(unitsPerMonth) || unitsPerMonth <= 0) {
    go(detail(studyId || "invalido"), "Revise os dados da velocidade de vendas.", "error");
  }
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { error } = await supabase.from("commercial_feasibility_sales_velocities").update({
    name,
    start_offset_months: startOffset,
    units_per_month: unitsPerMonth,
    sort_order: integerValue(formData, "sort_order"),
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  }).eq("id", velocityId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Velocidade de vendas atualizada.");
}

export async function deleteFeasibilitySalesVelocity(formData: FormData) {
  const studyId = text(formData, "study_id");
  const velocityId = text(formData, "sales_velocity_id");
  if (!studyId || !velocityId) go(detail(studyId || "invalido"), "Velocidade de vendas inválida.", "error");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  await requireDraftStudy(supabase, companyId, studyId);
  const { count } = await supabase.from("commercial_feasibility_sales_velocities")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("study_id", studyId);
  if ((count ?? 0) <= 1) go(detail(studyId), "O estudo precisa manter ao menos uma velocidade de vendas.", "error");
  const { error } = await supabase.from("commercial_feasibility_sales_velocities").delete().eq("id", velocityId).eq("study_id", studyId).eq("company_id", companyId);
  if (error) go(detail(studyId), error.message, "error");
  refreshStudy(studyId);
  go(detail(studyId), "Velocidade de vendas removida.");
}

export async function approveAndConvertFeasibilityStudy(formData: FormData) {
  const studyId = text(formData, "study_id");
  if (!studyId) go(BASE, "Estudo inválido.", "error");
  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.approve");
  const [studyResult, unitResult, areaResult, velocityResult] = await Promise.all([
    supabase.from("commercial_feasibility_studies").select("*").eq("id", studyId).eq("company_id", companyId).maybeSingle(),
    supabase.from("commercial_feasibility_unit_types").select("*").eq("study_id", studyId).eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("commercial_feasibility_construction_areas").select("*").eq("study_id", studyId).eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("commercial_feasibility_sales_velocities").select("*").eq("study_id", studyId).eq("company_id", companyId).order("start_offset_months").order("sort_order"),
  ]);
  const study = studyResult.data;
  const unitTypes = unitResult.data ?? [];
  const constructionAreas = areaResult.data ?? [];
  const salesVelocities = velocityResult.data ?? [];
  if (!study) go(BASE, "Estudo não localizado.", "error");
  if (study.status !== "draft") go(detail(studyId), "Este estudo já foi concluído.", "error");
  if (!unitTypes.length) go(detail(studyId), "Inclua ao menos uma tipologia antes de aprovar.", "error");
  if (!salesVelocities.length) go(detail(studyId), "Inclua ao menos uma velocidade de vendas antes de aprovar.", "error");
  const result = calculateFeasibility(study, unitTypes, { constructionAreas, salesVelocities });
  if (result.available_units <= 0 || result.available_vgv <= 0) go(detail(studyId), "A permuta consome todas as unidades. É necessário haver estoque comercializável.", "error");
  if (result.built_area_m2 <= 0 || result.construction_cost <= 0) go(detail(studyId), "Informe áreas e custos de obra antes de aprovar.", "error");
  const { cashflow, ...metrics } = result;
  const { error: snapshotError } = await supabase.from("commercial_feasibility_studies").update({
    approved_metrics: metrics,
    approved_cashflow: cashflow,
    updated_at: new Date().toISOString(),
  }).eq("id", studyId).eq("company_id", companyId).eq("status", "draft");
  if (snapshotError) go(detail(studyId), snapshotError.message, "error");
  const { data, error } = await supabase.rpc("commercial_convert_feasibility_study", { p_study_id: studyId });
  if (error) go(detail(studyId), error.message, "error");
  const projectId = (data as { project_id?: string } | null)?.project_id;
  revalidatePath(BASE);
  revalidatePath("/empreendimentos");
  revalidatePath("/comercial/incorporacao");
  go(detail(studyId), projectId ? `Estudo aprovado. Empreendimento criado: ${projectId}.` : "Estudo aprovado e convertido em empreendimento.");
}