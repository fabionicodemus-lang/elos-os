"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AcceptInviteForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    let active = true;
    async function prepareSession() {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const query = new URLSearchParams(window.location.search);
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        const tokenHash = query.get("token_hash");
        const code = query.get("code");
        let sessionError: Error | null = null;

        if (!accessToken && !tokenHash && !code) {
          throw new Error("Link sem código de convite.");
        }

        if (accessToken && refreshToken) {
          const { error: exchangeError } = await supabase.auth.setSession({
            access_token: accessToken, refresh_token: refreshToken,
          });
          sessionError = exchangeError;
        } else if (tokenHash && query.get("type") === "invite") {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash, type: "invite",
          });
          sessionError = verifyError;
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          sessionError = exchangeError;
        }

        // O token não deve permanecer no histórico após a tentativa de autenticação.
        if (accessToken || refreshToken || tokenHash || code) {
          window.history.replaceState({}, "", "/convite");
        }
        if (sessionError) throw sessionError;
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) throw userError || new Error("Sessão não encontrada.");
        if (active) setReady(true);
      } catch {
        if (active) setError("Convite inválido ou expirado. Solicite um novo convite ao administrador do Elos OS.");
      }
    }
    void prepareSession();
    return () => { active = false; };
  }, [supabase]);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    if (password.length < 8) {
      setError("Sua senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não conferem.");
      return;
    }
    setWorking(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Não foi possível definir a senha. Tente novamente ou solicite outro convite.");
      setWorking(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login?success=Senha%20definida.%20Entre%20com%20seu%20e-mail%20e%20sua%20nova%20senha.");
  }

  if (!ready && !error) {
    return <p aria-live="polite">Validando seu convite...</p>;
  }

  return (
    <>
      {error ? <div className="auth-message error" role="alert">{error}</div> : null}
      {ready ? (
        <form className="auth-form" onSubmit={savePassword}>
          <label>Nova senha
            <input type="password" autoComplete="new-password" minLength={8} required
              value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>Confirmar senha
            <input type="password" autoComplete="new-password" minLength={8} required
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <button className="auth-primary" type="submit" disabled={working}>
            {working ? "Salvando..." : "Definir senha e acessar"}
          </button>
        </form>
      ) : (
        <a className="auth-secondary" href="/login">Voltar para o login</a>
      )}
    </>
  );
}
