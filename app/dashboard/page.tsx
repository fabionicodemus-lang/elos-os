import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { bootstrapWorkspace, selectWorkspace } from "./actions";

type Company = {
  id: string;
  name: string;
  slug: string;
};

type Role = {
  id: string;
  key: string;
  name: string;
};

type Membership = {
  company_id: string;
  role_id: string;
  companies: Company | Company[] | null;
  roles: Role | Role[] | null;
};

type Project = {
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  status: string;
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const moduleCatalog = [
  { key: "engineering", label: "Engenharia", description: "Orçamentos, linha de base e planejamento da obra." },
  { key: "execution", label: "Execução", description: "Produção, diário, qualidade, contratos e controle de campo." },
  { key: "procurement", label: "Suprimentos", description: "Cotações, pedidos, recebimentos e estoque." },
  { key: "finance", label: "Financeiro", description: "Contas, pagamentos, notas fiscais e fluxo de caixa.", href: "/financeiro/contas-a-pagar", permission: "payables.view" },
  { key: "commercial", label: "Comercial", description: "Clientes, propostas, corretores, vendas e contratos.", href: "/cadastros/clientes", permission: "clients.view" },
  { key: "postwork", label: "Pós-Obra", description: "Assistências técnicas, chamados, vistorias e garantias." },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";

  const membershipResult = await supabase
    .from("company_memberships")
    .select("company_id, role_id, companies(id, name, slug), roles(id, key, name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at");

  const schemaMissing = Boolean(
    membershipResult.error &&
      (membershipResult.error.code === "42P01" || membershipResult.error.message.includes("company_memberships")),
  );

  const memberships = (membershipResult.data ?? []) as unknown as Membership[];
  const companyIds = memberships.map((membership) => membership.company_id);

  const projectResult = companyIds.length
    ? await supabase
        .from("projects")
        .select("id, company_id, name, code, status")
        .in("company_id", companyIds)
        .neq("status", "archived")
        .order("name")
    : { data: [], error: null };

  const projects = (projectResult.data ?? []) as Project[];
  const cookieStore = await cookies();
  const requestedCompanyId = cookieStore.get("elos_company_id")?.value;
  const requestedProjectId = cookieStore.get("elos_project_id")?.value;

  const activeMembership =
    memberships.find((membership) => membership.company_id === requestedCompanyId) ?? memberships[0] ?? null;
  const activeCompany = activeMembership ? relatedOne(activeMembership.companies) : null;
  const activeRole = activeMembership ? relatedOne(activeMembership.roles) : null;
  const companyProjects = activeCompany
    ? projects.filter((project) => project.company_id === activeCompany.id)
    : [];
  const activeProject =
    companyProjects.find((project) => project.id === requestedProjectId) ?? companyProjects[0] ?? null;

  const permissionResult = activeRole
    ? await supabase
        .from("role_permissions")
        .select("permission_key")
        .eq("role_id", activeRole.id)
        .eq("allowed", true)
    : { data: [], error: null };

  const permissionKeys = new Set(
    ((permissionResult.data ?? []) as { permission_key: string }[]).map((item) => item.permission_key),
  );

  const privilegedRole = activeRole?.key === "owner" || activeRole?.key === "admin";
  if (privilegedRole) {
    [
      "admin.users.view",
      "suppliers.view",
      "clients.view",
      "payables.view",
      "execution.view",
      "quality.view",
      "commercial.view",
      "documents.view",
    ].forEach((permission) => permissionKeys.add(permission));
  }

  if (schemaMissing || memberships.length === 0 || !activeCompany) {
    return (
      <main className="auth-page">
        <section className="auth-brand">
          <div className="auth-logo">E</div>
          <div>
            <span className="auth-kicker">Elos OS</span>
            <h1>Construção conectada</h1>
            <p>Configure o primeiro ambiente para iniciar a operação multiempresa.</p>
          </div>
        </section>

        {schemaMissing ? (
          <section className="auth-card">
            <div className="auth-card-header"><span>Banco de dados</span><h2>Instalar estrutura inicial</h2></div>
            <p>Execute no Supabase o arquivo <code>supabase/migrations/20260722_0001_multitenancy.sql</code>.</p>
          </section>
        ) : (
          <form className="auth-card workspace-form" action={bootstrapWorkspace}>
            <div className="auth-card-header"><span>Cadastro inicial</span><h2>Empresa e obra</h2></div>
            <label>Nome da empresa<input name="company_name" defaultValue="Bossa Empreendimentos" required /></label>
            <label>Identificador<input name="company_slug" defaultValue="bossa" /></label>
            <label>Primeira obra<input name="project_name" defaultValue="Flow Aptos" /></label>
            <label>Código da obra<input name="project_code" defaultValue="FLOW" /></label>
            <button className="auth-primary" type="submit">Criar ambiente da Bossa</button>
          </form>
        )}
      </main>
    );
  }

  const [supplierCountResult, clientCountResult, payableSummaryResult] = await Promise.all([
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", activeCompany.id),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", activeCompany.id),
    permissionKeys.has("payables.view")
      ? supabase.rpc("payables_summary", { p_company_id: activeCompany.id, p_project_id: activeProject?.id ?? null })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const payableSummary = payableSummaryResult.data as { total_count?: number; total_amount?: number; open_count?: number } | null;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <AppShell
      activeGroup="home"
      eyebrow="Início"
      title="Dashboard Geral"
      description="Visão consolidada dos módulos, empreendimentos e atividades do Elos OS."
      actions={permissionKeys.has("admin.users.view") ? <Link className="elos-button" href="/configuracoes/acessos">Usuários e acessos</Link> : undefined}
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      <section className="dashboard-welcome">
        <div>
          <span>VISÃO GERAL DO SISTEMA</span>
          <h2>Gestão conectada da incorporação ao pós-obra</h2>
          <p>Use o menu lateral para acessar cada módulo e suas divisões.</p>
        </div>
        <Link className="elos-button" href="/financeiro/contas-a-pagar">Abrir operação do Flow</Link>
      </section>

      <section className="access-summary">
        <article><span>Fornecedores</span><strong>{supplierCountResult.count ?? 0}</strong></article>
        <article><span>Clientes</span><strong>{clientCountResult.count ?? 0}</strong></article>
        <article><span>Contas a pagar</span><strong>{payableSummary?.total_count ?? 0}</strong></article>
      </section>

      <section className="registry-dashboard-section">
        <div className="section-heading">
          <div><span>Módulos do sistema</span><h2>Operação integrada</h2></div>
          <p>As telas disponíveis já estão ligadas ao ambiente ativo e às permissões do usuário.</p>
        </div>
        <div className="module-launch-grid">
          {moduleCatalog.map((module) => {
            const available = module.href && (!module.permission || permissionKeys.has(module.permission));
            return (
              <article key={module.key}>
                <span>{available ? "Disponível" : "Em preparação"}</span>
                <h3>{module.label}</h3>
                <p>{module.description}</p>
                {available ? <Link className="module-link" href={module.href!}>Abrir módulo</Link> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="workspace-hero">
        <div>
          <span>Ambiente ativo</span>
          <h2>{activeProject?.name ?? "Visão geral da empresa"}</h2>
          <p>Você está acessando como <strong>{activeRole?.name}</strong>. Todos os módulos respeitam esse contexto.</p>
        </div>
        <div className="workspace-summary">
          <div><span>Empresa</span><strong>{activeCompany.name}</strong></div>
          <div><span>Obra</span><strong>{activeProject?.name ?? "Todas"}</strong></div>
          <div><span>Financeiro</span><strong>{money.format(Number(payableSummary?.total_amount ?? 0))}</strong></div>
        </div>
      </section>

      <section className="environment-panel">
        <div className="section-heading">
          <div><span>Trocar ambiente</span><h2>Empresas e obras disponíveis</h2></div>
          <p>A seleção também pode ser feita diretamente no cabeçalho.</p>
        </div>
        <div className="company-list">
          {memberships.map((membership) => {
            const company = relatedOne(membership.companies);
            const role = relatedOne(membership.roles);
            if (!company) return null;
            const availableProjects = projects.filter((project) => project.company_id === company.id);

            return (
              <article key={company.id} className={company.id === activeCompany.id ? "selected" : ""}>
                <div className="company-card-header">
                  <div><strong>{company.name}</strong><span>{role?.name}</span></div>
                  {company.id === activeCompany.id ? <em>Ativa</em> : null}
                </div>
                <div className="project-buttons">
                  <form action={selectWorkspace}>
                    <input type="hidden" name="company_id" value={company.id} />
                    <input type="hidden" name="project_id" value="" />
                    <button type="submit">Visão geral</button>
                  </form>
                  {availableProjects.map((project) => (
                    <form action={selectWorkspace} key={project.id}>
                      <input type="hidden" name="company_id" value={company.id} />
                      <input type="hidden" name="project_id" value={project.id} />
                      <button className={project.id === activeProject?.id ? "active" : ""} type="submit">
                        {project.code ? `${project.code} · ` : ""}{project.name}
                      </button>
                    </form>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
