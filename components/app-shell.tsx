import type { ReactNode } from "react";
import { logout, selectWorkspace } from "@/app/dashboard/actions";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ShellNavigation, type ShellNavigationGroup } from "@/components/shell-navigation";
import { resolveActiveWorkspace } from "@/lib/workspace";

type Project = { id: string; name: string; code: string | null };

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
  const { supabase, userId, email, company, companyId, projectId, role } = await resolveActiveWorkspace();

  const [projectsResult, profileResult, permissionResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .neq("status", "archived")
      .order("name"),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    role.id
      ? supabase
          .from("role_permissions")
          .select("permission_key")
          .eq("role_id", role.id)
          .eq("allowed", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const projects = (projectsResult.data ?? []) as Project[];
  const permissions = new Set(
    ((permissionResult.data ?? []) as { permission_key: string }[]).map((item) => item.permission_key),
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
      "cashflow.view",
      "reports.view",
      "budgets.view",
      "budgets.manage",
      "services.view",
      "services.manage",
      "inputs.view",
      "inputs.manage",
      "prices.view",
      "prices.manage",
      "execution.view",
      "quality.view",
      "commercial.view",
      "documents.view",
    ].forEach((permission) => permissions.add(permission));
  }

  const can = (permission: string) => permissions.has(permission);
  const fullName = profileResult.data?.full_name?.trim() || email.split("@")[0] || "Usuário";
  const activeProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const financeReceivablesHref = can("receivables.view") ? "/financeiro/contas-a-receber" : undefined;
  const commercialReceivablesHref = can("receivables.view") ? "/comercial/planos-de-pagamento" : undefined;
  const indicesHref = can("indices.view") ? "/financeiro/indices-de-correcao" : undefined;
  const cashflowHref = can("cashflow.view") ? "/financeiro/fluxo-de-caixa" : undefined;
  const reportsHref = can("reports.view") ? "/financeiro/relatorios" : undefined;
  const budgetsHref = can("budgets.view") ? "/engenharia/orcamentos" : undefined;
  const servicesHref = can("services.view") ? "/engenharia/servicos" : undefined;
  const inputsHref = can("inputs.view") ? "/engenharia/insumos" : undefined;
  const pricesHref = can("prices.view") ? "/engenharia/precos" : undefined;

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
        { label: "Cadastro de Orçamentos", href: budgetsHref, active: activeItem === "budgets", disabled: !budgetsHref },
        { label: "Serviços", href: servicesHref, active: activeItem === "services", disabled: !servicesHref },
        { label: "Insumos", href: inputsHref, active: activeItem === "inputs", disabled: !inputsHref },
        { label: "Preços e Cotações", href: pricesHref, active: activeItem === "prices", disabled: !pricesHref },
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
        { label: "Fluxo de Caixa", href: cashflowHref, active: activeItem === "cashflow", disabled: !cashflowHref },
        { label: "Relatórios Financeiros", href: reportsHref, active: activeItem === "reports", disabled: !reportsHref },
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
              <h1>{title}<span className="elos-module-version">V0.26.2 · sistema integrado</span></h1>
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
