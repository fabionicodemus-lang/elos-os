import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ModelDashboardPage from "./model-dashboard";
import { logout } from "./actions";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";
  const email = typeof authData.claims.email === "string" ? authData.claims.email : "seu e-mail";
  const { data: memberships, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);

  const schemaMissing = Boolean(
    membershipError &&
      (membershipError.code === "42P01" || membershipError.message.includes("company_memberships")),
  );

  if (!schemaMissing && !membershipError && (memberships ?? []).length === 0) {
    return (
      <main className="auth-page">
        <section className="auth-brand">
          <div className="auth-logo">E</div>
          <div>
            <span className="auth-kicker">Elos OS</span>
            <h1>Cadastro confirmado</h1>
            <p>
              Sua conta está pronta. Agora o proprietário ou administrador precisa liberar seu
              acesso a uma empresa do Elos OS.
            </p>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card-header">
            <span>Aguardando liberação</span>
            <h2>Você ainda não possui um ambiente</h2>
            <p>
              O cadastro de novas empresas é feito somente pela administração da plataforma.
              Usuários não podem criar ambientes por conta própria.
            </p>
          </div>

          <div className="auth-message success">Conta confirmada: {email}</div>
          <p>
            Informe este e-mail ao responsável pela empresa. Assim que o acesso for liberado,
            entre novamente para visualizar os módulos autorizados.
          </p>

          <form action={logout}>
            <button className="auth-secondary" type="submit">
              Sair e entrar com outra conta
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <ModelDashboardPage searchParams={searchParams} />;
}
