import { NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { createClient } from "@/lib/supabase/server";

type BudgetItem = {
  id: string;
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  service_id: string | null;
  sort_order: number;
};

type Service = {
  id: string;
  code: string;
  description: string;
};

type Composition = {
  id: string;
  service_id: string;
};

type CompositionItem = {
  id: string;
  composition_id: string;
  input_id: string;
  effective_coefficient: number;
};

type Input = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: "material" | "labor" | "equipment" | "service" | "freight" | "other";
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

  const budgetItems = budgetItemsResult.data;
  const serviceIds = [...new Set(budgetItems.map((item) => item.service_id).filter((value): value is string => Boolean(value)))];

  if (serviceIds.length === 0) {
    return NextResponse.json({ items: budgetItems.map((item) => ({
      budgetItemId: item.id,
      matchKey: matchKey(item.code, item.description),
      serviceId: null,
      serviceHref: null,
      quantity: Number(item.quantity ?? 0),
      unit: item.unit,
      inputs: [],
    })) });
  }

  const [servicesResult, compositionsResult] = await Promise.all([
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", budget.company_id)
        .in("id", serviceIds)
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<Composition>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_service_compositions")
        .select("id, service_id")
        .eq("company_id", budget.company_id)
        .eq("status", "active")
        .in("service_id", serviceIds)
        .range(from, to);
      return { data: (data ?? []) as Composition[], error };
    }),
  ]);

  if (servicesResult.error || compositionsResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar as composições dos serviços." }, { status: 500 });
  }

  const compositionIds = compositionsResult.data.map((composition) => composition.id);
  const compositionItemsResult = compositionIds.length > 0
    ? await fetchAllRows<CompositionItem>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_service_composition_items")
          .select("id, composition_id, input_id, effective_coefficient")
          .eq("company_id", budget.company_id)
          .eq("status", "active")
          .in("composition_id", compositionIds)
          .range(from, to);
        return { data: (data ?? []) as CompositionItem[], error };
      })
    : { data: [] as CompositionItem[], error: null };

  if (compositionItemsResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar os insumos das composições." }, { status: 500 });
  }

  const inputIds = [...new Set(compositionItemsResult.data.map((item) => item.input_id))];
  const [inputsResult, pricesResult] = inputIds.length > 0
    ? await Promise.all([
        fetchAllRows<Input>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_inputs")
            .select("id, code, description, unit, category")
            .eq("company_id", budget.company_id)
            .in("id", inputIds)
            .range(from, to);
          return { data: (data ?? []) as Input[], error };
        }),
        fetchAllRows<Price>(async (from, to) => {
          let query = supabase
            .from("engineering_input_prices")
            .select("input_id, project_id, final_unit_price, price_date")
            .eq("company_id", budget.company_id)
            .eq("status", "active")
            .eq("is_adopted", true)
            .in("input_id", inputIds)
            .order("price_date", { ascending: false });

          if (budget.project_id) {
            query = query.or(`project_id.eq.${budget.project_id},project_id.is.null`);
          } else {
            query = query.is("project_id", null);
          }

          const { data, error } = await query.range(from, to);
          return { data: (data ?? []) as Price[], error };
        }),
      ])
    : [
        { data: [] as Input[], error: null },
        { data: [] as Price[], error: null },
      ];

  if (inputsResult.error || pricesResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar os preços dos insumos." }, { status: 500 });
  }

  const serviceMap = new Map(servicesResult.data.map((service) => [service.id, service]));
  const compositionByService = new Map(compositionsResult.data.map((composition) => [composition.service_id, composition]));
  const itemsByComposition = new Map<string, CompositionItem[]>();
  compositionItemsResult.data.forEach((item) => {
    const current = itemsByComposition.get(item.composition_id) ?? [];
    current.push(item);
    itemsByComposition.set(item.composition_id, current);
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

  const items = budgetItems.map((budgetItem) => {
    const service = budgetItem.service_id ? serviceMap.get(budgetItem.service_id) ?? null : null;
    const composition = budgetItem.service_id ? compositionByService.get(budgetItem.service_id) ?? null : null;
    const quantity = Number(budgetItem.quantity ?? 0);
    const compositionItems = composition ? itemsByComposition.get(composition.id) ?? [] : [];

    return {
      budgetItemId: budgetItem.id,
      matchKey: matchKey(budgetItem.code, budgetItem.description),
      serviceId: service?.id ?? null,
      serviceHref: service ? `/engenharia/servicos?service=${service.id}#insumos-do-servico` : null,
      quantity,
      unit: budgetItem.unit,
      inputs: compositionItems.map((compositionItem) => {
        const input = inputMap.get(compositionItem.input_id) ?? null;
        const coefficient = Number(compositionItem.effective_coefficient ?? 0);
        const price = projectPrices.get(compositionItem.input_id) ?? corporatePrices.get(compositionItem.input_id) ?? null;
        const unitPrice = price ? Number(price.final_unit_price ?? 0) : null;
        const totalQuantity = coefficient * quantity;

        return {
          id: compositionItem.id,
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

  return NextResponse.json({ items });
}
