"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos";
const statuses = new Set(["planning", "active", "paused", "completed", "archived"]);
const projectTypes = new Set(["residential", "commercial", "mixed", "land", "industrial", "other"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

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

function listUrl(message: string, type: "error" | "success" = "error") {
  return `${LIST_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function projectPayload(formData: FormData) {
  const status = text(formData, "status") || "planning";
  const projectType = text(formData, "project_type") || "residential";

  return {
    name: text(formData, "name"),
    code: optional(formData, "code")?.toUpperCase() ?? null,
    project_type: projectTypes.has(projectType) ? projectType : "other",
    status: statuses.has(status) ? status : "planning",
    description: optional(formData, "description"),
    postal_code: optional(formData, "postal_code"),
    street: optional(formData, "street"),
    address_number: optional(formData, "address_number"),
    complement: optional(formData, "complement"),
    district: optional(formData, "district"),
    city: optional(formData, "city"),
    state: optional(formData, "state")?.toUpperCase() ?? null,
    land_area_m2: numberValue(formData, "land_area_m2"),
    built_area_m2: numberValue(formData, "built_area_m2"),
    private_area_m2: numberValue(formData, "private_area_m2"),
    common_area_m2: numberValue(formData, "common_area_m2"),
    total_units: integerValue(formData, "total_units"),
    total_towers: integerValue(formData, "total_towers", 1),
    total_floors: integerValue(formData, "total_floors"),
    parking_spaces: integerValue(formData, "parking_spaces"),
    launch_date: optional(formData, "launch_date"),
    construction_start_date: optional(formData, "construction_start_date"),
    delivery_date: optional(formData, "delivery_date"),
    registration_number: optional(formData, "registration_number"),
    notes: optional(formData, "notes"),
  };
}

function validatePayload(payload: ReturnType<typeof projectPayload>) {
  const numericValues = [
    payload.land_area_m2,
    payload.built_area_m2,
    payload.private_area_m2,
    payload.common_area_m2,
    payload.total_units,
    payload.total_towers,
    payload.total_floors,
    payload.parking_spaces,
  ];

  return Boolean(
    payload.name &&
    numericValues.every((value) => Number.isFinite(value) && value >= 0) &&
    (!payload.state || payload.state.length === 2)
  );
}

export async function createProject(formData: FormData) {
  const payload = projectPayload(formData);
  if (!validatePayload(payload)) redirect(listUrl("Revise o nome, o estado e os valores numéricos do empreendimento."));

  const { supabase, companyId, userId } = await requireCompanyPermission("projects.manage");
  const { error } = await supabase.from("projects").insert({
    company_id: companyId,
    ...payload,
    created_by: userId,
  });

  if (error) redirect(listUrl(error.message));
  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  redirect(listUrl("Empreendimento cadastrado com sucesso.", "success"));
}

export async function updateProject(formData: FormData) {
  const projectId = text(formData, "project_id");
  const payload = projectPayload(formData);
  if (!projectId || !validatePayload(payload)) redirect(listUrl("Revise os dados do empreendimento."));

  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  const { error } = await supabase
    .from("projects")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("company_id", companyId);

  if (error) redirect(listUrl(error.message));
  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  redirect(listUrl("Empreendimento atualizado.", "success"));
}
