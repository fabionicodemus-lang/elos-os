"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function eligible(select: HTMLSelectElement) {
  return !select.disabled
    && !select.multiple
    && select.options.length >= 8
    && select.dataset.nativeSelect !== "true";
}

export function GlobalSearchableSelect() {
  const [target, setTarget] = useState<HTMLSelectElement | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closePicker(restoreFocus = true) {
    const currentTarget = target;
    const dialog = dialogRef.current;

    if (dialog?.open) dialog.close();
    setTarget(null);

    if (restoreFocus && currentTarget?.isConnected) {
      window.setTimeout(() => currentTarget.focus(), 0);
    }
  }

  useEffect(() => {
    function open(select: HTMLSelectElement) {
      setTarget(select);
      setQuery("");
    }

    function handlePointerDown(event: PointerEvent) {
      const element = event.target instanceof Element ? event.target.closest("select") : null;
      if (!(element instanceof HTMLSelectElement) || !eligible(element)) return;
      event.preventDefault();
      event.stopPropagation();
      open(element);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.target instanceof HTMLSelectElement) || !eligible(event.target)) return;
      if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      open(event.target);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!target) {
      if (dialog.open) dialog.close();
      return;
    }

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        return;
      }
    }

    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [target]);

  const options = useMemo<SelectOption[]>(() => {
    if (!target) return [];
    return Array.from(target.options).map((option) => ({
      value: option.value,
      label: option.textContent?.trim() || option.label || option.value,
      disabled: option.disabled,
    }));
  }, [target]);

  const filtered = useMemo(() => {
    const term = normalize(query);
    const active = options.filter((option) => !option.disabled);
    if (!term) return active.slice(0, 100);
    return active
      .filter((option) => normalize(`${option.label} ${option.value}`).includes(term))
      .sort((a, b) => {
        const aLabel = normalize(a.label);
        const bLabel = normalize(b.label);
        const aRank = aLabel.startsWith(term) ? 0 : 1;
        const bRank = bLabel.startsWith(term) ? 0 : 1;
        return aRank - bRank || a.label.localeCompare(b.label, "pt-BR");
      })
      .slice(0, 100);
  }, [options, query]);

  function choose(option: SelectOption) {
    if (!target) return;
    const selectedTarget = target;
    selectedTarget.value = option.value;
    selectedTarget.dispatchEvent(new Event("input", { bubbles: true }));
    selectedTarget.dispatchEvent(new Event("change", { bubbles: true }));
    closePicker(false);
    window.setTimeout(() => selectedTarget.isConnected && selectedTarget.focus(), 0);
  }

  const totalMatches = target
    ? options.filter((option) => !option.disabled && normalize(`${option.label} ${option.value}`).includes(normalize(query))).length
    : 0;

  return (
    <dialog
      ref={dialogRef}
      className="global-select-dialog"
      aria-label="Pesquisar opção"
      onCancel={(event) => {
        event.preventDefault();
        closePicker();
      }}
      onClose={() => {
        if (target) setTarget(null);
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePicker();
      }}
    >
      {target ? (
        <section className="global-select-panel" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>Seleção pesquisável</span><strong>{target.closest("label")?.querySelector("span")?.textContent || "Escolha uma opção"}</strong></div>
            <button type="button" onClick={() => closePicker()} aria-label="Fechar">×</button>
          </header>
          <div className="global-select-search">
            <span>⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Digite código, nome ou parte da descrição"
              autoComplete="off"
            />
          </div>
          <div className="global-select-results" role="listbox">
            {filtered.map((option) => (
              <button
                key={`${option.value}-${option.label}`}
                type="button"
                role="option"
                aria-selected={option.value === target.value}
                className={option.value === target.value ? "selected" : ""}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.value === target.value ? <b>✓</b> : null}
              </button>
            ))}
            {filtered.length === 0 ? <div className="global-select-empty">Nenhuma opção contém o texto digitado.</div> : null}
          </div>
          <footer>
            <span>{totalMatches} resultado(s)</span>
            {totalMatches > 100 ? <small>Continue digitando para refinar a pesquisa.</small> : null}
          </footer>
        </section>
      ) : null}
    </dialog>
  );
}
