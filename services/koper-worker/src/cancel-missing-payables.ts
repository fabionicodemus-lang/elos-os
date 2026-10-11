/**
 * Cancela no Elos OS os títulos que o Fábio autorizou cancelar por não existirem mais no Koper.
 *
 * Não apaga nada: muda `payables.status` de `open` para `cancelled` e anota o motivo. O vínculo
 * com o Koper (`source_system` / `source_id`) e as linhas de rateio ficam como estão — as telas
 * (Custo x Orçamento, contas a pagar) só leem títulos `open` e `paid`, então o rateio do título
 * cancelado deixa de contar sem ser removido.
 *
 * Travas (qualquer uma falhando, o título é pulado e listado):
 *   - o número do título está na lista aprovada (`TARGETS.<obra>.approvedCancellations`);
 *     título que sumir do Koper depois disso NÃO é cancelado sozinho;
 *   - a listagem espelhada de títulos da empresa está inteira (mínimo de registros) e o título
 *     não aparece nela;
 *   - o título no Elos OS é da obra alvo, veio do Koper e está `open` (pago nunca é cancelado).
 *
 *   KOPER_TOOL=payable-cancel KOPER_TOOL_TARGET=flow                        # plano (não grava)
 *   KOPER_TOOL=payable-cancel KOPER_TOOL_TARGET=flow KOPER_TOOL_WRITE=true  # grava
 *   KOPER_ALLOC_LIMIT=5                                                     # piloto: nº de títulos
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { type KoperCompany, type Requester, type TargetKey, TARGETS, allRows, cents, loadMirror, money, resolveProject } from "./mirror-shared.js";

type Payable = { id: string; source_system: string | null; source_id: string | null; amount: number; status: string; notes: string | null };

const MIN_MIRROR_BILLS = 1000;

export type CancelCheck = { ok: true } | { ok: false; reason: string };

/** Decide, sem tocar no banco, se um título aprovado pode ser cancelado agora. */
export function checkCancellation(payable: { status: string } | undefined, inKoper: boolean, mirrorBills: number): CancelCheck {
  if (!payable) return { ok: false, reason: "título não encontrado no Elos OS para esta obra" };
  if (mirrorBills < MIN_MIRROR_BILLS) return { ok: false, reason: "listagem espelhada do Koper incompleta" };
  if (inKoper) return { ok: false, reason: "título voltou a existir no Koper" };
  if (payable.status === "cancelled") return { ok: false, reason: "já está cancelado" };
  if (payable.status !== "open") return { ok: false, reason: `título está ${payable.status}: só título em aberto é cancelado` };
  return { ok: true };
}

export async function cancelMissingPayables(options: { write: boolean; target: TargetKey; limit: number }, request: Requester = requestSupabase) {
  const target = TARGETS[options.target];
  const approved = target.approvedCancellations;
  const project = await resolveProject(request, target);
  const company = `eq.${env.BOSSA_COMPANY_ID}`;
  if (!approved || approved.billIds.length === 0) {
    console.log("KOPER_CANCEL_PLAN", JSON.stringify({ target: options.target, project: project.name, approved: 0, note: "nenhum cancelamento aprovado para esta obra" }));
    return { cancelled: 0, verified: null };
  }
  const exclusive = (Object.entries(target.payableSources) as Array<[string, KoperCompany]>).filter(([, koperCompany]) => target.exclusiveCompanies.includes(koperCompany));
  const source = exclusive[0];
  if (exclusive.length !== 1 || !source) throw new Error("KOPER_CANCEL_NEEDS_ONE_EXCLUSIVE_COMPANY");
  const [sourceSystem, koperCompany] = source;

  const payables = await allRows<Payable>(request, "payables", {
    select: "id,source_system,source_id,amount,status,notes", company_id: company, project_id: `eq.${project.id}`, source_system: `eq.${sourceSystem}`, order: "id.asc",
  });
  const bySourceId = new Map(payables.map((payable) => [payable.source_id ?? "", payable]));
  const mirror = await loadMirror(request, "mirror.bill_to_pay", koperCompany);
  const allocations = await allRows<{ payable_id: string; allocation_amount: number }>(request, "payable_cost_allocations", {
    select: "payable_id,allocation_amount", company_id: company, project_id: `eq.${project.id}`, order: "id.asc",
  });
  const allocationOf = (payableId: string) => allocations.filter((row) => row.payable_id === payableId);

  const eligible: Array<{ billId: string; payable: Payable }> = [];
  const skipped: Array<{ bill: string; reason: string }> = [];
  for (const billId of approved.billIds) {
    const payable = bySourceId.get(`koper_bill:${billId}`);
    const check = checkCancellation(payable, mirror.has(billId), mirror.size);
    if (!check.ok || !payable) { skipped.push({ bill: billId, reason: check.ok ? "título não encontrado" : check.reason }); continue; }
    eligible.push({ billId, payable });
  }
  const selected = options.limit > 0 ? eligible.slice(0, options.limit) : eligible;
  const sum = (list: Array<{ payable: Payable }>) => money(list.reduce((total, item) => total + cents(item.payable.amount), 0));
  const allocatedRows = selected.flatMap((item) => allocationOf(item.payable.id));
  console.log("KOPER_CANCEL_PLAN", JSON.stringify({
    write: options.write,
    target: options.target,
    project: project.name,
    note: approved.note,
    approved: approved.billIds.length,
    mirrorBills: mirror.size,
    eligible: eligible.length,
    eligibleTotal: sum(eligible),
    thisRun: selected.length,
    thisRunTotal: sum(selected),
    thisRunWithAllocation: new Set(allocatedRows.map((row) => row.payable_id)).size,
    thisRunAllocationRows: allocatedRows.length,
    thisRunAllocated: money(allocatedRows.reduce((total, row) => total + cents(row.allocation_amount), 0)),
    skipped,
    bills: selected.map((item) => item.billId),
  }));
  if (!options.write || selected.length === 0) return { cancelled: 0, verified: options.write ? true : null };

  const today = new Date().toISOString().slice(0, 10);
  const mark = `Cancelado em ${today}: título não existe mais no Koper (${approved.note}).`;
  for (const item of selected) {
    const notes = [item.payable.notes?.trim() || null, mark].filter(Boolean).join(" | ");
    const updated = await request<Array<{ id: string }>>("payables", {
      method: "PATCH",
      body: { status: "cancelled", notes },
      prefer: "return=representation",
      query: new URLSearchParams({
        id: `eq.${item.payable.id}`, company_id: company, project_id: `eq.${project.id}`, status: "eq.open",
        source_system: `eq.${sourceSystem}`, source_id: `eq.koper_bill:${item.billId}`, select: "id",
      }),
    });
    if (updated.length !== 1) throw new Error(`KOPER_CANCEL_NOT_CONFIRMED_${item.billId}`);
  }

  // Conferência: relê os títulos e confere que o rateio deles continua intacto.
  const after = await allRows<Payable>(request, "payables", {
    select: "id,source_system,source_id,amount,status,notes", company_id: company, project_id: `eq.${project.id}`, source_system: `eq.${sourceSystem}`, order: "id.asc",
  });
  const afterById = new Map(after.map((payable) => [payable.id, payable]));
  const notCancelled = selected.filter((item) => afterById.get(item.payable.id)?.status !== "cancelled").map((item) => item.billId);
  const changedAmount = selected.filter((item) => cents(afterById.get(item.payable.id)?.amount) !== cents(item.payable.amount)).map((item) => item.billId);
  const allocationsAfter = await allRows<{ payable_id: string; allocation_amount: number }>(request, "payable_cost_allocations", {
    select: "payable_id,allocation_amount", company_id: company, project_id: `eq.${project.id}`, order: "id.asc",
  });
  const ids = new Set(selected.map((item) => item.payable.id));
  const rowsAfter = allocationsAfter.filter((row) => ids.has(row.payable_id));
  const untouchedOthers = after.filter((payable) => !ids.has(payable.id)).every((payable) => {
    const before = payables.find((entry) => entry.id === payable.id);
    return before !== undefined && before.status === payable.status;
  });
  const verified = notCancelled.length === 0 && changedAmount.length === 0 && rowsAfter.length === allocatedRows.length && untouchedOthers && after.length === payables.length;
  const byStatus: Record<string, number> = {};
  for (const payable of after) byStatus[payable.status] = (byStatus[payable.status] ?? 0) + 1;
  console.log("KOPER_CANCEL_RESULT", JSON.stringify({
    target: options.target, project: project.name, cancelled: selected.length, total: sum(selected), notCancelled, changedAmount,
    allocationRowsKept: rowsAfter.length, allocationRowsExpected: allocatedRows.length, otherTitlesUntouched: untouchedOthers,
    titlesInProject: after.length, byStatus, verified,
  }));
  if (!verified) throw new Error("KOPER_CANCEL_VERIFY_FAILED");
  return { cancelled: selected.length, verified };
}
