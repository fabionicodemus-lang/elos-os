import { AcceptInviteForm } from "./accept-invite-form";

export default function InvitePage() {
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo">E</div>
        <div>
          <span className="auth-kicker">Bem-vindo à plataforma</span>
          <h1>Elos OS</h1>
          <p>Seu convite para uma gestão de obras conectada.</p>
        </div>
      </section>
      <section className="auth-card">
        <div className="auth-card-header">
          <span>Convite seguro</span>
          <h2>Defina sua senha</h2>
          <p>Use uma senha exclusiva. Seu acesso ficará vinculado somente à construtora que o convidou.</p>
        </div>
        <AcceptInviteForm />
      </section>
    </main>
  );
}
