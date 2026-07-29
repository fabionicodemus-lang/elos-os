"use client";

import { useEffect } from "react";

export function XmlImportOverlayFix() {
  useEffect(() => {
    const activate = (element: Element) => {
      if (!(element instanceof HTMLElement) || !element.matches(".xml-input-picker-popover")) return;
      element.setAttribute("popover", "manual");
      try {
        if (!element.matches(":popover-open")) element.showPopover();
      } catch {
        // Navegadores antigos continuam usando o posicionamento fixo normal.
      }
    };

    document.querySelectorAll(".xml-input-picker-popover").forEach(activate);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          activate(node);
          node.querySelectorAll(".xml-input-picker-popover").forEach(activate);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
