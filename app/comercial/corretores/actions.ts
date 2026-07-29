"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/comercial/corretores";

function target(message: string, type: "error" | "success" = "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

function parseInteger(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function refresh() {
  revalidatePath(PATH);
  revalidatePath("/comercial/propostas");
  revalidatePath("/comercial/vendas");
  revalidatePath("/financeiro/contas-a-pagar");
}

export async function saveBroker(formData: FormData) {
  const brokerId = String(formData.get("broker_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "broker");
  const defaultCommissionRaw = parseMoney(formData.get("default_commission_pct"));
  const defaultCommissionPct = Number.isFinite(defaultCommissionRaw) && defaultCommissionRaw >= 0 ? defaultCommissionRaw : 0;
  const paymentDueDays = parseInteger(formData.get("payment_due_days"), 0);
  const status = String(formData.get("status") ?? "active");

  if (!name || !["broker", "agency", "manager", "partner"].includes(kind) || paymentDueDays < 0 || paymentDueDays > 3650 || !["active", "inactive"].includes(status)) {
    redirect(target("Preencha nome, tipo, prazo e situação válidos."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.brokers.manage");
  const payload = {
    company_id: companyId,
    kind,
    name,
    legal_name: optional(formData, "legal_name"),
    tax_id: optional(formData, "tax_id"),
    creci_number: optional(formData, "creci_number"),
    creci_state: optional(formData, "creci_state"),
    agency_name: optional(formData, "agency_name"),
    phone: optional(formData, "phone"),
    email: optional(formData, "email"),
    pix_key: optional(formData, "pix_key"),
    bank_name: optional(formData, "bank_name"),
    bank_agency: optional(formData, "bank_agency"),
    bank_account: optional(formData, "bank_account"),
    default_commission_pct: defaultCommissionPct,
    payment_due_days: paymentDueDays,
    status,
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  };

  const result = brokerId
    ? await supabase.from("commercial_brokers").update(payload).eq("id", brokerId).eq("company_id", companyId)
    : await supabase.from("commercial_brokers").insert({ ...payload, created_by: userId });

  if (result.error) {
    const message = result.error.code === "23505" ? "Já existe um corretor ou imobiliária com esse nome." : result.error.message;
    redirect(target(message));
  }

  refresh();
  redirect(target(brokerId ? "Cadastro atualizado." : "Corretor ou imobiliária cadastrado.", "success"));
}

export async function saveCommission(formData: FormData) {
  const commissionId = String(formData.get("commission_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const brokerId = String(formData.get("broker_id") ?? "").trim();
  const role = String(formData.get("role") ?? "broker");
  const baseRaw = parseMoney(formData.get("calculation_base"));
  const pctRaw = parseMoney(formData.get("commission_pct"));
  const dueDate = String(formData.get("due_date") ?? "").trim();

  if (!saleId || !brokerId || !["broker", "agency", "manager", "referral", "other"].includes(role) || !Number.isFinite(pctRaw) || pctRaw < 0 || !dueDate) {
    redirect(target("Informe venda, favorecido, percentual e vencimento válidos."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.brokers.manage");
  const [saleResult, brokerResult] = await Promise.all([
    supabase.from("sales").select("id,project_id,total_amount,status").eq("id", saleId).eq("company_id", companyId).maybeSingle(),
    supabase.from("commercial_brokers").select("id,status").eq("id", brokerId).eq("company_id", companyId).maybeSingle(),
  ]);

  if (!saleResult.data || saleResult.data.status !== "active") redirect(target("Selecione uma venda ativa da empresa atual."));
  if (!brokerResult.data || brokerResult.data.status !== "active") redirect(target("Selecione um corretor ou imobiliária ativo."));

  const calculationBase = Number.isFinite(baseRaw) && baseRaw >= 0 ? baseRaw : Number(saleResult.data.total_amount ?? 0);
  if (calculationBase <= 0) redirect(target("A base de cálculo precisa ser maior que zero."));

  if (commissionId) {
    const currentResult = await supabase
      .from("commercial_sale_commissions")
      .select("id,status,payable_id")
      .eq("id", commissionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!currentResult.data || currentResult.data.payable_id || !["planned", "cancelled"].includes(currentResult.data.status)) {
      redirect(target("A comissão já avançou para aprovação ou financeiro e não pode ser editada."));
    }
  }

  const payload = {
    company_id: companyId,
    project_id: saleResult.data.project_id,
    sale_id: saleId,
    broker_id: brokerId,
    role,
    calculation_base: calculationBase,
    commission_pct: pctRaw,
    due_date: dueDate,
    status: "planned",
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  };

  const result = commissionId
    ? await supabase.from("commercial_sale_commissions").update(payload).eq("id", commissionId).eq("company_id", companyId)
    : await supabase.from("commercial_sale_commissions").insert({ ...payload, source_system: "manual", created_by: userId });

  if (result.error) redirect(target(result.error.message));
  refresh();
  redirect(target(commissionId ? "Comissão atualizada." : "Comissão adicionada.", "success"));
}

export async function setCommissionStatus(formData: FormData) {
  const commissionId = String(formData.get("commission_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const dueDate = optional(formData, "due_date");
  if (!commissionId || !["planned", "approved", "cancelled"].includes(status)) redirect(target("Situação de comissão inválida."));

  const permission = status === "approved" ? "commercial.brokers.approve" : "commercial.brokers.manage";
  const { supabase, companyId, userId } = await requireCompanyPermission(permission);
  const result = await supabase.rpc("commercial_set_commission_status", {
    p_company_id: companyId,
    p_commission_id: commissionId,
    p_status: status,
    p_due_date: dueDate,
    p_user_id: userId,
  });
  if (result.error) redirect(target(result.error.message));

  refresh();
  const labels: Record<string, string> = { planned: "planejada", approved: "aprovada", cancelled: "cancelada" };
  redirect(target(`Comissão ${labels[status]}.`, "success"));
}

export async function generateCommissionPayable(formData: FormData) {
  const commissionId = String(formData.get("commission_id") ?? "").trim();
  if (!commissionId) redirect(target("Comissão inválida."));

  const { supabase } = await requireCompanyPermission("commercial.brokers.finance");
  const result = await supabase.rpc("commercial_generate_commission_payable", { p_commission_id: commissionId });
  if (result.error || !result.data) redirect(target(result.error?.message || "Não foi possível gerar a conta a pagar."));

  refresh();
  redirect(target("Conta a pagar da comissão gerada com sucesso.", "success"));
}
