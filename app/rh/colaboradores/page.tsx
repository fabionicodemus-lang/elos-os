import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { saveEmployee, setEmployeeStatus } from "./actions";
import "../hr.css";

type Project = { id: string; name: string; code: string | null };
type Employee = {
  id: string;
  default_project_id: string | null;
  employee_code: string;
  full_name: string;
  tax_id: string | null;
  position_title: string | null;
  employment_type: string;
  admission_date: string | null;
  termination_date: string | null;
  base_salary: number;
  salary_due_day: number;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  pix_key: string | null;
  cost_center: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

const employmentLabels: Record<string, string> = {
  clt: "CLT",
  pj: "Pessoa jurídica",
  intern: "Estagiário",
  apprentice: "Aprendiz",
  partner: "Sócio / pró-labore",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  terminated: "Desligado",
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function dateBR(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function EmployeeForm({ employee, projects }: { employee?: Employee; projects: Project[] }) {
  return (
    <form action={saveEmployee} className="hr-form-grid">
      {employee ? <input type="hidden" name="employee_id" value={employee.id} /> : null}
      <label><span>Código</span><input name="employee_code" defaultValue={employee?.employee_code ?? ""} placeholder="Automático se vazio" /></label>
      <label className="hr-span-2"><span>Nome completo *</span><input name="full_name" defaultValue={employee?.full_name ?? ""} required /></label>
      <label><span>CPF / CNPJ</span><input name="tax_id" defaultValue={employee?.tax_id ?? ""} /></label>
      <label><span>Cargo / função</span><input name="position_title" defaultValue={employee?.position_title ?? ""} /></label>
      <label><span>Vínculo</span><select name="employment_type" defaultValue={employee?.employment_type ?? "clt"}>
        {Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>Empreendimento padrão *</span><select name="default_project_id" defaultValue={employee?.default_project_id ?? ""} required>
        <option value="">Selecione</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}
      </select></label>
      <label><span>Admissão</span><input type="date" name="admission_date" defaultValue={employee?.admission_date ?? ""} /></label>
      <label><span>Salário-base</span><input name="base_salary" inputMode="decimal" defaultValue={Number(employee?.base_salary ?? 0).toFixed(2)} /></label>
      <label><span>Dia de pagamento</span><input name="salary_due_day" type="number" min="1" max="31" defaultValue={employee?.salary_due_day ?? 5} /></label>
      <label><span>Centro de custo</span><input name="cost_center" defaultValue={employee?.cost_center ?? ""} /></label>
      <label><span>Banco</span><input name="bank_name" defaultValue={employee?.bank_name ?? ""} /></label>
      <label><span>Agência</span><input name="bank_branch" defaultValue={employee?.bank_branch ?? ""} /></label>
      <label><span>Conta</span><input name="bank_account" defaultValue={employee?.bank_account ?? ""} /></label>
      <label className="hr-span-2"><span>Chave Pix</span><input name="pix_key" defaultValue={employee?.pix_key ?? ""} /></label>
      <label className="hr-span-3"><span>Observações</span><textarea name="notes" rows={3} defaultValue={employee?.notes ?? ""} /></label>
      <div className="hr-form-actions hr-span-3">
        <button className="elos-button primary" type="submit">{employee ? "Salvar alterações" : "Cadastrar colaborador"}</button>
      </div>
    </form>
  );
}

export default async function EmployeesPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; project?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("hr.employees.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const queryText = (params.q ?? "").trim();
  const status = ["active", "inactive", "terminated"].includes(params.status ?? "") ? params.status! : "";
  const projectFilter = params.project ?? "";

  const projectsQuery = supabase
    .from("projects")
    .select("id,name,code")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("name");

  let employeesQuery = supabase
    .from("hr_employees")
    .select("id,default_project_id,employee_code,full_name,tax_id,position_title,employment_type,admission_date,termination_date,base_salary,salary_due_day,bank_name,bank_branch,bank_account,pix_key,cost_center,status,notes,created_at")
    .eq("company_id", companyId)
    .order("full_name");

  if (status) employeesQuery = employeesQuery.eq("status", status);
  if (projectFilter) employeesQuery = employeesQuery.eq("default_project_id", projectFilter);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    employeesQuery = employeesQuery.or(`full_name.ilike.%${safe}%,employee_code.ilike.%${safe}%,tax_id.ilike.%${safe}%,position_title.ilike.%${safe}%`);
  }

  const [projectsResult, employeesResult, manageResult] = await Promise.all([
    projectsQuery,
    employeesQuery,
    privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "hr.employees.manage" }),
  ]);

  const projects = (projectsResult.data ?? []) as Project[];
  const employees = (employeesResult.data ?? []) as Employee[];
  const canManage = manageResult.data === true || privileged;
  const schemaMissing = employeesResult.error?.code === "42P01" || employeesResult.error?.message.includes("hr_employees");
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const payrollBase = activeEmployees.reduce((sum, employee) => sum + Number(employee.base_salary), 0);

  return (
    <AppShell
      activeGroup="hr"
      activeItem="hr-employees"
      eyebrow="Recursos Humanos"
      title="Colaboradores"
      description={`${company.name} · cadastro, vínculo, alocação, salário-base e dados de pagamento.`}
      actions={<Link className="elos-button primary" href="/rh/folha">Abrir folha de pagamento</Link>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura do RH</h2>
          <p>Execute a migration <code>20260801_0069_hr_payroll.sql</code>.</p>
        </section>
      ) : (
        <>
          <section className="hr-kpis">
            <article><span>Colaboradores ativos</span><strong>{activeEmployees.length}</strong><small>{employees.length} cadastrados no filtro</small></article>
            <article><span>Folha-base mensal</span><strong>{money(payrollBase)}</strong><small>Antes de adicionais e descontos</small></article>
            <article><span>CLT</span><strong>{activeEmployees.filter((employee) => employee.employment_type === "clt").length}</strong><small>vínculos ativos</small></article>
            <article><span>Outros vínculos</span><strong>{activeEmployees.filter((employee) => employee.employment_type !== "clt").length}</strong><small>PJ, estágio, aprendiz e sócios</small></article>
          </section>

          <section className="hr-toolbar">
            <form method="get" className="hr-filter">
              <input name="q" defaultValue={queryText} placeholder="Nome, código, CPF ou cargo" />
              <select name="status" defaultValue={status}>
                <option value="">Todos os status</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="terminated">Desligados</option>
              </select>
              <select name="project" defaultValue={projectFilter}>
                <option value="">Todos os empreendimentos</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}
              </select>
              <button type="submit">Filtrar</button>
              <Link href="/rh/colaboradores">Limpar</Link>
            </form>
            {canManage ? <details className="hr-create-panel"><summary>+ Novo colaborador</summary><EmployeeForm projects={projects} /></details> : null}
          </section>

          <section className="hr-table-panel">
            <div className="section-heading">
              <div><span>Equipe</span><h2>Colaboradores cadastrados</h2></div>
              <p>{employees.length} registro(s) no filtro atual.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table hr-employees-table">
                <thead><tr><th>Colaborador</th><th>Vínculo</th><th>Empreendimento</th><th>Admissão</th><th>Salário-base</th><th>Pagamento</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  {employees.map((employee) => {
                    const project = employee.default_project_id ? projectMap.get(employee.default_project_id) : null;
                    return (
                      <tr key={employee.id}>
                        <td><strong>{employee.full_name}</strong><small>{employee.employee_code}{employee.position_title ? ` · ${employee.position_title}` : ""}</small><small>{employee.tax_id || "Sem CPF/CNPJ"}</small></td>
                        <td>{employmentLabels[employee.employment_type] ?? employee.employment_type}</td>
                        <td><span>{project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Sem alocação"}</span><small>{employee.cost_center}</small></td>
                        <td>{dateBR(employee.admission_date)}</td>
                        <td><strong>{money(employee.base_salary)}</strong></td>
                        <td><span>Dia {employee.salary_due_day}</span><small>{employee.pix_key ? `Pix: ${employee.pix_key}` : employee.bank_name || "Dados bancários pendentes"}</small></td>
                        <td><span className={`hr-status ${employee.status}`}>{statusLabels[employee.status] ?? employee.status}</span></td>
                        <td>
                          {canManage ? (
                            <div className="hr-row-actions">
                              <details className="hr-inline-edit"><summary>Editar</summary><div className="hr-inline-popover"><EmployeeForm employee={employee} projects={projects} /></div></details>
                              <form action={setEmployeeStatus}>
                                <input type="hidden" name="employee_id" value={employee.id} />
                                <input type="hidden" name="status" value={employee.status === "active" ? "inactive" : "active"} />
                                <button className="table-action" type="submit">{employee.status === "active" ? "Inativar" : "Reativar"}</button>
                              </form>
                              {employee.status !== "terminated" ? (
                                <form action={setEmployeeStatus}>
                                  <input type="hidden" name="employee_id" value={employee.id} />
                                  <input type="hidden" name="status" value="terminated" />
                                  <button className="table-action danger" type="submit">Desligar</button>
                                </form>
                              ) : null}
                            </div>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {employees.length === 0 ? <tr><td className="empty-table" colSpan={8}>Nenhum colaborador encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
