/**
 * Conferência (somente leitura) dos títulos a pagar de uma obra: Elos OS × Koper.
 *
 * Compara `payables` da obra alvo com a staging `mirror.bill_to_pay` (+ detalhe) das empresas
 * do Koper que a alimentam e responde:
 *   - o que está nos dois lados e bate (valor, baixa, vencimento) e o que diverge;
 *   - o que está só no Elos OS (título que sumiu do Koper, ids `missing-…`);
 *   - o que está só no Koper (falta importar), separado por tipo de título;
 *   - títulos do Elos OS que no Koper são pai de agrupamento (custo em dobro se os filhos
 *     também estiverem) ou crédito de fornecedor;
 *   - quantos títulos já têm rateio por serviço.
 *
 * Não grava nada.
 *
 *   KOPER_TOOL=reconcile KOPER_TOOL_TARGET=flow
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { type Json, type KoperCompany, type Requester, type TargetKey, TARGETS, allRows, asObject, cents, idOf, loadMirror, money, resolveProject, text } from "./mirror-shared.js";

type Payable = { id: string; source_system: string | null; source_id: string | null; amount: number; status: string; due_date: string | null; paid_at: string | null; paid_amount: number | null };
type Bucket = { count: number; cents: number };

const isoDate = (value: unknown): string | null => {
  const out = text(value);
  return out && /^\d{4}-\d{2}-\d{2}/.test(out) ? out.slice(0, 10) : null;
};

export type KoperBill = { type: string; amountCents: number; paid: boolean; dueDate: string | null; parentId: string | null };

/** Situação de cada título no Koper; filho de agrupamento herda a baixa do pai (mesma regra da promoção). */
export function readKoperBills(bills: Map<string, Json>, details: Map<string, Json>): Map<string, KoperBill> {
  const out = new Map<string, KoperBill>();
  for (const [billId, bill] of bills) {
    const detail = asObject(details.get(billId));
    const parentId = idOf(detail.join_bill_id) ?? idOf(bill.joinBillId);
    let paid = bill.isPaid === true;
    if (!paid && parentId) {
      const parent = bills.get(parentId);
      if (parent && parent.isPaid === true) paid = true;
    }
    out.set(billId, { type: text(detail.bill_type) ?? (details.has(billId) ? "sem tipo" : "sem detalhe"), amountCents: cents(bill.billValue), paid, dueDate: isoDate(bill.dueDate), parentId });
  }
  return out;
}

export type Comparison = {
  both: Array<{ billId: string; payable: Payable; koper: KoperBill }>;
  onlyElos: Payable[];
  onlyKoper: Array<{ billId: string; koper: KoperBill }>;
};

export function comparePayables(payables: Payable[], koper: Map<string, KoperBill>): Comparison {
  const both: Comparison["both"] = [];
  const onlyElos: Payable[] = [];
  const seen = new Set<string>();
  for (const payable of payables) {
    const match = /^koper_bill:(\d+)$/.exec(payable.source_id ?? "");
    const bill = match?.[1] ? koper.get(match[1]) : undefined;
    if (!match?.[1] || !bill) { onlyElos.push(payable); continue; }
    seen.add(match[1]);
    both.push({ billId: match[1], payable, koper: bill });
  }
  const onlyKoper = [...koper].filter(([billId]) => !seen.has(billId)).map(([billId, bill]) => ({ billId, koper: bill }));
  return { both, onlyElos, onlyKoper };
}

export async function reconcilePayables(options: { target: TargetKey }, request: Requester = requestSupabase) {
  const target = TARGETS[options.target];
  const project = await resolveProject(request, target);
  const company = `eq.${env.BOSSA_COMPANY_ID}`;
  const bump = (map: Map<string, Bucket>, key: string, valueCents: number) => {
    const bucket = map.get(key) ?? { count: 0, cents: 0 };
    bucket.count += 1;
    bucket.cents += valueCents;
    map.set(key, bucket);
  };
  const dump = (map: Map<string, Bucket>) => Object.fromEntries([...map].sort((a, b) => b[1].cents - a[1].cents).map(([key, bucket]) => [key, { count: bucket.count, total: money(bucket.cents) }]));

  const allPayables = await allRows<Payable>(request, "payables", {
    select: "id,source_system,source_id,amount,status,due_date,paid_at,paid_amount",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  });
  const allocated = new Set((await allRows<{ payable_id: string }>(request, "payable_cost_allocations", {
    select: "payable_id", company_id: company, project_id: `eq.${project.id}`, order: "id.asc",
  })).map((row) => row.payable_id));

  const bySource = new Map<string, Bucket>();
  for (const payable of allPayables) bump(bySource, `${payable.source_system ?? "sem origem"} · ${payable.status}`, cents(payable.amount));

  for (const [sourceSystem, koperCompany] of Object.entries(target.payableSources) as Array<[string, KoperCompany]>) {
    const payables = allPayables.filter((payable) => payable.source_system === sourceSystem);
    const bills = await loadMirror(request, "mirror.bill_to_pay", koperCompany);
    const details = await loadMirror(request, "mirror.bill_to_pay_detail", koperCompany);
    const koper = readKoperBills(bills, details);
    const { both, onlyElos, onlyKoper } = comparePayables(payables, koper);
    const exclusive = target.exclusiveCompanies.includes(koperCompany);

    const koperByType = new Map<string, Bucket>();
    for (const bill of koper.values()) bump(koperByType, `${bill.type} · ${bill.paid ? "pago" : "em aberto"}`, bill.amountCents);

    const value = new Map<string, Bucket>();
    const status = new Map<string, Bucket>();
    const due = new Map<string, Bucket>();
    const typeInElos = new Map<string, Bucket>();
    const allocation = new Map<string, Bucket>();
    const examples: Record<string, string[]> = {};
    const note = (key: string, billId: string) => {
      const list = examples[key] ?? [];
      if (list.length < 8) examples[key] = [...list, billId];
    };
    let valueDiffCents = 0;
    const inElos = new Set(both.map((item) => item.billId));
    let parentsWithChildrenInElos = 0;
    let parentsWithChildrenCents = 0;
    const childrenByParent = new Map<string, string[]>();
    for (const [billId, bill] of koper) if (bill.parentId) childrenByParent.set(bill.parentId, [...(childrenByParent.get(bill.parentId) ?? []), billId]);

    for (const item of both) {
      const amount = cents(item.payable.amount);
      if (amount === item.koper.amountCents) bump(value, "valor igual", amount);
      else {
        bump(value, "valor diferente", amount);
        valueDiffCents += item.koper.amountCents - amount;
        note("valor diferente", item.billId);
      }
      const elosPaid = item.payable.status === "paid";
      const statusKey = elosPaid === item.koper.paid ? (elosPaid ? "pago nos dois" : "em aberto nos dois") : elosPaid ? "pago no Elos OS, em aberto no Koper" : "em aberto no Elos OS, pago no Koper";
      bump(status, statusKey, amount);
      if (elosPaid !== item.koper.paid) note(statusKey, item.billId);
      const sameDue = !item.koper.dueDate || !item.payable.due_date || item.koper.dueDate === String(item.payable.due_date).slice(0, 10);
      bump(due, sameDue ? "vencimento igual" : "vencimento diferente", amount);
      if (!sameDue) note("vencimento diferente", item.billId);
      bump(typeInElos, item.koper.type, amount);
      if (item.koper.type === "Grupo") {
        const children = (childrenByParent.get(item.billId) ?? []).filter((child) => inElos.has(child));
        if (children.length) {
          parentsWithChildrenInElos += 1;
          parentsWithChildrenCents += amount;
          note("pai de agrupamento com filhos também no Elos OS", item.billId);
        }
      }
      bump(allocation, allocated.has(item.payable.id) ? "com rateio" : "sem rateio", amount);
    }

    const onlyElosKinds = new Map<string, Bucket>();
    for (const payable of onlyElos) {
      const sourceId = payable.source_id ?? "";
      const kind = /^koper_bill:missing-/.test(sourceId) ? "id missing-…" : /^koper_bill:\d+$/.test(sourceId) ? "título que não está (mais) no Koper" : "outro formato de id";
      bump(onlyElosKinds, `${kind} · ${payable.status} · ${allocated.has(payable.id) ? "com rateio" : "sem rateio"}`, cents(payable.amount));
      if (kind !== "id missing-…") note(`só no Elos OS: ${kind}`, sourceId.replace(/^koper_bill:/, ""));
    }
    const onlyKoperKinds = new Map<string, Bucket>();
    for (const item of onlyKoper) {
      bump(onlyKoperKinds, `${item.koper.type} · ${item.koper.paid ? "pago" : "em aberto"}`, item.koper.amountCents);
      if (item.koper.type !== "Grupo" && item.koper.type !== "Crédito") note("só no Koper (falta importar)", item.billId);
    }

    console.log("KOPER_RECONCILE", JSON.stringify({
      target: options.target,
      project: project.name,
      sourceSystem,
      koperCompany,
      elos: { titles: payables.length, total: money(payables.reduce((sum, payable) => sum + cents(payable.amount), 0)) },
      koper: { titles: koper.size, total: money([...koper.values()].reduce((sum, bill) => sum + bill.amountCents, 0)), byType: dump(koperByType) },
      inBoth: { titles: both.length, value: dump(value), koperMinusElos: money(valueDiffCents), status: dump(status), dueDate: dump(due), koperType: dump(typeInElos), allocation: dump(allocation) },
      groupParentsWithChildrenInElos: { count: parentsWithChildrenInElos, total: money(parentsWithChildrenCents) },
      onlyInElos: dump(onlyElosKinds),
      onlyInKoper: exclusive ? dump(onlyKoperKinds) : "empresa do Koper com outras obras: não se aplica",
      examples,
    }));
  }
  console.log("KOPER_RECONCILE_PROJECT", JSON.stringify({ target: options.target, project: project.name, payablesBySource: dump(bySource), payablesWithAllocation: allocated.size }));
}
