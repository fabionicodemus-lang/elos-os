"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function PreobraExactEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/engenharia/")) return;
    const forms = document.querySelectorAll<HTMLFormElement>(".preobra-filter-shell form");
    forms.forEach((form) => {
      const select = form.querySelector<HTMLSelectElement>('select[name="baseline"]');
      if (!select) return;
      form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="baseline"]').forEach((input) => {
        input.disabled = true;
      });
    });
  }, [pathname]);

  return null;
}
