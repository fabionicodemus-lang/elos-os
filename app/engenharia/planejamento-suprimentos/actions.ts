"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/planejamento-suprimentos";
const STATUSES = new Set(["planned", "quotation", "approval", "ordered", "partial", "delivered", "canceled"]);
const PURCHASABLE = new Set(["material", "equipment", "freight", "other"]);

type Activity = { service_id: string | null; quantity_snapshot: number; planned_start: string };
type BudgetItem = { service_id: string | null; quantity: number };
type Composition = { id: string; service_id: string; status: string };
type CompositionItem = { composition_id: string; input_id: string; effective_coefficient: number; status: string };
type Input = { id: string; code: string; description: string; unit: string; category: string };
type Price = { input_id: string; project_id: string | null; supplier_id: string | null; price_date: string; final_unit_price: number };
type ExistingItem = {
  id: string;
  input_id: string;
  supplier_id: string | null;
  available_stock: number;
  quotation_lead_days: number;
  purchasing_lead_days: number;
  delivery_lead_days: number;
  safety_days: number;
  status: string;
  responsible: string | null;
  notes: string | null;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;

function numberValue(form: FormData, key: string, fallback = 0) {
  const raw = text(form, key);
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}

function target(message: string, type: "error" | "success", baseline?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (baseline) params.set("baseline", baseline);
  return `${PATH}?${params}`;
}

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function minus(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - Math.max(0, Math.trunc(days)));
  return result;
}

function deadlines(firstUse: Date, quotation: number, purchasing: number, delivery: number, safety: number) {
  const deliveryDeadline = minus(firstUse, safety);
  const orderDeadline = minus(deliveryDeadline, delivery);
  const quotationStart = minus(orderDeadline, quotation + purchasing);
  return {
    quotation_start: iso(quotationStart),
    order_deadline: iso(orderDeadline),
    delivery_deadline: iso(deliveryDeadline),
  };
}

function recommended(input: Input) {
  const value = `${input.description} ${input.category}`.toLocaleLowerCase("pt-BR");
  if (/(elevador|transformador|gerador|subestação|esquadria|fachada|estrutura metálica|chiller|pressurização)/.test(value)) return [45, 20, 75, 15];
  if (/(porcelanato|revestimento|louça|metal sanitário|vidro|impermeabil|ar condicionado|automação|incêndio)/.test(value)) return [30, 15, 45, 10];
  if (/(concreto|argamassa|cimento|areia|brita|bloco|tijolo|aço|forma|madeira)/.test(value)) return [12, 5, 10, 4];
  if (input.category === "equipment") return [25, 10, 30, 7];
  return [20, 10, 20, 7];
}

async function context(form: FormData) {
  const baselineId = text(form, "baseline_id");
  const workspace = await requireCompanyPermission("supply_plan.manage");
  if (!workspace.projectId) redirect(target("Selecione uma obra.", "error"));
  if (!baselineId) redirect(target("Selecione uma linha de base.", "error"));

  const { data: baseline } = await workspace.supabase
    .from("engineering_schedule_baselines")
    .select("id, budget_id, status")
    .eq("id", baselineId)
    .eq("company_id", workspace.companyId)
    .eq("project_id", workspace.projectId)
    .maybeSingle();

  if (!baseline || baseline.status === "archived") redirect(target("Linha de base indisponível.", "error"));
  // A obra já foi validada acima; devolver o contexto com projectId não-nulo
  // evita espalhar `!` por cada consulta e gravação daqui para baixo.
  return {
    ...workspace,
    projectId: workspace.projectId,
    baseline: baseline as { id: string; budget_id: string; status: string },
  };
}

export async function generateSupplyPlanFromSchedule(form: FormData) {
  const ctx = await context(form);

  const [activitiesResult, budgetItemsResult, compositionsResult, compositionItemsResult, inputsResult, pricesResult, existingResult] = await Promise.all([
    fetchAllRows<Activity>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_schedule_activities")
        .select("service_id, quantity_snapshot, planned_start")
        .eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!)
        .eq("record_status", "active").range(from, to);
      return { data: (data ?? []) as Activity[], error };
    }),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_budget_items")
        .select("service_id, quantity").eq("budget_id", ctx.baseline.budget_id)
        .eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!).eq("status", "active").range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
    fetchAllRows<Composition>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_service_compositions")
        .select("id, service_id, status").eq("company_id", ctx.companyId).eq("status", "active").range(from, to);
      return { data: (data ?? []) as Composition[], error };
    }),
    fetchAllRows<CompositionItem>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_service_composition_items")
        .select("composition_id, input_id, effective_coefficient, status")
        .eq("company_id", ctx.companyId).eq("status", "active").range(from, to);
      return { data: (data ?? []) as CompositionItem[], error };
    }),
    fetchAllRows<Input>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_inputs")
        .select("id, code, description, unit, category")
        .eq("company_id", ctx.companyId).eq("status", "active").range(from, to);
      return { data: (data ?? []) as Input[], error };
    }),
    fetchAllRows<Price>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_input_prices")
        .select("input_id, project_id, supplier_id, price_date, final_unit_price")
        .eq("company_id", ctx.companyId).eq("status", "active").eq("is_adopted", true).range(from, to);
      return { data: (data ?? []) as Price[], error };
    }),
    fetchAllRows<ExistingItem>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_supply_plan_items")
        .select("id, input_id, supplier_id, available_stock, quotation_lead_days, purchasing_lead_days, delivery_lead_days, safety_days, status, responsible, notes")
        .eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).range(from, to);
      return { data: (data ?? []) as ExistingItem[], error };
    }),
  ]);

  const error = activitiesResult.error || budgetItemsResult.error || compositionsResult.error || compositionItemsResult.error || inputsResult.error || pricesResult.error || existingResult.error;
  if (error) redirect(target(error.message, "error", ctx.baseline.id));

  const earliestByService = new Map<string, string>();
  const activityQuantityByService = new Map<string, number>();
  activitiesResult.data.forEach((activity) => {
    if (!activity.service_id) return;
    const earliest = earliestByService.get(activity.service_id);
    if (!earliest || activity.planned_start < earliest) earliestByService.set(activity.service_id, activity.planned_start);
    activityQuantityByService.set(activity.service_id, (activityQuantityByService.get(activity.service_id) ?? 0) + Math.max(0, Number(activity.quantity_snapshot ?? 0)));
  });

  const budgetQuantityByService = new Map<string, number>();
  budgetItemsResult.data.forEach((item) => {
    if (!item.service_id) return;
    budgetQuantityByService.set(item.service_id, (budgetQuantityByService.get(item.service_id) ?? 0) + Math.max(0, Number(item.quantity ?? 0)));
  });

  const compositionByService = new Map(compositionsResult.data.map((item) => [item.service_id, item.id]));
  const itemsByComposition = new Map<string, CompositionItem[]>();
  compositionItemsResult.data.forEach((item) => {
    itemsByComposition.set(item.composition_id, [...(itemsByComposition.get(item.composition_id) ?? []), item]);
  });
  const inputMap = new Map(inputsResult.data.map((item) => [item.id, item]));
  const existingMap = new Map(existingResult.data.map((item) => [item.input_id, item]));

  const priceMap = new Map<string, Price>();
  pricesResult.data.forEach((price) => {
    if (price.project_id && price.project_id !== ctx.projectId) return;
    const current = priceMap.get(price.input_id);
    const rank = price.project_id === ctx.projectId ? 2 : 1;
    const currentRank = current?.project_id === ctx.projectId ? 2 : current ? 1 : 0;
    if (!current || rank > currentRank || (rank === currentRank && price.price_date > current.price_date)) priceMap.set(price.input_id, price);
  });

  const needs = new Map<string, { required: number; firstUse: string }>();
  earliestByService.forEach((firstUse, serviceId) => {
    const compositionId = compositionByService.get(serviceId);
    if (!compositionId) return;
    const serviceQuantity = budgetQuantityByService.get(serviceId) ?? activityQuantityByService.get(serviceId) ?? 0;
    if (serviceQuantity <= 0) return;

    (itemsByComposition.get(compositionId) ?? []).forEach((item) => {
      const input = inputMap.get(item.input_id);
      if (!input || !PURCHASABLE.has(input.category)) return;
      const quantity = serviceQuantity * Math.max(0, Number(item.effective_coefficient ?? 0));
      if (quantity <= 0) return;
      const current = needs.get(item.input_id);
      needs.set(item.input_id, {
        required: (current?.required ?? 0) + quantity,
        firstUse: !current || firstUse < current.firstUse ? firstUse : current.firstUse,
      });
    });
  });

  const now = new Date().toISOString();
  const rows = [...needs].flatMap(([inputId, need]) => {
    const input = inputMap.get(inputId);
    const firstUse = date(need.firstUse);
    if (!input || !firstUse) return [];
    const saved = existingMap.get(inputId);
    const price = priceMap.get(inputId);
    const defaults = recommended(input);
    const quotation = Number(saved?.quotation_lead_days ?? defaults[0]);
    const purchasing = Number(saved?.purchasing_lead_days ?? defaults[1]);
    const delivery = Number(saved?.delivery_lead_days ?? defaults[2]);
    const safety = Number(saved?.safety_days ?? defaults[3]);
    const stock = Math.max(0, Number(saved?.available_stock ?? 0));
    const required = Math.max(0, need.required);

    return [{
      company_id: ctx.companyId,
      project_id: ctx.projectId,
      baseline_id: ctx.baseline.id,
      input_id: inputId,
      supplier_id: saved?.supplier_id ?? price?.supplier_id ?? null,
      code: `SUP-${input.code}`.toUpperCase(),
      name: input.description,
      unit_snapshot: input.unit,
      category_snapshot: input.category,
      required_quantity: required,
      available_stock: stock,
      purchase_quantity: Math.max(0, required - stock),
      planned_unit_cost: Math.max(0, Number(price?.final_unit_price ?? 0)),
      first_use_date: need.firstUse,
      quotation_lead_days: quotation,
      purchasing_lead_days: purchasing,
      delivery_lead_days: delivery,
      safety_days: safety,
      ...deadlines(firstUse, quotation, purchasing, delivery, safety),
      status: saved?.status ?? "planned",
      responsible: saved?.responsible ?? null,
      notes: saved?.notes ?? null,
      record_status: "active",
      created_by: ctx.userId,
      updated_at: now,
    }];
  });

  if (!rows.length) redirect(target("Nenhum material ou equipamento pôde ser calculado. Verifique as composições e quantidades do orçamento.", "error", ctx.baseline.id));

  for (let index = 0; index < rows.length; index += 400) {
    const { error: saveError } = await ctx.supabase.from("engineering_supply_plan_items")
      .upsert(rows.slice(index, index + 400), { onConflict: "baseline_id,input_id" });
    if (saveError) redirect(target(saveError.message, "error", ctx.baseline.id));
  }

  const generatedIds = new Set(rows.map((row) => row.input_id));
  const staleIds = existingResult.data.filter((item) => !generatedIds.has(item.input_id)).map((item) => item.id);
  for (let index = 0; index < staleIds.length; index += 400) {
    await ctx.supabase.from("engineering_supply_plan_items")
      .update({ record_status: "inactive", updated_at: now })
      .in("id", staleIds.slice(index, index + 400));
  }

  revalidatePath(PATH);
  redirect(target(`${rows.length} insumo(s) sincronizado(s) com o orçamento e o cronograma.`, "success", ctx.baseline.id));
}

export async function updateSupplyPlanItem(form: FormData) {
  const ctx = await context(form);
  const itemId = text(form, "item_id");
  const firstUseText = text(form, "first_use_date");
  const firstUse = date(firstUseText);
  const status = text(form, "status");
  if (!itemId || !firstUse || !STATUSES.has(status)) redirect(target("Revise os dados do insumo.", "error", ctx.baseline.id));

  const { data: current, error: readError } = await ctx.supabase.from("engineering_supply_plan_items")
    .select("required_quantity")
    .eq("id", itemId).eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!).maybeSingle();
  if (readError || !current) redirect(target(readError?.message ?? "Insumo do plano não encontrado.", "error", ctx.baseline.id));

  const quotation = Math.max(0, Math.trunc(numberValue(form, "quotation_lead_days")));
  const purchasing = Math.max(0, Math.trunc(numberValue(form, "purchasing_lead_days")));
  const delivery = Math.max(0, Math.trunc(numberValue(form, "delivery_lead_days")));
  const safety = Math.max(0, Math.trunc(numberValue(form, "safety_days")));
  const stock = Math.max(0, numberValue(form, "available_stock"));
  const required = Math.max(0, Number(current.required_quantity ?? 0));

  const { error } = await ctx.supabase.from("engineering_supply_plan_items").update({
    supplier_id: optional(form, "supplier_id"),
    available_stock: stock,
    purchase_quantity: Math.max(0, required - stock),
    planned_unit_cost: Math.max(0, numberValue(form, "planned_unit_cost")),
    first_use_date: firstUseText,
    quotation_lead_days: quotation,
    purchasing_lead_days: purchasing,
    delivery_lead_days: delivery,
    safety_days: safety,
    ...deadlines(firstUse, quotation, purchasing, delivery, safety),
    status,
    responsible: optional(form, "responsible"),
    notes: optional(form, "notes"),
    updated_at: new Date().toISOString(),
  }).eq("id", itemId).eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!);

  if (error) redirect(target(error.message, "error", ctx.baseline.id));
  revalidatePath(PATH);
  redirect(target("Planejamento do insumo atualizado.", "success", ctx.baseline.id));
}
