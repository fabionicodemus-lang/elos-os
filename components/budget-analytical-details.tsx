"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type CompositionInput = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
  coefficient: number;
  totalQuantity: number;
  unitPrice: number | null;
  serviceUnitCost: number | null;
  totalCost: number | null;
};

type BudgetCompositionItem = {
  budgetItemId: string;
  matchKey: string;
  serviceId: string | null;
  serviceHref: string | null;
  quantity: number;
  unit: string;
  inputs: CompositionInput[];
};

type PreparedBudgetRow = {
  row: HTMLTableRowElement;
  code: string;
  originalDescription: string;
  visibleDescription: string;
  descriptionElement: HTMLElement;
};

const categoryLabels: Record<CompositionInput["category"], string> = {
  material: "Material",
  labor: "Mão de obra",
  equipment: "Equipamento",
  service: "Serviço terceirizado",
  freight: "Frete",
  other: "Outro custo",
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function matchKey(code: string, description: string) {
  return `${normalize(code)}::${normalize(description)}`;
}

function cleanServiceName(value: string) {
  return value.replace(/^(?:(?:c[oó]pia)\s+de\s+)+/i, "").trim();
}

function cleanVisibleNote(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/(?:^|\s)(?:koper\s+)?(?:itembudgetid|fatheritemid|serviceid|compositionid|inputid)=/i.test(line))
    .join("\n")
    .trim();
}

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function decimal(value: number, digits = 6) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function appendTextCell(row: HTMLTableRowElement, value: string, strong = false) {
  const cell = document.createElement("td");
  const element = document.createElement(strong ? "strong" : "span");
  element.textContent = value;
  cell.appendChild(element);
  row.appendChild(cell);
}

function createDetailRow(item: BudgetCompositionItem, serviceCode: string, serviceDescription: string) {
  const detailRow = document.createElement("tr");
  detailRow.className = "budget-composition-detail-row";
  detailRow.dataset.budgetItemId = item.budgetItemId;

  const cell = document.createElement("td");
  cell.colSpan = 12;
  detailRow.appendChild(cell);

  const panel = document.createElement("div");
  panel.className = "budget-composition-detail-panel";
  cell.appendChild(panel);

  const header = document.createElement("header");
  const heading = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = `Composição para 1 ${item.unit}`;
  const title = document.createElement("strong");
  title.textContent = `${serviceCode} · ${serviceDescription}`;
  heading.append(eyebrow, title);
  header.appendChild(heading);

  if (item.serviceHref) {
    const editLink = document.createElement("a");
    editLink.href = item.serviceHref;
    editLink.textContent = "Editar serviço e composição";
    header.appendChild(editLink);
  }
  panel.appendChild(header);

  if (item.inputs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "budget-composition-detail-empty";
    const emptyTitle = document.createElement("strong");
    emptyTitle.textContent = item.serviceId
      ? "Este serviço ainda não possui insumos cadastrados."
      : "Este item ainda não está vinculado a um serviço da base técnica.";
    const emptyText = document.createElement("span");
    emptyText.textContent = "Abra o serviço para cadastrar materiais, mão de obra, equipamentos e coeficientes.";
    empty.append(emptyTitle, emptyText);
    if (item.serviceHref) {
      const link = document.createElement("a");
      link.href = item.serviceHref;
      link.textContent = "Montar composição";
      empty.appendChild(link);
    }
    panel.appendChild(empty);
    return detailRow;
  }

  const wrap = document.createElement("div");
  wrap.className = "registry-table-wrap budget-composition-inputs-wrap";
  const table = document.createElement("table");
  table.className = "registry-table budget-composition-inputs-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    "Insumo / mão de obra",
    "Natureza",
    "Un.",
    `Coef. por ${item.unit}`,
    "Quantidade total",
    "Preço unit.",
    `Custo por ${item.unit}`,
    "Custo total",
  ].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  item.inputs.forEach((input) => {
    const row = document.createElement("tr");
    const inputCell = document.createElement("td");
    const code = document.createElement("strong");
    code.textContent = input.code;
    const description = document.createElement("span");
    description.textContent = input.description;
    inputCell.append(code, description);
    row.appendChild(inputCell);

    const natureCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `budget-composition-category ${input.category}`;
    badge.textContent = categoryLabels[input.category];
    natureCell.appendChild(badge);
    row.appendChild(natureCell);

    appendTextCell(row, input.unit, true);
    appendTextCell(row, `${decimal(input.coefficient, 8)} ${input.unit}`);
    appendTextCell(row, `${decimal(input.totalQuantity)} ${input.unit}`, true);
    appendTextCell(row, money(input.unitPrice));
    appendTextCell(row, money(input.serviceUnitCost));
    appendTextCell(row, money(input.totalCost), true);
    body.appendChild(row);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  panel.appendChild(wrap);
  return detailRow;
}

export function BudgetAnalyticalDetails() {
  const pathname = usePathname();

  useEffect(() => {
    const match = pathname.match(/^\/engenharia\/orcamentos\/([^/]+)$/);
    if (!match) return;

    const budgetId = match[1];
    const tableCard = document.querySelector<HTMLElement>(".budget-table-card.budget-analytic-card");
    const table = tableCard?.querySelector<HTMLTableElement>(".budgets-items-table");
    if (!tableCard || !table) return;

    const controller = new AbortController();
    const insertedDetails: HTMLTableRowElement[] = [];
    const insertedLinks: Array<{ link: HTMLAnchorElement; original: HTMLElement }> = [];
    const restorePresentation: Array<() => void> = [];
    let toolbar: HTMLElement | null = null;
    let detailsVisible = new URLSearchParams(window.location.search).get("view") === "details";
    let matchedRows: Array<{ row: HTMLTableRowElement; item: BudgetCompositionItem; code: string; description: string }> = [];

    const preparedRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr"))
      .map((row): PreparedBudgetRow | null => {
        const cells = Array.from(row.children).filter((child): child is HTMLTableCellElement => child instanceof HTMLTableCellElement);
        if (cells.length !== 12) return null;

        const code = cells[0].textContent?.trim() ?? "";
        const descriptionElement = cells[1].querySelector<HTMLElement>("strong");
        if (!descriptionElement) return null;

        const originalDescription = descriptionElement.textContent?.trim() ?? "";
        const visibleDescription = cleanServiceName(originalDescription) || originalDescription;
        if (visibleDescription !== originalDescription) {
          descriptionElement.textContent = visibleDescription;
          restorePresentation.push(() => {
            descriptionElement.textContent = originalDescription;
          });
        }

        const editDescriptionInput = row.querySelector<HTMLInputElement>('input[name="description"]');
        if (editDescriptionInput && editDescriptionInput.value !== visibleDescription) {
          const originalValue = editDescriptionInput.value;
          const originalDefaultValue = editDescriptionInput.defaultValue;
          editDescriptionInput.value = visibleDescription;
          editDescriptionInput.defaultValue = visibleDescription;
          restorePresentation.push(() => {
            editDescriptionInput.value = originalValue;
            editDescriptionInput.defaultValue = originalDefaultValue;
          });
        }

        cells[1].querySelectorAll<HTMLElement>("span").forEach((noteElement) => {
          const originalText = noteElement.textContent ?? "";
          const originalHidden = noteElement.hidden;
          const visibleText = cleanVisibleNote(originalText);
          if (visibleText === originalText.trim()) return;

          if (visibleText) {
            noteElement.textContent = visibleText;
          } else {
            noteElement.hidden = true;
          }
          restorePresentation.push(() => {
            noteElement.textContent = originalText;
            noteElement.hidden = originalHidden;
          });
        });

        return {
          row,
          code,
          originalDescription,
          visibleDescription,
          descriptionElement,
        };
      })
      .filter((value): value is PreparedBudgetRow => Boolean(value));

    const removeDetails = () => {
      insertedDetails.splice(0).forEach((row) => row.remove());
    };

    const renderDetails = () => {
      removeDetails();
      if (!detailsVisible) return;
      matchedRows.forEach(({ row, item, code, description }) => {
        const detailRow = createDetailRow(item, code, description);
        row.insertAdjacentElement("afterend", detailRow);
        insertedDetails.push(detailRow);
      });
    };

    void fetch(`/api/engineering/budget-compositions/${encodeURIComponent(budgetId)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar as composições.");
        return response.json() as Promise<{ items: BudgetCompositionItem[] }>;
      })
      .then(({ items }) => {
        const itemQueues = new Map<string, BudgetCompositionItem[]>();
        items.forEach((item) => {
          const queue = itemQueues.get(item.matchKey) ?? [];
          queue.push(item);
          itemQueues.set(item.matchKey, queue);
        });

        matchedRows = preparedRows
          .map(({ row, code, originalDescription, visibleDescription, descriptionElement }) => {
            const queue = itemQueues.get(matchKey(code, originalDescription));
            const item = queue?.shift();
            if (!item) return null;

            if (item.serviceHref) {
              const link = document.createElement("a");
              link.className = "budget-service-edit-link";
              link.href = item.serviceHref;
              descriptionElement.replaceWith(link);
              link.appendChild(descriptionElement);
              insertedLinks.push({ link, original: descriptionElement });
            }

            return { row, item, code, description: visibleDescription };
          })
          .filter((value): value is { row: HTMLTableRowElement; item: BudgetCompositionItem; code: string; description: string } => Boolean(value));

        toolbar = document.createElement("section");
        toolbar.className = "budget-composition-toggle-card";
        const text = document.createElement("div");
        const label = document.createElement("span");
        label.textContent = "Detalhamento das composições";
        const heading = document.createElement("strong");
        heading.textContent = "Visualize os insumos e a mão de obra dentro de cada serviço";
        text.append(label, heading);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "elos-button budget-composition-toggle";
        const updateButton = () => {
          button.textContent = detailsVisible ? "Ocultar insumos" : "Ver insumos e mão de obra";
          button.setAttribute("aria-pressed", String(detailsVisible));
        };
        updateButton();
        button.addEventListener("click", () => {
          detailsVisible = !detailsVisible;
          const url = new URL(window.location.href);
          if (detailsVisible) url.searchParams.set("view", "details");
          else url.searchParams.delete("view");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          updateButton();
          renderDetails();
        });

        toolbar.append(text, button);
        tableCard.insertAdjacentElement("beforebegin", toolbar);
        renderDetails();
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
      });

    return () => {
      controller.abort();
      removeDetails();
      toolbar?.remove();
      insertedLinks.forEach(({ link, original }) => {
        if (link.isConnected) link.replaceWith(original);
      });
      restorePresentation.reverse().forEach((restore) => restore());
    };
  }, [pathname]);

  return null;
}
