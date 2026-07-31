import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Bossa CRM | Elos Engenharia",
  description:
    "Plataforma SaaS desenvolvida e operada pela Elos Engenharia para atendimento e gestão comercial integrada ao WhatsApp Business.",
};

const features = [
  {
    icon: "◉",
    title: "Atendimento centralizado",
    text: "Reúne conversas de clientes e corretores, histórico, leads, tarefas e acompanhamento comercial em uma única plataforma.",
  },
  {
    icon: "↔",
    title: "WhatsApp Business integrado",
    text: "Conecta números autorizados pela empresa às APIs oficiais da Meta, mantendo o atendimento organizado e rastreável.",
  },
  {
    icon: "✦",
    title: "Automação supervisionada",
    text: "Nara e Plantão auxiliam no primeiro atendimento, enquanto a equipe pode assumir, revisar ou pausar a automação a qualquer momento.",
  },
  {
    icon: "✓",
    title: "Modelos e transmissões",
    text: "Permite gerenciar modelos aprovados pela Meta e realizar comunicações autorizadas com controle de status e histórico.",
  },
];

const securityItems = [
  "Acesso individual por usuário e permissões conforme a função.",
  "Segregação dos dados por organização no banco de dados.",
  "Tokens do WhatsApp criptografados e processados somente no servidor.",
  "Uso dos dados restrito ao atendimento e à gestão comercial autorizada.",
  "O Bossa CRM não vende dados pessoais nem os utiliza para publicidade de terceiros.",
  "Solicitações de acesso, correção ou exclusão podem ser feitas pelos canais informados nesta página.",
];

export default function BossaCrmPublicPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/bossa-crm" aria-label="Bossa CRM">
          <span className={styles.mark}>B.</span>
          <span>
            <span className={styles.brandTitle}>
              bossa<span>.</span>crm
            </span>
            <span className={styles.brandSub}>Produto tecnológico da Elos Engenharia</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Navegação principal">
          <Link href="/bossa-crm/legal/privacidade">Privacidade</Link>
          <a className={styles.login} href="https://bossa-crm-phi.vercel.app/login">
            Acessar o sistema
          </a>
        </nav>
      </header>

      <section className={styles.hero}>
        <span className={styles.eyebrow}>Plataforma SaaS de atendimento comercial</span>
        <h1>Relacionamento imobiliário conectado ao WhatsApp Business.</h1>
        <p className={styles.lead}>
          O Bossa CRM é desenvolvido e operado pela Elos Engenharia para centralizar conversas,
          organizar oportunidades e apoiar equipes comerciais no atendimento de clientes e corretores.
        </p>
        <div className={styles.actions}>
          <a className={styles.primary} href="https://bossa-crm-phi.vercel.app/login">
            Entrar no Bossa CRM
          </a>
          <Link className={styles.secondary} href="/bossa-crm/legal/privacidade">
            Como tratamos os dados
          </Link>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.grid2} aria-label="Identidade da plataforma">
          <article className={styles.card}>
            <div className={styles.label}>Empresa responsável</div>
            <h2>Elos Engenharia</h2>
            <p>
              A Elos Engenharia desenvolve, mantém e opera o Bossa CRM como plataforma tecnológica
              de atendimento e gestão comercial. A empresa é responsável pela infraestrutura do sistema,
              integrações, segurança operacional e evolução do produto.
            </p>
          </article>

          <article className={styles.card}>
            <div className={styles.label}>Operação atual</div>
            <h2>Bossa Empreendimentos</h2>
            <p>
              A Bossa Empreendimentos utiliza a plataforma para organizar o relacionamento com clientes
              interessados em imóveis e com corretores parceiros. O acesso aos ativos empresariais ocorre
              somente após autorização de um administrador da própria empresa.
            </p>
          </article>
        </section>

        <section className={styles.sectionTitle}>
          <h2>O que a plataforma oferece</h2>
          <p>
            Recursos desenvolvidos para reduzir perdas de atendimento, preservar o histórico e permitir
            colaboração entre equipe humana e automação.
          </p>
        </section>

        <section className={styles.grid4} aria-label="Recursos do Bossa CRM">
          {features.map((feature) => (
            <article className={styles.card} key={feature.title}>
              <div className={styles.icon} aria-hidden="true">
                {feature.icon}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </section>

        <section className={styles.darkCard}>
          <div className={styles.label}>Integração oficial da Meta</div>
          <h2>Como usamos os dados da plataforma</h2>
          <p>
            O Bossa CRM utiliza as APIs oficiais da Meta somente para conectar e operar contas do
            WhatsApp Business expressamente autorizadas pelo administrador da empresa. Não acessamos
            portfólios, contas ou números que não tenham sido selecionados durante o processo de autorização.
          </p>

          <div className={styles.steps}>
            <div className={styles.step}>
              <strong>1. Autorização</strong>
              <span>O administrador escolhe o portfólio, a conta e o número do WhatsApp Business.</span>
            </div>
            <div className={styles.step}>
              <strong>2. Operação</strong>
              <span>O CRM recebe mensagens e status, envia respostas e utiliza modelos aprovados.</span>
            </div>
            <div className={styles.step}>
              <strong>3. Controle</strong>
              <span>A empresa acompanha o histórico, assume atendimentos e pode revogar a integração.</span>
            </div>
          </div>
        </section>

        <section className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.label}>Privacidade e segurança</div>
          <h2>Proteção aplicada à operação</h2>
          <p>
            Os dados são tratados para viabilizar o atendimento comercial autorizado, com controles
            técnicos e organizacionais compatíveis com a operação do sistema.
          </p>
          <div className={styles.securityGrid}>
            {securityItems.map((item) => (
              <div className={styles.securityItem} key={item}>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.contact}>
          <div>
            <div className={styles.label}>Contato</div>
            <h2>Fale com a empresa responsável</h2>
            <p>
              Dúvidas sobre a plataforma, privacidade, integração com a Meta ou solicitações relacionadas
              a dados podem ser enviadas para o contato administrativo da Elos Engenharia.
            </p>
          </div>
          <a className={styles.contactLink} href="mailto:fabio.nicodemus@gmail.com">
            fabio.nicodemus@gmail.com
          </a>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>© 2026 Elos Engenharia · Bossa CRM</span>
        <nav className={styles.footerNav} aria-label="Documentos legais">
          <Link href="/bossa-crm">Sobre</Link>
          <Link href="/bossa-crm/legal/privacidade">Política de Privacidade</Link>
          <Link href="/bossa-crm/legal/termos">Termos de Uso</Link>
          <Link href="/bossa-crm/legal/exclusao-de-dados">Exclusão de Dados</Link>
        </nav>
      </footer>
    </main>
  );
}
