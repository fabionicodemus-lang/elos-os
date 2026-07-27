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
  const match = title.match(/R\$\s*([\d.]+(?:,\d+)?)/);
  if (!match) return null;

  const value = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function applyLabels() {
  document.querySelectorAll<HTMLElement>(".curves-bars > div > span[title]").forEach((bar) => {
    const value = valueFromTitle(bar.getAttribute("title") ?? "");
    if (value === null) return;

    let label = bar.querySelector<HTMLElement>(":scope > .curves-bar-value");
    if (!label) {
      label = document.createElement("b");
      label.className = "curves-bar-value";
      bar.appendChild(label);
    }

    label.textContent = compactBRL(value);
    label.setAttribute("aria-hidden", "true");
  });
}

export function CurvesBarValues() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/engenharia/curvas") return;

    const frame = window.requestAnimationFrame(applyLabels);
    const observer = new MutationObserver(applyLabels);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
