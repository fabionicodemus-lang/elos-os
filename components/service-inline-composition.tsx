"use client";

import { useEffect } from "react";

const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,form,details,summary,label,[role='dialog']";

export function ServiceInlineComposition() {
  useEffect(() => {
    if (window.location.pathname !== "/engenharia/servicos") return;

    const table = document.querySelector<HTMLTableElement>(".merged-services-table");
    const detail = document.querySelector<HTMLElement>(".merged-service-detail");
    if (!table || !detail) return;

    const selectedServiceId = new URLSearchParams(window.location.search).get("service");
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr"));
    const cleanups: Array<() => void> = [];

    rows.forEach((row) => {
      const actionLink = row.querySelector<HTMLAnchorElement>(".composition-open-action");
      if (!actionLink) return;

      const openUrl = new URL(actionLink.href, window.location.href);
      const serviceId = openUrl.searchParams.get("service");
      if (!serviceId) return;

      row.id = `service-row-${serviceId}`;
      row.classList.add("service-clickable-row");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", String(selectedServiceId === serviceId));

      openUrl.hash = row.id;
      actionLink.href = `${openUrl.pathname}${openUrl.search}${openUrl.hash}`;

      if (selectedServiceId === serviceId) {
        const closeUrl = new URL(window.location.href);
        closeUrl.searchParams.delete("service");
        closeUrl.hash = row.id;
        actionLink.href = `${closeUrl.pathname}${closeUrl.search}${closeUrl.hash}`;
        actionLink.textContent = "Fechar";
        row.dataset.serviceHref = actionLink.href;
      } else {
        row.dataset.serviceHref = actionLink.href;
      }

      const navigate = (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) return;
        const href = row.dataset.serviceHref;
        if (href) window.location.assign(href);
      };

      const keyboardNavigate = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) return;
        event.preventDefault();
        const href = row.dataset.serviceHref;
        if (href) window.location.assign(href);
      };

      const navigateFromAction = (event: MouseEvent) => {
        event.preventDefault();
        window.location.assign(actionLink.href);
      };

      row.addEventListener("click", navigate);
      row.addEventListener("keydown", keyboardNavigate);
      actionLink.addEventListener("click", navigateFromAction);
      cleanups.push(() => {
        row.removeEventListener("click", navigate);
        row.removeEventListener("keydown", keyboardNavigate);
        actionLink.removeEventListener("click", navigateFromAction);
      });
    });

    if (!selectedServiceId) {
      rows.forEach((row) => {
        row.classList.remove("composition-service-selected");
        row.setAttribute("aria-expanded", "false");
      });
      detail.hidden = true;
      return () => cleanups.forEach((cleanup) => cleanup());
    }

    const selectedRow = document.getElementById(`service-row-${selectedServiceId}`) as HTMLTableRowElement | null;
    if (!selectedRow) {
      detail.hidden = true;
      return () => cleanups.forEach((cleanup) => cleanup());
    }

    const detailRow = document.createElement("tr");
    detailRow.className = "service-inline-composition-row";
    detailRow.setAttribute("aria-label", "Composição do serviço aberto");

    const detailCell = document.createElement("td");
    detailCell.colSpan = 9;
    detailCell.className = "service-inline-composition-cell";
    detailRow.appendChild(detailCell);

    detail.hidden = false;
    detailCell.appendChild(detail);
    selectedRow.insertAdjacentElement("afterend", detailRow);

    window.requestAnimationFrame(() => {
      selectedRow.scrollIntoView({ block: "nearest" });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
