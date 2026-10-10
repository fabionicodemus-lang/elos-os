"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ElosIaMarkdown } from "./elos-ia-markdown";

export type ElosIaChatPersona = {
  key: string;
  label: string;
  tagline: string;
  pilotNote: string | null;
  suggestions: string[];
  sources: Array<{ label: string; available: boolean }>;
};

type Quota = {
  tracking: boolean;
  userTokensToday: number;
  dailyUserTokens: number;
  companyTokensMonth: number;
  monthlyCompanyTokens: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  consultas?: Array<{ nome: string; ok: boolean }>;
  tokens?: number;
};

type ChatResponse = {
  ok?: boolean;
  text?: string;
  error?: string;
  consultas?: Array<{ nome: string; ok: boolean }>;
  tokens?: number;
  quota?: Quota | null;
};

function tokenLabel(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR");
}

function uniqueSources(consultas: Array<{ nome: string; ok: boolean }>) {
  const map = new Map<string, boolean>();
  for (const consulta of consultas) map.set(consulta.nome, (map.get(consulta.nome) ?? true) && consulta.ok);
  return [...map.entries()].map(([nome, ok]) => ({ nome, ok }));
}

let messageCounter = 0;
const nextId = () => `m${Date.now()}-${(messageCounter += 1)}`;

export function ElosIaChat({
  personas,
  defaultPersona,
  configured,
  activeProjectLabel,
  initialQuota,
  maxQuestionChars,
}: {
  personas: ElosIaChatPersona[];
  defaultPersona: string;
  configured: boolean;
  activeProjectLabel: string | null;
  initialQuota: Quota;
  maxQuestionChars: number;
}) {
  const [personaKey, setPersonaKey] = useState(personas.some((item) => item.key === defaultPersona) ? defaultPersona : personas[0]?.key ?? "");
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [pendingPersona, setPendingPersona] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota>(initialQuota);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const persona = personas.find((item) => item.key === personaKey) ?? personas[0];
  const messages = threads[personaKey] ?? [];
  const waiting = pendingPersona === personaKey;
  const busy = pendingPersona !== null;
  const dailyUsedUp = quota.tracking && quota.dailyUserTokens > 0 && quota.userTokensToday >= quota.dailyUserTokens;
  const canType = configured && !dailyUsedUp;
  const dailyPercent = quota.dailyUserTokens > 0 ? Math.min(100, quota.userTokensToday / quota.dailyUserTokens * 100) : 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, waiting]);

  function append(key: string, message: ChatMessage) {
    setThreads((current) => ({ ...current, [key]: [...(current[key] ?? []), message] }));
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || !canType || !persona) return;
    const key = persona.key;
    const history = (threads[key] ?? []).filter((message) => !message.error).map(({ role, content }) => ({ role, content }));

    append(key, { id: nextId(), role: "user", content: question });
    setDraft("");
    setPendingPersona(key);

    try {
      const response = await fetch("/api/elos-ia/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: key, question, history }),
      });
      const payload = (await response.json().catch(() => null)) as ChatResponse | null;
      if (payload?.quota) setQuota(payload.quota);
      if (!response.ok || !payload?.ok || typeof payload.text !== "string") {
        append(key, { id: nextId(), role: "assistant", error: true, content: payload?.error ?? "O Elos IA não conseguiu responder agora. Tente novamente em instantes." });
      } else {
        append(key, { id: nextId(), role: "assistant", content: payload.text, consultas: payload.consultas ?? [], tokens: payload.tokens ?? 0 });
      }
    } catch {
      append(key, { id: nextId(), role: "assistant", error: true, content: "Sem conexão com o Elos OS. Confira a internet e tente de novo." });
    } finally {
      setPendingPersona(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  }

  if (!persona) return null;

  return (
    <div className="elos-ia">
      {!configured ? (
        <div className="auth-message error workspace-message">
          O Elos IA ainda não está ativo: falta cadastrar a chave da OpenAI (variável <strong>OPENAI_API_KEY</strong>) no projeto do Elos OS na Vercel.
        </div>
      ) : null}

      <div className="elos-ia-personas" role="tablist" aria-label="Persona do Elos IA">
        {personas.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === personaKey}
            className={`elos-ia-persona ${item.key === personaKey ? "active" : ""}`}
            onClick={() => setPersonaKey(item.key)}
          >
            <strong>{item.label}</strong>
            <span>{item.tagline}</span>
          </button>
        ))}
      </div>

      <section className="elos-ia-card" aria-label={`Conversa com a persona ${persona.label}`}>
        <header className="elos-ia-card-head">
          <div className="elos-ia-sources">
            <span className="elos-ia-sources-label">Consulta</span>
            {persona.sources.map((source) => (
              <span
                key={source.label}
                className={`elos-ia-chip ${source.available ? "" : "off"}`}
                title={source.available ? undefined : "Seu papel no Elos OS não tem permissão para esta consulta"}
              >
                {source.label}
              </span>
            ))}
          </div>
          {messages.length ? (
            <button type="button" className="elos-button" disabled={busy} onClick={() => setThreads((current) => ({ ...current, [personaKey]: [] }))}>
              Nova conversa
            </button>
          ) : null}
        </header>

        {persona.pilotNote ? <p className="elos-ia-note">{persona.pilotNote}</p> : null}

        <div className="elos-ia-messages" aria-live="polite">
          {!messages.length ? (
            <div className="elos-ia-empty">
              <h2>Pergunte sobre {activeProjectLabel ?? "as obras da empresa"}</h2>
              <p>
                A resposta usa só o que está lançado no Elos OS e termina com os próximos passos.
                {activeProjectLabel ? " Para outra obra, troque no seletor do cabeçalho ou cite o nome dela na pergunta." : " Selecione uma obra no cabeçalho para perguntas de cronograma e custos."}
              </p>
              <div className="elos-ia-suggestions">
                {persona.suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" disabled={busy || !canType} onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <article key={message.id} className={`elos-ia-message ${message.role} ${message.error ? "error" : ""}`}>
              {message.role === "assistant" && !message.error ? <ElosIaMarkdown text={message.content} /> : <p>{message.content}</p>}
              {message.role === "assistant" && !message.error ? (
                <footer>
                  {uniqueSources(message.consultas ?? []).length ? (
                    <>
                      <span>Consultou</span>
                      {uniqueSources(message.consultas ?? []).map((consulta) => (
                        <span key={consulta.nome} className={`elos-ia-chip ${consulta.ok ? "" : "off"}`} title={consulta.ok ? undefined : "Esta consulta não trouxe dados"}>
                          {consulta.nome}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span>Respondeu sem consultar dados</span>
                  )}
                  {message.tokens ? <span className="elos-ia-tokens">{tokenLabel(message.tokens)} tokens</span> : null}
                </footer>
              ) : null}
            </article>
          ))}

          {waiting ? (
            <article className="elos-ia-message assistant waiting">
              <p>Consultando o Elos OS<span className="elos-ia-dots" aria-hidden="true"><i /><i /><i /></span></p>
            </article>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form
          className="elos-ia-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, maxQuestionChars))}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={dailyUsedUp ? "Cota diária atingida. Ela é renovada à meia-noite." : `Pergunte como ${persona.label}…`}
            aria-label="Pergunta para o Elos IA"
            disabled={!canType}
          />
          <button type="submit" className="elos-button primary" disabled={!canType || busy || !draft.trim()}>
            {busy ? "Aguarde…" : "Enviar"}
          </button>
        </form>

        <footer className="elos-ia-card-foot">
          {quota.tracking ? (
            <div className="elos-ia-quota" title={`Empresa no mês: ${tokenLabel(quota.companyTokensMonth)} de ${tokenLabel(quota.monthlyCompanyTokens)} tokens`}>
              <span>Seu uso hoje: {tokenLabel(quota.userTokensToday)} de {tokenLabel(quota.dailyUserTokens)} tokens</span>
              <span className="elos-ia-quota-bar" aria-hidden="true"><i style={{ width: `${dailyPercent}%` }} /></span>
            </div>
          ) : (
            <span>Cota diária ainda não ativada: falta aplicar a atualização 0091 do banco.</span>
          )}
          <span>Enter envia · Shift + Enter quebra a linha</span>
        </footer>
      </section>
    </div>
  );
}
