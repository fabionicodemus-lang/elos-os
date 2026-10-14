import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { loadCostVsBudget } from "@/lib/cost-vs-budget/server";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  addBudgetAmendmentItem,
  approveBudgetAmendment,
  cancelBudgetAmendment,
  configureBudgetAdjustment,
  createBudgetAmendment,
} from "./actions";
import "../../../../preconstruction-95.css";

type Budget = {
  id: string; code: string; version: string; name: string; status: string; reference_date: string | null;
  adjustment_enabled: boolean; correction_index_id: string | null; correction_base_month: string | null; correction_base_value: number | null;
};
type Index = { id: string; code: string; name: string; value_type: string; unit_label: string; source_name: string | null };
type BudgetItem = { id: string; service_id: string | null; code: string | null; description: string; total_direct_cost: number };
type Amendment = {
  id: string; code: string; description: string; approval_date: string | null; status: string; adjustment_enabled: boolean;
  correction_index_id: string | null; correction_index_code: string | null; correction_base_month: string | null;
  correction_base_value: number | null; correction_factor: number; nominal_amount: number; current_amount: number;
};
type AmendmentItem = { amendment_id: string; service_code_snapshot: string | null; service_name_snapshot: string; amount: number };

function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value ?? 0)); }
function decimal(value: number | null | undefined, digits = 3) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0)); }
function monthBR(value: string | null | undefined) { if (!value) return "—"; const [y,m] = value.slice(0,7).split("-"); return `${m}/${y}`; }
function dateBR(value: string | null | undefined) { if (!value) return "—"; const [y,m,d] = value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }

export default async function BudgetAdjustmentPage({ params, searchParams }: {
  params: Promise<{ budgetId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const [{ budgetId }, query] = await Promise.all([params, searchParams]);
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("budgets.view");
  const [budgetResult, indicesResult, itemsResult, amendmentsResult, amendmentItemsResult, manageResult] = await Promise.all([
    supabase.from("engineering_budgets").select("id, code, version, name, status, reference_date, adjustment_enabled, correction_index_id, correction_base_month, correction_base_value, project_id").eq("company_id", companyId).eq("id", budgetId).maybeSingle(),
    supabase.from("correction_indices").select("id, code, name, value_type, unit_label, source_name").eq("company_id", companyId).eq("status", "active").order("code"),
    supabase.from("engineering_budget_items").select("id, service_id, code, description, total_direct_cost").eq("company_id", companyId).eq("budget_id", budgetId).eq("status", "active").order("sort_order"),
    supabase.from("engineering_budget_amendments_current").select("id, code, description, approval_date, status, adjustment_enabled, correction_index_id, correction_index_code, correction_base_month, correction_base_value, correction_factor, nominal_amount, current_amount").eq("company_id", companyId).eq("budget_id", budgetId).order("approval_date", { ascending: false }),
    supabase.from("engineering_budget_amendment_items").select("amendment_id, service_code_snapshot, service_name_snapshot, amount").eq("company_id", companyId).eq("budget_id", budgetId),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "budgets.manage" }),
  ]);
  const budget = budgetResult.data as (Budget & { project_id: string }) | null;
  const indices = (indicesResult.data ?? []) as Index[];
  const items = (itemsResult.data ?? []) as BudgetItem[];
  const amendments = (amendmentsResult.data ?? []) as Amendment[];
  const amendmentItems = (amendmentItemsResult.data ?? []) as AmendmentItem[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  if (!budget) return <AppShell activeGroup="engineering" activeItem="budgets" eyebrow="Engenharia · Orçamento" title="Reajuste do orçamento" description={company.name}><div className="pre95-empty">Orçamento não localizado.</div></AppShell>;

  const costContext = await loadCostVsBudget({ supabase, companyId, projectId: budget.project_id, budgetId: budget.id });
  const nominalBudget = items.reduce((sum, item) => sum + Number(item.total_direct_cost || 0), 0);
  const currentIndex = indices.find((item) => item.id === budget.correction_index_id) ?? null;
  let factor = 1;
  if (budget.adjustment_enabled && budget.correction_index_id && budget.correction_base_month) {
    const result = await supabase.rpc("engineering_correction_factor", {
      p_company_id: companyId,
      p_index_id: budget.correction_index_id,
      p_base_month: budget.correction_base_month,
      p_target_month: new Date().toISOString().slice(0,10),
      p_base_value: budget.correction_base_value,
    });
    factor = Number(result.data ?? 1);
  }
  const approvedAmendments = amendments.filter((item) => item.status === "approved");
  const nominalAmendments = approvedAmendments.reduce((sum, item) => sum + Number(item.nominal_amount || 0), 0);
  const currentAmendments = approvedAmendments.reduce((sum, item) => sum + Number(item.current_amount || 0), 0);
  const nominalReference = nominalBudget + nominalAmendments;
  const currentBudgetReference = nominalBudget * factor + currentAmendments;
  const adjustmentGain = currentBudgetReference - nominalReference;
  const weightedFactor = Math.abs(nominalReference) > 0.01 ? currentBudgetReference / nominalReference : 1;
  const forecastCost = Number(costContext.totals.forecast || 0);
  const nominalBalance = nominalReference - forecastCost;
  // Regra conservadora: só o saldo positivo remanescente recebe atualização. Um
  // estouro não é "curado" pelo índice e permanece negativo em valor nominal.
  const adjustedBalance = nominalBalance > 0 ? nominalBalance * weightedFactor : nominalBalance;
  const balanceAdjustmentGain = adjustedBalance - nominalBalance;

  return (
    <AppShell activeGroup="engineering" activeItem="budgets" eyebrow="Engenharia · Orçamento" title="Reajuste mensal do orçamento"
      description={`${company.name} · ${budget.code} · ${budget.version} · ${budget.name}.`}
      actions={<><Link prefetch={false} className="elos-button" href={`/engenharia/orcamentos/${budget.id}`}>Abrir orçamento</Link><Link prefetch={false} className="elos-button" href="/engenharia/custo-orcamento">Custos × Orçamento</Link></>}>
      {query.success ? <div className="auth-message success workspace-message">{query.success}</div> : null}
      {query.error ? <div className="auth-message error workspace-message">{query.error}</div> : null}
      {(budgetResult.error || amendmentsResult.error) ? <div className="auth-message error workspace-message">A tela exige as migrations do pacote Pré-Obra 9.5.</div> : null}

      <section className="pre95-summary">
        <article><span>Orçamento nominal + aditivos</span><strong>{money(nominalReference)}</strong><small>{money(nominalBudget)} base · {money(nominalAmendments)} aditivos</small></article>
        <article><span>Custo previsto / comprometido</span><strong>{money(forecastCost)}</strong><small>controle atual da obra</small></article>
        <article><span>Saldo nominal</span><strong>{money(nominalBalance)}</strong><small>sem correção monetária</small></article>
        <article className={adjustedBalance >= 0 ? "positive" : "negative"}><span>Saldo reajustado</span><strong>{money(adjustedBalance)}</strong><small>{balanceAdjustmentGain >= 0 ? "+" : ""}{money(balanceAdjustmentGain)} pelo índice</small></article>
        <article><span>Referência atualizada</span><strong>{money(currentBudgetReference)}</strong><small>base + aditivos no índice atual</small></article>
        <article className={adjustmentGain > 0 ? "positive" : ""}><span>Efeito bruto dos índices</span><strong>{adjustmentGain >= 0 ? "+" : ""}{money(adjustmentGain)}</strong><small>memória de referência</small></article>
      </section>

      <div className="auth-message warning workspace-message">
        Regra do Elos: custos já realizados ou comprometidos não são reindexados retroativamente. O índice atualiza o saldo positivo ainda disponível. Se a obra estiver estourada, o saldo negativo não é reduzido pelo reajuste.
      </div>

      <section className="pre95-card">
        <div className="pre95-heading"><div><span>Política de reajuste</span><h2>O orçamento será reajustado mensalmente?</h2></div><p>O snapshot nominal permanece intacto. O saldo positivo disponível é apresentado também em valor reajustado.</p></div>
        {canManage ? <form action={configureBudgetAdjustment} className="pre95-form-grid">
          <input type="hidden" name="budget_id" value={budget.id} />
          <label className="pre95-toggle"><input type="checkbox" name="adjustment_enabled" defaultChecked={budget.adjustment_enabled} /><span>Reajustado?</span></label>
          <label><span>Índice</span><select name="correction_index_id" defaultValue={budget.correction_index_id ?? ""}><option value="">Selecione</option>{indices.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label><span>Competência-base</span><input type="month" name="correction_base_month" defaultValue={budget.correction_base_month?.slice(0,7) ?? budget.reference_date?.slice(0,7) ?? ""} /></label>
          <button type="submit">Salvar política</button>
        </form> : null}
        <div className="pre95-index-memory">
          <div><span>Situação</span><strong>{budget.adjustment_enabled ? "Reajuste ativo" : "Sem reajuste"}</strong></div>
          <div><span>Índice</span><strong>{currentIndex?.code ?? "—"}</strong><small>{currentIndex?.source_name ?? ""}</small></div>
          <div><span>Base</span><strong>{monthBR(budget.correction_base_month)}</strong><small>{budget.correction_base_value ? decimal(budget.correction_base_value, 4) : "valor-base ainda não informado"}</small></div>
          <div><span>Fator ponderado atual</span><strong>{decimal(weightedFactor, 6)}×</strong><small>{decimal((weightedFactor - 1) * 100, 3)}%</small></div>
        </div>
      </section>

      {canManage ? <section className="pre95-card">
        <div className="pre95-heading"><div><span>Novo aditivo</span><h2>Acrescentar ou reduzir orçamento</h2></div><p>O aditivo nasce em rascunho, recebe itens por centro de custo e só entra no controle depois da aprovação.</p></div>
        <form action={createBudgetAmendment} className="pre95-form-grid">
          <input type="hidden" name="budget_id" value={budget.id} />
          <label><span>Código</span><input name="code" placeholder="ADT-01" required /></label>
          <label className="pre95-wide"><span>Descrição</span><input name="description" placeholder="Ex.: Alteração de fachada / reforço estrutural" required /></label>
          <label><span>Data do aditivo</span><input type="date" name="approval_date" /></label>
          <label className="pre95-toggle"><input type="checkbox" name="adjustment_enabled" defaultChecked={budget.adjustment_enabled} /><span>Reajustado?</span></label>
          <label><span>Índice</span><select name="correction_index_id" defaultValue={budget.correction_index_id ?? ""}><option value="">Herdar do orçamento</option>{indices.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label className="pre95-wide"><span>Observações</span><input name="notes" /></label>
          <button type="submit">Criar aditivo</button>
        </form>
      </section> : null}

      <section className="pre95-card">
        <div className="pre95-heading"><div><span>Aditivos</span><h2>Memória contratual do orçamento</h2></div><p>Valores aprovados são congelados; o valor corrente acompanha o índice configurado.</p></div>
        <div className="pre95-amendments">
          {amendments.map((amendment) => {
            const rows = amendmentItems.filter((item) => item.amendment_id === amendment.id);
            return <article key={amendment.id} className={`pre95-amendment status-${amendment.status}`}>
              <header><div><span>{amendment.status === "approved" ? "Aprovado" : amendment.status === "cancelled" ? "Cancelado" : "Rascunho"}</span><h3>{amendment.code} · {amendment.description}</h3><small>{dateBR(amendment.approval_date)} · {amendment.adjustment_enabled ? `${amendment.correction_index_code ?? "índice"} desde ${monthBR(amendment.correction_base_month)}` : "sem reajuste"}</small></div><div><strong>{money(amendment.nominal_amount)}</strong><small>atual: {money(amendment.current_amount)} · fator {decimal(amendment.correction_factor, 5)}×</small></div></header>
              {rows.length ? <div className="pre95-amendment-items">{rows.map((row, index) => <div key={`${amendment.id}-${index}`}><span>{row.service_code_snapshot || "—"} · {row.service_name_snapshot}</span><strong>{money(row.amount)}</strong></div>)}</div> : null}
              {canManage && amendment.status === "draft" ? <div className="pre95-amendment-actions">
                <form action={addBudgetAmendmentItem}><input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="amendment_id" value={amendment.id} /><select name="budget_item_id"><option value="">Ajuste geral</option>{items.map((item) => <option key={item.id} value={item.id}>{item.code ?? "—"} · {item.description}</option>)}</select><input name="amount" inputMode="decimal" placeholder="Valor (+ ou -)" required /><input name="notes" placeholder="Observação" /><button type="submit">Adicionar item</button></form>
                <form action={approveBudgetAmendment}><input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="amendment_id" value={amendment.id} /><button type="submit">Aprovar aditivo</button></form>
              </div> : null}
              {canManage && amendment.status === "approved" ? <form action={cancelBudgetAmendment} className="pre95-cancel"><input type="hidden" name="budget_id" value={budget.id} /><input type="hidden" name="amendment_id" value={amendment.id} /><button type="submit">Cancelar aditivo</button></form> : null}
            </article>;
          })}
          {!amendments.length ? <div className="pre95-empty">Nenhum aditivo cadastrado.</div> : null}
        </div>
      </section>
    </AppShell>
  );
}