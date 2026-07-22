"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function pageUrl(path: string, message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${path}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

export async function createSupplier(formData: FormData) {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const path = "/cadastros/fornecedores";

  if (!legalName) redirect(pageUrl(path, "Informe a razão social ou o nome do fornecedor."));

  const { supabase, companyId, userId } = await requireCompanyPermission("suppliers.manage");
  const personType = String(formData.get("person_type") ?? "company");
  const { error } = await supabase.from("suppliers").insert({
    company_id: companyId,
    person_type: ["company", "individual", "other"].includes(personType) ? personType : "other",
    legal_name: legalName,
    trade_name: optional(formData, "trade_name"),
    tax_id: optional(formData, "tax_id"),
    state_registration: optional(formData, "state_registration"),
    category: optional(formData, "category"),
    contact_name: optional(formData, "contact_name"),
    phone: optional(formData, "phone"),
    email: optional(formData, "email"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    notes: optional(formData, "notes"),
    status: "active",
    source_system: "elos_os",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  });

  if (error) redirect(pageUrl(path, error.message));
  revalidatePath(path);
  redirect(pageUrl(path, "Fornecedor cadastrado com sucesso.", "success"));
}

export async function setSupplierStatus(formData: FormData) {
  const path = "/cadastros/fornecedores";
  const supplierId = String(formData.get("supplier_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!supplierId || !["active", "inactive"].includes(status)) {
    redirect(pageUrl(path, "Ação inválida para o fornecedor."));
  }

  const { supabase, companyId } = await requireCompanyPermission("suppliers.manage");
  const { error } = await supabase
    .from("suppliers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", supplierId)
    .eq("company_id", companyId);

  if (error) redirect(pageUrl(path, error.message));
  revalidatePath(path);
  redirect(pageUrl(path, status === "active" ? "Fornecedor reativado." : "Fornecedor inativado.", "success"));
}

export async function createClient(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const path = "/cadastros/clientes";

  if (!name) redirect(pageUrl(path, "Informe o nome do cliente."));

  const { supabase, companyId, userId } = await requireCompanyPermission("clients.manage");
  const personType = String(formData.get("person_type") ?? "PF");
  const birthDate = optional(formData, "birth_date");
  const { error } = await supabase.from("clients").insert({
    company_id: companyId,
    person_type: ["PF", "PJ", "OTHER"].includes(personType) ? personType : "OTHER",
    name,
    tax_id: optional(formData, "tax_id"),
    identity_document: optional(formData, "identity_document"),
    birth_date: birthDate,
    marital_status: optional(formData, "marital_status"),
    profession: optional(formData, "profession"),
    email: optional(formData, "email"),
    phone: optional(formData, "phone"),
    secondary_phone: optional(formData, "secondary_phone"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    nationality: optional(formData, "nationality"),
    notes: optional(formData, "notes"),
    status: "active",
    source_system: "elos_os",
    source_id: `manual_${crypto.randomUUID()}`,
    created_by: userId,
  });

  if (error) redirect(pageUrl(path, error.message));
  revalidatePath(path);
  redirect(pageUrl(path, "Cliente cadastrado com sucesso.", "success"));
}

export async function setClientStatus(formData: FormData) {
  const path = "/cadastros/clientes";
  const clientId = String(formData.get("client_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!clientId || !["active", "inactive"].includes(status)) {
    redirect(pageUrl(path, "Ação inválida para o cliente."));
  }

  const { supabase, companyId } = await requireCompanyPermission("clients.manage");
  const { error } = await supabase
    .from("clients")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("company_id", companyId);

  if (error) redirect(pageUrl(path, error.message));
  revalidatePath(path);
  redirect(pageUrl(path, status === "active" ? "Cliente reativado." : "Cliente inativado.", "success"));
}
