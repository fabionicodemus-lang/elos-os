import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { generateSupplyPlanFromSchedule, updateSupplyPlanItem } from "./actions";
import "../../supply-plan.css";

type Project = { id: string; code: string | null; name: string };
type Baseline = { id: string; code: string; name: string; version: string; status: "draft" | "review" | "approved" | "archived" };
type Supplier = { id: string; legal_name: string; trade_name: string | null };
type Status = "planned" | "quotation" | "approval" | "ordered" | "partial" | "delivered" | "canceled";
type View = "all" | "crit" | "open" | "done";
type Item = {
  id: string; baseline_id: string; input_id: string; supplier_id: string | null; code: string; name: string;
  unit_snapshot: string; category_snapshot: string; required_quantity: number; available_stock: number; physical_stock: number; reserved_stock: number; consumed_stock: number; stock_observed_at: string | null; purchase_quantity: number;
  planned_unit_cost: number; planned_total_cost: number; first_use_date: string; quotation_lead_days: number;
  purchasing_lead_days: number; delivery_lead_days: number; safety_days: number; quotation_start: string;
  order_deadline: string; delivery_deadline: string; status: Status; responsible: string | null; notes: string | null;
};

const statusLabels: Record<Status, string> = { planned: "Planejado", quotation: "Em cotação", approval: "Em aprovação", ordered: "Pedido emitido", partial: "Entrega parcial", delivered: "Entregue", canceled: "Cancelado" };
const categoryLabels: Record<string, string> = { material: "Material", equipment: "Equipamento", freight: "Frete", other: "Outro" };
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value)) : "—"; }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function quantity(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value || 0)); }
function addDays(value: Date, days: number) { const result = new Date(value); result.setUTCDate(result.getUTCDate() + days); return result; }
function risk(item: Item, today: Date) {
  if (["delivered", "canceled"].includes(item.status)) return { key: "controlled", label: item.status === "canceled" ? "Cancelado" : "Entregue" };
  if (["ordered", "partial"].includes(item.status)) return { key: "receiving", label: item.status === "partial" ? "Entrega parcial" : "Aguardando entrega" };
  if (today > parseDate(item.delivery_deadline)) return { key: "critical", label: "Entrega vencida" };
  if (today > parseDate(item.order_deadline)) return { key: "order", label: "Pedido vencido" };
  if (today >= parseDate(item.quotation_start)) return { key: "quotation", label: "Cotar agora" };
  return { key: "future", label: "No prazo" };
}

export default async function SupplyPlanPage({ searchParams }: {
  searchParams: Promise<{ baseline?: string; q?: string; status?: string; risk?: string; category?: string; view?: string; horizon?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, companyId, projectId, roleKey } = await requireCompanyPermission("supply_plan.view");
  const [projectResult, baselinesResult, suppliersResult, itemsResult, manageResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<Baseline>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_baselines").select("id, code, name, version, status").eq("company_id", companyId).eq("project_id", projectId).order("updated_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Baseline[], error }; }) : Promise.resolve({ data: [] as Baseline[], error: null }),
    fetchAllRows<Supplier>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id, legal_name, trade_name").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to); return { data: (data ?? []) as Supplier[], error }; }),
    projectId ? fetchAllRows<Item>(async (from, to) => { const { data, error } = await supabase.from("engineering_supply_plan_items").select("id, baseline_id, input_id, supplier_id, code, name, unit_snapshot, category_snapshot, required_quantity, available_stock, physical_stock, reserved_stock, consumed_stock, stock_observed_at, purchase_quantity, planned_unit_cost, planned_total_cost, first_use_date, quotation_lead_days, purchasing_lead_days, delivery_lead_days, safety_days, quotation_start, order_deadline, delivery_deadline, status, responsible, notes").eq("company_id", companyId).eq("project_id", projectId).eq("record_status", "active").order("order_deadline").range(from, to); return { data: (data ?? []) as Item[], error }; }) : Promise.resolve({ data: [] as Item[], error: null }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "supply_plan.manage" }),
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selected = baselines.find((item) => item.id === params.baseline) ?? baselines.find((item) => item.status === "approved") ?? baselines.find((item) => item.status !== "archived") ?? baselines[0] ?? null;
  const supplierMap = new Map(suppliersResult.data.map((item) => [item.id, item]));
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const view: View = ["crit", "open", "done"].includes(params.view ?? "") ? params.view as View : "all";
  const horizon = [30, 60, 90, 180, 365].includes(Number(params.horizon)) ? Number(params.horizon) : 90;
  const horizonEnd = addDays(today, horizon);
  const all = selected ? itemsResult.data.filter((item) => item.baseline_id === selected.id) : [];
  const isDone = (item: Item) => ["ordered", "partial", "delivered"].includes(item.status);
  const isOpen = (item: Item) => ["planned", "quotation", "approval"].includes(item.status);
  const isLate = (item: Item) => ["critical", "order"].includes(risk(item, today).key);
  const filtered = all.filter((item) => {
    const itemRisk = risk(item, today);
    if (view === "crit" && !isLate(item)) return false;
    if (view === "open" && !isOpen(item)) return false;
    if (view === "done" && !isDone(item)) return false;
    if (parseDate(item.first_use_date) > horizonEnd) return false;
    if (params.status && item.status !== params.status) return false;
    if (params.risk && itemRisk.key !== params.risk) return false;
    if (params.category && item.category_snapshot !== params.category) return false;
    if (!queryText) return true;
    const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null;
    return [item.code, item.name, item.responsible, supplier?.legal_name, supplier?.trade_name].join(" ").toLocaleLowerCase("pt-BR").includes(queryText);
  });
  const total = all.reduce((sum, item) => sum + Number(item.planned_total_cost || 0), 0);
  const ordered = all.filter(isDone).reduce((sum, item) => sum + Number(item.planned_total_cost || 0), 0);
  const overdueOrders = all.filter((item) => risk(item, today).key === "order");
  const next30 = addDays(today, 30);
  const due30 = all.filter((item) => isOpen(item) && parseDate(item.order_deadline) >= today && parseDate(item.order_deadline) <= next30);
  const due30Value = due30.reduce((sum, item) => sum + Number(item.planned_total_cost || 0), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const baseQuery = selected ? `baseline=${encodeURIComponent(selected.id)}` : "";
  const chipHref = (next: View) => `?${[baseQuery, next === "all" ? "" : `view=${next}`, `horizon=${horizon}`].filter(Boolean).join("&")}`;

  return (
    <AppShell activeGroup="engineering" activeItem="supply-plan" eyebrow="Pré-Obra · Planejamento da obra" title="Planejamento de Suprimentos"
      description="Necessidades das composições × cronograma, descontado o estoque"
      actions={<><Link prefetch={false} className="elos-button" href={selected ? `/engenharia/cronograma?baseline=${selected.id}` : "/engenharia/cronograma"}>Abrir cronograma</Link>{canManage && selected ? <form action={generateSupplyPlanFromSchedule}><input type="hidden" name="baseline_id" value={selected.id} /><button className="elos-button" type="submit">Sincronizar suprimentos</button></form> : null}</>}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {itemsResult.error ? <div className="auth-message error workspace-message">Execute a migration <strong>20260727_0025_engineering_supply_plan.sql</strong> no Supabase.</div> : null}
      {!projectId ? <div className="supply-plan-empty">Selecione uma obra no topo.</div> : null}

      <section className="supply-plan-kpis">
        <article><span>Insumos planejados</span><strong>{all.length}</strong><small>materiais e equipamentos</small></article>
        <article><span>Valor a comprar</span><strong>{money(total)}</strong><small>já descontado o estoque</small></article>
        <article className="preobra-kpi-ok"><span>Pedido emitido / entregue</span><strong>{money(ordered)}</strong><small>{total ? (ordered / total * 100).toFixed(1) : "0,0"}% do plano</small></article>
        <article className={overdueOrders.length ? "preobra-kpi-bad" : ""}><span>Pedido vencido</span><strong>{overdueOrders.length}</strong><small>{overdueOrders[0]?.name ?? "nenhum vencido"}</small></article>
        <article className={due30.length ? "preobra-kpi-warn" : ""}><span>Pedir em 30 dias</span><strong>{due30.length}</strong><small>{money(due30Value)}</small></article>
      </section>

      <section className="preobra-filter-shell">
        <nav className="preobra-chips" aria-label="Situação dos suprimentos">
          <Link prefetch={false} className={view === "all" ? "active" : ""} href={chipHref("all")}>Todos <small>{all.length}</small></Link>
          <Link prefetch={false} className={view === "crit" ? "active" : ""} href={chipHref("crit")}>Atrasados <small>{all.filter(isLate).length}</small></Link>
          <Link prefetch={false} className={view === "open" ? "active" : ""} href={chipHref("open")}>A comprar <small>{all.filter(isOpen).length}</small></Link>
          <Link prefetch={false} className={view === "done" ? "active" : ""} href={chipHref("done")}>Pedidos <small>{all.filter(isDone).length}</small></Link>
        </nav>
        <form method="get">
          {selected ? <input type="hidden" name="baseline" value={selected.id} /> : null}<input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={params.q ?? ""} placeholder="Insumo ou serviço" />
          <select name="baseline" defaultValue={selected?.id ?? ""}>{baselines.map((item) => <option key={item.id} value={item.id}>Linha {item.code} · {item.version}</option>)}</select>
          <select name="horizon" defaultValue={String(horizon)}><option value="30">Primeiro uso: 30 dias</option><option value="60">Primeiro uso: 60 dias</option><option value="90">Primeiro uso: 90 dias</option><option value="180">Primeiro uso: 180 dias</option><option value="365">Primeiro uso: 1 ano</option></select>
          <button type="submit">Filtrar</button>
        </form>
      </section>

      <section className="supply-plan-table-card"><div className="budget-section-head"><div><span>Agenda de compras</span><h2>Necessidades vinculadas às composições</h2></div><p>{filtered.length} insumo(s)</p></div><div className="registry-table-wrap"><table className="registry-table supply-plan-table"><thead><tr><th>Insumo</th><th>Necessidade</th><th>Estoque</th><th>Comprar</th><th>Cotar</th><th>Pedido até</th><th>Entrega até</th><th>1º uso</th><th>Valor</th><th>Status / risco</th><th>Ação</th></tr></thead><tbody>
        {filtered.map((item) => { const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null; const itemRisk = risk(item, today); return <tr key={item.id}><td><strong>{item.code}</strong><span>{item.name}</span><small>{categoryLabels[item.category_snapshot] ?? item.category_snapshot} · {supplier?.trade_name || supplier?.legal_name || "Fornecedor não definido"}</small></td><td><strong>{quantity(Number(item.required_quantity))}</strong><small>{item.unit_snapshot}</small></td><td>{quantity(Number(item.available_stock))}<small>Físico {quantity(item.physical_stock)} · reservado {quantity(item.reserved_stock)} · consumido {quantity(item.consumed_stock)}</small><small>Estoque da obra · {item.stock_observed_at ? new Date(item.stock_observed_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "sincronização pendente"}</small></td><td><strong>{quantity(Number(item.purchase_quantity))}</strong><small>{item.unit_snapshot}</small></td><td>{dateBR(item.quotation_start)}</td><td><strong>{dateBR(item.order_deadline)}</strong></td><td>{dateBR(item.delivery_deadline)}</td><td><strong>{dateBR(item.first_use_date)}</strong></td><td><strong>{money(Number(item.planned_total_cost))}</strong><small>{money(Number(item.planned_unit_cost))}/{item.unit_snapshot}</small></td><td><span className={`supply-status status-${item.status}`}>{statusLabels[item.status]}</span><span className={`supply-risk risk-${itemRisk.key}`}>{itemRisk.label}</span></td><td>{canManage ? <details className="contract-edit supply-edit"><summary>Editar</summary><div className="contract-edit-popover supply-edit-popover"><form action={updateSupplyPlanItem}><input type="hidden" name="baseline_id" value={selected?.id ?? ""} /><input type="hidden" name="item_id" value={item.id} /><h3>{item.code} · {item.name}</h3><div className="contract-edit-grid"><label>Fornecedor<select name="supplier_id" defaultValue={item.supplier_id ?? ""}><option value="">Não definido</option>{suppliersResult.data.map((option) => <option key={option.id} value={option.id}>{option.trade_name || option.legal_name}</option>)}</select></label><label>Responsável<input name="responsible" defaultValue={item.responsible ?? ""} /></label><label>Primeiro uso<input name="first_use_date" type="date" defaultValue={item.first_use_date} required /></label><label>Estoque disponível<input readOnly value={quantity(item.available_stock)} /><small>Origem: estoque da obra · físico {quantity(item.physical_stock)} · reservado {quantity(item.reserved_stock)} · consumido {quantity(item.consumed_stock)} · conferido {item.stock_observed_at ? new Date(item.stock_observed_at).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo"}) : "ainda não sincronizado"}</small></label><label>Preço unitário<input name="planned_unit_cost" type="number" min="0" step="0.000001" defaultValue={Number(item.planned_unit_cost)} /></label><label>Dias para cotação<input name="quotation_lead_days" type="number" min="0" defaultValue={item.quotation_lead_days} /></label><label>Dias para aprovação/pedido<input name="purchasing_lead_days" type="number" min="0" defaultValue={item.purchasing_lead_days} /></label><label>Prazo de entrega<input name="delivery_lead_days" type="number" min="0" defaultValue={item.delivery_lead_days} /></label><label>Margem de segurança<input name="safety_days" type="number" min="0" defaultValue={item.safety_days} /></label><label>Status<select name="status" defaultValue={item.status}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="contract-wide">Observações<textarea name="notes" rows={3} defaultValue={item.notes ?? ""} /></label></div><div className="contract-edit-actions"><button type="submit">Salvar planejamento</button></div></form></div></details> : <span>Somente leitura</span>}</td></tr>; })}
        {filtered.length === 0 ? <tr><td colSpan={11} className="empty-table">Nenhum insumo encontrado.</td></tr> : null}
      </tbody></table></div></section>
    </AppShell>
  );
}
