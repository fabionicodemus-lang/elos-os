import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cloneBudgetRevision } from "./actions";
import "../../../../preconstruction-95.css";

type Budget = { id: string; code: string; version: string; name: string; status: string; is_base: boolean; reference_date: string | null; updated_at: string };
type Item = { id: string; service_id: string | null; code: string | null; description: string; unit: string; quantity: number; unit_direct_cost: number; total_direct_cost: number };

type ComparisonRow = {
  key: string;
  code: string;
  description: string;
  unit: string;
  beforeQty: number;
  afterQty: number;
  beforeUnit: number;
  afterUnit: number;
  beforeTotal: number;
  afterTotal: number;
  quantityImpact: number;
  priceImpact: number;
  totalImpact: number;
};

function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function decimal(value: number, digits = 2) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function keyFor(item: Item) { return item.service_id || item.code || item.description.trim().toLocaleLowerCase("pt-BR"); }

function compare(before: Item[], after: Item[]): ComparisonRow[] {
  const beforeMap = new Map(before.map((item) => [keyFor(item), item]));
  const afterMap = new Map(after.map((item) => [keyFor(item), item]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  return keys.map((key) => {
    const a = beforeMap.get(key);
    const b = afterMap.get(key);
    const beforeQty = Number(a?.quantity ?? 0);
    const afterQty = Number(b?.quantity ?? 0);
    const beforeUnit = Number(a?.unit_direct_cost ?? 0);
    const afterUnit = Number(b?.unit_direct_cost ?? 0);
    const beforeTotal = Number(a?.total_direct_cost ?? 0);
    const afterTotal = Number(b?.total_direct_cost ?? 0);
    const quantityImpact = (afterQty - beforeQty) * beforeUnit;
    const priceImpact = afterQty * (afterUnit - beforeUnit);
    return {
      key,
      code: b?.code || a?.code || "—",
      description: b?.description || a?.description || "—",
      unit: b?.unit || a?.unit || "—",
      beforeQty, afterQty, beforeUnit, afterUnit, beforeTotal, afterTotal,
      quantityImpact,
      priceImpact,
      totalImpact: afterTotal - beforeTotal,
    };
  }).sort((a, b) => Math.abs(b.totalImpact) - Math.abs(a.totalImpact));
}

export default async function BudgetComparePage({ params, searchParams }: {
  params: Promise<{ budgetId: string }>;
  searchParams: Promise<{ against?: string; error?: string }>;
}) {
  const [{ budgetId }, query] = await Promise.all([params, searchParams]);
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("budgets.view");
  const budgetResult = await supabase.from("engineering_budgets").select("id, code, version, name, status, is_base, reference_date, updated_at, project_id").eq("company_id", companyId).eq("id", budgetId).maybeSingle();
  const budget = budgetResult.data as (Budget & { project_id: string }) | null;
  if (!budget) return <AppShell activeGroup="engineering" activeItem="budgets" eyebrow="Engenharia · Orçamento" title="Comparar revisões" description={company.name}><div className="pre95-empty">Revisão não localizada.</div></AppShell>;

  const revisionsResult = await supabase.from("engineering_budgets").select("id, code, version, name, status, is_base, reference_date, updated_at").eq("company_id", companyId).eq("project_id", budget.project_id).neq("status", "archived").order("updated_at", { ascending: false }).limit(200);
  const revisions = (revisionsResult.data ?? []) as Budget[];
  const against = revisions.find((item) => item.id === query.against)
    ?? revisions.find((item) => item.id !== budget.id && item.status === "approved")
    ?? revisions.find((item) => item.id !== budget.id)
    ?? null;
  const [currentItemsResult, againstItemsResult, manageResult] = await Promise.all([
    supabase.from("engineering_budget_items").select("id, service_id, code, description, unit, quantity, unit_direct_cost, total_direct_cost").eq("company_id", companyId).eq("budget_id", budget.id).eq("status", "active"),
    against ? supabase.from("engineering_budget_items").select("id, service_id, code, description, unit, quantity, unit_direct_cost, total_direct_cost").eq("company_id", companyId).eq("budget_id", against.id).eq("status", "active") : Promise.resolve({ data: [], error: null }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "budgets.manage" }),
  ]);
  const rows = against ? compare((againstItemsResult.data ?? []) as Item[], (currentItemsResult.data ?? []) as Item[]) : [];
  const beforeTotal = rows.reduce((sum, row) => sum + row.beforeTotal, 0);
  const afterTotal = rows.reduce((sum, row) => sum + row.afterTotal, 0);
  const quantityImpact = rows.reduce((sum, row) => sum + row.quantityImpact, 0);
  const priceImpact = rows.reduce((sum, row) => sum + row.priceImpact, 0);
  const changed = rows.filter((row) => Math.abs(row.totalImpact) > 0.005 || Math.abs(row.afterQty - row.beforeQty) > 0.000001 || Math.abs(row.afterUnit - row.beforeUnit) > 0.000001);
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const nextRevision = `R${String(revisions.length + 1).padStart(2, "0")}`;

  return (
    <AppShell activeGroup="engineering" activeItem="budgets" eyebrow="Engenharia · Orçamento" title="Comparar revisões"
      description={`${company.name} · ${budget.code} · ${budget.version} · impacto de quantidade e custo.`}
      actions={<><Link prefetch={false} className="elos-button" href={`/engenharia/orcamentos/${budget.id}`}>Abrir revisão</Link><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link></>}>
      {query.error ? <div className="auth-message error workspace-message">{query.error}</div> : null}
      <section className="pre95-selector">
        <div><span>Revisão atual</span><strong>{budget.code} · {budget.version} · {budget.name}</strong></div>
        <form method="get"><select name="against" defaultValue={against?.id ?? ""}><option value="">Escolha uma revisão</option>{revisions.filter((item) => item.id !== budget.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>)}</select><button type="submit">Comparar com</button></form>
      </section>

      {against ? <>
        <section className="pre95-summary">
          <article><span>Antes</span><strong>{money(beforeTotal)}</strong><small>{against.code} · {against.version}</small></article>
          <article><span>Depois</span><strong>{money(afterTotal)}</strong><small>{budget.code} · {budget.version}</small></article>
          <article className={afterTotal > beforeTotal ? "negative" : "positive"}><span>Impacto total</span><strong>{afterTotal - beforeTotal >= 0 ? "+" : ""}{money(afterTotal - beforeTotal)}</strong><small>{beforeTotal ? decimal((afterTotal - beforeTotal) / beforeTotal * 100, 2) : "0"}%</small></article>
          <article><span>Itens alterados</span><strong>{changed.length}</strong><small>de {rows.length}</small></article>
        </section>
        <section className="pre95-impact-split"><article><span>Efeito quantidade</span><strong>{quantityImpact >= 0 ? "+" : ""}{money(quantityImpact)}</strong></article><article><span>Efeito preço</span><strong>{priceImpact >= 0 ? "+" : ""}{money(priceImpact)}</strong></article></section>
        <section className="pre95-card">
          <div className="pre95-heading"><div><span>Memória de revisão</span><h2>O que mudou</h2></div><p>Ordenado pelo maior impacto financeiro absoluto.</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Código</th><th>Serviço</th><th>Qtd. antes</th><th>Qtd. depois</th><th>Preço antes</th><th>Preço depois</th><th>Impacto qtd.</th><th>Impacto preço</th><th>Δ total</th></tr></thead><tbody>
            {changed.map((row) => <tr key={row.key}><td><strong>{row.code}</strong></td><td>{row.description}<small>{row.unit}</small></td><td>{decimal(row.beforeQty, 3)}</td><td>{decimal(row.afterQty, 3)}</td><td>{money(row.beforeUnit)}</td><td>{money(row.afterUnit)}</td><td>{row.quantityImpact >= 0 ? "+" : ""}{money(row.quantityImpact)}</td><td>{row.priceImpact >= 0 ? "+" : ""}{money(row.priceImpact)}</td><td><strong className={row.totalImpact > 0 ? "negative" : row.totalImpact < 0 ? "positive" : ""}>{row.totalImpact >= 0 ? "+" : ""}{money(row.totalImpact)}</strong></td></tr>)}
            {!changed.length ? <tr><td colSpan={9}>As duas revisões não possuem diferenças financeiras relevantes.</td></tr> : null}
          </tbody></table></div>
        </section>
      </> : <div className="pre95-empty">Não existe outra revisão para comparar.</div>}

      {canManage && budget.status === "approved" ? <section className="pre95-card pre95-clone"><div className="pre95-heading"><div><span>Nova revisão</span><h2>Preservar este snapshot e continuar trabalhando</h2></div><p>A revisão aprovada permanece congelada.</p></div><form action={cloneBudgetRevision}><input type="hidden" name="budget_id" value={budget.id} /><label><span>Nova revisão</span><input name="version" defaultValue={nextRevision} required /></label><label><span>Nome</span><input name="name" defaultValue={budget.name} /></label><button type="submit">Criar nova revisão</button></form></section> : null}
    </AppShell>
  );
}