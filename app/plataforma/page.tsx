import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import styles from "./plataforma.module.css";

type Environment = {
  company_id: string;
  company_name: string;
  company_slug: string;
  company_status: string;
  owner_email: string;
  project_count: number;
  member_count: number;
  created_at: string;
};

type EnvironmentAudit = {
  id: string;
  company_name: string;
  owner_email: string;
  action: string;
  changed_at: string;
};

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

export default async function PlatformHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // A verificação acontece no servidor, independentemente de qualquer opção visual.
  const { supabase, email } = await requirePlatformAdmin();
  const params = await searchParams;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");

  const [environmentResult, auditResult] = await Promise.all([
    supabase.rpc("platform_list_environments"),
    supabase
      .from("platform_environment_audit")
      .select("id,company_name,owner_email,action,changed_at")
      .order("changed_at", { ascending: false })
      .limit(8),
  ]);

  const hasEnvironmentError = Boolean(environmentResult.error);
  const environments = (environmentResult.data ?? []) as Environment[];
  const audits = (auditResult.data ?? []) as EnvironmentAudit[];
  const filtered = environments.filter((item) =>
    [item.company_name, item.company_slug, item.owner_email]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query),
  );

  const activeCompanies = environments.filter(
    (item) => item.company_status === "active",
  ).length;
  const projectCount = environments.reduce(
    (total, item) => total + Number(item.project_count || 0),
    0,
  );
  const memberCount = environments.reduce(
    (total, item) => total + Number(item.member_count || 0),
    0,
  );

  return (
    <main className={styles.app}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/plataforma">
          <span className={styles.brandMark}>E</span>
          <span>
            <strong>Elos OS</strong>
            <small>Administração da plataforma</small>
          </span>
        </Link>
        <p className={styles.navLabel}>GESTÃO GLOBAL</p>
        <nav className={styles.nav} aria-label="Administração global">
          <Link href="/plataforma" className={styles.navActive}>Visão geral</Link>
          <Link href="/plataforma/ambientes">Empresas e ambientes</Link>
          <Link href="#auditoria">Histórico de operações</Link>
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.isolatedDot} />
          <div>
            <strong>Área administrativa</strong>
            <small>Separada dos dados de cada construtora</small>
          </div>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>Elos OS <span>/</span> Plataforma <span>/</span> Visão geral</div>
          <div className={styles.account}>
            <span className={styles.avatar}>E</span>
            <div>
              <strong>Administrador global</strong>
              <small>{email}</small>
            </div>
          </div>
        </header>

        <div className={styles.main}>
          <section className={styles.heading}>
            <div>
              <span className={styles.eyebrow}>CONTROLE DA PLATAFORMA</span>
              <h1>Visão geral do Elos OS</h1>
              <p>Gerencie os ambientes dos clientes sem entrar nos dados operacionais de cada construtora.</p>
            </div>
            <Link href="/plataforma/ambientes" className={styles.primaryAction}>+ Criar ambiente</Link>
          </section>

          {hasEnvironmentError ? (
            <div className={styles.error} role="alert">
              Não foi possível consultar os ambientes. Verifique o acesso de administrador
              global e a função de administração do Supabase.
            </div>
          ) : null}

          <div className={styles.kpis} aria-label="Indicadores globais">
            <article className={styles.kpi}>
              <span>Empresas cadastradas</span>
              <strong>{hasEnvironmentError ? "—" : environments.length}</strong>
              <small>Todos os ambientes da plataforma</small>
            </article>
            <article className={styles.kpi}>
              <span>Empresas ativas</span>
              <strong>{hasEnvironmentError ? "—" : activeCompanies}</strong>
              <small>Ambientes com status ativo</small>
            </article>
            <article className={styles.kpi}>
              <span>Empreendimentos</span>
              <strong>{hasEnvironmentError ? "—" : projectCount}</strong>
              <small>Obras não arquivadas</small>
            </article>
            <article className={styles.kpi}>
              <span>Vínculos de usuários</span>
              <strong>{hasEnvironmentError ? "—" : memberCount}</strong>
              <small>Somatório dos acessos ativos por empresa</small>
            </article>
          </div>

          <section className={styles.panel} aria-labelledby="companies-heading">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>CLIENTES</span>
                <h2 id="companies-heading">Empresas e ambientes</h2>
                <p>Proprietários, empreendimentos, usuários e situação de cada ambiente.</p>
              </div>
              <Link href="/plataforma/ambientes" className={styles.outlineAction}>Administrar ambientes</Link>
            </div>

            <form className={styles.search} action="/plataforma" method="get" role="search">
              <label htmlFor="environment-search">Buscar empresa, identificador ou proprietário</label>
              <div className={styles.searchRow}>
                <input
                  id="environment-search"
                  type="search"
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="Ex.: Construtora Horizonte"
                />
                <button type="submit">Buscar</button>
              </div>
            </form>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Empresa</th><th>Proprietário</th><th>Obras</th>
                    <th>Usuários</th><th>Status</th><th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.company_id}>
                      <td>
                        <strong>{item.company_name}</strong>
                        <small>{item.company_slug}</small>
                      </td>
                      <td>{item.owner_email || "—"}</td>
                      <td>{Number(item.project_count ?? 0)}</td>
                      <td>{Number(item.member_count ?? 0)}</td>
                      <td>
                        <span className={item.company_status === "active" ? styles.active : styles.inactive}>
                          {item.company_status === "active" ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                  {!hasEnvironmentError && filtered.length === 0 ? (
                    <tr><td colSpan={6} className={styles.empty}>
                      {query ? "Nenhum ambiente corresponde à busca." : "Nenhuma empresa cadastrada ainda."}
                    </td></tr>
                  ) : null}
                  {hasEnvironmentError ? (
                    <tr><td colSpan={6} className={styles.empty}>Listagem indisponível.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.bottom} id="auditoria">
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>RASTREABILIDADE</span>
                  <h2>Últimas operações</h2>
                  <p>Histórico de criação e alteração de ambientes.</p>
                </div>
              </div>
              {auditResult.error ? (
                <p className={styles.muted}>Não foi possível carregar o histórico de operações.</p>
              ) : audits.length === 0 ? (
                <p className={styles.muted}>Nenhuma operação registrada até agora.</p>
              ) : (
                <ul className={styles.auditList}>
                  {audits.map((item) => (
                    <li key={item.id}>
                      <span className={styles.auditDot} />
                      <div>
                        <strong>{item.company_name}</strong>
                        <small>{item.action === "environment_created"
                          ? "Ambiente criado"
                          : item.action === "environment_status_changed"
                            ? "Situação do ambiente alterada" : "Operação administrativa"}</small>
                      </div>
                      <time>{formatDate(item.changed_at)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className={styles.info}>
              <span className={styles.eyebrow}>ACESSOS</span>
              <h2>Plataforma x Construtora</h2>
              <p>Esta área mostra apenas indicadores administrativos. Os dados de orçamento,
                financeiro, contratos e obra permanecem isolados por empresa e sujeitos
                às permissões do respectivo ambiente.</p>
              <Link href="/dashboard?scope=empresa">Abrir meu ambiente operacional →</Link>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
