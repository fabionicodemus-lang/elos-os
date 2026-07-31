import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createPlatformEnvironment } from "./actions";
import styles from "./platform-admin.module.css";

type PlatformEnvironment = {
  company_id: string;
  company_name: string;
  company_slug: string;
  company_status: string;
  owner_email: string;
  project_count: number;
  member_count: number;
  created_at: string;
};

function dateTimeBR(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export default async function PlatformEnvironmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, email } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("platform_list_environments");
  const environments = (data ?? []) as PlatformEnvironment[];

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>Administração da plataforma</span>
            <h1>Ambientes do Elos OS</h1>
            <p>
              Crie empresas e libere o primeiro proprietário. Esta área não faz parte da
              administração de nenhuma empresa e só pode ser acessada por administradores
              globais cadastrados no banco.
            </p>
          </div>
          <Link className={styles.back} href="/dashboard">
            Voltar ao Elos OS
          </Link>
        </header>

        {params.success ? (
          <div className={`${styles.message} ${styles.success}`}>{params.success}</div>
        ) : null}
        {params.error ? (
          <div className={`${styles.message} ${styles.error}`}>{params.error}</div>
        ) : null}
        {error ? (
          <div className={`${styles.message} ${styles.error}`}>
            Não foi possível consultar os ambientes. Confirme se a migration 0061 foi aplicada.
          </div>
        ) : null}

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Novo ambiente</span>
              <h2>Empresa e primeira obra</h2>
              <p>O proprietário precisa ter criado e confirmado a conta antes desta liberação.</p>
            </div>

            <form className={styles.form} action={createPlatformEnvironment}>
              <label>
                Nome da empresa
                <input
                  name="company_name"
                  placeholder="Construtora Horizonte Homologação Ltda."
                  required
                />
              </label>
              <label>
                Identificador
                <input name="company_slug" placeholder="horizonte-testes" />
              </label>
              <label>
                E-mail do primeiro proprietário
                <input
                  name="owner_email"
                  type="email"
                  placeholder="proprietario@empresa.com.br"
                  required
                />
              </label>
              <label>
                Primeira obra
                <input name="project_name" placeholder="Residencial Aurora" />
              </label>
              <label>
                Código da obra
                <input name="project_code" placeholder="HOM-001" />
              </label>
              <button type="submit">Criar e liberar ambiente</button>
            </form>

            <p className={styles.note}>
              O administrador da plataforma cria somente o ambiente e o primeiro proprietário.
              Depois disso, o proprietário ou administrador da empresa inclui os demais usuários
              pela tela Sistema → Usuários e Acessos.
            </p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Controle global</span>
              <h2>Ambientes cadastrados</h2>
              <p>{environments.length} ambiente(s) visível(is) para {email}.</p>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Proprietário</th>
                    <th>Obras</th>
                    <th>Usuários</th>
                    <th>Status</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {environments.map((environment) => (
                    <tr key={environment.company_id}>
                      <td>
                        <span className={styles.name}>{environment.company_name}</span>
                        <span className={styles.slug}>{environment.company_slug}</span>
                      </td>
                      <td>{environment.owner_email || "—"}</td>
                      <td>{Number(environment.project_count ?? 0)}</td>
                      <td>{Number(environment.member_count ?? 0)}</td>
                      <td>
                        <span className={styles.status}>
                          {environment.company_status === "active" ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <span className={styles.meta}>{dateTimeBR(environment.created_at)}</span>
                      </td>
                    </tr>
                  ))}
                  {!environments.length ? (
                    <tr>
                      <td colSpan={6} className={styles.empty}>
                        Nenhum ambiente encontrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          A URL não aparece no menu comum. A autorização é validada novamente no servidor e no
          Supabase em cada consulta ou criação.
        </footer>
      </div>
    </main>
  );
}
