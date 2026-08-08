"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SearchResult = {
  id: string;
  kind: string;
  group: string;
  icon: string;
  title: string;
  subtitle: string;
  meta?: string;
  href: string;
  projectId?: string | null;
  projectName?: string | null;
};

type SearchResponse = {
  results?: SearchResult[];
  total?: number;
  query?: string;
  scope?: "project" | "company";
};

const RECENT_KEY = "elos_global_search_recent_v1";
const RECENT_LIMIT = 6;

function readRecent(): SearchResult[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SearchResult => Boolean(item) && typeof item === "object" && typeof item.id === "string" && typeof item.href === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecent(result: SearchResult) {
  if (typeof window === "undefined") return;
  const next = [result, ...readRecent().filter((item) => item.id !== result.id)].slice(0, RECENT_LIMIT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function GlobalSearch({
  activeProjectId,
  activeProjectName,
}: {
  activeProjectId: string | null;
  activeProjectName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"project" | "company">(activeProjectId ? "project" : "company");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTerm = query.trim();
  const searching = open && searchTerm.length >= 2;
  // Só há "carregando" enquanto uma busca válida está em andamento: se o termo
  // encurtar durante a requisição, o spinner some sem depender do efeito.
  const busy = searching && loading;

  // Cada novo termo reinicia destaque e erro. Ajustar no render evita os
  // setState síncronos dentro do efeito, que disparavam renders em cascata.
  const searchKey = `${searching ? "on" : "off"} ${scope} ${searchTerm}`;
  const [syncedSearchKey, setSyncedSearchKey] = useState(searchKey);

  if (syncedSearchKey !== searchKey) {
    setSyncedSearchKey(searchKey);
    setActiveIndex(0);
    setError("");
  }

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setError("");
    setActiveIndex(0);
  }, []);

  const show = useCallback(() => {
    setRecent(readRecent());
    setScope(activeProjectId ? "project" : "company");
    setOpen(true);
  }, [activeProjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close(); else show();
        return;
      }
      if (!open && event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        show();
        return;
      }
      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, show]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!searching) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: searchTerm, scope });
        const response = await fetch(`/api/global-search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Não foi possível consultar o Elos OS.");
        const payload = await response.json() as SearchResponse;
        setResults(payload.results ?? []);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(requestError instanceof Error ? requestError.message : "Falha inesperada na busca.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searching, searchTerm, scope]);

  const visibleItems = searching ? results : recent;
  const groups = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const result of visibleItems) {
      map.set(result.group, [...(map.get(result.group) ?? []), result]);
    }
    return [...map.entries()];
  }, [visibleItems]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openResult = useCallback((result: SearchResult) => {
    saveRecent(result);
    window.location.assign(result.href);
  }, []);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!visibleItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + visibleItems.length) % visibleItems.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = visibleItems[activeIndex];
      if (selected) openResult(selected);
    }
  }

  let flatIndex = -1;

  return (
    <>
      <button className="elos-search-button" type="button" title="Buscar no Elos OS · Ctrl K" aria-label="Buscar no Elos OS" onClick={show}>
        <span aria-hidden="true">⌕</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open ? (
        <div className="global-search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Busca global do Elos OS">
            <header className="global-search-header">
              <span className="global-search-symbol" aria-hidden="true">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Buscar cliente, unidade, proposta, contrato, documento..."
                aria-label="Termo da busca global"
                autoComplete="off"
                spellCheck={false}
              />
              {busy ? <span className="global-search-spinner" aria-label="Buscando" /> : null}
              {query ? <button type="button" className="global-search-clear" onClick={() => setQuery("")} aria-label="Limpar busca">×</button> : null}
              <button type="button" className="global-search-close" onClick={close} aria-label="Fechar busca">Esc</button>
            </header>

            <div className="global-search-scope" role="group" aria-label="Escopo da busca">
              <button
                type="button"
                className={scope === "project" ? "active" : ""}
                disabled={!activeProjectId}
                onClick={() => setScope("project")}
              >
                <span>Obra atual</span>
                <small>{activeProjectName || "Nenhuma obra selecionada"}</small>
              </button>
              <button type="button" className={scope === "company" ? "active" : ""} onClick={() => setScope("company")}>
                <span>Toda a empresa</span>
                <small>Inclui todos os empreendimentos</small>
              </button>
            </div>

            <div className="global-search-body" ref={listRef}>
              {query.trim().length < 2 && !recent.length ? (
                <div className="global-search-empty global-search-intro">
                  <strong>Encontre qualquer registro do Elos OS</strong>
                  <p>Digite ao menos dois caracteres. A busca respeita suas permissões e o escopo selecionado.</p>
                  <div><span>Clientes</span><span>Unidades</span><span>Propostas</span><span>Contratos</span><span>Documentos</span></div>
                </div>
              ) : null}

              {query.trim().length < 2 && recent.length ? (
                <div className="global-search-section-title"><span>Recentes neste dispositivo</span><button type="button" onClick={() => { window.localStorage.removeItem(RECENT_KEY); setRecent([]); }}>Limpar</button></div>
              ) : null}

              {error ? <div className="global-search-empty error"><strong>Busca indisponível</strong><p>{error}</p></div> : null}

              {!busy && !error && searching && !results.length ? (
                <div className="global-search-empty"><strong>Nenhum resultado encontrado</strong><p>Tente pelo número, código, nome, documento, unidade ou uma parte da descrição.</p></div>
              ) : null}

              {!error ? groups.map(([group, items]) => (
                <section className="global-search-group" key={group}>
                  <h3>{group}<span>{items.length}</span></h3>
                  <div>
                    {items.map((result) => {
                      flatIndex += 1;
                      const index = flatIndex;
                      return (
                        <button
                          type="button"
                          key={result.id}
                          data-search-index={index}
                          className={index === activeIndex ? "active" : ""}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => openResult(result)}
                        >
                          <span className="global-search-result-icon" aria-hidden="true">{result.icon}</span>
                          <span className="global-search-result-copy">
                            <strong>{result.title}</strong>
                            <small>{result.subtitle}</small>
                            {result.meta ? <em>{result.meta}</em> : null}
                          </span>
                          {result.projectName ? <span className="global-search-project">{result.projectName}</span> : null}
                          <span className="global-search-arrow" aria-hidden="true">↗</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )) : null}
            </div>

            <footer className="global-search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
              <span><kbd>Enter</kbd> abrir</span>
              <span><kbd>Esc</kbd> fechar</span>
              <strong>{searching ? `${results.length} resultado(s)` : "Busca global"}</strong>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
