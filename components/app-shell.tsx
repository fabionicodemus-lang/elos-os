import type { ReactNode } from "react";
import { logout, selectWorkspace } from "@/app/dashboard/actions";
import { BankAccountPaymentSelector } from "@/components/bank-account-payment-selector";
import { GlobalSearch } from "@/components/global-search";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ShellNavigation, type ShellNavigationGroup } from "@/components/shell-navigation";
import { resolveActiveWorkspace } from "@/lib/workspace";

type Project = { id: string; name: string; code: string | null };

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export async function AppShell({ activeGroup, activeItem, eyebrow, title, description, actions, children }: {
  activeGroup: "home" | "system" | "projects" | "engineering" | "execution" | "procurement" | "hr" | "finance" | "commercial" | "postwork";
  activeItem?: string; eyebrow: string; title: string; description?: string; actions?: ReactNode; children: ReactNode;
}) {
  const { supabase, userId, email, company, companyId, projectId, role } = await resolveActiveWorkspace();
  const privileged = role.key === "owner" || role.key === "admin";
  const permissionQuery = privileged
    ? supabase.from("permissions").select("key")
    : role.id
      ? supabase.from("role_permissions").select("permission_key").eq("role_id", role.id).eq("allowed", true)
      : Promise.resolve({ data: [], error: null });
  const [projectsResult, profileResult, permissionResult] = await Promise.all([
    supabase.from("projects").select("id, name, code").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    permissionQuery,
  ]);
  const projects = (projectsResult.data ?? []) as Project[];
  const permissions = new Set(
    privileged
      ? ((permissionResult.data ?? []) as { key: string }[]).map((item) => item.key)
      : ((permissionResult.data ?? []) as { permission_key: string }[]).map((item) => item.permission_key),
  );
  const can = (permission: string) => privileged || permissions.has(permission);
  const fullName = profileResult.data?.full_name?.trim() || email.split("@")[0] || "Usuário";
  const activeProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const permissionsHref = privileged || can("admin.roles.view") || can("admin.roles.manage") ? "/configuracoes/permissoes" : undefined;
  const dataBackupHref = privileged || can("admin.data.view") || can("admin.data.export") || can("admin.data.restore") || can("admin.data.manage") ? "/configuracoes/dados-backup" : undefined;
  const legalEntitiesHref = can("projects.view") ? "/empreendimentos/empresas" : undefined;
  const projectsHref = can("projects.view") ? "/empreendimentos" : undefined;
  const projectCharacteristicsHref = can("projects.view") ? "/empreendimentos/caracteristicas" : undefined;
  const projectLocationsHref = can("projects.view") ? "/empreendimentos/locais" : undefined;
  const projectUnitsHref = can("projects.view") ? "/empreendimentos/unidades" : undefined;
  const financeReceivablesHref = can("receivables.view") ? "/financeiro/contas-a-receber" : undefined;
  const commercialReceivablesHref = can("receivables.view") ? "/comercial/planos-de-pagamento" : undefined;
  const indicesHref = can("indices.view") ? "/financeiro/indices-de-correcao" : undefined;
  const cashflowHref = can("cashflow.view") ? "/financeiro/fluxo-de-caixa" : undefined;
  const reportsHref = can("reports.view") ? "/financeiro/relatorios" : undefined;
  const budgetsHref = can("budgets.view") ? "/engenharia/orcamentos" : undefined;
  const servicesHref = can("services.view") ? "/engenharia/servicos" : undefined;
  const inputsHref = can("inputs.view") ? "/engenharia/insumos" : undefined;
  const pricesHref = can("prices.view") ? "/engenharia/precos" : undefined;
  const takeoffsHref = can("takeoffs.view") ? "/engenharia/levantamento" : undefined;
  const scheduleHref = can("schedule.view") ? "/engenharia/cronograma" : undefined;
  const curvesHref = can("schedule.view") ? "/engenharia/curvas" : undefined;
  const engineeringContractsHref = can("execution.contracts.view") ? "/engenharia/contratos" : undefined;
  const contractPlanHref = can("schedule.view") ? "/engenharia/plano-contratacoes" : undefined;
  const supplyPlanHref = can("supply_plan.view") ? "/engenharia/planejamento-suprimentos" : undefined;
  const executionScheduleHref = can("execution.schedule.view") || can("schedule.view") ? "/execucao/cronograma" : undefined;
  const materialRequestsHref = can("execution.material_requests.view") ? "/execucao/solicitacoes-materiais" : undefined;
  const dailyLogsHref = can("execution.daily_logs.view") ? "/execucao/diario-obras" : undefined;
  const qualityHref = can("execution.quality.view") ? "/execucao/qualidade" : undefined;
  const serviceProcurementHref = can("execution.contract_procurement.view") ? "/execucao/contratacoes-servicos" : undefined;
  const serviceContractsHref = can("execution.contracts.view") ? "/execucao/contratos-servicos" : undefined;
  const stageMeasurementsHref = can("execution.measurements.view") ? "/execucao/medicoes-por-etapas" : undefined;
  const contractMeasurementsHref = can("execution.measurements.view") ? "/execucao/medicoes-contratos" : undefined;
  const workOrdersHref = can("execution.work_orders.view") ? "/execucao/ordens-servico" : undefined;
  const materialQuotationsHref = can("procurement.quotations.view") ? "/suprimentos/orcamentos-materiais" : undefined;
  const purchaseOrdersHref = can("procurement.orders.view") ? "/suprimentos/pedidos-compras" : undefined;
  const materialReceiptsHref = can("procurement.receipts.view") ? "/suprimentos/recebimento-materiais" : undefined;
  const inventoryHref = can("procurement.inventory.view") ? "/suprimentos/estoque" : undefined;
  const intelligenceHref = can("procurement.intelligence.view") ? "/suprimentos/controle-integrado" : undefined;
  const supplierPerformanceHref = can("procurement.intelligence.view") ? "/suprimentos/desempenho-fornecedores" : undefined;
  const procurementIndicatorsHref = can("procurement.intelligence.view") ? "/suprimentos/indicadores" : undefined;
  const manualInvoicesHref = can("finance.manual_invoices.view") ? "/financeiro/notas-manuais" : undefined;
  const electronicInvoicesHref = can("finance.invoices.view") ? "/financeiro/notas-eletronicas" : undefined;
  const bankAccountsHref = can("finance.bank_accounts.view") ? "/financeiro/contas-bancarias" : undefined;
  const taxesHref = can("finance.taxes.view") ? "/financeiro/impostos" : undefined;
  const hrEmployeesHref = can("hr.employees.view") || can("hr.employees.manage") ? "/rh/colaboradores" : undefined;
  const hrPayrollHref = can("hr.payroll.view") || can("hr.payroll.manage") || can("hr.payroll.approve") ? "/rh/folha" : undefined;
  const proposalsHref = can("commercial.proposals.view") ? "/comercial/propostas" : undefined;
  const brokersHref = can("commercial.brokers.view") ? "/comercial/corretores" : undefined;
  const assistanceHref = can("postwork.assistance.view") ? "/pos-obra/assistencias" : undefined;
  const inspectionsHref = can("postwork.inspections.view") ? "/pos-obra/vistorias" : undefined;
  const warrantiesHref = can("postwork.warranties.view") ? "/pos-obra/garantias" : undefined;

  const groups: ShellNavigationGroup[] = [
    { key: "system", label: "Sistema", icon: "⚙", active: activeGroup === "system", items: [
      { label: "Usuários", href: can("admin.users.view") ? "/configuracoes/acessos" : undefined, active: activeItem === "users", disabled: !can("admin.users.view") },
      { label: "Permissões", href: permissionsHref, active: activeItem === "permissions", disabled: !permissionsHref },
      { label: "Cadastros gerais", sectionLabel: "Cadastros gerais" },
      { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "suppliers", disabled: !can("suppliers.view") },
      { label: "Clientes", href: can("clients.view") ? "/cadastros/clientes" : undefined, active: activeItem === "clients", disabled: !can("clients.view") },
      { label: "Dados & Backup", href: dataBackupHref, active: activeItem === "data-backup", disabled: !dataBackupHref },
    ]},
    { key: "projects", label: "Empreendimentos", icon: "▦", active: activeGroup === "projects", items: [
      { label: "Empresas / SPEs", href: legalEntitiesHref, active: activeItem === "legal-entities", disabled: !legalEntitiesHref },
      { label: "Cadastro de Empreendimentos", href: projectsHref, active: activeItem === "projects", disabled: !projectsHref },
      { label: "Características do Empreendimento", href: projectCharacteristicsHref, active: activeItem === "project-characteristics", disabled: !projectCharacteristicsHref },
      { label: "Locais / Pavimentos", href: projectLocationsHref, active: activeItem === "project-locations", disabled: !projectLocationsHref },
      { label: "Unidades privativas", href: projectUnitsHref, active: activeItem === "project-units", disabled: !projectUnitsHref },
    ]},
    { key: "engineering", label: "Engenharia", icon: "♙", active: activeGroup === "engineering", items: [
      { label: "Orçamentos", sectionLabel: "Orçamentos" },
      { label: "Orçamentos", href: budgetsHref, active: activeItem === "budgets", disabled: !budgetsHref },
      { label: "Serviços", href: servicesHref, active: activeItem === "services", disabled: !servicesHref },
      { label: "Insumos", href: inputsHref, active: activeItem === "inputs", disabled: !inputsHref },
      { label: "Preços e Cotações", href: pricesHref, active: activeItem === "prices", disabled: !pricesHref },
      { label: "Levantamento de Quantitativos", href: takeoffsHref, active: activeItem === "takeoffs", disabled: !takeoffsHref },
      { label: "Planejamento da obra", sectionLabel: "Planejamento da obra" },
      { label: "Cronograma Físico · Linha Base", href: scheduleHref, active: activeItem === "schedule", disabled: !scheduleHref },
      { label: "Curvas Física e Financeira", href: curvesHref, active: activeItem === "curves", disabled: !curvesHref },
      { label: "Contratos e Medições", href: engineeringContractsHref, active: activeItem === "contracts", disabled: !engineeringContractsHref },
      { label: "Plano de Contratações", href: contractPlanHref, active: activeItem === "contract-plan", disabled: !contractPlanHref },
      { label: "Planejamento de Suprimentos", href: supplyPlanHref, active: activeItem === "supply-plan", disabled: !supplyPlanHref },
    ]},
    { key: "execution", label: "Execução", icon: "✓", active: activeGroup === "execution", items: [
      { label: "Controle do Cronograma", href: executionScheduleHref, active: activeItem === "execution-schedule", disabled: !executionScheduleHref },
      { label: "Solicitações de Materiais", href: materialRequestsHref, active: activeItem === "material-requests", disabled: !materialRequestsHref },
      { label: "Diário de Obras", href: dailyLogsHref, active: activeItem === "daily-logs", disabled: !dailyLogsHref },
      { label: "Qualidade", href: qualityHref, active: activeItem === "quality", disabled: !qualityHref },
      { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "execution-suppliers", disabled: !can("suppliers.view") },
      { label: "Contratação de serviços", sectionLabel: "Contratação de serviços" },
      { label: "Solicitações e Concorrências", href: serviceProcurementHref, active: activeItem === "service-procurement", disabled: !serviceProcurementHref },
      { label: "Contratos Formalizados", href: serviceContractsHref, active: activeItem === "service-contracts", disabled: !serviceContractsHref },
      { label: "Medições por Etapas", href: stageMeasurementsHref, active: activeItem === "stage-measurements", disabled: !stageMeasurementsHref },
      { label: "Aprovação e Financeiro", href: contractMeasurementsHref, active: activeItem === "contract-measurements", disabled: !contractMeasurementsHref },
      { label: "Ordens de Serviço", href: workOrdersHref, active: activeItem === "work-orders", disabled: !workOrdersHref },
    ]},
    { key: "procurement", label: "Suprimentos", icon: "🛒", active: activeGroup === "procurement", items: [
      { label: "Operação", sectionLabel: "Operação" },
      { label: "Orçamentos de Materiais", href: materialQuotationsHref, active: activeItem === "material-quotations", disabled: !materialQuotationsHref },
      { label: "Pedidos de Compras", href: purchaseOrdersHref, active: activeItem === "purchase-orders", disabled: !purchaseOrdersHref },
      { label: "Recebimento de Materiais", href: materialReceiptsHref, active: activeItem === "material-receipts", disabled: !materialReceiptsHref },
      { label: "Estoque", href: inventoryHref, active: activeItem === "inventory", disabled: !inventoryHref },
      { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "procurement-suppliers", disabled: !can("suppliers.view") },
      { label: "Gestão e inteligência", sectionLabel: "Gestão e inteligência" },
      { label: "Controle Integrado", href: intelligenceHref, active: activeItem === "integrated-control", disabled: !intelligenceHref },
      { label: "Desempenho de Fornecedores", href: supplierPerformanceHref, active: activeItem === "supplier-performance", disabled: !supplierPerformanceHref },
      { label: "Indicadores", href: procurementIndicatorsHref, active: activeItem === "procurement-indicators", disabled: !procurementIndicatorsHref },
    ]},
    { key: "hr", label: "RH", icon: "♧", active: activeGroup === "hr", items: [
      { label: "Cadastros", sectionLabel: "Cadastros" },
      { label: "Colaboradores", href: hrEmployeesHref, active: activeItem === "hr-employees", disabled: !hrEmployeesHref },
      { label: "Folha e financeiro", sectionLabel: "Folha e financeiro" },
      { label: "Folha de Pagamento", href: hrPayrollHref, active: activeItem === "hr-payroll", disabled: !hrPayrollHref },
      { label: "Contas a Pagar da Folha", href: can("payables.view") ? "/financeiro/contas-a-pagar?q=RH" : undefined, active: activeItem === "hr-payables", disabled: !can("payables.view") },
    ]},
    { key: "finance", label: "Financeiro", icon: "$", active: activeGroup === "finance", items: [
      { label: "Contas a Pagar", href: can("payables.view") ? "/financeiro/contas-a-pagar" : undefined, active: activeItem === "payables", disabled: !can("payables.view") },
      { label: "Contas a Receber", href: financeReceivablesHref, active: activeItem === "receivables", disabled: !financeReceivablesHref },
      { label: "Índices de Correção", href: indicesHref, active: activeItem === "correction-indices", disabled: !indicesHref },
      { label: "Fluxo de Caixa", href: cashflowHref, active: activeItem === "cashflow", disabled: !cashflowHref },
      { label: "Relatórios Financeiros", href: reportsHref, active: activeItem === "reports", disabled: !reportsHref },
      { label: "Fornecedores", href: can("suppliers.view") ? "/cadastros/fornecedores" : undefined, active: activeItem === "finance-suppliers", disabled: !can("suppliers.view") },
      { label: "Notas Manuais", href: manualInvoicesHref, active: activeItem === "manual-invoices", disabled: !manualInvoicesHref },
      { label: "Notas Eletrônicas · XML", href: electronicInvoicesHref, active: activeItem === "electronic-invoices", disabled: !electronicInvoicesHref },
      { label: "Contas Bancárias", href: bankAccountsHref, active: activeItem === "bank-accounts", disabled: !bankAccountsHref },
      { label: "Impostos", href: taxesHref, active: activeItem === "taxes", disabled: !taxesHref },
    ]},
    { key: "commercial", label: "Comercial", icon: "◇", active: activeGroup === "commercial", items: [
      { label: "Clientes", href: can("clients.view") ? "/cadastros/clientes" : undefined, active: activeItem === "commercial-clients", disabled: !can("clients.view") },
      { label: "Propostas", href: proposalsHref, active: activeItem === "proposals", disabled: !proposalsHref },
      { label: "Corretores", href: brokersHref, active: activeItem === "brokers", disabled: !brokersHref },
      { label: "Vendas", href: can("sales.view") ? "/comercial/vendas" : undefined, active: activeItem === "sales", disabled: !can("sales.view") },
      { label: "Planos de Pagamento", href: commercialReceivablesHref, active: activeItem === "payment-plans", disabled: !commercialReceivablesHref },
    ]},
    { key: "postwork", label: "Pós-Obra", icon: "⌁", active: activeGroup === "postwork", items: [
      { label: "Assistências Técnicas", href: assistanceHref, active: activeItem === "assistance", disabled: !assistanceHref },
      { label: "Vistorias e Chamados", href: inspectionsHref, active: activeItem === "inspections", disabled: !inspectionsHref },
      { label: "Garantias", href: warrantiesHref, active: activeItem === "warranties", disabled: !warrantiesHref },
    ]},
  ];
  const groupLabel = groups.find((group) => group.key === activeGroup)?.label ?? "Início";

  return <div className="elos-app-shell">
    <BankAccountPaymentSelector />
    <ShellNavigation groups={groups} homeActive={activeGroup === "home"} />
    <main className="elos-main">
      <header className="elos-header">
        <div className="elos-org"><span className="elos-org-icon">▥</span><span className="elos-org-text"><strong>{company.name}</strong><span>{role.name}</span></span></div>
        <div className="elos-breadcrumb" aria-label="Caminho da página"><span>Elos OS</span><span>›</span><b>{groupLabel}</b><span>›</span><span>{title}</span></div>
        <ProjectSwitcher companyId={company.id} activeProjectId={activeProject?.id ?? null} projects={projects} action={selectWorkspace} />
        <GlobalSearch activeProjectId={activeProject?.id ?? null} activeProjectName={activeProject ? [activeProject.code, activeProject.name].filter(Boolean).join(" · ") : null} />
        <div className="elos-user"><span className="elos-avatar">{initials(fullName)}</span><span className="elos-user-text"><strong>{fullName}</strong><span>{role.name}</span></span></div>
        <form action={logout}><button className="elos-logout-button" type="submit" title="Sair" aria-label="Sair">↪</button></form>
      </header>
      <div className="elos-module-content"><div className="elos-page-top"><div><div className="elos-eyebrow">{eyebrow}</div><h1>{title}<span className="elos-module-version">V0.71.0 · sistema integrado</span></h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="elos-page-actions">{actions}</div> : null}</div>{children}</div>
    </main>
  </div>;
}
