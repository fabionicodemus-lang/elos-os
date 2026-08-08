"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos/unidades";
const allowedStatuses = new Set(["available", "reserved", "sold", "inactive"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function parseLocaleNumber(rawValue: string, fallback = Number.NaN) {
  const raw = rawValue.trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}


function optionalNumber(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = parseLocaleNumber(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

function optionalInteger(formData: FormData, key: string) {
  const value = optionalNumber(formData, key);
  if (value === null) return null;
  return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
}

function resultUrl(message: string, type: "error" | "success" = "error") {
  return `${LIST_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function refreshUnits() {
  revalidatePath(LIST_PATH);
  revalidatePath("/empreendimentos");
  revalidatePath("/empreendimentos/caracteristicas");
  revalidatePath("/comercial/vendas");
  revalidatePath("/dashboard");
}

async function unitContext() {
  const context = await requireCompanyPermission("projects.manage");
  if (!context.projectId) redirect(resultUrl("Selecione um empreendimento no topo do sistema."));
  return { ...context, projectId: context.projectId };
}

async function validateFloorLocation(locationId: string | null) {
  if (!locationId) return true;
  const { supabase, companyId, projectId } = await unitContext();
  const { data } = await supabase
    .from("engineering_takeoff_locations")
    .select("id")
    .eq("id", locationId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

function unitPayload(formData: FormData) {
  const status = text(formData, "status") || "available";
  return {
    code: text(formData, "code").toUpperCase(),
    tower: optional(formData, "tower"),
    floor: optionalInteger(formData, "floor"),
    type: optional(formData, "type"),
    position: optional(formData, "position"),
    floor_location_id: optional(formData, "floor_location_id"),
    private_area: optionalNumber(formData, "private_area"),
    uncovered_private_area: optionalNumber(formData, "uncovered_private_area"),
    common_area: optionalNumber(formData, "common_area"),
    total_area: optionalNumber(formData, "total_area"),
    fractional_share: optionalNumber(formData, "fractional_share"),
    bedrooms: optionalInteger(formData, "bedrooms"),
    suites: optionalInteger(formData, "suites"),
    parking_spaces: optionalInteger(formData, "parking_spaces"),
    parking_description: optional(formData, "parking_description"),
    list_price: optionalNumber(formData, "list_price"),
    status: allowedStatuses.has(status) ? status : "available",
    registry: optional(formData, "registry"),
    notes: optional(formData, "notes"),
  };
}

function validPayload(payload: ReturnType<typeof unitPayload>) {
  const numericValues = [
    payload.floor,
    payload.private_area,
    payload.uncovered_private_area,
    payload.common_area,
    payload.total_area,
    payload.fractional_share,
    payload.bedrooms,
    payload.suites,
    payload.parking_spaces,
    payload.list_price,
  ].filter((value): value is number => value !== null);

  return Boolean(payload.code && numericValues.every((value) => Number.isFinite(value) && value >= 0));
}

export async function createProjectUnit(formData: FormData) {
  const payload = unitPayload(formData);
  if (!validPayload(payload)) redirect(resultUrl("Revise o código, as áreas, as quantidades e o preço da unidade."));
  if (payload.status === "sold") payload.status = "available";
  if (!(await validateFloorLocation(payload.floor_location_id))) {
    redirect(resultUrl("O local ou pavimento selecionado não pertence ao empreendimento."));
  }

  const { supabase, companyId, projectId, userId } = await unitContext();
  const { error } = await supabase.from("units").insert({
    company_id: companyId,
    project_id: projectId,
    ...payload,
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505" ? `Já existe uma unidade com o código ${payload.code}.` : error.message;
    redirect(resultUrl(message));
  }

  refreshUnits();
  redirect(resultUrl("Unidade privativa cadastrada.", "success"));
}

export async function updateProjectUnit(formData: FormData) {
  const unitId = text(formData, "unit_id");
  const payload = unitPayload(formData);
  if (!unitId || !validPayload(payload)) redirect(resultUrl("Revise os dados da unidade privativa."));
  if (!(await validateFloorLocation(payload.floor_location_id))) {
    redirect(resultUrl("O local ou pavimento selecionado não pertence ao empreendimento."));
  }

  const { supabase, companyId, projectId } = await unitContext();
  const { data: activeSale } = await supabase
    .from("sales")
    .select("id")
    .eq("unit_id", unitId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (activeSale) payload.status = "sold";
  if (!activeSale && payload.status === "sold") {
    redirect(resultUrl("O status Vendida é definido automaticamente por uma venda ativa."));
  }

  const { error } = await supabase
    .from("units")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", unitId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) {
    const message = error.code === "23505" ? `Já existe uma unidade com o código ${payload.code}.` : error.message;
    redirect(resultUrl(message));
  }

  refreshUnits();
  redirect(resultUrl("Unidade privativa atualizada.", "success"));
}

export async function setProjectUnitStatus(formData: FormData) {
  const unitId = text(formData, "unit_id");
  const status = text(formData, "status");
  if (!unitId || !allowedStatuses.has(status) || status === "sold") redirect(resultUrl("Ação inválida para a unidade."));

  const { supabase, companyId, projectId } = await unitContext();
  const { data: activeSale } = await supabase
    .from("sales")
    .select("id")
    .eq("unit_id", unitId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (activeSale) redirect(resultUrl("Uma unidade com venda ativa não pode ser inativada ou liberada."));

  const { error } = await supabase
    .from("units")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", unitId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) redirect(resultUrl(error.message));
  refreshUnits();
  redirect(resultUrl(status === "inactive" ? "Unidade retirada do cadastro ativo." : "Situação da unidade atualizada.", "success"));
}

function normalizeStatus(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    disponivel: "available",
    available: "available",
    reservada: "reserved",
    reservado: "reserved",
    reserved: "reserved",
    vendida: "sold",
    vendido: "sold",
    sold: "sold",
    inativa: "inactive",
    inativo: "inactive",
    inactive: "inactive",
  };
  return aliases[normalized] ?? normalized;
}

function numericCell(value: string) {
  if (!value.trim()) return "";
  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function importProjectUnits(formData: FormData) {
  const source = text(formData, "units_text");
  if (!source) redirect(resultUrl("Cole as unidades que deseja importar."));

  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: Array<Record<string, string | number>> = [];

  for (const [index, line] of lines.entries()) {
    const columns = line.includes("\t") ? line.split("\t") : line.split(";");
    const values = columns.map((column) => column.trim());
    const header = values[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (index === 0 && header?.includes("codigo")) continue;

    const [
      codeRaw,
      towerRaw = "",
      floorRaw = "",
      typeRaw = "",
      positionRaw = "",
      floorLocationCodeRaw = "",
      privateAreaRaw = "",
      uncoveredAreaRaw = "",
      commonAreaRaw = "",
      totalAreaRaw = "",
      fractionalShareRaw = "",
      bedroomsRaw = "",
      suitesRaw = "",
      parkingSpacesRaw = "",
      parkingDescriptionRaw = "",
      listPriceRaw = "",
      statusRaw = "available",
      registryRaw = "",
      notesRaw = "",
    ] = values;

    const status = normalizeStatus(statusRaw || "available");
    const numericEntries = {
      floor: numericCell(floorRaw),
      private_area: numericCell(privateAreaRaw),
      uncovered_private_area: numericCell(uncoveredAreaRaw),
      common_area: numericCell(commonAreaRaw),
      total_area: numericCell(totalAreaRaw),
      fractional_share: numericCell(fractionalShareRaw),
      bedrooms: numericCell(bedroomsRaw),
      suites: numericCell(suitesRaw),
      parking_spaces: numericCell(parkingSpacesRaw),
      list_price: numericCell(listPriceRaw),
    };

    if (
      !codeRaw ||
      !allowedStatuses.has(status) ||
      Object.values(numericEntries).some((value) => value !== "" && (!Number.isFinite(value) || Number(value) < 0))
    ) {
      redirect(resultUrl(`Revise a linha ${index + 1} da importação.`));
    }

    rows.push({
      code: codeRaw.toUpperCase(),
      tower: towerRaw,
      floor: numericEntries.floor,
      type: typeRaw,
      position: positionRaw,
      floor_location_code: floorLocationCodeRaw.toUpperCase(),
      private_area: numericEntries.private_area,
      uncovered_private_area: numericEntries.uncovered_private_area,
      common_area: numericEntries.common_area,
      total_area: numericEntries.total_area,
      fractional_share: numericEntries.fractional_share,
      bedrooms: numericEntries.bedrooms,
      suites: numericEntries.suites,
      parking_spaces: numericEntries.parking_spaces,
      parking_description: parkingDescriptionRaw,
      list_price: numericEntries.list_price,
      status,
      registry: registryRaw,
      notes: notesRaw,
    });
  }

  if (!rows.length) redirect(resultUrl("Nenhuma unidade válida foi encontrada para importar."));
  if (rows.length > 1000) redirect(resultUrl("A importação aceita até 1.000 unidades por vez."));

  const { supabase, companyId, projectId } = await unitContext();
  const { data, error } = await supabase.rpc("import_project_units", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_rows: rows,
  });

  if (error) redirect(resultUrl(error.message));
  refreshUnits();
  redirect(resultUrl(`${Number(data ?? rows.length)} unidade(s) importada(s) ou atualizada(s).`, "success"));
}
