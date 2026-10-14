import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";

type AuditRow = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete";
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};
type Profile = { id: string; full_name: string | null; email: string };

const PAGE_SIZE = 50;

const TABLE_LABELS: Record<string, string> = {
  company_memberships: "Usuários da empresa",
  project_memberships: "Acesso a obras",
  payables: "Contas a pagar",
  receivables: "Contas a receber",
  finance_bank_accounts: "Contas bancárias",
  finance_bank_transactions: "Lançamentos bancários",
  finance_bank_transfers: "Transferências",
  hr_payroll_runs: "Folha de pagamento",
  hr_payroll_entries: "Lançamentos da folha",
  hr_payroll_obligations: "Encargos da folha",
  engineering_budgets: "Orçamentos",
  execution_service_contracts: "Contratos de serviço",
  execution_contract_measurements: "Medições de contrato",
};

const ACTION_LABELS = { insert: "Criou", update: "Alterou", delete: "Excluiu" } as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changesSummary(row: AuditRow) {
  if (row.action !== "update") return null;
  const fields = row.changed_fields ?? [];
  return fields.slice(0, 4).map((field) => (
    <small key={field}>
      {field}: {formatValue(row.old_values?.[field])} → {formatValue(row.new_values?.[field])}
    </small>
  ));
}

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("security.audit.view");
  const table = params.table && TABLE_LABELS[params.table] ? params.table : "";
  const action = params.action && params.action in ACTION_LABELS ? params.action : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let query = supabase
    .from("security_audit_log")
    .select("id, table_name, record_id, action, changed_fields, old_values, new_values, created_by, created_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (table) query = query.eq("table_name", table);
  if (action) query = query.eq("action", action);

  const { data, count, error } = await query;
  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const { data: profileData } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const profiles = new Map(((profileData ?? []) as Profile[]).map((profile) => [profile.id, profile.full_name || profile.email]));

  const pageHref = (target: number) => `?table=${table}&action=${action}&page=${target}`;

  return (
    <AppShell
      activeGroup="system"
      activeItem="audit-trail"
      eyebrow="Sistema · Segurança"
      title="Trilha de auditoria"
      description={`${company.name} · quem criou, alterou ou excluiu registros sensíveis. A trilha não pode ser editada nem apagada.`}
    >
      <section className="registry-toolbar">
        <form className="registry-filter" method="get">
          <select name="table" defaultValue={table}>
            <option value="">Todas as áreas</option>
            {Object.entries(TABLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select name="action" defaultValue={action}>
            <option value="">Todas as ações</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="submit">Filtrar</button>
          {(table || action) ? <Link prefetch={false} href="/configuracoes/auditoria">Limpar</Link> : <span />}
        </form>
      </section>

      <section className="registry-table-panel">
        <div className="section-heading">
          <div><span>Segurança</span><h2>Eventos registrados</h2></div>
          <p>{total.toLocaleString("pt-BR")} evento(s) no filtro atual.</p>
        </div>
        {error ? <div className="auth-message error workspace-message">Não foi possível carregar a trilha. A atualização do banco (0093) já foi aplicada?</div> : null}
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Área</th><th>O que mudou</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.created_by ? profiles.get(row.created_by) ?? "Usuário removido" : "Sistema"}</td>
                  <td><span className={`status-badge ${row.action === "delete" ? "inactive" : "active"}`}>{ACTION_LABELS[row.action]}</span></td>
                  <td><strong>{TABLE_LABELS[row.table_name] ?? row.table_name}</strong><small>{row.record_id?.slice(0, 8) ?? ""}</small></td>
                  <td>
                    {changesSummary(row)}
                    {row.action === "update" && (row.changed_fields?.length ?? 0) > 4 ? <small>+{(row.changed_fields?.length ?? 0) - 4} campo(s)</small> : null}
                    {row.action !== "update" ? <small>Registro completo guardado</small> : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={5} className="empty-table">Nenhum evento registrado ainda.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link prefetch={false} href={pageHref(page - 1)}>Anterior</Link> : null}
            {page < totalPages ? <Link prefetch={false} href={pageHref(page + 1)}>Próxima</Link> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
