import { requestPasswordReset, signup, updatePassword } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    recovery?: string;
    from?: string;
  }>;
}) {
  const params = await searchParams;
  const recovery = params.recovery === "1";
  const fromCrm = params.from === "crm";

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo">E</div>
        <div>
          <span className="auth-kicker">Sistema integrado de obras</span>
          <h1>Elos OS</h1>
          <p>
            Engenharia, execução, financeiro e comercial em um único ambiente seguro.
          </p>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-header">
          <span>Acesso seguro</span>
          <h2>{recovery ? "Definir nova senha" : fromCrm ? "Acesso ao Elos CRM" : "Entrar no Elos OS"}</h2>
          <p>
            {recovery
              ? "Crie uma nova senha para seu acesso."
              : fromCrm
                ? "O CRM agora usa o mesmo acesso do Elos OS."
                : "Use seu e-mail corporativo para acessar a plataforma."}
          </p>
        </div>

        {params.error ? <div className="auth-message error">{params.error}</div> : null}
        {params.success ? <div className="auth-message success">{params.success}</div> : null}

        {recovery ? (
          <form className="auth-form" action={updatePassword}>
            <label>
              Nova senha
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <label>
              Confirmar nova senha
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <button className="auth-primary" type="submit">
              Salvar nova senha
            </button>
          </form>
        ) : (
          <form className="auth-form" action="/api/auth/login" method="post">
            <label>
              E-mail
              <input name="email" type="email" autoComplete="email" required />
            </label>

            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                required
              />
            </label>

            <button className="auth-primary" type="submit">
              Entrar
            </button>
            <button className="auth-secondary" formAction={requestPasswordReset} formNoValidate>
              Esqueci minha senha
            </button>
            {!fromCrm ? (
              <button className="auth-secondary" formAction={signup}>
                Criar meu acesso
              </button>
            ) : null}
          </form>
        )}

        <small>
          {fromCrm
            ? "Se você usava uma senha diferente no CRM antigo, redefina sua senha aqui."
            : "A confirmação por e-mail deve estar habilitada no projeto Supabase."}
        </small>
      </section>
    </main>
  );
}
