import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { abcSummary, classifyAbc } from "@/lib/preconstruction/abc.mjs";
import "../../preconstruction-95.css";

type Budget = { id: string; code: string; version: string; name: string; status: string; is_base: boolean; updated_at: string };
type ServiceRow = { budget_item_id: string; code: string | null; description: string; unit: string; quantity: number; unit_direct_cost: number; total_direct_cost: number };
type InputRow = { input_id: string; code: string; description: string; unit: string; category: string; planned_quantity: number; weighted_unit_price: number; total_cost: number };

function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function decimal(value: number, digits = 1) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }

export default async function AbcPage({ searchParams }: { searchParams: Promise<{ budget?: string; tab?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("budgets.view");
  const budgetsResult = projectId
    ? await supabase.from("engineering_budgets").select("id, code, version, name, status, is_base, updated_at").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(200)
    : { data: [], error: null };
  const budgets = (budgetsResult.data ?? []) as Budget[];
  const budget = budgets.find((item) => item.id === params.budget)
    ?? budgets.find((item) => item.is_base && item.status === "approved")
    ?? budgets.find((item) => item.status === "approved")
    ?? budgets[0]
    ?? null;
  const tab = params.tab === "inputs" ? "inputs" : "services";

  const [servicesResult, inputsResult] = budget ? await Promise.all([
    supabase.from("engineering_budget_abc_services").select("budget_item_id, code, description, unit, quantity, unit_direct_cost, total_direct_cost").eq("company_id", companyId).eq("budget_id", budget.id),
    supabase.from("engineering_budget_abc_inputs").select("input_id, code, description, unit, category, planned_quantity, weighted_unit_price, total_cost").eq("company_id", companyId).eq("budget_id", budget.id),
  ]) : [{ data: [], error: null }, { data: [], error: null }];

  const serviceRows = classifyAbc(((servicesResult.data ?? []) as ServiceRow[]).map((row) => ({ id: row.budget_item_id, label: row.description, value: Number(row.total_direct_cost), ...row })));
  const inputRows = classifyAbc(((inputsResult.data ?? []) as InputRow[]).map((row) => ({ id: row.input_id, label: row.description, value: Number(row.total_cost), ...row })));
  const currentRows = tab === "inputs" ? inputRows : serviceRows;
  const summary = abcSummary(currentRows);
  const total = currentRows.reduce((sum, row) => sum + Number(row.value), 0);
  const schemaMissing = Boolean(servicesResult.error || inputsResult.error);

  return (
    <AppShell activeGroup="engineering" activeItem="abc" eyebrow="Engenharia · Orçamento" title="Curva ABC"
      description={`${company.name} · serviços e insumos ordenados por impacto financeiro.`}
      actions={<><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link>{budget ? <Link prefetch={false} className="elos-button" href={`/engenharia/orcamentos/${budget.id}`}>Abrir orçamento</Link> : null}</>}>
      {!projectId ? <div className="pre95-empty">Selecione uma obra.</div> : null}
      {projectId && !budget ? <div className="pre95-empty">A obra ainda não possui orçamento.</div> : null}
      {schemaMissing ? <div className="auth-message error workspace-message">A Curva ABC exige a migration do pacote Pré-Obra 9.5.</div> : null}
      {budget ? <>
        <section className="pre95-selector">
          <div><span>Revisão analisada</span><strong>{budget.code} · {budget.version} · {budget.name}</strong></div>
          <form method="get"><select name="budget" defaultValue={budget.id}>{budgets.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}{item.is_base ? " · BASE" : ""}</option>)}</select><input type="hidden" name="tab" value={tab} /><button type="submit">Abrir</button></form>
        </section>

        <nav className="pre95-tabs"><Link prefetch={false} className={tab === "services" ? "active" : ""} href={`?budget=${budget.id}&tab=services`}>ABC de serviços</Link><Link prefetch={false} className={tab === "inputs" ? "active" : ""} href={`?budget=${budget.id}&tab=inputs`}>ABC de insumos</Link></nav>

        <section className="pre95-summary">
          <article><span>Valor analisado</span><strong>{money(total)}</strong><small>{currentRows.length} item(ns)</small></article>
          <article className="abc-a"><span>Classe A</span><strong>{summary.A.count}</strong><small>{money(summary.A.value)}</small></article>
          <article className="abc-b"><span>Classe B</span><strong>{summary.B.count}</strong><small>{money(summary.B.value)}</small></article>
          <article className="abc-c"><span>Classe C</span><strong>{summary.C.count}</strong><small>{money(summary.C.value)}</small></article>
        </section>

        <section className="pre95-card">
          <div className="pre95-heading"><div><span>Priorização 80 / 15 / 5</span><h2>{tab === "inputs" ? "Insumos que concentram o custo" : "Serviços que concentram o orçamento"}</h2></div><p>A = até ~80% acumulado · B = até ~95% · C = restante.</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>#</th><th>Classe</th><th>Código</th><th>{tab === "inputs" ? "Insumo" : "Serviço"}</th><th>Qtd.</th><th>Un.</th><th>Unitário</th><th>Valor</th><th>%</th><th>% acum.</th></tr></thead><tbody>
            {currentRows.map((row) => <tr key={row.id} className={`abc-row abc-${row.classification.toLowerCase()}`}><td>{row.rank}</td><td><strong className={`abc-badge abc-${row.classification.toLowerCase()}`}>{row.classification}</strong></td><td><strong>{String(row.code ?? "—")}</strong></td><td>{row.label}</td><td>{decimal(Number(tab === "inputs" ? row.planned_quantity : row.quantity), 3)}</td><td>{String(row.unit ?? "—")}</td><td>{money(Number(tab === "inputs" ? row.weighted_unit_price : row.unit_direct_cost))}</td><td><strong>{money(row.value)}</strong></td><td>{decimal(row.percentage, 2)}%</td><td>{decimal(row.accumulatedPercentage, 2)}%</td></tr>)}
            {!currentRows.length ? <tr><td colSpan={10}>Nenhum item disponível para classificar.</td></tr> : null}
          </tbody></table></div>
        </section>
      </> : null}
    </AppShell>
  );
}