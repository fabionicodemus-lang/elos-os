"use server";

import {revalidateFinancialViews} from "@/lib/finance-core/revalidate";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { financialInstallmentSummary, type FinancialInstallmentDraft } from "@/lib/financial-installments";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/financeiro/contas-a-pagar";

function pageUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${PATH}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;

  return Number(normalized);
}

function parseInstallments(formData: FormData): FinancialInstallmentDraft[] {
  try {
    const parsed = JSON.parse(String(formData.get("installments_json") ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row, index) => ({
      id: `server-${index + 1}`,
      label: String(row?.label ?? row?.number ?? `${index + 1} / ${parsed.length}`),
      due_date: String(row?.due_date ?? ""),
      amount: Number(row?.amount ?? 0),
      payment_method: String(row?.payment_method ?? "Boleto"),
    }));
  } catch {
    return [];
  }
}

export async function createPayable(formData: FormData) {
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const totalAmount = parseMoney(formData.get("total_amount"));
  const installments = parseInstallments(formData);
  const summary = financialInstallmentSummary(totalAmount, installments);

  if (!supplierId || !Number.isFinite(totalAmount) || totalAmount <= 0 || !summary.valid) {
    redirect(pageUrl("Informe fornecedor, valor total e parcelas válidas. A soma das parcelas precisa coincidir exatamente com o total."));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("payables.manage");

  if (!projectId) {
    redirect(pageUrl("Selecione uma obra antes de criar a conta."));
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!supplier) {
    redirect(pageUrl("O fornecedor selecionado não pertence à empresa ativa."));
  }

  const groupId = crypto.randomUUID();
  const document = optional(formData, "document");
  const fiscalClass = optional(formData, "fiscal_class");
  const notes = optional(formData, "notes");
  const rows = installments.map((installment, index) => ({
    company_id: companyId,
    project_id: projectId,
    supplier_id: supplierId,
    document,
    fiscal_class: fiscalClass,
    payment_method: installment.payment_method || null,
    due_date: installment.due_date,
    amount: installment.amount,
    status: "open" as const,
    installment_label: `${index + 1} / ${installments.length}`,
    notes,
    origin: "manual",
    source_system: "elos_os",
    source_id: `manual_installment_group:${groupId}:${index + 1}`,
    created_by: userId,
  }));

  const { error } = await supabase.from("payables").insert(rows);

  if (error) redirect(pageUrl(error.message));
  revalidatePath(PATH);
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath("/dashboard");
  redirect(pageUrl(`${installments.length} parcela(s) cadastrada(s) com sucesso.`, "success"));
}

export async function markPayablePaid(formData: FormData) {
  const payableId = String(formData.get("payable_id") ?? "").trim();
  const bankAccountId = String(formData.get("bank_account_id") ?? "").trim();
  const paidAt = String(formData.get("paid_at") ?? "").trim();
  const paidAmount = parseMoney(formData.get("paid_amount"));

  if (!payableId || !bankAccountId || !paidAt || !Number.isFinite(paidAmount) || paidAmount <= 0) {
    redirect(pageUrl("Informe conta bancária, data e valor pagos."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("payables.manage");
  const payableResult = await supabase
    .from("payables")
    .select("id,project_id,status")
    .eq("id", payableId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!payableResult.data) {
    redirect(pageUrl("A conta não está disponível para pagamento."));
  }
  if (projectId && payableResult.data.project_id !== projectId) {
    redirect(pageUrl("A conta pertence a outro empreendimento. Selecione a obra correta antes de pagar."));
  }

  const commandId = String(formData.get("command_id") ?? "");
  const result = await supabase.rpc("settle_finance_titles", {
    p_company: companyId, p_command: commandId, p_account: bankAccountId, p_date: paidAt,
    p_lines: [{ type: "AP", title_id: payableId, principal: paidAmount,
      interest: parseMoney(formData.get("interest_amount") ?? "0"), discount: parseMoney(formData.get("discount_amount") ?? "0"),
      evidence: String(formData.get("evidence") ?? "") }],
    p_reason: String(formData.get("reason") ?? "Registro financeiro de título"),
  });

  if (result.error) redirect(pageUrl(result.error.message));
  revalidateFinancialViews();
  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-bancarias");
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath("/execucao/medicoes-contratos");
  redirect(pageUrl("Pagamento registrado e lançado no extrato bancário.", "success"));
}

export async function cancelPayable(formData: FormData) {
  const payableId = String(formData.get("payable_id") ?? "").trim();
  if (!payableId) redirect(pageUrl("Conta inválida."));

  const { supabase, companyId, projectId } = await requireCompanyPermission("payables.manage");
  const payableResult = await supabase
    .from("payables")
    .select("id,project_id,status,origin,source_system,source_id")
    .eq("id", payableId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!payableResult.data || payableResult.data.status !== "open") {
    redirect(pageUrl("A conta não está disponível para cancelamento."));
  }
  if (projectId && payableResult.data.project_id !== projectId) {
    redirect(pageUrl("A conta pertence a outro empreendimento. Selecione a obra correta antes de cancelar."));
  }
  if (String(payableResult.data.source_id ?? "").startsWith("nfe:")) {
    redirect(pageUrl("Esta parcela foi gerada por uma NF-e aprovada e não pode ser cancelada isoladamente."));
  }

  const { data, error } = await supabase
    .from("payables")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", payableId)
    .eq("company_id", companyId)
    .eq("project_id", payableResult.data.project_id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) redirect(pageUrl(error.message));
  if (!data) redirect(pageUrl("A conta foi alterada por outro usuário. Atualize a tela e tente novamente."));
  revalidatePath(PATH);
  redirect(pageUrl("Conta cancelada.", "success"));
}

export async function reversePayableSettlement(formData: FormData){
 const {supabase,companyId}=await requireCompanyPermission("payables.manage");
 const choice=String(formData.get("discount_decision")??"");
 const amount=parseMoney(formData.get("refund_amount"));
 if(!["keep","revoke"].includes(choice)||!Number.isFinite(amount)||amount<0)redirect(pageUrl("Informe a condição do desconto e o valor da devolução."));
 const {error}=await supabase.rpc("reverse_finance_settlement",{
  p_company:companyId,p_event:String(formData.get("event_id")??""),p_command:String(formData.get("command_id")??""),
  p_date:String(formData.get("effective_date")??""),p_reason:String(formData.get("reason")??""),p_keep_discount:choice==="keep",p_confirmed_refund:amount,p_evidence:String(formData.get("evidence")??"")||null,
 });
 if(error)redirect(pageUrl(error.message));
 revalidateFinancialViews();redirect(pageUrl("Estorno registrado. O caixa só muda pelo valor de devolução informado com evidência.","success"));
}

export async function validateUnassignedObligation(formData:FormData){
 const {supabase,companyId}=await requireCompanyPermission('payables.manage');
 const {error}=await supabase.rpc('validate_unassigned_obligation',{p_company:companyId,p_object:String(formData.get('object_id')??''),p_command:String(formData.get('command_id')??''),p_competence:optional(formData,'competence'),p_economic_amount:optional(formData,'economic_amount')===null?null:parseMoney(formData.get('economic_amount')),p_evidence:String(formData.get('evidence')??''),p_reason:String(formData.get('reason')??'')});
 if(error)redirect(pageUrl(error.message));revalidateFinancialViews();redirect(pageUrl('Obrigação validada na entidade; apropriação à obra continua pendente.','success'));
}
