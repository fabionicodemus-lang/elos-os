import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout, selectWorkspace } from "@/app/dashboard/actions";
import { createClient } from "@/lib/supabase/server";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ShellNavigation, type ShellNavigationGroup } from "@/components/shell-navigation";

type Company = { id: string; name: string; slug: string };
type Project = { id: string; name: string; code: string | null };
type Role = { id: string; key: string; name: string };
type Membership = { role_id: string; roles: Role | Role[] | null };

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export async function AppShell({
  activeGroup,
  activeItem,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  activeGroup: "home" | "system" | "projects" | "engineering" | "execution" | "procurement" | "finance" | "commercial" | "postwork";
  activeItem?: string;
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) redirect("/login");

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  const email = typeof authData.claims.email === "string" ? authData.claims.email : "Usuário";
  const cookieStore = await cookies();
  const companyId = cookieStore.get("elos_company_id")?.value;
  const projectId = cookieStore.get("elos_project_id")?.value ?? null;

  if (!companyId) redirect("/dashboard");

  const [companyResult, projectsResult, membershipResult, profileResult] = await Promise.all([
    supabase.from("companies").select("id, name, slug").eq("id", companyId).maybeSingle(),
    supabase.from("projects").select("id, name, code").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase
      .from("company_memberships")
      .select("role_id, roles(id, key, name)")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const company = companyResult.data as Company | null;
  const projects = (projectsResult.data ?? []) as Project[];
  const membership = membershipResult.data as unknown as Membership | null;
  const role = membership ? relatedOne(membership.roles) : null;

  if (!company || !membership || !role) redirect("/dashboard");

  const { data: permissionData } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", role.id)
    .eq("allowed", true);

  const permissions = new Set(
    ((permissionData ?? []) as { permission_key: string }[]).map((item) => item.permission_key),
  );

  if (role.key === "owner" || role.key === "admin") {
    [
      "admin.users.view",
      "admin.users.manage",
      "suppliers.view",
      "suppliers.manage",
      "clients.view",
      "clients.manage",
      "payables.view",
      "payables.manage",
      "sales.view",
      "sales.manage",
      "receivables.view",
      "receivables.manage",
      "indices.view",
      "indices.manage",
      "execution.view",
      "quality.view",
      "commercial.view",
      "documents.view",
    ].forEach((permission) => permissions.add(permission));
  }

  const can = (permission: string) => permissions.has(permission);
  const fullName = profileResult.data?.full_name?.trim() || email.split("@")[0] || "Usuário";
  const activeProject = projects.find((project) => project.id === projectId) ?? null;
  const financeReceivablesHref = can("receivables.view") ? "/financeiro/contas-a-receber" : undefined;
  const commercialReceivablesHref = can("receivables.view") ? "/comercial/planos-de-pagamento" : undefined;
  const indicesHref = can("indices.view") ? "/financeiro/indices-de-correcao" : undefined;

  const groups: ShellNavigationGroup[] = [
    {
      key: "system",
      label: "Sistema",
      icon: "⚙",
      active: activeGroup === "system",
      items: [
        { label: "Usuários", href: can("admin.users.view") ? "/configuracoes/acessos" : undefined, active: activeItem === "users", disabled: !can("admin.users.view") },
        { label: "Permissões", disabled: true },
        { label: "Cadastros gerais", sectionLabel: "Cadastros gerais" },
        { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "suppliers", disabled: !can("suppliers.view") },
        { label: "Clientes", href: can("clients.view") ? "/cadastros/clientes" : undefined, active: activeItem === "clients", disabled: !can("clients.view") },
        { label: "Dados & Backup", disabled: true },
      ],
    },
    {
      key: "projects",
      label: "Empreendimentos",
      icon: "▦",
      active: activeGroup === "projects",
      items: [
        { label: "Empresas / SPEs", disabled: true },
        { label: "Cadastro de Empreendimentos", disabled: true },
        { label: "Características do Empreendimento", disabled: true },
        { label: "Locais / Pavimentos", disabled: true },
      ],
    },
    {
      key: "engineering",
      label: "Engenharia",
      icon: "♙",
      active: activeGroup === "engineering",
      items: [
        { label: "Orçamentos", sectionLabel: "Orçamentos" },
        { label: "Cadastro de Orçamentos", disabled: true },
        { label: "Serviços", disabled: true },
        { label: "Insumos", disabled: true },
        { label: "Planejamento da obra", sectionLabel: "Planejamento da obra" },
        { label: "Cronograma Físico · Linha Base", disabled: true },
        { label: "Curvas Física e Financeira", disabled: true },
        { label: "Plano de Contratações", disabled: true },
        { label: "Planejamento de Suprimentos", disabled: true },
      ],
    },
    {
      key: "execution",
      label: "Execução",
      icon: "✓",
      active: activeGroup === "execution",
      items: [
        { label: "Controle do Cronograma", disabled: true },
        { label: "Solicitações de Materiais", disabled: true },
        { label: "Diário de Obras", disabled: true },
        { label: "Qualidade", disabled: true },
        { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "execution-suppliers", disabled: !can("suppliers.view") },
        { label: "Contratos de Serviços", disabled: true },
        { label: "Medições dos Contratos", disabled: true },
        { label: "Ordens de Serviço", disabled: true },
      ],
    },
    {
      key: "procurement",
      label: "Suprimentos",
      icon: "🛒",
      active: activeGroup === "procurement",
      items: [
        { label: "Orçamentos de Materiais", disabled: true },
        { label: "Pedidos de Compras", disabled: true },
        { label: "Estoque", disabled: true },
        { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "procurement-suppliers", disabled: !can("suppliers.view") },
        { label: "Recebimento de Materiais", disabled: true },
      ],
    },
    {
      key: "finance",
      label: "Financeiro",
      icon: "$",
      active: activeGroup === "finance",
      items: [
        { label: "Contas a Pagar", href: can("payables.view") ? "/financeiro/contas-a-pagar" : undefined, active: activeItem === "payables", disabled: !can("payables.view") },
        { label: "Contas a Receber", href: financeReceivablesHref, active: activeItem === "receivables", disabled: !financeReceivablesHref },
        { label: "Índices de Correção", href: indicesHref, active: activeItem === "correction-indices", disabled: !indicesHref },
        { label: "Fluxo de Caixa", disabled: true },
        { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "finance-suppliers", disabled: !can("suppliers.view") },
        { label: "Notas Manuais", disabled: true },
        { label: "Notas Eletrônicas · XML", disabled: true },
        { label: "Contas Bancárias", disabled: true },
        { label: "Impostos", disabled: true },
      ],
    },
    {
      key: "commercial",
      label: "Comercial",
      icon: "◇",
      active: activeGroup === "commercial",
      items: [
        { label: "Clientes", href: can("clients.view") ? "/cadastros/clientes" : undefined, active: activeItem === "commercial-clients", disabled: !can("clients.view") },
        { label: "Propostas", disabled: true },
        { label: "Corretores", disabled: true },
        { label: "Vendas", href: can("sales.view") ? "/comercial/vendas" : undefined, active: activeItem === "sales", disabled: !can("sales.view") },
        { label: "Planos de Pagamento", href: commercialReceivablesHref, active: activeItem === "payment-plans", disabled: !commercialReceivablesHref },
      ],
    },
    {
      key: "postwork",
      label: "Pós-Obra",
      icon: "⌁",
      active: activeGroup === "postwork",
      items: [
        { label: "Assistências Técnicas", disabled: true },
        { label: "Vistorias e Chamados", disabled: true },
        { label: "Garantias", disabled: true },
      ],
    },
  ];

  const groupLabel = groups.find((group) => group.key === activeGroup)?.label ?? "Início";

  return (
    <div className="elos-app-shell">
      <ShellNavigation groups={groups} homeActive={activeGroup === "home"} />
      <main className="elos-main">
        <header className="elos-header">
          <div className="elos-org">
            <span className="elos-org-icon">▥</span>
            <span className="elos-org-text"><strong>{company.name}</strong><span>{role.name}</span></span>
          </div>
          <div className="elos-breadcrumb" aria-label="Caminho da página">
            <span>Elos OS</span><span>›</span><b>{groupLabel}</b><span>›</span><span>{title}</span>
          </div>
          <ProjectSwitcher companyId={company.id} activeProjectId={activeProject?.id ?? null} projects={projects} action={selectWorkspace} />
          <button className="elos-search-button" type="button" title="Buscar no Elos OS" aria-label="Buscar no Elos OS">⌕</button>
          <div className="elos-user">
            <span className="elos-avatar">{initials(fullName)}</span>
            <span className="elos-user-text"><strong>{fullName}</strong><span>{role.name}</span></span>
          </div>
          <form action={logout}><button className="elos-logout-button" type="submit" title="Sair" aria-label="Sair">↪</button></form>
        </header>
        <div className="elos-module-content">
          <div className="elos-page-top">
            <div>
              <div className="elos-eyebrow">{eyebrow}</div>
              <h1>{title}<span className="elos-module-version">V0.25.3 · sistema integrado</span></h1>
              {description ? <p>{description}</p> : null}
            </div>
            {actions ? <div className="elos-page-actions">{actions}</div> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
