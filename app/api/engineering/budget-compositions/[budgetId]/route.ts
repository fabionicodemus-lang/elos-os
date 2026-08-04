import { NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type Budget = {
  id: string;
  company_id: string;
  project_id: string;
};

type BudgetItem = {
  id: string;
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  service_id: string | null;
  sort_order: number;
};

type Input = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
};

type BudgetComposition = {
  id: string;
  budget_item_id: string;
};

type BudgetCompositionRow = {
  id: string;
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
  unit_price: number;
};

type ServiceComposition = {
  id: string;
  service_id: string;
};

type ServiceCompositionRow = {
  id: string;
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
};

type Price = {
  input_id: string;
  project_id: string | null;
  final_unit_price: number;
  price_date: string;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function matchKey(code: string | null, description: string) {
  return `${normalize(code)}::${normalize(description)}`;
}

function itemHref(budgetId: string, budgetItemId: string) {
  return `/engenharia/orcamentos/${budgetId}/itens/${budgetItemId}`;
}

async function loadInputs(
  supabase: SupabaseClient,
  companyId: string,
  inputIds: string[],
) {
  if (inputIds.length === 0) return { data: [] as Input[], error: null };

  return fetchAllRows<Input>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_inputs")
      .select("id, code, description, unit, category")
      .eq("company_id", companyId)
      .in("id", inputIds)
      .range(from, to);
    return { data: (data ?? []) as Input[], error };
  });
}

async function loadBudgetSnapshots(
  supabase: SupabaseClient,
  budget: Budget,
  budgetItems: BudgetItem[],
  budgetId: string,
) {
  const headerResult = await fetchAllRows<BudgetComposition>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_budget_item_compositions")
      .select("id, budget_item_id")
      .eq("company_id", budget.company_id)
      .eq("budget_id", budgetId)
      .eq("status", "active")
      .range(from, to);
    return { data: (data ?? []) as BudgetComposition[], error };
  });

  if (headerResult.error) {
    return { items: null, error: headerResult.error };
  }

  const compositionIds = headerResult.data.map((composition) => composition.id);
  const rowsResult = compositionIds.length > 0
    ? await fetchAllRows<BudgetCompositionRow>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_budget_item_composition_items")
          .select("id, composition_id, input_id, effective_coefficient, unit_price")
          .eq("company_id", budget.company_id)
          .eq("status", "active")
          .in("composition_id", compositionIds)
          .order("sort_order")
          .range(from, to);
        return { data: (data ?? []) as BudgetCompositionRow[], error };
      })
    : { data: [] as BudgetCompositionRow[], error: null };

  if (rowsResult.error) return { items: null, error: rowsResult.error };

  const inputIds = [...new Set(rowsResult.data.map((row) => row.input_id))];
  const inputsResult = await loadInputs(supabase, budget.company_id, inputIds);
  if (inputsResult.error) return { items: null, error: inputsResult.error };

  const headerByBudgetItem = new Map(
    headerResult.data.map((composition) => [composition.budget_item_id, composition]),
  );
  const rowsByComposition = new Map<string, BudgetCompositionRow[]>();
  rowsResult.data.forEach((row) => {
    const current = rowsByComposition.get(row.composition_id) ?? [];
    current.push(row);
    rowsByComposition.set(row.composition_id, current);
  });
  const inputMap = new Map(inputsResult.data.map((input) => [input.id, input]));

  const items = budgetItems.map((budgetItem) => {
    const composition = headerByBudgetItem.get(budgetItem.id);
    const quantity = Number(budgetItem.quantity ?? 0);
    const rows = composition ? rowsByComposition.get(composition.id) ?? [] : [];

    return {
      budgetItemId: budgetItem.id,
      matchKey: matchKey(budgetItem.code, budgetItem.description),
      serviceId: budgetItem.service_id,
      serviceHref: itemHref(budgetId, budgetItem.id),
      quantity,
      unit: budgetItem.unit,
      inputs: rows.map((row) => {
        const input = inputMap.get(row.input_id);
        const coefficient = Number(row.effective_coefficient ?? 0);
        const unitPrice = Number(row.unit_price ?? 0);
        const totalQuantity = coefficient * quantity;
        return {
          id: row.id,
          code: input?.code ?? "—",
          description: input?.description ?? "Insumo indisponível",
          unit: input?.unit ?? "—",
          category: input?.category ?? "other",
          coefficient,
          totalQuantity,
          unitPrice,
          serviceUnitCost: coefficient * unitPrice,
          totalCost: totalQuantity * unitPrice,
        };
      }),
    };
  });

  return { items, error: null };
}

async function loadLegacyCompositions(
  supabase: SupabaseClient,
  budget: Budget,
  budgetItems: BudgetItem[],
  budgetId: string,
) {
  const serviceIds = [...new Set(
    budgetItems
      .map((item) => item.service_id)
      .filter((value): value is string => Boolean(value)),
  )];

  if (serviceIds.length === 0) {
    return budgetItems.map((item) => ({
      budgetItemId: item.id,
      matchKey: matchKey(item.code, item.description),
      serviceId: null,
      serviceHref: itemHref(budgetId, item.id),
      quantity: Number(item.quantity ?? 0),
      unit: item.unit,
      inputs: [],
    }));
  }

  const compositionsResult = await fetchAllRows<ServiceComposition>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_service_compositions")
      .select("id, service_id")
      .eq("company_id", budget.company_id)
      .eq("status", "active")
      .in("service_id", serviceIds)
      .range(from, to);
    return { data: (data ?? []) as ServiceComposition[], error };
  });

  if (compositionsResult.error) throw compositionsResult.error;

  const compositionIds = compositionsResult.data.map((composition) => composition.id);
  const rowsResult = compositionIds.length > 0
    ? await fetchAllRows<ServiceCompositionRow>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_service_composition_items")
          .select("id, composition_id, input_id, effective_coefficient")
          .eq("company_id", budget.company_id)
          .eq("status", "active")
          .in("composition_id", compositionIds)
          .range(from, to);
        return { data: (data ?? []) as ServiceCompositionRow[], error };
      })
    : { data: [] as ServiceCompositionRow[], error: null };

  if (rowsResult.error) throw rowsResult.error;

  const inputIds = [...new Set(rowsResult.data.map((row) => row.input_id))];
  const [inputsResult, pricesResult] = inputIds.length > 0
    ? await Promise.all([
        loadInputs(supabase, budget.company_id, inputIds),
        fetchAllRows<Price>(async (from, to) => {
          let query = supabase
            .from("engineering_input_prices")
            .select("input_id, project_id, final_unit_price, price_date")
            .eq("company_id", budget.company_id)
            .eq("status", "active")
            .eq("is_adopted", true)
            .in("input_id", inputIds)
            .order("price_date", { ascending: false });

          query = budget.project_id
            ? query.or(`project_id.eq.${budget.project_id},project_id.is.null`)
            : query.is("project_id", null);

          const { data, error } = await query.range(from, to);
          return { data: (data ?? []) as Price[], error };
        }),
      ])
    : [
        { data: [] as Input[], error: null },
        { data: [] as Price[], error: null },
      ];

  if (inputsResult.error || pricesResult.error) {
    throw inputsResult.error ?? pricesResult.error;
  }

  const compositionByService = new Map(
    compositionsResult.data.map((composition) => [composition.service_id, composition]),
  );
  const rowsByComposition = new Map<string, ServiceCompositionRow[]>();
  rowsResult.data.forEach((row) => {
    const current = rowsByComposition.get(row.composition_id) ?? [];
    current.push(row);
    rowsByComposition.set(row.composition_id, current);
  });
  const inputMap = new Map(inputsResult.data.map((input) => [input.id, input]));
  const corporatePrices = new Map<string, Price>();
  const projectPrices = new Map<string, Price>();
  pricesResult.data.forEach((price) => {
    if (budget.project_id && price.project_id === budget.project_id) {
      if (!projectPrices.has(price.input_id)) projectPrices.set(price.input_id, price);
    } else if (!price.project_id && !corporatePrices.has(price.input_id)) {
      corporatePrices.set(price.input_id, price);
    }
  });

  return budgetItems.map((budgetItem) => {
    const composition = budgetItem.service_id
      ? compositionByService.get(budgetItem.service_id)
      : undefined;
    const quantity = Number(budgetItem.quantity ?? 0);
    const rows = composition ? rowsByComposition.get(composition.id) ?? [] : [];

    return {
      budgetItemId: budgetItem.id,
      matchKey: matchKey(budgetItem.code, budgetItem.description),
      serviceId: budgetItem.service_id,
      serviceHref: itemHref(budgetId, budgetItem.id),
      quantity,
      unit: budgetItem.unit,
      inputs: rows.map((row) => {
        const input = inputMap.get(row.input_id);
        const coefficient = Number(row.effective_coefficient ?? 0);
        const price = projectPrices.get(row.input_id) ?? corporatePrices.get(row.input_id);
        const unitPrice = price ? Number(price.final_unit_price ?? 0) : null;
        const totalQuantity = coefficient * quantity;
        return {
          id: row.id,
          code: input?.code ?? "—",
          description: input?.description ?? "Insumo indisponível",
          unit: input?.unit ?? "—",
          category: input?.category ?? "other",
          coefficient,
          totalQuantity,
          unitPrice,
          serviceUnitCost: unitPrice == null ? null : coefficient * unitPrice,
          totalCost: unitPrice == null ? null : totalQuantity * unitPrice,
        };
      }),
    };
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ budgetId: string }> },
) {
  const { budgetId } = await context.params;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const userId = typeof authData?.claims?.sub === "string" ? authData.claims.sub : "";

  if (authError || !userId) {
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }

  const { data: budget, error: budgetError } = await supabase
    .from("engineering_budgets")
    .select("id, company_id, project_id")
    .eq("id", budgetId)
    .maybeSingle();

  if (budgetError || !budget) {
    return NextResponse.json({ error: "Revisão não localizada." }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", budget.company_id)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const budgetItemsResult = await fetchAllRows<BudgetItem>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_budget_items")
      .select("id, code, description, unit, quantity, service_id, sort_order")
      .eq("budget_id", budgetId)
      .eq("company_id", budget.company_id)
      .eq("status", "active")
      .order("sort_order")
      .order("description")
      .range(from, to);
    return { data: (data ?? []) as BudgetItem[], error };
  });

  if (budgetItemsResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar os serviços da revisão." }, { status: 500 });
  }

  const typedBudget = budget as Budget;
  const snapshotResult = await loadBudgetSnapshots(
    supabase,
    typedBudget,
    budgetItemsResult.data,
    budgetId,
  );

  if (!snapshotResult.error && snapshotResult.items) {
    return NextResponse.json({ items: snapshotResult.items });
  }

  const missingSnapshotSchema = snapshotResult.error?.code === "42P01"
    || snapshotResult.error?.message?.includes("engineering_budget_item_composition");

  if (!missingSnapshotSchema) {
    return NextResponse.json({ error: "Não foi possível carregar as composições desta revisão." }, { status: 500 });
  }

  try {
    const items = await loadLegacyCompositions(
      supabase,
      typedBudget,
      budgetItemsResult.data,
      budgetId,
    );
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar as composições dos serviços." }, { status: 500 });
  }
}
