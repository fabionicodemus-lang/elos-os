"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function compactBRL(value: number) {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000) {
    return `${Math.round(value / 1_000_000).toLocaleString("pt-BR")}M`;
  }

  if (absolute >= 100_000) {
    return `${Math.round(value / 1_000).toLocaleString("pt-BR")}k`;
  }

  if (absolute >= 1_000) {
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value / 1_000)}k`;
  }

  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function valueFromTitle(title: string) {
  const match = title.match(/R\$[\s\u00a0]*([\d.]+(?:,\d+)?)/);
  if (!match) return null;

  const value = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function applyLabels() {
  let applied = 0;

  document.querySelectorAll<HTMLElement>(".curves-bars > div > span[title]").forEach((bar) => {
    const value = valueFromTitle(bar.getAttribute("title") ?? "");
    if (value === null) return;

    let label = bar.querySelector<HTMLElement>(":scope > .curves-bar-value");
    if (!label) {
      label = document.createElement("b");
      label.className = "curves-bar-value";
      label.setAttribute("aria-hidden", "true");
      bar.appendChild(label);
    }

    const compactValue = compactBRL(value);
    if (label.textContent !== compactValue) label.textContent = compactValue;
    applied += 1;
  });

  return applied;
}

export function CurvesBarValues() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/engenharia/curvas") return;

    let cancelled = false;
    let attempts = 0;
    let timeout: number | undefined;

    const run = () => {
      if (cancelled) return;
      const applied = applyLabels();
      attempts += 1;

      // A página pode chegar em partes pelo streaming do Next.js. Fazemos
      // poucas tentativas e paramos, sem manter um observador global ativo.
      if (applied === 0 && attempts < 20) {
        timeout = window.setTimeout(run, 100);
      }
    };

    const frame = window.requestAnimationFrame(run);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [pathname]);

  return null;
}
