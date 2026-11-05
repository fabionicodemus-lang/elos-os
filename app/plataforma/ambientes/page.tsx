import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { PLATFORM_ROLE_OPTIONS } from "@/lib/platform-onboarding";
import { createPlatformEnvironment, invitePlatformCompanyMember } from "./actions";
import { PlatformSubmitButton } from "./platform-submit-button";
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

type PlatformMember = {
  membership_id: string;
  email: string;
  full_name: string;
  role_key: string;
  role_name: string;
  membership_status: string;
  email_confirmed: boolean;
  created_at: string;
  total_count: number;
};

function dateBR(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export default async function PlatformEnvironmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; company?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { supabase, email } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("platform_list_environments");
  const environments = (data ?? []) as PlatformEnvironment[];
  const selectedCompany = environments.find((company) => company.company_id === params.company)
    ?? environments[0] ?? null;
  const requestedPage = Number(params.page);
  const memberPage = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10000) : 1;
  const pageSize = 25;
  const { data: memberData, error: memberError } = selectedCompany
    ? await supabase.rpc("platform_list_company_members", {
      p_company_id: selectedCompany.company_id, p_limit: pageSize, p_offset: (memberPage - 1) * pageSize,
    })
    : { data: [], error: null };
  const members = (memberData ?? []) as PlatformMember[];
  const totalMembers = Number(members[0]?.total_count ?? selectedCompany?.member_count ?? 0);
  const activeCompanies = environments.filter((company) => company.company_status === "active").length;
  const companyLink = (page: number) =>
    `/plataforma/ambientes?company=${selectedCompany?.company_id}&page=${page}`;

  return (
    <AppShell
      activeGroup="system"
      activeItem="platform-admin"
      eyebrow="Elos OS · Administração global"
      title="Construtoras e Acessos"
      description={`Área exclusiva do administrador da plataforma · ${email}`}
    >
      {params.success ? <div className={`${styles.message} ${styles.success}`} role="status">{params.success}</div> : null}
      {params.error ? <div className={`${styles.message} ${styles.error}`} role="alert">{params.error}</div> : null}
      {error ? (
        <div className={`${styles.message} ${styles.error}`} role="alert">
          Não foi possível consultar as construtoras. Verifique as migrations de administração global.
        </div>
      ) : null}

      <section className={styles.summary} aria-label="Resumo da plataforma">
        <article><span>Construtoras cadastradas</span><strong>{environments.length}</strong></article>
        <article><span>Construtoras ativas</span><strong>{activeCompanies}</strong></article>
        <article><span>Usuários vinculados</span><strong>{environments.reduce((sum, c) => sum + Number(c.member_count || 0), 0)}</strong></article>
        <article><span>Controle de acesso</span><strong>Exclusivo</strong></article>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>01 · Nova construtora</span>
            <h2>Criar empresa e proprietário</h2>
            <p>O responsável recebe um convite para definir sua própria senha. A empresa já fica isolada das demais.</p>
          </div>
          <form className={styles.form} action={createPlatformEnvironment}>
            <label>Razão social / nome da construtora
              <input name="company_name" placeholder="Construtora Horizonte" maxLength={150} required />
            </label>
            <label>Identificador do ambiente
              <input name="company_slug" placeholder="construtora-horizonte (opcional)" maxLength={80} />
            </label>
            <label>E-mail do proprietário
              <input name="owner_email" type="email" placeholder="diretor@construtora.com.br" autoComplete="off" required />
            </label>
            <div className={styles.formRow}>
              <label>Primeira obra (opcional)
                <input name="project_name" placeholder="Residencial Aurora" />
              </label>
              <label>Código da obra (opcional)
                <input name="project_code" placeholder="AUR-01" />
              </label>
            </div>
            <PlatformSubmitButton pendingLabel="Criando construtora...">Criar construtora e convidar</PlatformSubmitButton>
          </form>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>02 · Novo acesso</span>
            <h2>Convidar usuário para uma construtora</h2>
            <p>Selecione a empresa e o perfil. O usuário só terá acesso aos dados daquela construtora.</p>
          </div>
          <form className={styles.form} action={invitePlatformCompanyMember}>
            <label>Construtora
              <select name="company_id" defaultValue={
                environments.find((company) => company.company_status === "active")?.company_id ?? ""
              } required>
                <option value="" disabled>Selecione uma construtora</option>
                {environments.filter((company) => company.company_status === "active").map((company) => (
                  <option key={company.company_id} value={company.company_id}>{company.company_name}</option>
                ))}
              </select>
            </label>
            <label>E-mail do usuário
              <input name="email" type="email" placeholder="colaborador@construtora.com.br" autoComplete="off" required />
            </label>
            <label>Perfil de acesso
              <select name="role_key" defaultValue="engineering" required>
                {PLATFORM_ROLE_OPTIONS.map((role) => (
                  <option key={role.key} value={role.key}>{role.label}</option>
                ))}
              </select>
            </label>
            <PlatformSubmitButton pendingLabel="Enviando convite..." disabled={!activeCompanies}>
              Convidar e liberar acesso
            </PlatformSubmitButton>
          </form>
          <p className={styles.note}>
            O proprietário e os administradores de cada construtora continuam gerenciando sua
            equipe normalmente em Sistema → Usuários. Isso não dá acesso à administração global.
          </p>
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <span>03 · Visão geral</span>
          <h2>Construtoras cadastradas</h2>
          <p>Selecione uma empresa para conferir as pessoas e os convites vinculados a ela.</p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>
              <th>Construtora</th><th>Proprietário</th><th>Obras</th><th>Usuários</th><th>Status</th><th>Desde</th>
            </tr></thead>
            <tbody>
              {environments.map((company) => (
                <tr key={company.company_id} className={selectedCompany?.company_id === company.company_id ? styles.selected : undefined}>
                  <td><Link className={styles.name} href={`/plataforma/ambientes?company=${company.company_id}`}>
                    {company.company_name}
                  </Link><span className={styles.muted}>{company.company_slug}</span></td>
                  <td>{company.owner_email || "—"}</td>
                  <td>{Number(company.project_count || 0)}</td>
                  <td>{Number(company.member_count || 0)}</td>
                  <td><span className={company.company_status === "active" ? styles.active : styles.inactive}>
                    {company.company_status === "active" ? "Ativa" : "Inativa"}
                  </span></td>
                  <td className={styles.muted}>{dateBR(company.created_at)}</td>
                </tr>
              ))}
              {!environments.length ? <tr><td colSpan={6} className={styles.empty}>Nenhuma construtora cadastrada.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCompany ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>04 · Acessos vinculados</span>
            <h2>Equipe de {selectedCompany.company_name}</h2>
            <p>Confirme quem já ativou a conta e quais convites ainda aguardam aceitação.</p>
          </div>
          {memberError ? <div className={`${styles.message} ${styles.error}`}>Lista indisponível. Aplique a migration de convites.</div> : null}
          <form className={styles.filter} method="get" action="/plataforma/ambientes">
            <label htmlFor="admin-company-filter">Consultar empresa</label>
            <select id="admin-company-filter" name="company" defaultValue={selectedCompany.company_id}>
              {environments.map((company) => <option key={company.company_id} value={company.company_id}>{company.company_name}</option>)}
            </select>
            <button type="submit">Ver acessos</button>
          </form>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Usuário</th><th>Perfil</th><th>Convite / conta</th><th>Vínculo</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.membership_id}>
                    <td><strong>{member.full_name || member.email}</strong><span className={styles.muted}>{member.email}</span></td>
                    <td>{member.role_name}</td>
                    <td><span className={member.email_confirmed ? styles.active : styles.pending}>
                      {member.email_confirmed ? "Conta confirmada" : "Convite pendente"}
                    </span></td>
                    <td>{member.membership_status === "active" ? "Ativo" : member.membership_status}</td>
                  </tr>
                ))}
                {!members.length ? <tr><td colSpan={4} className={styles.empty}>Nenhum usuário nesta página.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>{totalMembers} usuário(s) vinculados · página {memberPage}</span>
            <div>
              {memberPage > 1 ? <Link href={companyLink(memberPage - 1)}>Anterior</Link> : null}
              {memberPage * pageSize < totalMembers ? <Link href={companyLink(memberPage + 1)}>Próxima</Link> : null}
            </div>
          </div>
        </section>
      ) : null}
      <p className={styles.footer}>
        Esta área não aparece no menu dos clientes. Cada operação é autorizada novamente no
        Supabase e o histórico de concessões de acesso é auditado.
      </p>
    </AppShell>
  );
}
