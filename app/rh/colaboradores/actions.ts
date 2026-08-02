"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/rh/colaboradores";

function pageUrl(message: string, type: "error" | "success" = "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
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

export async function saveEmployee(formData: FormData) {
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const employeeCode = String(formData.get("employee_code") ?? "").trim() || `COL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const employmentType = String(formData.get("employment_type") ?? "clt").trim();
  const defaultProjectId = String(formData.get("default_project_id") ?? "").trim() || null;
  const baseSalary = parseMoney(formData.get("base_salary"));
  const salaryDueDay = Number.parseInt(String(formData.get("salary_due_day") ?? "5"), 10);

  if (!fullName) redirect(pageUrl("Informe o nome do colaborador."));
  if (!["clt", "pj", "intern", "apprentice", "partner", "other"].includes(employmentType)) {
    redirect(pageUrl("Tipo de vínculo inválido."));
  }
  if (!Number.isFinite(baseSalary) || baseSalary < 0) redirect(pageUrl("Salário-base inválido."));
  if (!Number.isInteger(salaryDueDay) || salaryDueDay < 1 || salaryDueDay > 31) {
    redirect(pageUrl("O dia de pagamento deve ficar entre 1 e 31."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("hr.employees.manage");

  if (defaultProjectId) {
    const projectResult = await supabase
      .from("projects")
      .select("id")
      .eq("id", defaultProjectId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!projectResult.data) redirect(pageUrl("O empreendimento selecionado não pertence à empresa."));
  }

  const payload = {
    company_id: companyId,
    default_project_id: defaultProjectId,
    employee_code: employeeCode,
    full_name: fullName,
    tax_id: optional(formData, "tax_id"),
    position_title: optional(formData, "position_title"),
    employment_type: employmentType,
    admission_date: optional(formData, "admission_date"),
    termination_date: optional(formData, "termination_date"),
    base_salary: baseSalary,
    salary_due_day: salaryDueDay,
    bank_name: optional(formData, "bank_name"),
    bank_branch: optional(formData, "bank_branch"),
    bank_account: optional(formData, "bank_account"),
    pix_key: optional(formData, "pix_key"),
    cost_center: optional(formData, "cost_center"),
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  };

  const result = employeeId
    ? await supabase
        .from("hr_employees")
        .update(payload)
        .eq("id", employeeId)
        .eq("company_id", companyId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("hr_employees")
        .insert({ ...payload, status: "active", created_by: userId })
        .select("id")
        .single();

  if (result.error) redirect(pageUrl(result.error.message));
  if (!result.data) redirect(pageUrl("Colaborador não localizado ou alterado por outro usuário."));

  revalidatePath(PATH);
  revalidatePath("/rh/folha");
  redirect(pageUrl(employeeId ? "Cadastro do colaborador atualizado." : "Colaborador cadastrado.", "success"));
}

export async function setEmployeeStatus(formData: FormData) {
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!employeeId || !["active", "inactive", "terminated"].includes(status)) {
    redirect(pageUrl("Colaborador ou status inválido."));
  }

  const { supabase, companyId } = await requireCompanyPermission("hr.employees.manage");
  const { data, error } = await supabase
    .from("hr_employees")
    .update({
      status,
      termination_date: status === "terminated"
        ? String(formData.get("termination_date") ?? "").trim() || new Date().toISOString().slice(0, 10)
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employeeId)
    .eq("company_id", companyId)
    .select("id")
    .maybeSingle();

  if (error) redirect(pageUrl(error.message));
  if (!data) redirect(pageUrl("Colaborador não localizado."));

  revalidatePath(PATH);
  revalidatePath("/rh/folha");
  redirect(pageUrl(status === "active" ? "Colaborador reativado." : "Status do colaborador atualizado.", "success"));
}
