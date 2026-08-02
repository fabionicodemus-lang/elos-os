import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBudgetRelationships } from "./budget-relationships.js";

test("summarizes budget item, composition and input relationships", () => {
  const summary = analyzeBudgetRelationships(
    [
      { koper_id: "1", payload: { itemAmount: 0 } },
      { koper_id: "2", payload: { compositionId: 10, serviceId: 20, itemAmount: 2, itemUnit: "m2" } },
      { koper_id: "3", payload: { inputId: 30, itemAmount: 1, itemUnit: "un" } },
      { koper_id: "4", payload: { serviceId: 21, itemAmount: 3, itemUnit: "m" } },
    ],
    [
      { koper_id: "10", payload: {} },
      { koper_id: "11", payload: {} },
    ],
    [
      { koper_id: "30", payload: {} },
      { koper_id: "31", payload: {} },
    ],
  );

  assert.deepEqual(summary, {
    budgetItems: 4,
    structuralItems: 1,
    leafItems: 3,
    itemsLinkedToComposition: 1,
    itemsLinkedToInput: 1,
    itemsLinkedToService: 2,
    itemsWithoutResourceLink: 1,
    referencedCompositions: 1,
    stagedCompositions: 2,
    missingReferencedCompositions: [],
    unreferencedStagedCompositions: 1,
    referencedInputs: 1,
    stagedInputs: 2,
    missingReferencedInputs: [],
    unreferencedStagedInputs: 1,
    compositionServiceLinks: 1,
  });
});

test("reports referenced records missing from staging", () => {
  const summary = analyzeBudgetRelationships(
    [{ koper_id: "1", payload: { compositionId: 99, inputId: 98, itemAmount: 1, itemUnit: "un" } }],
    [],
    [],
  );

  assert.deepEqual(summary.missingReferencedCompositions, ["99"]);
  assert.deepEqual(summary.missingReferencedInputs, ["98"]);
});
