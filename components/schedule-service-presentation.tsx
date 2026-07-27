"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const palette = [
  "#075985", "#C2410C", "#047857", "#A21CAF", "#6D28D9", "#B45309",
  "#1D4ED8", "#B91C1C", "#0F766E", "#4D7C0F", "#92400E", "#4338CA",
  "#BE185D", "#0369A1", "#7E22CE", "#C2410C", "#166534", "#6B21A8",
  "#9A3412", "#0E7490", "#9D174D", "#581C87", "#1E3A8A", "#3F6212",
  "#991B1B", "#155E75", "#374151", "#713F12", "#134E4A", "#7F1D1D",
];

const keywordAbbreviations: Array<[RegExp, string]> = [
  [/ALVENAR/i, "ALVEN"],
  [/REBOCO|EMBOCO/i, "REBOC"],
  [/GESSO/i, "GESSO"],
  [/PINTUR/i, "PINTU"],
  [/CONTRAPISO/i, "CONTR"],
  [/IMPERMEABIL/i, "IMPER"],
  [/ESQUADRI/i, "ESQUA"],
  [/ELETRIC|ELETRICA/i, "ELETR"],
  [/HIDRAUL/i, "HIDRA"],
  [/REVEST/i, "REVES"],
  [/ESTRUTUR/i, "ESTRU"],
  [/FUNDAC/i, "FUNDA"],
  [/PORCELAN/i, "PORCE"],
  [/CERAMIC/i, "CERAM"],
  [/FACHAD/i, "FACHA"],
  [/ELEVADOR/i, "ELEVA"],
  [/COBERTUR/i, "COBER"],
  [/PAISAG/i, "PAISA"],
  [/PISCIN/i, "PISCI"],
  [/CLIMAT|AR CONDIC/i, "CLIMA"],
  [/INCEND/i, "INCEN"],
  [/LIMPEZ/i, "LIMPE"],
  [/FORRO/i, "FORRO"],
  [/VIDRO|VIDRAC/i, "VIDRO"],
];

const assignedColors = new Map<string, string>();
let nextColorIndex = 0;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function serviceNameFromBar(bar: HTMLElement) {
  const title = (bar.getAttribute("title") ?? "").trim();
  if (!title) return "Serviço";

  const withoutDates = title
    .replace(/\s*·\s*\d{2}\/\d{2}\/\d{4}(?:\s+a\s+\d{2}\/\d{2}\/\d{4})?\s*$/i, "")
    .trim();

  if (bar.classList.contains("prevision-task-bar")) {
    const parts = withoutDates.split(" · ");
    if (parts.length > 1 && /^[A-Z0-9._/-]+$/i.test(parts[0])) {
      return parts.slice(1).join(" · ").trim() || "Serviço";
    }
  }

  return withoutDates || "Serviço";
}

function abbreviation(name: string) {
  const normalized = normalize(name);
  const preset = keywordAbbreviations.find(([pattern]) => pattern.test(normalized));
  if (preset) return preset[1];

  const ignored = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "EM", "PARA", "COM", "POR"]);
  const generic = new Set(["INSTALACAO", "INSTALACOES", "EXECUCAO", "SERVICO", "SERVICOS", "COLOCACAO", "APLICACAO"]);
  const words = normalized.split(" ").filter((word) => word && !ignored.has(word));
  if (!words.length) return "SERVI";
  if (generic.has(words[0]) && words[1]) return words[1].slice(0, 5).padEnd(5, words[1].slice(-1));
  if (words.length === 1) return words[0].slice(0, 5);
  return `${words[0].slice(0, 3)}${words[1].slice(0, 2)}`.slice(0, 5);
}

function colorFor(name: string) {
  const key = normalize(name);
  const existing = assignedColors.get(key);
  if (existing) return existing;

  const color = palette[nextColorIndex % palette.length];
  nextColorIndex += 1;
  assignedColors.set(key, color);
  return color;
}

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#17202a" : "#ffffff";
}

function buildLegend(root: HTMLElement, services: Map<string, { name: string; abbreviation: string; color: string }>) {
  const ganttView = root.querySelector<HTMLElement>(".prevision-gantt-view");
  const toolbar = ganttView?.querySelector<HTMLElement>(".prevision-toolbar");
  if (!ganttView || !toolbar) return;

  let legend = ganttView.querySelector<HTMLElement>(":scope > .prevision-service-legend");
  if (!legend) {
    legend = document.createElement("section");
    legend.className = "prevision-service-legend";
    toolbar.insertAdjacentElement("afterend", legend);
    ganttView.classList.add("has-service-legend");
  }

  const ordered = [...services.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const signature = ordered.map((service) => `${service.name}:${service.color}`).join("|");
  if (legend.dataset.signature === signature) return;
  legend.dataset.signature = signature;
  legend.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "Legenda dos serviços";
  legend.appendChild(title);

  const list = document.createElement("div");
  list.className = "prevision-service-legend-list";
  ordered.forEach((service) => {
    const item = document.createElement("span");
    item.className = "prevision-service-legend-item";
    item.title = service.name;

    const swatch = document.createElement("i");
    swatch.style.backgroundColor = service.color;

    const code = document.createElement("b");
    code.textContent = service.abbreviation;

    const name = document.createElement("em");
    name.textContent = service.name;

    item.append(swatch, code, name);
    list.appendChild(item);
  });
  legend.appendChild(list);
}

function applyPresentation(root: HTMLElement) {
  const bars = root.querySelectorAll<HTMLElement>(".prevision-summary-task-bar[title], .prevision-task-bar[title]");
  const services = new Map<string, { name: string; abbreviation: string; color: string }>();

  bars.forEach((bar) => {
    const name = serviceNameFromBar(bar);
    const key = normalize(name);
    const shortName = abbreviation(name);
    const color = colorFor(name);
    services.set(key, { name, abbreviation: shortName, color });

    bar.style.setProperty("--bar", color);
    bar.style.backgroundColor = color;
    bar.style.color = readableText(color);
    bar.dataset.serviceName = name;
    bar.dataset.serviceAbbreviation = shortName;

    if (bar.classList.contains("prevision-task-bar")) {
      const label = bar.querySelector<HTMLElement>(":scope > span");
      if (label && label.textContent !== shortName) label.textContent = shortName;
    } else if (bar.textContent !== shortName) {
      bar.textContent = shortName;
    }
  });

  buildLegend(root, services);
  const version = document.querySelector<HTMLElement>(".elos-module-version");
  if (version) version.textContent = "V0.32.2 · sistema integrado";
}

export function ScheduleServicePresentation() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/engenharia/cronograma") return;

    const root = document.querySelector<HTMLElement>(".prevision-workbench");
    if (!root) return;

    let frame = 0;
    const scheduleApply = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => applyPresentation(root));
    };

    scheduleApply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
