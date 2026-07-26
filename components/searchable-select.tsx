"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  secondary?: string;
  disabled?: boolean;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function rank(option: SearchableSelectOption, normalizedQuery: string) {
  if (!normalizedQuery) return 3;
  const label = normalize(option.label);
  const searchable = normalize(`${option.label} ${option.keywords ?? ""} ${option.secondary ?? ""}`);
  if (label === normalizedQuery) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (searchable.includes(normalizedQuery)) return 2;
  return 9;
}

export function SearchableSelect({
  name,
  options,
  value,
  defaultValue = "",
  onValueChange,
  placeholder = "Digite para pesquisar",
  emptyLabel = "Nenhuma opção encontrada",
  clearLabel,
  required = false,
  autoFocus = false,
  maxResults = 80,
}: {
  name: string;
  options: SearchableSelectOption[];
  value?: string;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  clearLabel?: string;
  required?: boolean;
  autoFocus?: boolean;
  maxResults?: number;
}) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue?.trim() ?? "");
  const selectedValue = controlled ? value ?? "" : internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue) ?? null;
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) setQuery(selectedOption?.label ?? "");
  }, [selectedOption?.label, open]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selectedOption?.label ?? "");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedOption?.label]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      required && !selectedValue ? "Selecione uma opção da lista." : "",
    );
  }, [required, selectedValue]);

  const normalizedQuery = normalize(query);
  const matches = useMemo(() => options
    .filter((option) => !option.disabled && rank(option, normalizedQuery) < 9)
    .sort((a, b) => {
      const rankDifference = rank(a, normalizedQuery) - rank(b, normalizedQuery);
      return rankDifference || a.label.localeCompare(b.label, "pt-BR");
    }), [options, normalizedQuery]);
  const visibleOptions = matches.slice(0, maxResults);
  const entries = clearLabel && !required
    ? [{ value: "", label: clearLabel, secondary: "" } as SearchableSelectOption, ...visibleOptions]
    : visibleOptions;

  function commit(nextValue: string) {
    if (!controlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    const nextOption = options.find((option) => option.value === nextValue);
    setQuery(nextOption?.label ?? "");
    setOpen(false);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleChange(nextQuery: string) {
    setQuery(nextQuery);
    if (selectedValue) {
      if (!controlled) setInternalValue("");
      onValueChange?.("");
    }
    setOpen(true);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open && entries.length > 0) {
      event.preventDefault();
      commit((entries[activeIndex] ?? entries[0]).value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery(selectedOption?.label ?? "");
    }
  }

  const showList = open;

  return (
    <div ref={rootRef} className="creatable-combobox searchable-select">
      <input type="hidden" name={name} value={selectedValue} />
      <div className="creatable-combobox-control">
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && entries[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) {
                setOpen(false);
                setQuery(selectedOption?.label ?? "");
              }
            }, 100);
          }}
        />
        <button
          type="button"
          className="creatable-combobox-toggle"
          aria-label={open ? "Fechar opções" : "Abrir opções"}
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          ▾
        </button>
      </div>

      {showList ? (
        <div id={listId} className="creatable-combobox-list" role="listbox">
          {entries.map((option, index) => (
            <button
              id={`${listId}-${index}`}
              key={option.value || "__clear__"}
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              className={`creatable-combobox-option searchable-select-option ${index === activeIndex ? "active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option.value)}
            >
              <span className="searchable-select-option-content">
                <strong>{option.label}</strong>
                {option.secondary ? <small>{option.secondary}</small> : null}
              </span>
              {option.value === selectedValue ? <b>✓</b> : null}
            </button>
          ))}
          {entries.length === 0 ? <div className="creatable-combobox-empty">{emptyLabel}</div> : null}
          {matches.length > maxResults ? (
            <div className="searchable-select-more">Mais {matches.length - maxResults} resultado(s). Continue digitando para refinar.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
