"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos";
const IMAGE_BUCKET = "project-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const statuses = new Set(["planning", "active", "paused", "completed", "archived"]);
const projectTypes = new Set(["residential", "commercial", "mixed", "land", "industrial", "other"]);
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

function coverImage(formData: FormData) {
  const value = formData.get("cover_image");
  if (!(value instanceof File) || value.size === 0) return null;
  if (!imageExtensions[value.type]) {
    throw new Error("A imagem deve estar em JPG, PNG ou WebP.");
  }
  if (value.size > MAX_IMAGE_BYTES) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }
  return value;
}

async function uploadCoverImage({
  supabase,
  companyId,
  projectId,
  image,
}: {
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"];
  companyId: string;
  projectId: string;
  image: File;
}) {
  const extension = imageExtensions[image.type];
  const path = `${companyId}/${projectId}/capa-${crypto.randomUUID()}.${extension}`;
  const bytes = await image.arrayBuffer();
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: image.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function createProject(formData: FormData) {
  const payload = projectPayload(formData);
  if (!validatePayload(payload)) redirect(listUrl("Revise o nome, o estado e os valores numéricos do empreendimento."));

  let image: File | null = null;
  try {
    image = coverImage(formData);
  } catch (error) {
    redirect(listUrl(error instanceof Error ? error.message : "Imagem inválida."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("projects.manage");
  const { data: project, error } = await supabase
    .from("projects")
    .insert({ company_id: companyId, ...payload, created_by: userId })
    .select("id")
    .single();

  if (error || !project?.id) redirect(listUrl(error?.message || "Não foi possível cadastrar o empreendimento."));

  if (image) {
    try {
      const coverImagePath = await uploadCoverImage({ supabase, companyId, projectId: project.id, image });
      const { error: imageUpdateError } = await supabase
        .from("projects")
        .update({ cover_image_path: coverImagePath })
        .eq("id", project.id)
        .eq("company_id", companyId);
      if (imageUpdateError) {
        await supabase.storage.from(IMAGE_BUCKET).remove([coverImagePath]);
        redirect(listUrl(imageUpdateError.message));
      }
    } catch (uploadError) {
      redirect(listUrl(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem da obra."));
    }
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  redirect(listUrl("Empreendimento cadastrado com sucesso.", "success"));
}

export async function updateProject(formData: FormData) {
  const projectId = text(formData, "project_id");
  const payload = projectPayload(formData);
  if (!projectId || !validatePayload(payload)) redirect(listUrl("Revise os dados do empreendimento."));

  let image: File | null = null;
  try {
    image = coverImage(formData);
  } catch (error) {
    redirect(listUrl(error instanceof Error ? error.message : "Imagem inválida."));
  }

  const removeCover = text(formData, "remove_cover_image") === "true";
  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  const { data: existingProject } = await supabase
    .from("projects")
    .select("id, cover_image_path")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!existingProject) redirect(listUrl("Empreendimento não localizado."));

  let newCoverPath: string | null = null;
  if (image) {
    try {
      newCoverPath = await uploadCoverImage({ supabase, companyId, projectId, image });
    } catch (uploadError) {
      redirect(listUrl(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem da obra."));
    }
  }

  const nextCoverPath = newCoverPath ?? (removeCover ? null : existingProject.cover_image_path);
  const { error } = await supabase
    .from("projects")
    .update({ ...payload, cover_image_path: nextCoverPath, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("company_id", companyId);

  if (error) {
    if (newCoverPath) await supabase.storage.from(IMAGE_BUCKET).remove([newCoverPath]);
    redirect(listUrl(error.message));
  }

  if ((newCoverPath || removeCover) && existingProject.cover_image_path) {
    await supabase.storage.from(IMAGE_BUCKET).remove([existingProject.cover_image_path]);
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  redirect(listUrl("Empreendimento atualizado.", "success"));
}

export async function selectProjectFromRegistry(formData: FormData) {
  const projectId = text(formData, "project_id");
  const { supabase, companyId } = await requireCompanyPermission("projects.view");
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!project) redirect(listUrl("Empreendimento não localizado."));

  const cookieStore = await cookies();
  cookieStore.set("elos_project_id", project.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath(LIST_PATH);
  redirect(listUrl(`${project.name} selecionado no sistema.`, "success"));
}
