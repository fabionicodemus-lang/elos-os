"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/impostos";
const categories = new Set(["federal", "state", "municipal", "labor", "social", "property", "other"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function parseMoney(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function competenceDate(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7) + "-01";
  return "";
}

function pageUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${PATH}?${params.toString()}`;
}

export async function saveTaxType(formData: FormData) {
  const taxTypeId = text(formData, "tax_type_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const category = text(formData, "category");
  const authoritySupplierId = text(formData, "authority_supplier_id");
  const status = text(formData, "status") || "active";

  if (!code || !name || !categories.has(category) || !authoritySupplierId || !["active", "inactive"].includes(status)) {
    redirect(pageUrl("Informe código, nome, categoria e órgão favorecido válidos."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("finance.taxes.manage");
  const supplierResult = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", authoritySupplierId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .maybeSingle();

  if (!supplierResult.data) redirect(pageUrl("O órgão favorecido não pertence à empresa ativa ou está inativo."));

  const payload = {
    company_id: companyId,
    code,
    name,
    category,
    authority_supplier_id: authoritySupplierId,
    fiscal_class: optional(formData, "fiscal_class"),
    payment_method: optional(formData, "payment_method"),
    document_prefix: optional(formData, "document_prefix"),
    notes: optional(formData, "notes"),
    status,
    updated_at: new Date().toISOString(),
  };

  const result = taxTypeId
    ? await supabase.from("finance_tax_types").update(payload).eq("id", taxTypeId).eq("company_id", companyId)
    : await supabase.from("finance_tax_types").insert({ ...payload, created_by: userId });

  if (result.error) {
    const message = result.error.code === "23505" ? `Já existe um tributo com o código ${code}.` : result.error.message;
    redirect(pageUrl(message));
  }

  revalidatePath(PATH);
  redirect(pageUrl(taxTypeId ? "Tributo atualizado." : "Tributo cadastrado.", "success"));
}

export async function saveTaxObligation(formData: FormData) {
  const obligationId = text(formData, "obligation_id");
  const projectId = text(formData, "project_id");
  const taxTypeId = text(formData, "tax_type_id");
  const competence = competenceDate(text(formData, "competence_date"));
  const dueDate = text(formData, "due_date");
  const principalAmount = parseMoney(formData.get("principal_amount"));
  const interestAmount = parseMoney(formData.get("interest_amount"), 0);
  const penaltyAmount = parseMoney(formData.get("penalty_amount"), 0);
  const otherAmount = parseMoney(formData.get("other_amount"), 0);
  const discountAmount = parseMoney(formData.get("discount_amount"), 0);
  const total = principalAmount + interestAmount + penaltyAmount + otherAmount - discountAmount;

  if (
    !projectId || !taxTypeId || !competence || !dueDate ||
    ![principalAmount, interestAmount, penaltyAmount, otherAmount, discountAmount].every((value) => Number.isFinite(value) && value >= 0) ||
    total < 0
  ) {
    redirect(pageUrl("Revise o empreendimento, tributo, competência, vencimento e valores informados."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("finance.taxes.manage");
  const [projectResult, typeResult] = await Promise.all([
    supabase.from("projects").select("id").eq("id", projectId).eq("company_id", companyId).neq("status", "archived").maybeSingle(),
    supabase.from("finance_tax_types").select("id").eq("id", taxTypeId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
  ]);

  if (!projectResult.data) redirect(pageUrl("O empreendimento não pertence à empresa ativa."));
  if (!typeResult.data) redirect(pageUrl("O tributo selecionado está inativo ou indisponível."));

  const payload = {
    company_id: companyId,
    project_id: projectId,
    tax_type_id: taxTypeId,
    competence_date: competence,
    reference: text(formData, "reference"),
    due_date: dueDate,
    principal_amount: principalAmount,
    interest_amount: interestAmount,
    penalty_amount: penaltyAmount,
    other_amount: otherAmount,
    discount_amount: discountAmount,
    document_number: optional(formData, "document_number"),
    payment_code: optional(formData, "payment_code"),
    barcode: optional(formData, "barcode"),
    notes: optional(formData, "notes"),
    status: "scheduled",
    updated_at: new Date().toISOString(),
  };

  let result;
  if (obligationId) {
    result = await supabase
      .from("finance_tax_obligations")
      .update(payload)
      .eq("id", obligationId)
      .eq("company_id", companyId)
      .in("status", ["scheduled", "cancelled"])
      .is("payable_id", null);
  } else {
    result = await supabase.from("finance_tax_obligations").insert({ ...payload, created_by: userId });
  }

  if (result.error) {
    const message = result.error.code === "23505"
      ? "Já existe uma obrigação igual para este tributo, empreendimento, competência e referência."
      : result.error.message;
    redirect(pageUrl(message));
  }

  revalidatePath(PATH);
  redirect(pageUrl(obligationId ? "Obrigação fiscal atualizada." : "Obrigação adicionada à agenda.", "success"));
}

export async function generateTaxPayable(formData: FormData) {
  const obligationId = text(formData, "obligation_id");
  if (!obligationId) redirect(pageUrl("Obrigação fiscal inválida."));

  const { supabase } = await requireCompanyPermission("finance.taxes.manage");
  const result = await supabase.rpc("finance_generate_tax_payable", { p_obligation_id: obligationId });
  if (result.error) redirect(pageUrl(result.error.message));

  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Conta a pagar gerada e vinculada à obrigação fiscal.", "success"));
}

export async function cancelTaxObligation(formData: FormData) {
  const obligationId = text(formData, "obligation_id");
  if (!obligationId) redirect(pageUrl("Obrigação fiscal inválida."));

  const { supabase, companyId } = await requireCompanyPermission("finance.taxes.manage");
  const result = await supabase
    .from("finance_tax_obligations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", obligationId)
    .eq("company_id", companyId)
    .eq("status", "scheduled")
    .is("payable_id", null);

  if (result.error) redirect(pageUrl(result.error.message));
  revalidatePath(PATH);
  redirect(pageUrl("Obrigação fiscal cancelada.", "success"));
}
