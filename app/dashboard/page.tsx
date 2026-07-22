import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "Usuário autenticado";

  return (
    <main className="protected-page">
      <aside className="protected-sidebar">
        <div className="protected-logo">E</div>
        <div>
          <strong>Elos OS</strong>
          <span>Fundação do sistema</span>
        </div>
      </aside>

      <section className="protected-content">
        <header className="protected-header">
          <div>
            <span>Ambiente protegido</span>
            <h1>Dashboard inicial</h1>
          </div>
          <form action={logout}>
            <button className="logout-button">Sair</button>
          </form>
        </header>

        <div className="welcome-card">
          <span>Sessão ativa</span>
          <h2>Bem-vindo ao Elos OS</h2>
          <p>
            Você entrou como <strong>{email}</strong>. A autenticação está funcionando e esta página só pode ser acessada por usuários logados.
          </p>
        </div>

        <div className="foundation-grid">
          <article>
            <span>01</span>
            <h3>Login</h3>
            <p>Entrada por e-mail e senha usando Supabase Auth.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Sessão protegida</h3>
            <p>Cookies são renovados no servidor pelo proxy do Next.js.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Próximo passo</h3>
            <p>Cadastro de empresas, usuários e seleção de ambiente.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
