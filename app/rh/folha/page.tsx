import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  addPayrollObligation,
  cancelPayrollRun,
  createPayrollRun,
  deletePayrollObligation,
  postPayrollRun,
  savePayrollEntry,
} from "./actions";
import "../hr.css";

type Project = { id: string; name: string; code: string | null };
type PayrollRun = {
  id: string;
  competence: string;
  salary_due_date: string;
  status: "draft" | "posted" | "cancelled";
  notes: string | null;
  gross_amount: number;
  deduction_amount: number;
  net_amount: number;
  obligations_amount: number;
  total_company_cost: number;
  posted_at: string | null;
  created_at: string;
};

type EmployeeRef = {
  id: string;
  employee_code: string;
  full_name: string;
  tax_id: string | null;
  position_title: string | null;
};

type PayrollEntry = {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  base_salary: number;
  earnings: number;
  deductions: number;
  gross_salary: number;
  net_salary: number;
  due_date: string;
  notes: string | null;
  hr_employees: EmployeeRef | EmployeeRef[] | null;
};

type PayrollObligation = {
  id: string;
  payroll_run_id: string;
  obligation_code: string | null;
  description: string;
  obligation_type: string;
  beneficiary_name: string;
  beneficiary_tax_id: string | null;
  due_date: string;
  amount: number;
  notes: string | null;
};

const statusLabels: Record<string, string> = {
  draft: "Em elaboração",
  posted: "Aprovada e lançada",
  cancelled: "Cancelada",
};

const obligationLabels: Record<string, string> = {
  employer_charge: "Encargo patronal",
  withholding: "Retenção / recolhimento",
  benefit: "Benefício",
  other: "Outro",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function competenceLabel(value: string) {
  const [year, month] = value.slice(0, 7).split("-");
  return `${month}/${year}`;
}

function defaultDates() {
  const now = new Date();
  const competence = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const due = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return { competence, dueDate: due.toISOString().slice(0, 10) };
}

export default async function PayrollPage({ searchParams }: {
  searchParams: Promise<{ run?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("hr.payroll.view");
  const privileged = roleKey === "owner" || roleKey === "admin";

  const [projectResult, runsResult, manageResult, approveResult] = await Promise.all([
    projectId
      ? supabase.from("projects").select("id,name,code").eq("id", projectId).eq("company_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId
      ? supabase
          .from("hr_payroll_runs")
          .select("id,competence,salary_due_date,status,notes,gross_amount,deduction_amount,net_amount,obligations_amount,total_company_cost,posted_at,created_at")
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .order("competence", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "hr.payroll.manage" }),
    privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "hr.payroll.approve" }),
  ]);

  const runs = (runsResult.data ?? []) as PayrollRun[];
  const selectedRun = (params.run ? runs.find((run) => run.id === params.run) : runs[0]) ?? null;
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const schemaMissing = runsResult.error?.code === "42P01" || runsResult.error?.message.includes("hr_payroll_runs");

  const [entriesResult, obligationsResult, payablesResult] = selectedRun
    ? await Promise.all([
        supabase
          .from("hr_payroll_entries")
          .select("id,payroll_run_id,employee_id,base_salary,earnings,deductions,gross_salary,net_salary,due_date,notes,hr_employees(id,employee_code,full_name,tax_id,position_title)")
          .eq("company_id", companyId)
          .eq("project_id", projectId!)
          .eq("payroll_run_id", selectedRun.id)
          .order("created_at"),
        supabase
          .from("hr_payroll_obligations")
          .select("id,payroll_run_id,obligation_code,description,obligation_type,beneficiary_name,beneficiary_tax_id,due_date,amount,notes")
          .eq("company_id", companyId)
          .eq("project_id", projectId!)
          .eq("payroll_run_id", selectedRun.id)
          .order("sort_order")
          .order("due_date"),
        supabase
          .from("payables")
          .select("id,status,amount")
          .eq("company_id", companyId)
          .eq("project_id", projectId!)
          .eq("source_system", "elos_hr")
          .like("source_id", `payroll:${selectedRun.id}:%`),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  const entries = (entriesResult.data ?? []) as unknown as PayrollEntry[];
  const obligations = (obligationsResult.data ?? []) as PayrollObligation[];
  const generatedPayables = (payablesResult.data ?? []) as { id: string; status: string; amount: number }[];
  const project = projectResult.data as Project | null;
  const defaults = defaultDates();
  const openPayables = generatedPayables.filter((payable) => payable.status === "open");
  const paidPayables = generatedPayables.filter((payable) => payable.status === "paid");
  const runIsDraft = selectedRun?.status === "draft";
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione um empreendimento";

  return (
    <AppShell
      activeGroup="hr"
      activeItem="hr-payroll"
      eyebrow="Recursos Humanos"
      title="Folha de Pagamento"
      description={`${company.name} · ${context} · salários, descontos, encargos, benefícios e integração financeira.`}
      actions={<>
        <Link className="elos-button" href="/rh/colaboradores">Colaboradores</Link>
        <Link className="elos-button" href="/financeiro/contas-a-pagar">Contas a pagar</Link>
      </>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura do RH</h2>
          <p>Execute a migration <code>20260801_0069_hr_payroll.sql</code>.</p>
        </section>
      ) : !projectId ? (
        <section className="hr-empty"><strong>Selecione um empreendimento no topo.</strong><span>A folha é fechada por empreendimento para manter o custo e o fluxo de caixa corretamente alocados.</span></section>
      ) : (
        <>
          <section className="hr-guidance">
            <div><span>Fluxo do fechamento</span><h2>Da folha ao financeiro</h2><p>Os valores ficam editáveis enquanto a folha estiver em elaboração. A aprovação bloqueia a edição e cria os títulos financeiros.</p></div>
            <div className="hr-guidance-steps">
              <article><b>1</b><span><strong>Colaboradores</strong><small>Salário-base e alocação</small></span></article>
              <article><b>2</b><span><strong>Fechamento</strong><small>Proventos e descontos</small></span></article>
              <article><b>3</b><span><strong>Obrigações</strong><small>FGTS, INSS, IRRF e benefícios</small></span></article>
              <article><b>4</b><span><strong>Financeiro</strong><small>Contas a pagar geradas</small></span></article>
            </div>
          </section>

          <section className="hr-payroll-layout">
            <aside className="hr-runs-panel">
              <div className="hr-panel-head"><div><span>Competências</span><h2>Folhas mensais</h2></div></div>
              {canManage ? (
                <details className="hr-create-run">
                  <summary>+ Nova folha</summary>
                  <form action={createPayrollRun}>
                    <label><span>Competência</span><input type="month" name="competence" defaultValue={defaults.competence} required /></label>
                    <label><span>Pagamento dos salários</span><input type="date" name="salary_due_date" defaultValue={defaults.dueDate} required /></label>
                    <label><span>Observações</span><textarea name="notes" rows={2} /></label>
                    <button className="elos-button primary" type="submit">Criar fechamento</button>
                  </form>
                </details>
              ) : null}
              <nav className="hr-run-list">
                {runs.map((run) => (
                  <Link key={run.id} href={`/rh/folha?run=${run.id}`} className={selectedRun?.id === run.id ? "active" : ""}>
                    <span><strong>{competenceLabel(run.competence)}</strong><small>Pagamento {dateBR(run.salary_due_date)}</small></span>
                    <b className={`hr-status ${run.status}`}>{statusLabels[run.status]}</b>
                    <em>{money(run.total_company_cost)}</em>
                  </Link>
                ))}
                {runs.length === 0 ? <div className="hr-run-empty">Nenhuma folha criada para este empreendimento.</div> : null}
              </nav>
            </aside>

            <div className="hr-payroll-content">
              {!selectedRun ? (
                <section className="hr-empty"><strong>Crie a primeira folha mensal.</strong><span>Os colaboradores ativos alocados neste empreendimento serão incluídos automaticamente.</span></section>
              ) : (
                <>
                  <section className="hr-run-header">
                    <div><span>Competência {competenceLabel(selectedRun.competence)}</span><h2>Fechamento mensal</h2><p>Pagamento dos salários em {dateBR(selectedRun.salary_due_date)}.</p></div>
                    <div className="hr-run-header-actions">
                      <span className={`hr-status ${selectedRun.status}`}>{statusLabels[selectedRun.status]}</span>
                      {runIsDraft && canApprove ? (
                        <form action={postPayrollRun}>
                          <input type="hidden" name="run_id" value={selectedRun.id} />
                          <button className="elos-button primary" type="submit">Aprovar e gerar contas</button>
                        </form>
                      ) : null}
                      {selectedRun.status !== "cancelled" && canManage ? (
                        <form action={cancelPayrollRun}>
                          <input type="hidden" name="run_id" value={selectedRun.id} />
                          <button className="elos-button danger" type="submit">Cancelar folha</button>
                        </form>
                      ) : null}
                    </div>
                  </section>

                  <section className="hr-kpis hr-payroll-kpis">
                    <article><span>Salários brutos</span><strong>{money(selectedRun.gross_amount)}</strong><small>Salário-base + proventos</small></article>
                    <article><span>Descontos</span><strong>{money(selectedRun.deduction_amount)}</strong><small>Descontos do colaborador</small></article>
                    <article><span>Líquido a pagar</span><strong>{money(selectedRun.net_amount)}</strong><small>{entries.length} colaborador(es)</small></article>
                    <article><span>Encargos e benefícios</span><strong>{money(selectedRun.obligations_amount)}</strong><small>{obligations.length} obrigação(ões)</small></article>
                    <article className="total"><span>Custo total da empresa</span><strong>{money(selectedRun.total_company_cost)}</strong><small>Bruto + obrigações patronais</small></article>
                  </section>

                  {selectedRun.status === "posted" ? (
                    <section className="hr-finance-result">
                      <div><span>Integração financeira concluída</span><strong>{generatedPayables.length} conta(s) gerada(s)</strong><small>{openPayables.length} em aberto · {paidPayables.length} paga(s)</small></div>
                      <Link className="elos-button primary" href={`/financeiro/contas-a-pagar?q=${encodeURIComponent(`FOLHA ${competenceLabel(selectedRun.competence)}`)}`}>Ver contas a pagar</Link>
                    </section>
                  ) : null}

                  <section className="hr-table-panel">
                    <div className="section-heading">
                      <div><span>Salários</span><h2>Proventos e descontos por colaborador</h2></div>
                      <p>O sistema calcula bruto e líquido; os eventos legais devem ser conferidos antes da aprovação.</p>
                    </div>
                    <div className="registry-table-wrap">
                      <table className="registry-table hr-payroll-table">
                        <thead><tr><th>Colaborador</th><th>Salário-base</th><th>Proventos</th><th>Descontos</th><th>Bruto</th><th>Líquido</th><th>Vencimento</th><th>Ajustes</th></tr></thead>
                        <tbody>
                          {entries.map((entry) => {
                            const employee = relatedOne(entry.hr_employees);
                            return (
                              <tr key={entry.id}>
                                <td><strong>{employee?.full_name ?? "Colaborador"}</strong><small>{employee?.employee_code}{employee?.position_title ? ` · ${employee.position_title}` : ""}</small></td>
                                <td>{money(entry.base_salary)}</td>
                                <td>{money(entry.earnings)}</td>
                                <td>{money(entry.deductions)}</td>
                                <td><strong>{money(entry.gross_salary)}</strong></td>
                                <td><strong className="hr-net-value">{money(entry.net_salary)}</strong></td>
                                <td>{dateBR(entry.due_date)}</td>
                                <td>
                                  {runIsDraft && canManage ? (
                                    <details className="hr-inline-edit payroll"><summary>Ajustar</summary><div className="hr-inline-popover">
                                      <form action={savePayrollEntry} className="hr-entry-form">
                                        <input type="hidden" name="run_id" value={selectedRun.id} />
                                        <input type="hidden" name="entry_id" value={entry.id} />
                                        <label><span>Salário-base</span><input name="base_salary" defaultValue={Number(entry.base_salary).toFixed(2)} required /></label>
                                        <label><span>Proventos</span><input name="earnings" defaultValue={Number(entry.earnings).toFixed(2)} required /></label>
                                        <label><span>Descontos</span><input name="deductions" defaultValue={Number(entry.deductions).toFixed(2)} required /></label>
                                        <label><span>Vencimento</span><input type="date" name="due_date" defaultValue={entry.due_date} required /></label>
                                        <label className="hr-span-2"><span>Memória / observações</span><textarea name="notes" rows={2} defaultValue={entry.notes ?? ""} /></label>
                                        <button className="elos-button primary hr-span-2" type="submit">Salvar lançamento</button>
                                      </form>
                                    </div></details>
                                  ) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                          {entries.length === 0 ? <tr><td className="empty-table" colSpan={8}>Nenhum colaborador ativo está alocado neste empreendimento. Cadastre ou ajuste a alocação antes de criar outra folha.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="hr-table-panel">
                    <div className="section-heading">
                      <div><span>Encargos e benefícios</span><h2>Obrigações do fechamento</h2></div>
                      <p>Inclua os valores confirmados pela contabilidade: FGTS, INSS, IRRF, benefícios, pensões e outros recolhimentos.</p>
                    </div>

                    {runIsDraft && canManage ? (
                      <details className="hr-create-panel obligation"><summary>+ Adicionar obrigação</summary>
                        <form action={addPayrollObligation} className="hr-obligation-form">
                          <input type="hidden" name="run_id" value={selectedRun.id} />
                          <label><span>Código</span><input name="obligation_code" placeholder="FGTS, INSS, IRRF..." /></label>
                          <label className="hr-span-2"><span>Descrição *</span><input name="description" required /></label>
                          <label><span>Tipo</span><select name="obligation_type" defaultValue="employer_charge">
                            {Object.entries(obligationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select></label>
                          <label className="hr-span-2"><span>Favorecido *</span><input name="beneficiary_name" placeholder="Caixa, Receita Federal, operadora..." required /></label>
                          <label><span>CPF / CNPJ</span><input name="beneficiary_tax_id" /></label>
                          <label><span>Vencimento *</span><input type="date" name="due_date" required /></label>
                          <label><span>Valor *</span><input name="amount" inputMode="decimal" required /></label>
                          <label className="hr-span-3"><span>Observações</span><textarea name="notes" rows={2} /></label>
                          <button className="elos-button primary hr-span-3" type="submit">Adicionar obrigação</button>
                        </form>
                      </details>
                    ) : null}

                    <div className="registry-table-wrap">
                      <table className="registry-table hr-obligations-table">
                        <thead><tr><th>Obrigação</th><th>Tipo</th><th>Favorecido</th><th>Vencimento</th><th>Valor</th><th>Ação</th></tr></thead>
                        <tbody>
                          {obligations.map((obligation) => (
                            <tr key={obligation.id}>
                              <td><strong>{obligation.description}</strong><small>{obligation.obligation_code}{obligation.notes ? ` · ${obligation.notes}` : ""}</small></td>
                              <td>{obligationLabels[obligation.obligation_type] ?? obligation.obligation_type}</td>
                              <td><strong>{obligation.beneficiary_name}</strong><small>{obligation.beneficiary_tax_id}</small></td>
                              <td>{dateBR(obligation.due_date)}</td>
                              <td><strong>{money(obligation.amount)}</strong></td>
                              <td>{runIsDraft && canManage ? <form action={deletePayrollObligation}><input type="hidden" name="run_id" value={selectedRun.id} /><input type="hidden" name="obligation_id" value={obligation.id} /><button className="table-action danger" type="submit">Remover</button></form> : "—"}</td>
                            </tr>
                          ))}
                          {obligations.length === 0 ? <tr><td className="empty-table" colSpan={6}>Nenhum encargo ou benefício informado.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
