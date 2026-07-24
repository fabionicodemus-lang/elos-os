"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function uniqueOptions(options: string[], initialValue: string) {
  const values = [...options, initialValue]
    .map((value) => value.trim())
    .filter(Boolean);
  const map = new Map<string, string>();
  values.forEach((value) => {
    const key = normalize(value);
    if (!map.has(key)) map.set(key, value);
  });
  return [...map.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

type Entry =
  | { type: "option"; value: string }
  | { type: "create"; value: string };

export function CreatableCombobox({
  name,
  options,
  initialValue = "",
  placeholder,
  required = false,
  createLabel = "Criar nova opção",
  emptyLabel = "Nenhuma opção encontrada",
}: {
  name: string;
  options: string[];
  initialValue?: string | null;
  placeholder?: string;
  required?: boolean;
  createLabel?: string;
  emptyLabel?: string;
}) {
  const cleanInitialValue = initialValue?.trim() ?? "";
  const allOptions = useMemo(
    () => uniqueOptions(options, cleanInitialValue),
    [options, cleanInitialValue],
  );
  const [query, setQuery] = useState(cleanInitialValue);
  const [selectedValue, setSelectedValue] = useState(cleanInitialValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selectedValue);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedValue]);

  const normalizedQuery = normalize(query);
  const filteredOptions = allOptions.filter((option) =>
    normalize(option).includes(normalizedQuery),
  );
  const exactOption = allOptions.find(
    (option) => normalize(option) === normalizedQuery,
  );
  const canCreate = Boolean(query.trim()) && !exactOption;
  const entries: Entry[] = [
    ...filteredOptions.map((value): Entry => ({ type: "option", value })),
    ...(canCreate ? [{ type: "create", value: query.trim() } as Entry] : []),
  ];

  function select(entry: Entry) {
    setSelectedValue(entry.value);
    setQuery(entry.value);
    setOpen(false);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleChange(value: string) {
    setQuery(value);
    const exact = allOptions.find((option) => normalize(option) === normalize(value));
    setSelectedValue(exact ?? "");
    setOpen(true);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
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
      select(entries[activeIndex] ?? entries[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery(selectedValue);
    } else if (event.key === "Tab" && !selectedValue && exactOption) {
      setSelectedValue(exactOption);
      setQuery(exactOption);
    }
  }

  const showList = open && (entries.length > 0 || Boolean(normalizedQuery));

  return (
    <div ref={rootRef} className="creatable-combobox">
      <input type="hidden" name={name} value={selectedValue} />
      <div className="creatable-combobox-control">
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          required={required}
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
                setQuery(selectedValue);
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
          {entries.map((entry, index) => (
            <button
              id={`${listId}-${index}`}
              key={`${entry.type}-${entry.value}`}
              type="button"
              role="option"
              aria-selected={entry.type === "option" && normalize(entry.value) === normalize(selectedValue)}
              className={`creatable-combobox-option ${index === activeIndex ? "active" : ""} ${entry.type === "create" ? "create" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(entry)}
            >
              {entry.type === "create" ? (
                <><strong>＋ {createLabel}</strong><span>“{entry.value}”</span></>
              ) : (
                <><span>{entry.value}</span>{normalize(entry.value) === normalize(selectedValue) ? <b>✓</b> : null}</>
              )}
            </button>
          ))}
          {entries.length === 0 ? <div className="creatable-combobox-empty">{emptyLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
