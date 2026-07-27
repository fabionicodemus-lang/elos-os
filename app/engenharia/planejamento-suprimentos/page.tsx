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
 type Item = {
  id: string; baseline_id: string; input_id: string; supplier_id: string | null; code: string; name: string;
  unit_snapshot: string; category_snapshot: string; required_quantity: number; available_stock: number; purchase_quantity: number;
  planned_unit_cost: number; planned_total_cost: number; first_use_date: string; quotation_lead_days: number;
  purchasing_lead_days: number; delivery_lead_days: number; safety_days: number; quotation_start: string;
  order_deadline: string; delivery_deadline: string; status: Status; responsible: string | null; notes: string | null;
 };

const statusLabels: Record<Status, string> = {
  planned: "Planejado", quotation: "Em cotação", approval: "Em aprovação", ordered: "Pedido emitido",
  partial: "Entrega parcial", delivered: "Entregue", canceled: "Cancelado",
};
const categoryLabels: Record<string, string> = {
  material: "Material", equipment: "Equipamento", freight: "Frete", other: "Outro",
};
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value)) : "—"; }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function quantity(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value || 0)); }
function risk(item: Item, today: Date) {
  if (["delivered", "canceled"].includes(item.status)) return { key: "controlled", label: item.status === "canceled" ? "Cancelado" : "Entregue" };
  if (["ordered", "partial"].includes(item.status)) return { key: "receiving", label: item.status === "partial" ? "Entrega parcial" : "Aguardando entrega" };
  if (today > parseDate(item.delivery_deadline)) return { key: "critical", label: "Entrega vencida" };
  if (today > parseDate(item.order_deadline)) return { key: "order", label: "Pedido vencido" };
  if (today >= parseDate(item.quotation_start)) return { key: "quotation", label: "Cotar agora" };
  return { key: "future", label: "No prazo" };
}

export default async function SupplyPlanPage({ searchParams }: {
  searchParams: Promise<{ baseline?: string; q?: string; status?: string; risk?: string; category?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("supply_plan.view");
  const [projectResult, baselinesResult, suppliersResult, itemsResult, manageResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<Baseline>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_baselines").select("id, code, name, version, status")
        .eq("company_id", companyId).eq("project_id", projectId).order("updated_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Baseline[], error };
    }) : Promise.resolve({ data: [] as Baseline[], error: null }),
    fetchAllRows<Supplier>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id, legal_name, trade_name")
        .eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to);
      return { data: (data ?? []) as Supplier[], error };
    }),
    projectId ? fetchAllRows<Item>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_supply_plan_items")
        .select("id, baseline_id, input_id, supplier_id, code, name, unit_snapshot, category_snapshot, required_quantity, available_stock, purchase_quantity, planned_unit_cost, planned_total_cost, first_use_date, quotation_lead_days, purchasing_lead_days, delivery_lead_days, safety_days, quotation_start, order_deadline, delivery_deadline, status, responsible, notes")
        .eq("company_id", companyId).eq("project_id", projectId).eq("record_status", "active").order("order_deadline").range(from, to);
      return { data: (data ?? []) as Item[], error };
    }) : Promise.resolve({ data: [] as Item[], error: null }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "supply_plan.manage" }),
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selected = baselines.find((item) => item.id === params.baseline) ?? baselines.find((item) => item.status === "approved") ?? baselines.find((item) => item.status !== "archived") ?? baselines[0] ?? null;
  const supplierMap = new Map(suppliersResult.data.map((item) => [item.id, item]));
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const all = selected ? itemsResult.data.filter((item) => item.baseline_id === selected.id) : [];
  const filtered = all.filter((item) => {
    const itemRisk = risk(item, today);
    if (params.status && item.status !== params.status) return false;
    if (params.risk && itemRisk.key !== params.risk) return false;
    if (params.category && item.category_snapshot !== params.category) return false;
    if (!queryText) return true;
    const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null;
    return [item.code, item.name, item.responsible, supplier?.legal_name, supplier?.trade_name].join(" ").toLocaleLowerCase("pt-BR").includes(queryText);
  });
  const total = all.reduce((sum, item) => sum + Number(item.planned_total_cost || 0), 0);
  const noPrice = all.filter((item) => Number(item.planned_unit_cost || 0) <= 0).length;
  const critical = all.filter((item) => ["critical", "order"].includes(risk(item, today).key)).length;
  const ordered = all.filter((item) => ["ordered", "partial", "delivered"].includes(item.status)).reduce((sum, item) => sum + Number(item.planned_total_cost || 0), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return (
    <AppShell activeGroup="engineering" activeItem="supply-plan" eyebrow="Engenharia · Planejamento da Obra" title="Planejamento de Suprimentos"
      description={`${company.name} · ${context} · materiais, equipamentos, pedidos e entregas vinculados ao cronograma.`}
      actions={<><Link className="elos-button secondary" href={selected ? `/engenharia/cronograma?baseline=${selected.id}` : "/engenharia/cronograma"}>Abrir cronograma</Link>{canManage && selected ? <form action={generateSupplyPlanFromSchedule}><input type="hidden" name="baseline_id" value={selected.id} /><button className="elos-button" type="submit">Sincronizar suprimentos</button></form> : null}</>}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {itemsResult.error ? <div className="auth-message error workspace-message">Execute a migration <strong>20260727_0025_engineering_supply_plan.sql</strong> no Supabase.</div> : null}
      {!projectId ? <div className="supply-plan-empty">Selecione uma obra no topo.</div> : null}

      <nav className="budget-module-nav"><Link href="/engenharia/cronograma">▤ Cronograma físico</Link><Link href="/engenharia/curvas">◒ Curvas física e financeira</Link><Link href="/engenharia/plano-contratacoes">⌁ Plano de contratações</Link><span className="active">▧ Planejamento de suprimentos</span></nav>

      <section className="supply-baseline-card"><div><span>Linha de base selecionada</span><strong>{selected ? `${selected.code} · ${selected.version} · ${selected.name}` : "Nenhuma linha disponível"}</strong></div>{baselines.length ? <form method="get"><select name="baseline" defaultValue={selected?.id ?? ""}>{baselines.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>)}</select><button type="submit">Abrir</button></form> : null}</section>

      <section className="supply-plan-kpis"><article><span>Insumos planejados</span><strong>{all.length}</strong><small>materiais e equipamentos</small></article><article><span>Valor a comprar</span><strong>{money(total)}</strong><small>já descontado o estoque informado</small></article><article><span>Pedido emitido ou entregue</span><strong>{money(ordered)}</strong><small>{total ? (ordered / total * 100).toFixed(1) : "0,0"}% do plano</small></article><article className={critical ? "critical" : ""}><span>Prazos críticos</span><strong>{critical}</strong><small>pedido ou entrega vencidos</small></article><article className={noPrice ? "warning" : ""}><span>Sem preço adotado</span><strong>{noPrice}</strong><small>precisam de cotação</small></article></section>

      <section className="supply-plan-flow">{[["1","Necessidade","Composição e orçamento"],["2","Cotação","Preço e fornecedor"],["3","Pedido","Emitir dentro do prazo"],["4","Entrega","Receber antes do uso"],["5","Aplicação","Disponível para a equipe"]].map(([n,title,caption]) => <div key={n}><i>{n}</i><strong>{title}</strong><span>{caption}</span></div>)}</section>

      <section className="supply-plan-toolbar"><form method="get"><input type="hidden" name="baseline" value={selected?.id ?? ""} /><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar insumo, fornecedor ou responsável" /><select name="category" defaultValue={params.category ?? ""}><option value="">Todas as categorias</option>{Object.entries(categoryLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><select name="risk" defaultValue={params.risk ?? ""}><option value="">Todos os riscos</option><option value="critical">Entrega vencida</option><option value="order">Pedido vencido</option><option value="quotation">Cotar agora</option><option value="receiving">Aguardando entrega</option><option value="future">No prazo</option><option value="controlled">Controlado</option></select><button type="submit">Filtrar</button><Link href={selected ? `?baseline=${selected.id}` : "/engenharia/planejamento-suprimentos"}>Limpar</Link></form></section>

      <section className="supply-plan-table-card"><div className="budget-section-head"><div><span>Agenda de compras</span><h2>Necessidades vinculadas às composições</h2></div><p>{filtered.length} insumo(s).</p></div><div className="registry-table-wrap"><table className="registry-table supply-plan-table"><thead><tr><th>Insumo</th><th>Necessidade</th><th>Estoque</th><th>Comprar</th><th>Cotar</th><th>Pedido até</th><th>Entrega até</th><th>Primeiro uso</th><th>Valor</th><th>Status / risco</th><th>Ação</th></tr></thead><tbody>
        {filtered.map((item) => { const supplier = item.supplier_id ? supplierMap.get(item.supplier_id) : null; const itemRisk = risk(item, today); return <tr key={item.id}><td><strong>{item.code}</strong><span>{item.name}</span><small>{categoryLabels[item.category_snapshot] ?? item.category_snapshot} · {supplier?.trade_name || supplier?.legal_name || "Fornecedor não definido"}</small></td><td><strong>{quantity(Number(item.required_quantity))}</strong><small>{item.unit_snapshot}</small></td><td>{quantity(Number(item.available_stock))}</td><td><strong>{quantity(Number(item.purchase_quantity))}</strong><small>{item.unit_snapshot}</small></td><td>{dateBR(item.quotation_start)}</td><td><strong>{dateBR(item.order_deadline)}</strong></td><td>{dateBR(item.delivery_deadline)}</td><td><strong>{dateBR(item.first_use_date)}</strong></td><td><strong>{money(Number(item.planned_total_cost))}</strong><small>{money(Number(item.planned_unit_cost))}/{item.unit_snapshot}</small></td><td><span className={`supply-status status-${item.status}`}>{statusLabels[item.status]}</span><span className={`supply-risk risk-${itemRisk.key}`}>{itemRisk.label}</span></td><td>{canManage ? <details className="contract-edit supply-edit"><summary>Editar</summary><div className="contract-edit-popover supply-edit-popover"><form action={updateSupplyPlanItem}><input type="hidden" name="baseline_id" value={selected?.id ?? ""} /><input type="hidden" name="item_id" value={item.id} /><h3>{item.code} · {item.name}</h3><div className="contract-edit-grid"><label>Fornecedor<select name="supplier_id" defaultValue={item.supplier_id ?? ""}><option value="">Não definido</option>{suppliersResult.data.map((option) => <option key={option.id} value={option.id}>{option.trade_name || option.legal_name}</option>)}</select></label><label>Responsável<input name="responsible" defaultValue={item.responsible ?? ""} /></label><label>Primeiro uso<input name="first_use_date" type="date" defaultValue={item.first_use_date} required /></label><label>Estoque disponível<input name="available_stock" type="number" min="0" step="0.000001" defaultValue={Number(item.available_stock)} /></label><label>Preço unitário<input name="planned_unit_cost" type="number" min="0" step="0.000001" defaultValue={Number(item.planned_unit_cost)} /></label><label>Dias para cotação<input name="quotation_lead_days" type="number" min="0" defaultValue={item.quotation_lead_days} /></label><label>Dias para aprovação/pedido<input name="purchasing_lead_days" type="number" min="0" defaultValue={item.purchasing_lead_days} /></label><label>Prazo de entrega<input name="delivery_lead_days" type="number" min="0" defaultValue={item.delivery_lead_days} /></label><label>Margem de segurança<input name="safety_days" type="number" min="0" defaultValue={item.safety_days} /></label><label>Status<select name="status" defaultValue={item.status}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="contract-wide">Observações<textarea name="notes" rows={3} defaultValue={item.notes ?? ""} /></label></div><div className="contract-edit-actions"><button type="submit">Salvar planejamento</button></div></form></div></details> : <span>Somente leitura</span>}</td></tr>; })}
        {filtered.length === 0 ? <tr><td colSpan={11} className="empty-table">Nenhum insumo encontrado. Execute a sincronização após cadastrar as composições e a linha de base.</td></tr> : null}
      </tbody></table></div></section>
    </AppShell>
  );
}
