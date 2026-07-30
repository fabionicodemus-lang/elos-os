import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cloneRoleDefinition, saveRoleDefinition } from "./actions";
import { PermissionMatrix, type PermissionMatrixGroup } from "./permission-matrix";
import "../../system-permissions.css";

type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

type Permission = {
  key: string;
  module: string;
  action: string;
  description: string;
};

type RolePermission = {
  role_id: string;
  permission_key: string;
  allowed: boolean;
};

type Membership = {
  id: string;
  user_id: string;
  role_id: string;
  status: string;
};

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
};

type Audit = {
  id: string;
  role_id: string | null;
  role_key: string;
  role_name: string;
  action: string;
  previous_permissions: string[] | null;
  new_permissions: string[] | null;
  changed_by: string | null;
  changed_at: string;
};

const MODULE_LABELS: Record<string, string> = {
  admin: "Sistema e administração",
  projects: "Empreendimentos",
  suppliers: "Fornecedores",
  clients: "Clientes",
  budgets: "Engenharia · Orçamentos",
  services: "Engenharia · Serviços",
  inputs: "Engenharia · Insumos",
  prices: "Engenharia · Preços",
  compositions: "Engenharia · Composições",
  takeoffs: "Engenharia · Levantamentos",
  schedule: "Engenharia · Planejamento",
  supply_plan: "Engenharia · Suprimentos planejados",
  execution: "Execução",
  execution_schedule: "Execução · Cronograma",
  execution_material_requests: "Execução · Solicitações",
  execution_daily_logs: "Execução · Diário de obras",
  execution_quality: "Execução · Qualidade",
  execution_contracts: "Execução · Contratos",
  execution_measurements: "Execução · Medições",
  execution_work_orders: "Execução · Ordens de serviço",
  procurement_quotations: "Suprimentos · Cotações",
  procurement_orders: "Suprimentos · Pedidos",
  procurement_receipts: "Suprimentos · Recebimentos",
  procurement_inventory: "Suprimentos · Estoque",
  payables: "Financeiro · Contas a pagar",
  receivables: "Financeiro · Contas a receber",
  indices: "Financeiro · Índices",
  cashflow: "Financeiro · Fluxo de caixa",
  reports: "Financeiro · Relatórios",
  finance_invoices: "Financeiro · Notas eletrônicas",
  finance_manual_invoices: "Financeiro · Notas manuais",
  finance_bank_accounts: "Financeiro · Contas bancárias",
  finance_taxes: "Financeiro · Impostos",
  sales: "Comercial · Vendas",
  commercial: "Comercial",
  commercial_proposals: "Comercial · Propostas",
  commercial_brokers: "Comercial · Corretores",
  postwork_assistance: "Pós-Obra · Assistências",
  postwork_inspections: "Pós-Obra · Vistorias",
  postwork_warranties: "Pós-Obra · Garantias",
  quality: "Qualidade",
  financial: "Financeiro legado",
  documents: "Documentos",
};

const ACTION_LABELS: Record<string, string> = {
  view: "Visualizar",
  manage: "Gerenciar",
  approve: "Aprovar",
  cancel: "Cancelar",
  submit: "Enviar",
  reopen: "Reabrir",
  settings: "Configurar",
  fill: "Preencher",
  complete: "Concluir",
  nonconformity: "Registrar não conformidade",
  reinspect: "Reinspecionar",
  exception: "Liberar exceção",
  templates: "Gerenciar modelos",
  indicators: "Visualizar indicadores",
  release: "Liberar",
  progress: "Atualizar progresso",
  accept: "Aceitar",
  finance: "Integrar ao financeiro",
  issue: "Emitir",
  confirm: "Confirmar",
  discrepancies: "Tratar divergências",
  transfer: "Transferir",
  adjust: "Ajustar",
  count: "Inventariar",
  reconcile: "Conciliar",
  convert: "Converter",
  inspect: "Vistoriar",
  execute: "Executar",
  close: "Encerrar",
  correct: "Corrigir",
  deliver: "Entregar",
  analyze: "Analisar",
  maintenance: "Registrar manutenção",
  view_users: "Visualizar usuários",
  manage_users: "Gerenciar usuários",
  view_roles: "Visualizar permissões",
  manage_roles: "Gerenciar permissões",
  manage_company: "Gerenciar empresa",
  manage_company_data: "Gerenciar empresa",
};

const AUDIT_LABELS: Record<string, string> = {
  created: "Papel criado",
  updated: "Dados atualizados",
  permissions_changed: "Permissões alteradas",
  activated: "Papel ativado",
  inactivated: "Papel inativado",
  cloned: "Papel duplicado",
};

function titleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function moduleLabel(module: string) {
  return MODULE_LABELS[module] ?? titleCase(module);
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? titleCase(action);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function buildGroups(permissions: Permission[]): PermissionMatrixGroup[] {
  const grouped = new Map<string, PermissionMatrixGroup>();
  for (const permission of permissions) {
    const current = grouped.get(permission.module) ?? {
      key: permission.module,
      label: moduleLabel(permission.module),
      permissions: [],
    };
    current.permissions.push({
      key: permission.key,
      description: permission.description,
      actionLabel: actionLabel(permission.action),
    });
    grouped.set(permission.module, current);
  }
  return [...grouped.values()]
    .map((group) => ({ ...group, permissions: group.permissions.sort((a, b) => a.actionLabel.localeCompare(b.actionLabel, "pt-BR")) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("admin.roles.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const manageResult = privileged
    ? { data: true }
    : await supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.roles.manage" });
  const canManage = manageResult.data === true;

  const { data: roleData } = await supabase
    .from("roles")
    .select("id, key, name, description, is_system, status, created_at, updated_at")
    .eq("company_id", companyId)
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  const roles = (roleData ?? []) as Role[];
  const roleIds = roles.map((role) => role.id);

  const [permissionsResult, mappingsResult, membershipsResult, auditResult] = await Promise.all([
    supabase.from("permissions").select("key, module, action, description").order("module").order("action"),
    roleIds.length
      ? supabase.from("role_permissions").select("role_id, permission_key, allowed").in("role_id", roleIds).eq("allowed", true)
      : Promise.resolve({ data: [] }),
    supabase.from("company_memberships").select("id, user_id, role_id, status").eq("company_id", companyId),
    supabase
      .from("system_role_permission_audit")
      .select("id, role_id, role_key, role_name, action, previous_permissions, new_permissions, changed_by, changed_at")
      .eq("company_id", companyId)
      .order("changed_at", { ascending: false })
      .limit(30),
  ]);

  const permissions = (permissionsResult.data ?? []) as Permission[];
  const mappings = (mappingsResult.data ?? []) as RolePermission[];
  const memberships = (membershipsResult.data ?? []) as Membership[];
  const audit = (auditResult.data ?? []) as Audit[];
  const selectedRole = roles.find((role) => role.id === params.role)
    ?? roles.find((role) => !["owner", "admin"].includes(role.key) && role.status === "active")
    ?? roles[0]
    ?? null;
  const selectedMemberships = selectedRole ? memberships.filter((membership) => membership.role_id === selectedRole.id) : [];
  const profileIds = [...new Set([
    ...selectedMemberships.map((membership) => membership.user_id),
    ...audit.map((entry) => entry.changed_by).filter((value): value is string => Boolean(value)),
  ])];
  const { data: profileData } = profileIds.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", profileIds)
    : { data: [] };
  const profiles = (profileData ?? []) as Profile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const protectedRole = selectedRole ? ["owner", "admin"].includes(selectedRole.key) : false;
  const selectedKeys = selectedRole
    ? protectedRole
      ? permissions.map((permission) => permission.key)
      : mappings.filter((mapping) => mapping.role_id === selectedRole.id).map((mapping) => mapping.permission_key)
    : [];
  const groups = buildGroups(permissions);
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  const customRoles = roles.filter((role) => !role.is_system);

  return (
    <AppShell
      activeGroup="system"
      activeItem="permissions"
      eyebrow="Sistema · Administração"
      title="Papéis e Permissões"
      description={`${company.name} · controle dos módulos e ações disponíveis para cada perfil de acesso.`}
    >
      <div className="permissions-page">
        {params.error ? <div className="permission-message error">{params.error}</div> : null}
        {params.success ? <div className="permission-message success">{params.success}</div> : null}

        <section className="permission-kpis">
          <article><span>Papéis ativos</span><strong>{roles.filter((role) => role.status === "active").length}</strong><small>{roles.length} cadastrados</small></article>
          <article><span>Papéis personalizados</span><strong>{customRoles.length}</strong><small>Além dos perfis padrão</small></article>
          <article><span>Permissões disponíveis</span><strong>{permissions.length}</strong><small>Ações de todos os módulos</small></article>
          <article><span>Usuários ativos</span><strong>{activeMemberships.length}</strong><small>Distribuídos entre os papéis</small></article>
        </section>

        <section className="permission-layout">
          <aside className="permission-card permission-role-panel">
            <header className="permission-card-header">
              <div><span>Perfis de acesso</span><h2>Papéis da empresa</h2></div>
              <small>{roles.length}</small>
            </header>
            <nav className="permission-role-list" aria-label="Papéis da empresa">
              {roles.map((role) => {
                const count = memberships.filter((membership) => membership.role_id === role.id && membership.status === "active").length;
                const countPermissions = ["owner", "admin"].includes(role.key)
                  ? permissions.length
                  : mappings.filter((mapping) => mapping.role_id === role.id).length;
                return (
                  <Link className={`permission-role-item ${selectedRole?.id === role.id ? "active" : ""}`} href={`/configuracoes/permissoes?role=${role.id}`} key={role.id}>
                    <div>
                      <span className={`permission-role-icon ${role.is_system ? "system" : "custom"}`}>{role.name.slice(0, 2).toUpperCase()}</span>
                      <span><strong>{role.name}</strong><small>{role.is_system ? "Padrão do sistema" : "Personalizado"} · {count} usuário(s)</small></span>
                    </div>
                    <span className={`permission-status ${role.status}`}>{role.status === "active" ? "Ativo" : "Inativo"}</span>
                    <small>{countPermissions} permissões</small>
                  </Link>
                );
              })}
            </nav>

            {canManage ? (
              <form action={saveRoleDefinition} className="permission-create-form">
                <span>Novo papel personalizado</span>
                <label>Nome<input name="name" required placeholder="Ex.: Gestor de contratos" /></label>
                <label>Descrição<textarea name="description" placeholder="Responsabilidades e finalidade deste perfil" /></label>
                <input type="hidden" name="status" value="active" />
                <button type="submit">Criar papel</button>
              </form>
            ) : null}
          </aside>

          <main className="permission-main">
            {selectedRole ? (
              <>
                <section className="permission-card permission-role-detail">
                  <div className="permission-detail-heading">
                    <div>
                      <span>{selectedRole.is_system ? "Papel padrão" : "Papel personalizado"}</span>
                      <h2>{selectedRole.name}</h2>
                      <p>{selectedRole.description || "Sem descrição cadastrada."}</p>
                    </div>
                    <div className="permission-detail-badges">
                      <span className={`permission-status ${selectedRole.status}`}>{selectedRole.status === "active" ? "Ativo" : "Inativo"}</span>
                      {protectedRole ? <span className="permission-protected-badge">Acesso total protegido</span> : null}
                    </div>
                  </div>
                  <div className="permission-detail-stats">
                    <div><span>Usuários vinculados</span><strong>{selectedMemberships.filter((membership) => membership.status === "active").length}</strong></div>
                    <div><span>Permissões efetivas</span><strong>{selectedKeys.length}</strong></div>
                    <div><span>Identificador</span><strong>{selectedRole.key}</strong></div>
                    <div><span>Última atualização</span><strong>{formatDate(selectedRole.updated_at)}</strong></div>
                  </div>

                  {canManage && !selectedRole.is_system ? (
                    <form action={saveRoleDefinition} className="permission-definition-form">
                      <input type="hidden" name="role_id" value={selectedRole.id} />
                      <label>Nome<input name="name" required defaultValue={selectedRole.name} /></label>
                      <label className="wide">Descrição<input name="description" defaultValue={selectedRole.description ?? ""} /></label>
                      <label>Situação<select name="status" defaultValue={selectedRole.status}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                      <button type="submit">Salvar dados</button>
                    </form>
                  ) : null}

                  {canManage ? (
                    <details className="permission-clone-box">
                      <summary>Duplicar este papel</summary>
                      <form action={cloneRoleDefinition}>
                        <input type="hidden" name="source_role_id" value={selectedRole.id} />
                        <label>Nome do novo papel<input name="name" required placeholder={`${selectedRole.name} · cópia`} /></label>
                        <label>Descrição<input name="description" placeholder="Opcional; usa a descrição atual quando vazio" /></label>
                        <button type="submit">Duplicar com as permissões atuais</button>
                      </form>
                    </details>
                  ) : null}
                </section>

                <section className="permission-card">
                  <PermissionMatrix
                    roleId={selectedRole.id}
                    roleName={selectedRole.name}
                    groups={groups}
                    initialKeys={selectedKeys}
                    canManage={canManage}
                    protectedRole={protectedRole}
                    inactive={selectedRole.status === "inactive"}
                  />
                </section>

                <section className="permission-card permission-users-card">
                  <header className="permission-card-header"><div><span>Impacto do papel</span><h2>Usuários vinculados</h2></div><small>{selectedMemberships.length}</small></header>
                  {selectedMemberships.length ? (
                    <div className="permission-user-list">
                      {selectedMemberships.map((membership) => {
                        const profile = profileById.get(membership.user_id);
                        return <div key={membership.id}><span className="permission-user-avatar">{(profile?.full_name || profile?.email || "U").slice(0, 2).toUpperCase()}</span><span><strong>{profile?.full_name || profile?.email || "Usuário"}</strong><small>{profile?.email}</small></span><span className={`permission-status ${membership.status}`}>{membership.status === "active" ? "Ativo" : membership.status}</span></div>;
                      })}
                    </div>
                  ) : <div className="permission-empty">Nenhum usuário está vinculado a este papel.</div>}
                </section>
              </>
            ) : <section className="permission-card permission-empty">Nenhum papel cadastrado para esta empresa.</section>}
          </main>
        </section>

        <section className="permission-card permission-audit-card">
          <header className="permission-card-header"><div><span>Rastreabilidade</span><h2>Histórico das alterações</h2></div><small>30 registros recentes</small></header>
          {audit.length ? (
            <div className="permission-audit-list">
              {audit.map((entry) => {
                const actor = entry.changed_by ? profileById.get(entry.changed_by) : null;
                const previousCount = entry.previous_permissions?.length ?? 0;
                const nextCount = entry.new_permissions?.length ?? 0;
                return (
                  <article key={entry.id}>
                    <span className="permission-audit-dot" />
                    <div><strong>{AUDIT_LABELS[entry.action] ?? titleCase(entry.action)}</strong><p>{entry.role_name} <code>{entry.role_key}</code></p><small>{actor?.full_name || actor?.email || "Sistema"} · {formatDate(entry.changed_at)}</small></div>
                    {entry.action === "permissions_changed" ? <span className="permission-audit-count">{previousCount} → {nextCount}</span> : null}
                  </article>
                );
              })}
            </div>
          ) : <div className="permission-empty">O histórico começará a ser preenchido nas próximas alterações.</div>}
        </section>
      </div>
    </AppShell>
  );
}
