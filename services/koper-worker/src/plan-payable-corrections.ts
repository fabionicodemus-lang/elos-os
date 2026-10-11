/**
 * Ensaio (somente leitura) da correção dos títulos de uma obra que divergem do Koper.
 *
 * Lista, título a título, o que está diferente entre `payables` e o Koper e a ação proposta.
 * **Não grava nada**: a correção é decisão do Fábio (regra do handoff: sumiço na listagem do
 * Koper não autoriza apagar no Elos OS; nada de alteração em massa sem auditoria).
 *
 * Categorias:
 *   - título que não existe mais no Koper            → proposta: cancelar (status `cancelled`)
 *   - crédito de fornecedor lançado como despesa     → proposta: cancelar
 *   - pai de agrupamento com filhos também lançados  → proposta: cancelar o pai
 *   - registro antigo sem número do Koper (missing-) → revisar à mão
 *   - valor diferente do Koper                       → proposta: atualizar valor (e o rateio)
 *   - pago no Koper e aberto no Elos OS              → proposta: dar baixa
 *   - vencimento diferente                           → proposta: atualizar vencimento
 *
 * Cada linha sai em `KOPER_FIX_ROW` (um JSON por título) e o resumo em `KOPER_FIX_PLAN`.
 *
 *   KOPER_TOOL=payable-corrections KOPER_TOOL_TARGET=flow
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { type Json, type KoperCompany, type Requester, type TargetKey, TARGETS, allRows, asObject, cents, chunks, loadMirror, money, resolveProject, text } from "./mirror-shared.js";
import { readKoperBills } from "./reconcile-mirror-payables.js";

type Payable = {
  id: string; source_system: string | null; source_id: string | null; supplier_id: string | null; document: string | null; amount: number; status: string;
  due_date: string | null; paid_at: string | null; paid_amount: number | null; suppliers: { legal_name: string } | Array<{ legal_name: string }> | null;
};
type Bucket = { count: number; cents: number };

const isoDate = (value: unknown): string | null => {
  const out = text(value);
  return out && /^\d{4}-\d{2}-\d{2}/.test(out) ? out.slice(0, 10) : null;
};

export type CorrectionRow = {
  bill: string;
  categories: string[];
  action: string;
  document: string | null;
  supplier: string | null;
  elosAmount: number;
  koperAmount: number | null;
  elosStatus: string;
  koperPaid: boolean | null;
  elosDue: string | null;
  koperDue: string | null;
  koperPaidAt: string | null;
  allocated: number;
  allocationRows: number;
  detail: string | null;
};

export async function planPayableCorrections(options: { target: TargetKey }, request: Requester = requestSupabase) {
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

  const payables = (await allRows<Payable>(request, "payables", {
    select: "id,source_system,source_id,supplier_id,document,amount,status,due_date,paid_at,paid_amount,suppliers(legal_name)",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  })).filter((payable) => payable.source_system !== null && payable.source_system in target.payableSources && payable.status !== "cancelled");
  const allocations = await allRows<{ payable_id: string; allocation_amount: number }>(request, "payable_cost_allocations", {
    select: "payable_id,allocation_amount", company_id: company, project_id: `eq.${project.id}`, order: "id.asc",
  });
  const allocatedCents = new Map<string, { cents: number; rows: number }>();
  for (const row of allocations) {
    const entry = allocatedCents.get(row.payable_id) ?? { cents: 0, rows: 0 };
    entry.cents += cents(row.allocation_amount);
    entry.rows += 1;
    allocatedCents.set(row.payable_id, entry);
  }

  const byCategory = new Map<string, Bucket>();
  const byAction = new Map<string, Bucket>();
  const rows: CorrectionRow[] = [];

  for (const [sourceSystem, koperCompany] of Object.entries(target.payableSources) as Array<[string, KoperCompany]>) {
    if (!target.exclusiveCompanies.includes(koperCompany)) continue;
    const bills = await loadMirror(request, "mirror.bill_to_pay", koperCompany);
    const details = await loadMirror(request, "mirror.bill_to_pay_detail", koperCompany);
    const koper = readKoperBills(bills, details);
    const mine = payables.filter((payable) => payable.source_system === sourceSystem);
    const elosBillIds = new Set(mine.flatMap((payable) => {
      const match = /^koper_bill:(\d+)$/.exec(payable.source_id ?? "");
      return match?.[1] ? [match[1]] : [];
    }));
    const childrenByParent = new Map<string, string[]>();
    for (const [billId, bill] of koper) if (bill.parentId) childrenByParent.set(bill.parentId, [...(childrenByParent.get(bill.parentId) ?? []), billId]);

    // Quando o título sumido foi visto pela última vez pela rotina antiga do Flow.
    const goneIds = mine.flatMap((payable) => {
      const match = /^koper_bill:(\d+)$/.exec(payable.source_id ?? "");
      return match?.[1] && !koper.has(match[1]) ? [match[1]] : [];
    });
    const lastSeen = new Map<string, string>();
    for (const batch of chunks(goneIds, 60)) {
      const staged = await request<Array<{ koper_id: string; sync_state: string; last_seen_at: string | null }>>("koper_staging_records", {
        query: new URLSearchParams({ select: "koper_id,sync_state,last_seen_at", company_id: company, source: "eq.koper", entity: "eq.bill_to_pay", koper_id: `in.(${batch.join(",")})`, limit: "200" }),
      });
      for (const row of staged) lastSeen.set(row.koper_id, `${row.sync_state} · visto por último em ${(row.last_seen_at ?? "?").slice(0, 10)}`);
    }

    for (const payable of mine) {
      const amount = cents(payable.amount);
      const supplier = Array.isArray(payable.suppliers) ? payable.suppliers[0]?.legal_name ?? null : payable.suppliers?.legal_name ?? null;
      const allocation = allocatedCents.get(payable.id) ?? { cents: 0, rows: 0 };
      const sourceId = payable.source_id ?? "";
      const match = /^koper_bill:(\d+)$/.exec(sourceId);
      const billId = match?.[1] ?? sourceId.replace(/^koper_bill:/, "");
      const bill = match?.[1] ? koper.get(match[1]) : undefined;
      const raw = match?.[1] ? asObject(bills.get(match[1])) : ({} as Json);
      const categories: string[] = [];
      const actions: string[] = [];
      let detail: string | null = null;

      if (!match) {
        categories.push("registro antigo sem número do Koper");
        actions.push("revisar à mão");
      } else if (!bill) {
        categories.push("não existe mais no Koper");
        actions.push(allocation.rows ? "cancelar no Elos OS (o rateio deixa de contar)" : "cancelar no Elos OS");
        // Outro título da obra com o mesmo fornecedor e o mesmo valor pode ser o que substituiu este no Koper.
        const twins = mine.filter((other) => other.id !== payable.id && other.supplier_id && other.supplier_id === payable.supplier_id
          && cents(other.amount) === amount && /^koper_bill:\d+$/.test(other.source_id ?? "") && koper.has((other.source_id ?? "").slice("koper_bill:".length)));
        const twinText = twins.length
          ? `possível substituto no Koper: parcela ${twins.slice(0, 3).map((other) => `${(other.source_id ?? "").slice("koper_bill:".length)} (venc. ${String(other.due_date ?? "?").slice(0, 10)}, ${other.status === "paid" ? "pago" : "em aberto"})`).join(", ")}${twins.length > 3 ? ` e mais ${twins.length - 3}` : ""}`
          : "nenhum título de mesmo fornecedor e valor no Koper";
        detail = `${lastSeen.get(billId) ?? "nunca visto pela rotina antiga"} | ${twinText}`;
      } else {
        if (bill.type === "Crédito") {
          categories.push("crédito de fornecedor lançado como despesa");
          actions.push(allocation.rows ? "cancelar no Elos OS (o rateio deixa de contar)" : "cancelar no Elos OS");
        } else if (bill.type === "Grupo") {
          const children = childrenByParent.get(billId) ?? [];
          const inElos = children.filter((child) => elosBillIds.has(child));
          const childrenCents = children.reduce((sum, child) => sum + (koper.get(child)?.amountCents ?? 0), 0);
          categories.push("pai de agrupamento");
          detail = `${inElos.length} de ${children.length} filhos no Elos OS · filhos somam ${money(childrenCents)}`;
          actions.push(children.length > 0 && inElos.length === children.length
            ? (allocation.rows ? "cancelar o pai (filhos já contam; o rateio do pai deixa de contar)" : "cancelar o pai (filhos já contam)")
            : "revisar à mão (nem todos os filhos estão no Elos OS)");
        } else {
          if (bill.amountCents !== amount) {
            categories.push("valor diferente");
            actions.push(allocation.rows === 0 ? `atualizar valor para ${money(bill.amountCents)}`
              : allocation.cents === amount ? `atualizar valor para ${money(bill.amountCents)} e ajustar o rateio na mesma proporção`
                : `atualizar valor para ${money(bill.amountCents)}; rateio já estava incompleto (${money(allocation.cents)}): revisar`);
          }
          const elosPaid = payable.status === "paid";
          if (bill.paid && !elosPaid) {
            categories.push("pago no Koper, aberto no Elos OS");
            actions.push(isoDate(raw.paymentDate) ? `dar baixa em ${isoDate(raw.paymentDate)}` : "dar baixa (pago via título pai de agrupamento)");
          } else if (!bill.paid && elosPaid) {
            categories.push("pago no Elos OS, aberto no Koper");
            actions.push("revisar à mão");
          }
          const elosDue = payable.due_date ? String(payable.due_date).slice(0, 10) : null;
          if (bill.dueDate && elosDue && bill.dueDate !== elosDue) {
            categories.push("vencimento diferente");
            actions.push(`atualizar vencimento para ${bill.dueDate}`);
          }
        }
      }
      if (categories.length === 0) continue;
      for (const category of categories) bump(byCategory, category, amount);
      for (const action of actions) bump(byAction, action.replace(/ para [\d.,-]+/g, "").replace(/ em \d{4}-\d{2}-\d{2}/, "").replace(/ \([\d.,]+\)/, ""), amount);
      rows.push({
        bill: billId,
        categories,
        action: actions.join(" + "),
        document: payable.document,
        supplier: supplier ? supplier.slice(0, 40) : null,
        elosAmount: money(amount),
        koperAmount: bill ? money(bill.amountCents) : null,
        elosStatus: payable.status,
        koperPaid: bill ? bill.paid : null,
        elosDue: payable.due_date ? String(payable.due_date).slice(0, 10) : null,
        koperDue: bill?.dueDate ?? null,
        koperPaidAt: bill ? isoDate(raw.paymentDate) : null,
        allocated: money(allocation.cents),
        allocationRows: allocation.rows,
        detail,
      });
    }
  }

  // Rateio incompleto ou sobrando em títulos que não entraram em nenhuma categoria acima.
  const listed = new Set(rows.map((row) => row.bill));
  const partial = new Map<string, Bucket>();
  for (const payable of payables) {
    const allocation = allocatedCents.get(payable.id);
    if (!allocation) continue;
    const billId = (payable.source_id ?? "").replace(/^koper_bill:/, "");
    if (listed.has(billId)) continue;
    const amount = cents(payable.amount);
    if (allocation.cents < amount) bump(partial, "rateio menor que o título (valores iguais ao Koper)", amount - allocation.cents);
    else if (allocation.cents > amount) bump(partial, "rateio maior que o título", allocation.cents - amount);
  }

  console.log("KOPER_FIX_PLAN", JSON.stringify({
    target: options.target,
    project: project.name,
    readOnly: true,
    titlesChecked: payables.length,
    titlesWithDifference: rows.length,
    byCategory: dump(byCategory),
    byAction: dump(byAction),
    otherAllocationGaps: dump(partial),
  }));
  for (const row of rows) console.log("KOPER_FIX_ROW", JSON.stringify(row));
  console.log("KOPER_FIX_DONE", JSON.stringify({ rows: rows.length }));
  return rows;
}
