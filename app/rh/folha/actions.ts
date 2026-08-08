"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/rh/folha";

function pageUrl(message: string, type: "error" | "success" = "error", runId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (runId) params.set("run", runId);
  return `${PATH}?${params.toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  return Number(normalized);
}

async function requireDraftRun(permission: string, runId: string) {
  const workspace = await requireCompanyPermission(permission);
  if (!workspace.projectId) redirect(pageUrl("Selecione um empreendimento antes de operar a folha."));

  const runResult = await workspace.supabase
    .from("hr_payroll_runs")
    .select("id,status,project_id")
    .eq("id", runId)
    .eq("company_id", workspace.companyId)
    .eq("project_id", workspace.projectId)
    .maybeSingle();

  if (!runResult.data) redirect(pageUrl("Folha não localizada."));
  if (runResult.data.status !== "draft") redirect(pageUrl("A folha já foi aprovada ou cancelada.", "error", runId));

  // O empreendimento já foi validado acima; devolvê-lo não-nulo evita espalhar
  // `!` por cada gravação da folha.
  return { ...workspace, projectId: workspace.projectId, run: runResult.data };
}

export async function createPayrollRun(formData: FormData) {
  const competenceInput = String(formData.get("competence") ?? "").trim();
  const salaryDueDate = String(formData.get("salary_due_date") ?? "").trim();

  if (!/^\d{4}-\d{2}$/.test(competenceInput) || !salaryDueDate) {
    redirect(pageUrl("Informe a competência e a data de pagamento."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("hr.payroll.manage");
  if (!projectId) redirect(pageUrl("Selecione um empreendimento antes de criar a folha."));

  const result = await supabase.rpc("create_hr_payroll_run", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_competence: `${competenceInput}-01`,
    p_salary_due_date: salaryDueDate,
    p_notes: optional(formData, "notes"),
  });

  if (result.error) redirect(pageUrl(result.error.message));
  const runId = String(result.data ?? "").trim();
  if (!runId) redirect(pageUrl("A folha foi criada, mas o identificador não foi retornado."));

  revalidatePath(PATH);
  redirect(pageUrl("Folha criada com os colaboradores ativos do empreendimento.", "success", runId));
}

export async function savePayrollEntry(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const entryId = String(formData.get("entry_id") ?? "").trim();
  const baseSalary = parseMoney(formData.get("base_salary"));
  const earnings = parseMoney(formData.get("earnings"));
  const deductions = parseMoney(formData.get("deductions"));
  const dueDate = String(formData.get("due_date") ?? "").trim();

  if (!runId || !entryId || !dueDate) redirect(pageUrl("Lançamento salarial inválido.", "error", runId));
  if (![baseSalary, earnings, deductions].every((value) => Number.isFinite(value) && value >= 0)) {
    redirect(pageUrl("Informe valores válidos para salário, proventos e descontos.", "error", runId));
  }
  if (deductions > baseSalary + earnings) {
    redirect(pageUrl("Os descontos não podem superar o salário bruto.", "error", runId));
  }

  const { supabase, companyId, projectId } = await requireDraftRun("hr.payroll.manage", runId);

  const { data, error } = await supabase
    .from("hr_payroll_entries")
    .update({
      base_salary: baseSalary,
      earnings,
      deductions,
      due_date: dueDate,
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId)
    .eq("payroll_run_id", runId)
    .eq("company_id", companyId)
    .eq("project_id", projectId!)
    .select("id")
    .maybeSingle();

  if (error) redirect(pageUrl(error.message, "error", runId));
  if (!data) redirect(pageUrl("Lançamento não localizado.", "error", runId));

  revalidatePath(PATH);
  redirect(pageUrl("Lançamento salarial atualizado.", "success", runId));
}

export async function addPayrollObligation(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const beneficiaryName = String(formData.get("beneficiary_name") ?? "").trim();
  const obligationType = String(formData.get("obligation_type") ?? "employer_charge").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const amount = parseMoney(formData.get("amount"));

  if (!runId || !description || !beneficiaryName || !dueDate || !Number.isFinite(amount) || amount <= 0) {
    redirect(pageUrl("Informe descrição, favorecido, vencimento e valor do encargo.", "error", runId));
  }
  if (!["employer_charge", "withholding", "benefit", "other"].includes(obligationType)) {
    redirect(pageUrl("Tipo de obrigação inválido.", "error", runId));
  }

  const { supabase, companyId, projectId } = await requireDraftRun("hr.payroll.manage", runId);
  const { error } = await supabase.from("hr_payroll_obligations").insert({
    company_id: companyId,
    project_id: projectId,
    payroll_run_id: runId,
    obligation_code: optional(formData, "obligation_code"),
    description,
    obligation_type: obligationType,
    beneficiary_name: beneficiaryName,
    beneficiary_tax_id: optional(formData, "beneficiary_tax_id"),
    due_date: dueDate,
    amount,
    notes: optional(formData, "notes"),
  });

  if (error) redirect(pageUrl(error.message, "error", runId));

  revalidatePath(PATH);
  redirect(pageUrl("Encargo ou benefício adicionado.", "success", runId));
}

export async function deletePayrollObligation(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  const obligationId = String(formData.get("obligation_id") ?? "").trim();
  if (!runId || !obligationId) redirect(pageUrl("Obrigação inválida.", "error", runId));

  const { supabase, companyId, projectId } = await requireDraftRun("hr.payroll.manage", runId);
  const { data, error } = await supabase
    .from("hr_payroll_obligations")
    .delete()
    .eq("id", obligationId)
    .eq("payroll_run_id", runId)
    .eq("company_id", companyId)
    .eq("project_id", projectId!)
    .select("id")
    .maybeSingle();

  if (error) redirect(pageUrl(error.message, "error", runId));
  if (!data) redirect(pageUrl("Obrigação não localizada.", "error", runId));

  revalidatePath(PATH);
  redirect(pageUrl("Obrigação removida.", "success", runId));
}

export async function postPayrollRun(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  if (!runId) redirect(pageUrl("Folha inválida."));

  const { supabase, companyId, projectId } = await requireCompanyPermission("hr.payroll.approve");
  if (!projectId) redirect(pageUrl("Selecione o empreendimento da folha."));

  const result = await supabase.rpc("post_hr_payroll_run", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_run_id: runId,
  });

  if (result.error) redirect(pageUrl(result.error.message, "error", runId));

  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath("/dashboard");
  redirect(pageUrl(`${Number(result.data ?? 0)} conta(s) a pagar gerada(s).`, "success", runId));
}

export async function cancelPayrollRun(formData: FormData) {
  const runId = String(formData.get("run_id") ?? "").trim();
  if (!runId) redirect(pageUrl("Folha inválida."));

  const { supabase, companyId, projectId } = await requireCompanyPermission("hr.payroll.manage");
  if (!projectId) redirect(pageUrl("Selecione o empreendimento da folha."));

  const result = await supabase.rpc("cancel_hr_payroll_run", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_run_id: runId,
  });

  if (result.error) redirect(pageUrl(result.error.message, "error", runId));

  revalidatePath(PATH);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-de-caixa");
  redirect(pageUrl("Folha cancelada e contas em aberto canceladas.", "success", runId));
}
