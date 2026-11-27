"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { createIdleSession, idleSessionId } from "@/lib/auth/idle-session.mjs";
import { logoutInactiveSession } from "@/app/login/idle-actions";

export function IdleSessionBoundary({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(120);
  const continueSession = useRef<() => void>(() => {});

  useEffect(() => {
    const supabase = createClient();
    let controller: ReturnType<typeof createIdleSession> | null = null;
    let sessionId: string | null = null;
    let disposed = false;
    let expiring = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function expire(id: string) {
      if (expiring || disposed) return;
      expiring = true;
      setLocked(true);
      setWarning(false);
      await supabase.auth.stopAutoRefresh();
      try {
        const result = await logoutInactiveSession(id);
        if (!disposed) window.location.replace(result === "changed" ? "/dashboard" : "/login?expired=1");
      } catch {
        // Offline: keep all content hidden and retry when connectivity returns.
        // The expired marker survives reloads; activity cannot unlock it.
        expiring = false;
        if (!disposed) retry = setTimeout(() => { void expire(id); }, 5000);
      }
    }
    function check() {
      const state = controller?.check();
      if (!state || disposed) return;
      setWarning(state.warning);
      setRemaining(Math.ceil(state.remaining / 1000));
    }
    function activity(event?: Event) {
      if (event && !event.isTrusted) return;
      if (document.visibilityState !== "visible") return;
      controller?.activity();
      check();
    }
    continueSession.current = () => activity();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (disposed || expiring) return;
      const id = session ? idleSessionId(session.access_token) : null;
      if (id === sessionId) return; // Refresh/focus events never renew activity.
      if (sessionId) {
        setLocked(true);
        window.location.replace(id ? "/dashboard" : "/login");
        return;
      }
      sessionId = id;
      controller = null;
      setWarning(false);
      if (!id) return;
      const storage = {
        getItem: (key: string) => window.localStorage.getItem(key),
        setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
      };
      controller = createIdleSession({ sessionId: id, storage, onExpire: () => { void expire(id); } });
      check();
    });
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach(event => document.addEventListener(event, activity, { capture: true, passive: true }));
    // Focus is a check, never activity: returning after 30 minutes logs out.
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    const interval = setInterval(check, 1000);
    return () => {
      disposed = true;
      subscription.unsubscribe();
      clearInterval(interval);
      clearTimeout(retry);
      events.forEach(event => document.removeEventListener(event, activity, true));
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("storage", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return <>
    <div hidden={locked} inert={locked}>{children}</div>
    {locked ? <div className="idle-session-overlay" role="alert">
      <section className="idle-session-card"><h2>Acesso bloqueado</h2>
        <p>Estamos encerrando sua sessão por inatividade ou indisponibilidade do controle de sessão. Reconecte-se à internet se necessário e aguarde o retorno à tela de login.</p>
      </section>
    </div> : warning ? <aside className="idle-session-warning" role="alert" aria-label="Aviso de inatividade">
      <strong>Sua sessão será encerrada em {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}.</strong>
      <p>Salve o que estiver preenchendo. Alterações não salvas poderão ser perdidas.</p>
      <button className="elos-button" onClick={() => continueSession.current()}>Continuar conectado</button>
    </aside> : null}
  </>;
}
