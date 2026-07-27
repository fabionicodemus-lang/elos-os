"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/empreendimentos/empresas";
const entityTypes = new Set(["incorporator", "spe", "holding", "other"]);
const statuses = new Set(["active", "inactive"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function validCnpj(value: string) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(`${cnpj.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function listUrl(message: string, type: "error" | "success" = "error") {
  return `${LIST_PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function payload(formData: FormData) {
  const entityType = text(formData, "entity_type") || "spe";
  const status = text(formData, "status") || "active";
  return {
    entity_type: entityTypes.has(entityType) ? entityType : "other",
    status: statuses.has(status) ? status : "active",
    legal_name: text(formData, "legal_name"),
    trade_name: optional(formData, "trade_name"),
    cnpj: digits(text(formData, "cnpj")),
    state_registration: optional(formData, "state_registration"),
    municipal_registration: optional(formData, "municipal_registration"),
    parent_entity_id: optional(formData, "parent_entity_id"),
    email: optional(formData, "email"),
    phone: optional(formData, "phone"),
    postal_code: optional(formData, "postal_code"),
    street: optional(formData, "street"),
    address_number: optional(formData, "address_number"),
    complement: optional(formData, "complement"),
    district: optional(formData, "district"),
    city: optional(formData, "city"),
    state: optional(formData, "state")?.toUpperCase() ?? null,
    notes: optional(formData, "notes"),
  };
}

function validatePayload(record: ReturnType<typeof payload>) {
  return Boolean(
    record.legal_name &&
    validCnpj(record.cnpj) &&
    (!record.state || record.state.length === 2)
  );
}

async function validateParent({
  supabase,
  companyId,
  parentEntityId,
  editingId,
}: {
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"];
  companyId: string;
  parentEntityId: string | null;
  editingId?: string;
}) {
  if (!parentEntityId) return true;
  if (parentEntityId === editingId) return false;
  const { data } = await supabase
    .from("legal_entities")
    .select("id")
    .eq("id", parentEntityId)
    .eq("company_id", companyId)
    .maybeSingle();
  return Boolean(data);
}

export async function createLegalEntity(formData: FormData) {
  const record = payload(formData);
  if (!validatePayload(record)) {
    redirect(listUrl("Informe razão social, CNPJ válido e uma UF com duas letras."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("projects.manage");
  if (!(await validateParent({ supabase, companyId, parentEntityId: record.parent_entity_id }))) {
    redirect(listUrl("A empresa controladora selecionada não pertence ao ambiente atual."));
  }

  const { error } = await supabase.from("legal_entities").insert({
    company_id: companyId,
    ...record,
    created_by: userId,
  });

  if (error) {
    const message = error.code === "23505"
      ? "Este CNPJ já está cadastrado no ambiente atual."
      : error.message;
    redirect(listUrl(message));
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/empreendimentos");
  revalidatePath("/empreendimentos/caracteristicas");
  redirect(listUrl("Empresa fiscal cadastrada com sucesso.", "success"));
}

export async function updateLegalEntity(formData: FormData) {
  const entityId = text(formData, "entity_id");
  const record = payload(formData);
  if (!entityId || !validatePayload(record)) {
    redirect(listUrl("Revise os dados fiscais da empresa."));
  }

  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  const { data: current } = await supabase
    .from("legal_entities")
    .select("id, status")
    .eq("id", entityId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!current) redirect(listUrl("Empresa fiscal não localizada."));
  if (!(await validateParent({ supabase, companyId, parentEntityId: record.parent_entity_id, editingId: entityId }))) {
    redirect(listUrl("A empresa não pode ser controladora de si mesma ou pertencer a outro ambiente."));
  }

  if (current.status === "active" && record.status === "inactive") {
    const { count } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("legal_entity_id", entityId)
      .neq("status", "archived");
    if ((count ?? 0) > 0) {
      redirect(listUrl("Altere o vínculo dos empreendimentos antes de inativar esta empresa."));
    }
  }

  const { error } = await supabase
    .from("legal_entities")
    .update({ ...record, updated_at: new Date().toISOString() })
    .eq("id", entityId)
    .eq("company_id", companyId);

  if (error) {
    const message = error.code === "23505"
      ? "Este CNPJ já está cadastrado no ambiente atual."
      : error.message;
    redirect(listUrl(message));
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/empreendimentos");
  revalidatePath("/empreendimentos/caracteristicas");
  redirect(listUrl("Empresa fiscal atualizada.", "success"));
}

export async function setLegalEntityStatus(formData: FormData) {
  const entityId = text(formData, "entity_id");
  const nextStatus = text(formData, "status");
  if (!entityId || !statuses.has(nextStatus)) redirect(listUrl("Ação inválida."));

  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  if (nextStatus === "inactive") {
    const { count } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("legal_entity_id", entityId)
      .neq("status", "archived");
    if ((count ?? 0) > 0) {
      redirect(listUrl("Esta empresa está vinculada a empreendimento não arquivado e não pode ser inativada."));
    }
  }

  const { error } = await supabase
    .from("legal_entities")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", entityId)
    .eq("company_id", companyId);

  if (error) redirect(listUrl(error.message));
  revalidatePath(LIST_PATH);
  revalidatePath("/empreendimentos");
  redirect(listUrl(nextStatus === "active" ? "Empresa reativada." : "Empresa inativada.", "success"));
}
