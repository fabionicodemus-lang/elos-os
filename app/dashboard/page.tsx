import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bootstrapWorkspace, logout, selectWorkspace } from "./actions";

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

const registryCatalog = [
  {
    key: "suppliers.view",
    label: "Fornecedores",
    description: "Base central compartilhada por Execução, Suprimentos e Financeiro.",
    href: "/cadastros/fornecedores",
  },
  {
    key: "clients.view",
    label: "Clientes",
    description: "Clientes e investidores vinculados a propostas, vendas e contratos.",
    href: "/cadastros/clientes",
  },
];

const moduleCatalog = [
  {
    key: "execution.view",
    label: "Execução",
    description: "Cronograma, diário de obras e rotinas de campo.",
  },
  {
    key: "quality.view",
    label: "Qualidade",
    description: "Vistorias, critérios e não conformidades.",
  },
  {
    key: "payables.view",
    label: "Financeiro",
    description: "Contas a pagar, pagamentos e compromissos da obra.",
    href: "/financeiro/contas-a-pagar",
  },
  {
    key: "commercial.view",
    label: "Comercial",
    description: "Clientes, unidades, vendas e contratos.",
  },
  {
    key: "documents.view",
    label: "Documentos",
    description: "Arquivos, projetos e registros da obra.",
  },
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
  const email = typeof authData.claims.email === "string" ? authData.claims.email : "Usuário autenticado";

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
      "suppliers.view",
      "suppliers.manage",
      "clients.view",
      "clients.manage",
      "payables.view",
      "payables.manage",
    ].forEach((permission) => permissionKeys.add(permission));
  }

  const availableRegistries = registryCatalog.filter((registry) => permissionKeys.has(registry.key));
  const availableModules = moduleCatalog.filter((module) => permissionKeys.has(module.key));

  return (
    <main className="protected-page">
      <aside className="protected-sidebar app-sidebar">
        <div className="sidebar-brand">
          <div className="protected-logo">E</div>
          <div>
            <strong>Elos OS</strong>
            <span>Sistema integrado de obras</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          <Link className="active" href="/dashboard">Início</Link>

          {availableRegistries.length ? (
            <>
              <span className="sidebar-section">Cadastros</span>
              {availableRegistries.map((registry) => (
                <Link href={registry.href} key={registry.key}>{registry.label}</Link>
              ))}
            </>
          ) : null}

          {activeCompany ? <span className="sidebar-section">Módulos</span> : null}
          {availableModules.map((module) =>
            module.href ? (
              <Link href={module.href} key={module.key}>{module.label}</Link>
            ) : (
              <span className="disabled-link" key={module.key}>{module.label}</span>
            ),
          )}

          {permissionKeys.has("admin.users.view") ? (
            <>
              <span className="sidebar-section">Administração</span>
              <Link href="/configuracoes/acessos">Usuários e acessos</Link>
            </>
          ) : null}
        </nav>
      </aside>

      <section className="protected-content workspace-content">
        <header className="protected-header">
          <div>
            <span>{activeCompany ? "Ambiente de trabalho" : "Configuração inicial"}</span>
            <h1>{activeCompany ? activeCompany.name : "Bem-vindo ao Elos OS"}</h1>
            {activeProject ? <p className="header-context">Obra: {activeProject.name}</p> : null}
          </div>
          <div className="header-actions">
            <div className="user-chip">
              <strong>{email}</strong>
              <span>{activeRole?.name ?? "Novo usuário"}</span>
            </div>
            <form action={logout}>
              <button className="logout-button">Sair</button>
            </form>
          </div>
        </header>

        {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
        {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

        {schemaMissing ? (
          <section className="setup-panel">
            <span>Banco de dados pendente</span>
            <h2>Instale a estrutura multiempresa no Supabase</h2>
            <p>O login funciona, mas as tabelas de empresas, obras, papéis e permissões ainda precisam ser criadas.</p>
            <ol>
              <li>Abra o projeto no Supabase e entre em <strong>SQL Editor</strong>.</li>
              <li>Abra no GitHub o arquivo <code>supabase/migrations/20260722_0001_multitenancy.sql</code>.</li>
              <li>Copie todo o conteúdo, execute no Supabase e atualize esta página.</li>
            </ol>
          </section>
        ) : memberships.length === 0 ? (
          <section className="onboarding-layout">
            <div className="welcome-card onboarding-copy">
              <span>Primeiro ambiente</span>
              <h2>Vamos cadastrar a Bossa e a primeira obra</h2>
              <p>Esta empresa será isolada das futuras construtoras clientes. Você será cadastrado como proprietário.</p>
              <div className="foundation-grid compact-grid">
                <article><span>01</span><h3>Empresa isolada</h3><p>Dados separados por construtora.</p></article>
                <article><span>02</span><h3>Papéis</h3><p>Diretoria, engenharia, financeiro, comercial e obra.</p></article>
                <article><span>03</span><h3>Permissões</h3><p>Controle por módulo e ação.</p></article>
              </div>
            </div>

            <form className="workspace-form" action={bootstrapWorkspace}>
              <div><span className="form-kicker">Cadastro inicial</span><h2>Empresa e obra</h2></div>
              <label>Nome da empresa<input name="company_name" defaultValue="Bossa Empreendimentos" required /></label>
              <label>Identificador<input name="company_slug" defaultValue="bossa" /></label>
              <label>Primeira obra<input name="project_name" defaultValue="Flow Aptos" /></label>
              <label>Código da obra<input name="project_code" defaultValue="FLOW" /></label>
              <button className="auth-primary" type="submit">Criar ambiente da Bossa</button>
            </form>
          </section>
        ) : (
          <>
            <section className="workspace-hero">
              <div>
                <span>Ambiente ativo</span>
                <h2>{activeProject?.name ?? "Visão geral da empresa"}</h2>
                <p>Você está acessando como <strong>{activeRole?.name}</strong>. Os módulos respeitam as permissões desse papel.</p>
              </div>
              <div className="workspace-summary">
                <div><span>Empresa</span><strong>{activeCompany?.name}</strong></div>
                <div><span>Obra</span><strong>{activeProject?.name ?? "Todas"}</strong></div>
                <div><span>Papel</span><strong>{activeRole?.name}</strong></div>
              </div>
            </section>

            {availableRegistries.length ? (
              <section className="registry-dashboard-section">
                <div className="section-heading">
                  <div><span>Cadastros integrados</span><h2>Bases centrais da empresa</h2></div>
                  <p>Fornecedores e clientes são cadastrados antes dos lançamentos financeiros e comerciais.</p>
                </div>
                <div className="module-grid registry-module-grid">
                  {availableRegistries.map((registry) => (
                    <article key={registry.key}>
                      <span>Disponível</span>
                      <h3>{registry.label}</h3>
                      <p>{registry.description}</p>
                      <Link className="module-link" href={registry.href}>Abrir cadastro</Link>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="module-grid">
              {availableModules.map((module) => (
                <article key={module.key}>
                  <span>{module.href ? "Disponível" : "Em preparação"}</span>
                  <h3>{module.label}</h3>
                  <p>{module.description}</p>
                  {module.href ? (
                    <Link className="module-link" href={module.href}>Abrir módulo</Link>
                  ) : (
                    <button disabled>Em construção</button>
                  )}
                </article>
              ))}
            </section>

            <section className="environment-panel">
              <div><span>Trocar ambiente</span><h2>Empresas e obras disponíveis</h2></div>
              <div className="company-list">
                {memberships.map((membership) => {
                  const company = relatedOne(membership.companies);
                  const role = relatedOne(membership.roles);
                  if (!company) return null;
                  const availableProjects = projects.filter((project) => project.company_id === company.id);

                  return (
                    <article key={company.id} className={company.id === activeCompany?.id ? "selected" : ""}>
                      <div className="company-card-header">
                        <div><strong>{company.name}</strong><span>{role?.name}</span></div>
                        {company.id === activeCompany?.id ? <em>Ativa</em> : null}
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
          </>
        )}
      </section>
    </main>
  );
}
