"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos/locais";
const allowedTypes = new Set(["enterprise", "tower", "floor", "unit", "room", "sector", "external", "other"]);
const allowedStatuses = new Set(["active", "inactive"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const original = text(formData, key);
  if (!original) return fallback;
  const normalized = original.includes(",")
    ? original.replace(/\./g, "").replace(",", ".")
    : original;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}

function resultUrl(message: string, type: "error" | "success" = "error") {
  return `${LIST_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function refreshProjectStructure() {
  revalidatePath(LIST_PATH);
  revalidatePath("/empreendimentos/caracteristicas");
  revalidatePath("/engenharia/levantamento");
  revalidatePath("/engenharia/cronograma");
  revalidatePath("/dashboard");
}

async function locationContext(permission: "projects.view" | "projects.manage") {
  const context = await requireCompanyPermission(permission);
  if (!context.projectId) redirect(resultUrl("Selecione um empreendimento no topo do sistema."));
  return { ...context, projectId: context.projectId };
}

async function validateParent({
  locationId,
  parentId,
}: {
  locationId?: string | null;
  parentId: string | null;
}) {
  if (!parentId) return true;

  const { supabase, companyId, projectId } = await locationContext("projects.manage");
  const { data } = await supabase
    .from("engineering_takeoff_locations")
    .select("id, parent_id")
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  const locations = data ?? [];
  const parentMap = new Map(locations.map((item) => [item.id, item.parent_id as string | null]));
  if (!parentMap.has(parentId)) return false;

  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === locationId || visited.has(cursor)) return false;
    visited.add(cursor);
    cursor = parentMap.get(cursor) ?? null;
  }

  return true;
}

export async function createProjectLocation(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const locationType = text(formData, "location_type") || "floor";
  const repetitions = numberValue(formData, "repetitions", 1);
  const requestedOrder = numberValue(formData, "sort_order", Number.NaN);
  const parentId = optional(formData, "parent_id");

  if (!code || !name || !allowedTypes.has(locationType) || !Number.isFinite(repetitions) || repetitions <= 0) {
    redirect(resultUrl("Informe código, nome, tipo e repetições válidas para o local."));
  }

  const { supabase, companyId, projectId, userId } = await locationContext("projects.manage");
  if (!(await validateParent({ parentId }))) redirect(resultUrl("O local superior selecionado não é válido."));

  let sortOrder = Math.trunc(requestedOrder);
  if (!Number.isFinite(requestedOrder)) {
    const { data: lastLocation } = await supabase
      .from("engineering_takeoff_locations")
      .select("sort_order")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = Number(lastLocation?.sort_order ?? 0) + 10;
  }

  const { error } = await supabase.from("engineering_takeoff_locations").insert({
    company_id: companyId,
    project_id: projectId,
    parent_id: parentId,
    code,
    name,
    location_type: locationType,
    repetitions,
    sort_order: sortOrder,
    notes: optional(formData, "notes"),
    status: "active",
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505" ? `Já existe um local com o código ${code} nesta obra.` : error.message;
    redirect(resultUrl(message));
  }

  refreshProjectStructure();
  redirect(resultUrl("Local adicionado à estrutura do empreendimento.", "success"));
}

export async function updateProjectLocation(formData: FormData) {
  const locationId = text(formData, "location_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const locationType = text(formData, "location_type");
  const repetitions = numberValue(formData, "repetitions");
  const sortOrder = Math.trunc(numberValue(formData, "sort_order", 0));
  const parentId = optional(formData, "parent_id");
  const status = text(formData, "status") || "active";

  if (
    !locationId ||
    !code ||
    !name ||
    !allowedTypes.has(locationType) ||
    !allowedStatuses.has(status) ||
    !Number.isFinite(repetitions) ||
    repetitions <= 0 ||
    parentId === locationId
  ) {
    redirect(resultUrl("Revise os dados do local ou pavimento."));
  }

  const { supabase, companyId, projectId } = await locationContext("projects.manage");
  if (!(await validateParent({ locationId, parentId }))) {
    redirect(resultUrl("O local superior criaria uma hierarquia inválida."));
  }

  const { error } = await supabase
    .from("engineering_takeoff_locations")
    .update({
      parent_id: parentId,
      code,
      name,
      location_type: locationType,
      repetitions,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      notes: optional(formData, "notes"),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", locationId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) {
    const message = error.code === "23505" ? `Já existe um local com o código ${code} nesta obra.` : error.message;
    redirect(resultUrl(message));
  }

  refreshProjectStructure();
  redirect(resultUrl("Local atualizado. Os multiplicadores vinculados foram sincronizados.", "success"));
}

export async function setProjectLocationStatus(formData: FormData) {
  const locationId = text(formData, "location_id");
  const status = text(formData, "status");
  if (!locationId || !allowedStatuses.has(status)) redirect(resultUrl("Ação inválida para o local."));

  const { supabase, companyId, projectId } = await locationContext("projects.manage");

  if (status === "inactive") {
    const { count } = await supabase
      .from("engineering_takeoff_locations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("parent_id", locationId)
      .eq("status", "active");

    if ((count ?? 0) > 0) {
      redirect(resultUrl("Remova ou transfira os locais subordinados antes de excluir este item."));
    }
  }

  const { error } = await supabase
    .from("engineering_takeoff_locations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", locationId)
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (error) redirect(resultUrl(error.message));
  refreshProjectStructure();
  redirect(resultUrl(status === "active" ? "Local reativado." : "Local excluído da estrutura ativa.", "success"));
}

export async function moveProjectLocation(formData: FormData) {
  const locationId = text(formData, "location_id");
  const direction = text(formData, "direction");
  if (!locationId || !["up", "down"].includes(direction)) redirect(resultUrl("Movimentação inválida."));

  const { supabase, companyId, projectId } = await locationContext("projects.manage");
  const { data: locations, error: loadError } = await supabase
    .from("engineering_takeoff_locations")
    .select("id, sort_order, name")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("sort_order")
    .order("name");

  if (loadError) redirect(resultUrl(loadError.message));
  const index = (locations ?? []).findIndex((item) => item.id === locationId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= (locations ?? []).length) {
    redirect(resultUrl("O local já está no limite da lista."));
  }

  const current = locations![index];
  const target = locations![targetIndex];
  const currentOrder = Number(current.sort_order ?? index * 10);
  const targetOrder = Number(target.sort_order ?? targetIndex * 10);

  const firstUpdate = await supabase
    .from("engineering_takeoff_locations")
    .update({ sort_order: targetOrder, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("company_id", companyId)
    .eq("project_id", projectId);
  if (firstUpdate.error) redirect(resultUrl(firstUpdate.error.message));

  const secondUpdate = await supabase
    .from("engineering_takeoff_locations")
    .update({ sort_order: currentOrder, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("company_id", companyId)
    .eq("project_id", projectId);
  if (secondUpdate.error) redirect(resultUrl(secondUpdate.error.message));

  refreshProjectStructure();
  redirect(resultUrl("Ordem dos locais atualizada.", "success"));
}

function normalizeType(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    empreendimento: "enterprise",
    enterprise: "enterprise",
    torre: "tower",
    tower: "tower",
    pavimento: "floor",
    andar: "floor",
    floor: "floor",
    unidade: "unit",
    apartamento: "unit",
    unit: "unit",
    ambiente: "room",
    room: "room",
    setor: "sector",
    sector: "sector",
    externa: "external",
    externo: "external",
    external: "external",
    outro: "other",
    other: "other",
  };
  return aliases[normalized] ?? normalized;
}

export async function importProjectLocations(formData: FormData) {
  const source = text(formData, "structure_text");
  if (!source) redirect(resultUrl("Cole a estrutura que deseja importar."));

  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: Array<Record<string, string | number>> = [];

  for (const [index, line] of lines.entries()) {
    const columns = line.includes("\t") ? line.split("\t") : line.split(";");
    const values = columns.map((column) => column.trim());
    const first = values[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const second = values[1]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (index === 0 && first?.includes("ordem") && second?.includes("codigo")) continue;

    const [orderRaw, codeRaw, nameRaw, typeRaw = "floor", repetitionsRaw = "1", parentCodeRaw = "", notesRaw = ""] = values;
    const order = Number.parseInt(orderRaw || String((index + 1) * 10), 10);
    const repetitions = numberValue(new FormData(), "unused", 1);
    const normalizedRepetitions = repetitionsRaw.includes(",")
      ? Number(repetitionsRaw.replace(/\./g, "").replace(",", "."))
      : Number(repetitionsRaw || 1);
    const locationType = normalizeType(typeRaw || "floor");
    const code = (codeRaw || "").toUpperCase();
    const name = nameRaw || "";

    void repetitions;
    if (!code || !name || !allowedTypes.has(locationType) || !Number.isFinite(normalizedRepetitions) || normalizedRepetitions <= 0) {
      redirect(resultUrl(`Revise a linha ${index + 1} da importação.`));
    }

    rows.push({
      sort_order: Number.isFinite(order) ? order : (index + 1) * 10,
      code,
      name,
      location_type: locationType,
      repetitions: normalizedRepetitions,
      parent_code: (parentCodeRaw || "").toUpperCase(),
      notes: notesRaw || "",
      status: "active",
    });
  }

  if (!rows.length) redirect(resultUrl("Nenhum local válido foi encontrado para importar."));
  if (rows.length > 500) redirect(resultUrl("A importação aceita até 500 locais por vez."));

  const { supabase, companyId, projectId } = await locationContext("projects.manage");
  const { data, error } = await supabase.rpc("import_project_locations", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_rows: rows,
  });

  if (error) redirect(resultUrl(error.message));
  refreshProjectStructure();
  redirect(resultUrl(`${Number(data ?? rows.length)} local(is) importado(s) ou atualizado(s).`, "success"));
}
