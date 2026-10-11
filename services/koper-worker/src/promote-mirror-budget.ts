/**
 * Promoção do orçamento de uma obra a partir do **acompanhamento de obra** do Koper
 * (staging `mirror.building_monitoring` + `mirror.monitoring_items`) para as tabelas
 * `engineering_budgets`, `engineering_budget_groups` e `engineering_budget_items`.
 *
 * Por que o acompanhamento e não o "orçamento de obra" do Koper: é a estrutura viva que os
 * títulos citam (`itemMonitoringId`, `itemReference`) e a que traz o valor previsto por item
 * (`monItemExpectedValue`). Mesma convenção do orçamento do Flow importado em agosto
 * (`KOPER-100`): itens estruturais viram grupos, folhas com serviço viram itens ligados ao
 * serviço do catálogo (`engineering_services`, `source_system = koper`).
 *
 * Valor previsto guardado na etapa: no Koper o previsto de um grupo pode ser maior que a soma
 * dos filhos (o orçamento foi lançado por etapa e só parte foi detalhada em serviços). Essa
 * diferença vira um item **sem serviço** na própria etapa (marcador `Koper etapa
 * itemMonitoringId=<id>`), para o total do orçamento no Elos OS ser exatamente o do Koper.
 * Na tela Custo x Orçamento ela aparece em "Itens do orçamento sem serviço vinculado".
 * Nada é distribuído por conta própria entre serviços.
 *
 * Garantias: identidade estável (`source_id = monitoring:<id>` no orçamento, código do grupo,
 * marcador `Koper itemMonitoringId=<id>` no item), então reexecutar não duplica; nunca apaga;
 * item que sumiu do Koper só é listado. Valor: o total previsto do item é preservado ao
 * centavo (quantidade 1 quando a divisão pelo quantitativo não fecha exata).
 *
 *   KOPER_TOOL=budget KOPER_TOOL_TARGET=alma                       # plano (não grava)
 *   KOPER_TOOL=budget KOPER_TOOL_TARGET=alma KOPER_TOOL_WRITE=true # grava
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import {
  type Json, type KoperCompany, type KoperServiceInfo, type Requester, type TargetKey,
  TARGETS, allRows, asArray, asObject, cents, chunks, ensureKoperServices, idOf, loadMirror, money, num, resolveProject,
  serviceInfoFromCatalog, text,
} from "./mirror-shared.js";

export const itemToken = (itemMonitoringId: string) => `Koper itemMonitoringId=${itemMonitoringId}`;
/** Marcador do valor previsto que o Koper guarda na etapa (grupo), sem serviço. */
export const stageToken = (itemMonitoringId: string) => `Koper etapa itemMonitoringId=${itemMonitoringId}`;
export const budgetSourceId = (monitoringId: string) => `monitoring:${monitoringId}`;

export type MonitoringItem = {
  id: string;
  fatherId: string | null;
  reference: string | null;
  name: string | null;
  serviceId: string | null;
  hasChildren: boolean;
  amount: number;
  expectedCents: number;
  planningId: string | null;
};

export function readMonitoringItems(payload: Json): MonitoringItem[] {
  return asArray(payload.items).map(asObject).flatMap((row) => {
    const id = idOf(row.itemMonitoringId);
    if (!id) return [];
    return [{
      id,
      fatherId: idOf(row.fatherItemId),
      reference: text(row.itemReference),
      name: text(row.itemName),
      serviceId: idOf(row.serviceId),
      hasChildren: row.itemHasChildren === true,
      amount: num(row.itemAmount),
      expectedCents: cents(row.monItemExpectedValue),
      planningId: idOf(row.itemPlanningId),
    }];
  });
}

/** Quantidade e custo unitário que reproduzem o total ao centavo. */
export function exactQuantity(amount: number, expectedCents: number): { quantity: number; unitCost: number; keptQuantity: boolean } {
  const total = expectedCents / 100;
  if (amount > 0 && amount !== 1) {
    const unitCost = Math.round((total / amount) * 1e6) / 1e6;
    if (Math.round(amount * unitCost * 1e6) === expectedCents * 1e4) return { quantity: amount, unitCost, keptQuantity: true };
    return { quantity: 1, unitCost: total, keptQuantity: false };
  }
  return { quantity: 1, unitCost: total, keptQuantity: amount === 1 };
}

export type BudgetPlan = {
  groups: Array<{ id: string; code: string; name: string; notes: string }>;
  leaves: MonitoringItem[];
  /** Previsto que está na etapa e não nos filhos (previsto do grupo − soma dos filhos diretos). */
  stageItems: Array<{ id: string; reference: string | null; name: string | null; ownCents: number }>;
  /** Grupos cujo previsto é menor que a soma dos filhos (não deveria acontecer). */
  negativeStages: Array<{ id: string; reference: string | null; ownCents: number }>;
  rootsCents: number;
  /** Item com serviço que também tem filhos, ou folha sem serviço: ficam fora e são listados. */
  oddItems: Array<{ id: string; reference: string | null; reason: string }>;
  leavesCents: number;
};

export function planBudget(items: MonitoringItem[]): BudgetPlan {
  const groups: BudgetPlan["groups"] = [];
  const leaves: MonitoringItem[] = [];
  const oddItems: BudgetPlan["oddItems"] = [];
  const usedCodes = new Set<string>();
  for (const item of items) {
    if (item.serviceId && !item.hasChildren) leaves.push(item);
    else if (!item.serviceId) {
      let code = item.reference ?? `KOPER-G-${item.id}`;
      if (usedCodes.has(code)) code = `${code} (${item.id})`;
      usedCodes.add(code);
      groups.push({ id: item.id, code, name: item.name ?? `Grupo Koper ${item.id}`, notes: `${itemToken(item.id)} · fatherItemId=${item.fatherId ?? "root"}` });
    } else oddItems.push({ id: item.id, reference: item.reference, reason: "item com serviço e com filhos" });
  }
  const childrenCents = new Map<string, number>();
  for (const item of items) if (item.fatherId) childrenCents.set(item.fatherId, (childrenCents.get(item.fatherId) ?? 0) + item.expectedCents);
  const stageItems: BudgetPlan["stageItems"] = [];
  const negativeStages: BudgetPlan["negativeStages"] = [];
  for (const item of items) {
    if (item.serviceId) continue;
    const ownCents = item.expectedCents - (childrenCents.get(item.id) ?? 0);
    if (ownCents > 0) stageItems.push({ id: item.id, reference: item.reference, name: item.name, ownCents });
    else if (ownCents < -1) negativeStages.push({ id: item.id, reference: item.reference, ownCents });
  }
  const known = new Set(items.map((item) => item.id));
  return {
    groups, leaves, oddItems, stageItems, negativeStages,
    leavesCents: leaves.reduce((sum, item) => sum + item.expectedCents, 0),
    rootsCents: items.filter((item) => !item.fatherId || !known.has(item.fatherId)).reduce((sum, item) => sum + item.expectedCents, 0),
  };
}

type ExistingItem = { id: string; group_id: string | null; service_id: string | null; code: string | null; description: string; unit: string; quantity: number; other_unit_cost: number; notes: string | null; status: string };

export async function promoteMirrorBudget(options: { write: boolean; target: TargetKey }, request: Requester = requestSupabase) {
  const { write } = options;
  const target = TARGETS[options.target];
  if (!target.budgetFromMonitoring) {
    console.log("KOPER_BUDGET_SKIPPED", JSON.stringify({ target: options.target, reason: "a obra já tem orçamento próprio no Elos OS; esta ferramenta não cria nem altera" }));
    return [];
  }
  const project = await resolveProject(request, target);
  const summary: Json[] = [];

  for (const company of target.monitoringCompanies) {
    const [monitorings, monitoringItems, catalog] = [
      await loadMirror(request, "mirror.building_monitoring", company),
      await loadMirror(request, "mirror.monitoring_items", company),
      await loadMirror(request, "mirror.service", company),
    ];
    for (const [monitoringId, monitoring] of monitorings) {
      const payload = monitoringItems.get(monitoringId);
      if (!payload) throw new Error(`KOPER_BUDGET_ITEMS_NOT_STAGED_${company}_${monitoringId}`);
      const items = readMonitoringItems(payload);
      const plan = planBudget(items);
      const reportedCents = cents(payload.totalItems);
      const stageCents = plan.stageItems.reduce((sum, item) => sum + item.ownCents, 0);
      const budgetCents = plan.leavesCents + stageCents;
      const totalsMatch = Math.abs(budgetCents - reportedCents) <= 5 && Math.abs(budgetCents - plan.rootsCents) <= 5 && plan.negativeStages.length === 0;
      const byId = new Map(items.map((item) => [item.id, item]));

      // Serviços das folhas no catálogo do Elos OS.
      const needed = new Map<string, KoperServiceInfo>();
      for (const leaf of plan.leaves) {
        if (!leaf.serviceId || needed.has(leaf.serviceId)) continue;
        needed.set(leaf.serviceId, serviceInfoFromCatalog(catalog, leaf.serviceId) ?? { name: leaf.name, unit: null, categoryId: null, categoryName: null });
      }
      // Primeiro só consulta; a criação de serviço que falta acontece depois das travas abaixo.
      let services = await ensureKoperServices(request, needed, false);

      const sourceId = budgetSourceId(monitoringId);
      const existingBudgets = await request<Array<{ id: string }>>("engineering_budgets", {
        query: new URLSearchParams({ select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", source_id: `eq.${sourceId}`, limit: "2" }),
      });
      const report: Json = {
        write,
        target: options.target,
        project: project.name,
        koperCompany: company as KoperCompany,
        monitoringId,
        monitoringName: text(monitoring.buildMonitoringName),
        items: items.length,
        groups: plan.groups.length,
        leaves: plan.leaves.length,
        oddItems: plan.oddItems,
        leavesTotal: money(plan.leavesCents),
        stageItems: plan.stageItems.length,
        stageTotal: money(stageCents),
        budgetTotal: money(budgetCents),
        koperRootsTotal: money(plan.rootsCents),
        koperReportedTotal: money(reportedCents),
        totalsMatch,
        negativeStages: plan.negativeStages,
        servicesNeeded: needed.size,
        servicesCreated: services.created,
        servicesWouldCreate: services.wouldCreate,
        servicesWithoutName: services.unnamed,
        budgetExists: existingBudgets.length > 0,
      };
      if (!write) {
        // Árvore compacta para conferência: referência | serviço | tem filhos | previsto | realizado.
        const raw = asArray(payload.items).map(asObject);
        const tree = raw.map((row) => `${text(row.itemReference) ?? "?"}|${idOf(row.serviceId) ?? "-"}|${row.itemHasChildren === true ? 1 : 0}|${Math.round(num(row.monItemExpectedValue))}|${Math.round(num(row.totalMonItem))}`);
        const sumWhere = (pick: (item: MonitoringItem) => boolean) => money(items.filter(pick).reduce((sum, item) => sum + item.expectedCents, 0));
        console.log("KOPER_BUDGET_TREE", JSON.stringify({
          monitoringId,
          roots: sumWhere((item) => !item.fatherId),
          withoutChildren: sumWhere((item) => !item.hasChildren),
          withService: sumWhere((item) => Boolean(item.serviceId)),
          all: sumWhere(() => true),
          executedRoots: money(raw.filter((row) => !idOf(row.fatherItemId)).reduce((sum, row) => sum + cents(row.totalMonItem), 0)),
          top: Object.fromEntries(Object.entries(payload).filter(([, value]) => typeof value !== "object")),
        }));
        for (const part of chunks(tree, 70)) console.log("KOPER_BUDGET_TREE_ROWS", part.join(" ; "));
      }
      if (plan.oddItems.some((item) => item.reason === "item com serviço e com filhos")) throw new Error(`KOPER_BUDGET_ITEM_WITH_SERVICE_AND_CHILDREN_${monitoringId}`);
      if (write && !totalsMatch) {
        console.log("KOPER_BUDGET_PLAN", JSON.stringify({ ...report, aborted: "itens não fecham com o total informado pelo Koper" }));
        throw new Error(`KOPER_BUDGET_TOTAL_MISMATCH_${monitoringId}`);
      }
      if (!write) {
        console.log("KOPER_BUDGET_PLAN", JSON.stringify({
          ...report,
          sample: plan.leaves.slice(0, 3).map((leaf) => ({ code: leaf.reference, name: leaf.name, serviceId: leaf.serviceId, expected: money(leaf.expectedCents), ...exactQuantity(leaf.amount, leaf.expectedCents) })),
          stageSample: plan.stageItems.map((item) => ({ code: item.reference, name: item.name, own: money(item.ownCents) })),
        }));
        summary.push(report);
        continue;
      }
      if (services.unnamed.length) throw new Error(`KOPER_BUDGET_SERVICE_WITHOUT_NAME_${services.unnamed.slice(0, 5).join("_")}`);
      services = await ensureKoperServices(request, needed, true);

      const now = new Date().toISOString();
      const budgets = await request<Array<{ id: string }>>("engineering_budgets", {
        method: "POST",
        body: [{
          company_id: env.BOSSA_COMPANY_ID,
          project_id: project.id,
          code: `KOPER-ACOMP-${monitoringId}`,
          name: text(monitoring.buildMonitoringName) ?? `${target.label} — acompanhamento Koper ${monitoringId}`,
          version: "KOPER",
          status: "in_progress",
          reference_date: (text(monitoring.buildMonitoringDate) ?? "").slice(0, 10) || null,
          area_m2: 0,
          bdi_percentage: 0,
          notes: `Importado do Koper · acompanhamento de obra buildMonitoringId=${monitoringId} · buildingId=${idOf(monitoring.buildingId) ?? "n/a"}`,
          source_system: "koper",
          source_id: sourceId,
          updated_at: now,
        }],
        prefer: "resolution=merge-duplicates,return=representation",
        query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id" }),
      });
      const budgetId = budgets[0]?.id;
      if (budgets.length !== 1 || !budgetId) throw new Error(`KOPER_BUDGET_UPSERT_NOT_CONFIRMED_${monitoringId}`);

      const promotedGroups: Array<{ id: string; code: string }> = [];
      const groupBody = plan.groups.map((group, index) => ({
        company_id: env.BOSSA_COMPANY_ID, project_id: project.id, budget_id: budgetId, code: group.code, name: group.name, sort_order: index, notes: group.notes, status: "active", updated_at: now,
      }));
      for (const batch of chunks(groupBody, 100)) {
        promotedGroups.push(...await request<Array<{ id: string; code: string }>>("engineering_budget_groups", {
          method: "POST",
          body: batch,
          prefer: "resolution=merge-duplicates,return=representation",
          query: new URLSearchParams({ on_conflict: "budget_id,code", select: "id,code" }),
        }));
      }
      const groupIdByCode = new Map(promotedGroups.map((group) => [group.code, group.id]));
      const groupIdByKoper = new Map(plan.groups.flatMap((group) => {
        const id = groupIdByCode.get(group.code);
        return id ? [[group.id, id] as const] : [];
      }));
      const groupOf = (leaf: MonitoringItem): string | null => {
        const visited = new Set<string>();
        let parent = leaf.fatherId;
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          const groupId = groupIdByKoper.get(parent);
          if (groupId) return groupId;
          parent = byId.get(parent)?.fatherId ?? null;
        }
        return null;
      };

      const desired = plan.leaves.map((leaf, index) => {
        const service = leaf.serviceId ? services.byKoperId.get(leaf.serviceId) : undefined;
        if (!service) throw new Error(`KOPER_BUDGET_SERVICE_NOT_IN_CATALOG_${leaf.serviceId}`);
        const exact = exactQuantity(leaf.amount, leaf.expectedCents);
        return {
          key: `item:${leaf.id}`,
          row: {
            company_id: env.BOSSA_COMPANY_ID,
            project_id: project.id,
            budget_id: budgetId,
            group_id: groupOf(leaf),
            service_id: service.id,
            code: leaf.reference,
            description: leaf.name ?? service.description,
            unit: service.unit || "un",
            quantity: exact.quantity,
            material_unit_cost: 0,
            labor_unit_cost: 0,
            equipment_unit_cost: 0,
            other_unit_cost: exact.unitCost,
            sort_order: index,
            notes: [
              itemToken(leaf.id),
              `fatherItemId=${leaf.fatherId ?? "root"}`,
              `serviceId=${leaf.serviceId}`,
              `itemPlanningId=${leaf.planningId ?? "none"}`,
              exact.keptQuantity ? null : `quantidade Koper=${leaf.amount}`,
            ].filter(Boolean).join(" · "),
            status: "active",
            updated_at: now,
          },
        };
      });
      plan.stageItems.forEach((stage, index) => {
        desired.push({
          key: `stage:${stage.id}`,
          row: {
            company_id: env.BOSSA_COMPANY_ID,
            project_id: project.id,
            budget_id: budgetId,
            group_id: groupIdByKoper.get(stage.id) ?? null,
            service_id: null as unknown as string,
            code: stage.reference,
            description: `${stage.name ?? `Etapa Koper ${stage.id}`} — previsto na etapa (sem serviço no Koper)`,
            unit: "vb",
            quantity: 1,
            material_unit_cost: 0,
            labor_unit_cost: 0,
            equipment_unit_cost: 0,
            other_unit_cost: stage.ownCents / 100,
            sort_order: plan.leaves.length + index,
            notes: `${stageToken(stage.id)} · previsto da etapa menos a soma dos filhos`,
            status: "active",
            updated_at: now,
          },
        });
      });

      const existing = await allRows<ExistingItem>(request, "engineering_budget_items", {
        select: "id,group_id,service_id,code,description,unit,quantity,other_unit_cost,notes,status",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        budget_id: `eq.${budgetId}`,
        order: "id.asc",
      });
      const keyOf = (notes: string | null): string | null => {
        const stage = notes?.match(/Koper etapa itemMonitoringId=(\d+)/);
        if (stage?.[1]) return `stage:${stage[1]}`;
        const item = notes?.match(/Koper itemMonitoringId=(\d+)/);
        return item?.[1] ? `item:${item[1]}` : null;
      };
      const existingByKoper = new Map<string, ExistingItem>();
      for (const row of existing) {
        const key = keyOf(row.notes);
        if (key) existingByKoper.set(key, row);
      }
      const inserts = desired.filter((item) => !existingByKoper.has(item.key)).map((item) => item.row);
      const updates = desired.flatMap((item) => {
        const current = existingByKoper.get(item.key);
        if (!current) return [];
        const same = current.group_id === item.row.group_id && current.service_id === item.row.service_id && current.code === item.row.code
          && current.description === item.row.description && current.unit === item.row.unit && num(current.quantity) === item.row.quantity
          && Math.abs(num(current.other_unit_cost) - item.row.other_unit_cost) < 1e-6 && current.notes === item.row.notes && current.status === "active";
        return same ? [] : [{ id: current.id, row: item.row }];
      });
      let inserted = 0;
      for (const batch of chunks(inserts, 100)) {
        inserted += (await request<Array<{ id: string }>>("engineering_budget_items", {
          method: "POST", body: batch, prefer: "return=representation", query: new URLSearchParams({ select: "id" }),
        })).length;
      }
      let updated = 0;
      for (const update of updates) {
        updated += (await request<Array<{ id: string }>>("engineering_budget_items", {
          method: "PATCH",
          body: update.row,
          prefer: "return=representation",
          query: new URLSearchParams({ id: `eq.${update.id}`, company_id: `eq.${env.BOSSA_COMPANY_ID}`, budget_id: `eq.${budgetId}`, select: "id" }),
        })).length;
      }

      // Conferência: relê o que ficou gravado.
      const after = await allRows<{ notes: string | null; total_direct_cost: number; service_id: string | null; status: string }>(request, "engineering_budget_items", {
        select: "notes,total_direct_cost,service_id,status",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        budget_id: `eq.${budgetId}`,
        order: "id.asc",
      });
      const wanted = new Set(desired.map((item) => item.key));
      const present = after.filter((row) => {
        const key = keyOf(row.notes);
        return Boolean(key && wanted.has(key) && row.status === "active");
      });
      const storedCents = present.reduce((sum, row) => sum + cents(row.total_direct_cost), 0);
      const goneFromKoper = [...existingByKoper.keys()].filter((id) => !wanted.has(id));
      const withService = present.filter((row) => row.service_id).length;
      const verified = present.length === desired.length && withService === plan.leaves.length && Math.abs(storedCents - budgetCents) <= 5;
      const result = { ...report, servicesCreated: services.created, servicesWouldCreate: [], budgetId, groupsSaved: promotedGroups.length, inserted, updated, unchanged: desired.length - inserts.length - updates.length, storedItems: present.length, storedWithService: withService, storedTotal: money(storedCents), goneFromKoper, verified };
      console.log("KOPER_BUDGET_RESULT", JSON.stringify(result));
      if (!verified) throw new Error(`KOPER_BUDGET_POST_VERIFICATION_FAILED_${monitoringId}`);
      summary.push(result);
    }
  }
  return summary;
}
