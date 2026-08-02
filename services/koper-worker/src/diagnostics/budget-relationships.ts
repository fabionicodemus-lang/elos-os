export type BudgetRelationshipRow = {
  koper_id: string;
  payload: unknown;
};

export type BudgetRelationshipSummary = {
  budgetItems: number;
  structuralItems: number;
  leafItems: number;
  itemsLinkedToComposition: number;
  itemsLinkedToInput: number;
  itemsLinkedToService: number;
  itemsWithoutResourceLink: number;
  referencedCompositions: number;
  stagedCompositions: number;
  missingReferencedCompositions: string[];
  unreferencedStagedCompositions: number;
  referencedInputs: number;
  stagedInputs: number;
  missingReferencedInputs: string[];
  unreferencedStagedInputs: number;
  compositionServiceLinks: number;
};

function payloadObject(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function analyzeBudgetRelationships(
  budgetItems: BudgetRelationshipRow[],
  budgetCompositions: BudgetRelationshipRow[],
  budgetInputs: BudgetRelationshipRow[],
): BudgetRelationshipSummary {
  const compositionIds = new Set(budgetCompositions.map((row) => row.koper_id));
  const inputIds = new Set(budgetInputs.map((row) => row.koper_id));
  const referencedCompositions = new Set<string>();
  const referencedInputs = new Set<string>();
  const compositionServicePairs = new Set<string>();
  let structuralItems = 0;
  let itemsLinkedToComposition = 0;
  let itemsLinkedToInput = 0;
  let itemsLinkedToService = 0;
  let itemsWithoutResourceLink = 0;

  for (const row of budgetItems) {
    const payload = payloadObject(row.payload);
    const compositionId = identifier(payload.compositionId);
    const inputId = identifier(payload.inputId);
    const serviceId = identifier(payload.serviceId);
    const isStructural = (
      compositionId === null
      && inputId === null
      && serviceId === null
      && identifier(payload.itemUnit) === null
      && !positiveNumber(payload.itemAmount)
    );

    if (isStructural) {
      structuralItems += 1;
      continue;
    }

    if (compositionId) {
      referencedCompositions.add(compositionId);
      itemsLinkedToComposition += 1;
      if (serviceId) compositionServicePairs.add(`${compositionId}:${serviceId}`);
    }
    if (inputId) {
      referencedInputs.add(inputId);
      itemsLinkedToInput += 1;
    }
    if (serviceId) itemsLinkedToService += 1;
    if (!compositionId && !inputId) itemsWithoutResourceLink += 1;
  }

  const missingReferencedCompositions = [...referencedCompositions]
    .filter((id) => !compositionIds.has(id))
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const missingReferencedInputs = [...referencedInputs]
    .filter((id) => !inputIds.has(id))
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  return {
    budgetItems: budgetItems.length,
    structuralItems,
    leafItems: budgetItems.length - structuralItems,
    itemsLinkedToComposition,
    itemsLinkedToInput,
    itemsLinkedToService,
    itemsWithoutResourceLink,
    referencedCompositions: referencedCompositions.size,
    stagedCompositions: compositionIds.size,
    missingReferencedCompositions,
    unreferencedStagedCompositions: [...compositionIds]
      .filter((id) => !referencedCompositions.has(id)).length,
    referencedInputs: referencedInputs.size,
    stagedInputs: inputIds.size,
    missingReferencedInputs,
    unreferencedStagedInputs: [...inputIds]
      .filter((id) => !referencedInputs.has(id)).length,
    compositionServiceLinks: compositionServicePairs.size,
  };
}
