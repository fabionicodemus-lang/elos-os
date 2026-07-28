import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { approveMaterialRequest, cancelMaterialRequest } from "./actions";
import {
  MaterialRequestCreateDialog,
  MaterialRequestEditDialog,
  type MaterialCostCenterOption,
  type MaterialInputOption,
  type MaterialRequestDialogData,
  type SupplyPlanReference,
} from "./material-request-dialogs";
import "../../execution-material-requests.css";

type Project = { id: string; code: string | null; name: string };
type Budget = { id: string; code: string; name: string; version: string; status: string; updated_at: string };
type RequestStatus = "requested" | "approved" | "partially_ordered" | "attended" | "cancelled";
type MaterialRequest = {
  id: string; budget_id: string; request_number: string; status: RequestStatus; needed_date: string;
  requester_name: string; notes: string | null; approved_at: string | null; cancellation_reason: string | null;
  created_at: string; updated_at: string;
};
type MaterialRequestItem = {
  id: string; request_id: string; input_id: string; input_code: string; input_name: string; unit_snapshot: string;
  category_snapshot: string; cost_center_code: string; cost_center_name: string; requested_quantity: number;
  ordered_quantity: number; notes: string | null; sort_order: number;
};

const statusLabels: Record<RequestStatus, string> = {
  requested: "Solicitada",
  approved: "Aprovada",
  partially_ordered: "Atendimento parcial",
  attended: "Atendida",
  cancelled: "Cancelada",
};

function quantity(value: number, digits = 3) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0));
}

function dateBR(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function requestSearchText(request: MaterialRequest, items: MaterialRequestItem[]) {
  return [request.request_number, request.requester_name, request.notes ?? "", ...items.flatMap((item) => [item.input_code, item.input_name, item.cost_center_code, item.cost_center_name])]
    .join(" ").toLocaleLowerCase("pt-BR");
}

export default async function MaterialRequestsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; view?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.material_requests.view");
  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const budgetsPromise = projectId
    ? fetchAllRows<Budget>(async (from, to) => {
        const { data, error } = await supabase.from("engineering_budgets")
          .select("id, code, name, version, status, updated_at")
          .eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved")
          .order("updated_at", { ascending: false }).range(from, to);
        return { data: (data ?? []) as Budget[], error };
      })
    : Promise.resolve({ data: [] as Budget[], error: null });
  const groupsPromise = projectId
    ? fetchAllRows<MaterialCostCenterOption>(async (from, to) => {
        const { data, error } = await supabase.from("engineering_budget_groups")
          .select("budget_id, code, name").eq("company_id", companyId).eq("project_id", projectId)
          .eq("status", "active").order("sort_order").range(from, to);
        return { data: (data ?? []) as MaterialCostCenterOption[], error };
      })
    : Promise.resolve({ data: [] as MaterialCostCenterOption[], error: null });

  const [projectResult, budgetsResult, groupsResult, inputsResult, requestsResult, itemsResult, supplyResult, manageResult, approveResult] = await Promise.all([
    projectPromise,
    budgetsPromise,
    groupsPromise,
    fetchAllRows<MaterialInputOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_inputs")
        .select("id, code, description, unit, category").eq("company_id", companyId).eq("status", "active")
        .in("category", ["material", "equipment", "freight", "other"])
        .order("code").range(from, to);
      return { data: (data ?? []) as MaterialInputOption[], error };
    }),
    projectId ? fetchAllRows<MaterialRequest>(async (from, to) => {
      const { data, error } = await supabase.from("execution_material_requests")
        .select("id, budget_id, request_number, status, needed_date, requester_name, notes, approved_at, cancellation_reason, created_at, updated_at")
        .eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as MaterialRequest[], error };
    }) : Promise.resolve({ data: [] as MaterialRequest[], error: null }),
    projectId ? fetchAllRows<MaterialRequestItem>(async (from, to) => {
      const { data, error } = await supabase.from("execution_material_request_items")
        .select("id, request_id, input_id, input_code, input_name, unit_snapshot, category_snapshot, cost_center_code, cost_center_name, requested_quantity, ordered_quantity, notes, sort_order")
        .eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as MaterialRequestItem[], error };
    }) : Promise.resolve({ data: [] as MaterialRequestItem[], error: null }),
    projectId ? fetchAllRows<SupplyPlanReference>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_supply_plan_items")
        .select("input_id, required_quantity, purchase_quantity, unit_snapshot, order_deadline, first_use_date")
        .eq("company_id", companyId).eq("project_id", projectId).eq("record_status", "active")
        .neq("status", "canceled").order("first_use_date").range(from, to);
      return { data: (data ?? []) as SupplyPlanReference[], error };
    }) : Promise.resolve({ data: [] as SupplyPlanReference[], error: null }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "execution.material_requests.manage" }),
    roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "execution.material_requests.approve" }),
  ]);

  const project = projectResult.data as Project | null;
  const budgets = budgetsResult.data;
  const approvedBudget = budgets[0] ?? null;
  const requests = requestsResult.data;
  const items = itemsResult.data;
  const itemMap = new Map<string, MaterialRequestItem[]>();
  items.forEach((item) => itemMap.set(item.request_id, [...(itemMap.get(item.request_id) ?? []), item]));
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canApprove = approveResult.data === true || roleKey === "owner" || roleKey === "admin";
  const view = params.view === "history" ? "history" : "pending";
  const statusFilter = Object.keys(statusLabels).includes(params.status ?? "") ? params.status as RequestStatus : "";
  const queryText = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const visible = requests.filter((request) => view === "history"
    ? ["attended", "cancelled"].includes(request.status)
    : !["attended", "cancelled"].includes(request.status))
    .filter((request) => !statusFilter || request.status === statusFilter)
    .filter((request) => !queryText || requestSearchText(request, itemMap.get(request.id) ?? []).includes(queryText));

  const pendingRequests = requests.filter((request) => !["attended", "cancelled"].includes(request.status));
  const attended = requests.filter((request) => request.status === "attended").length;
  const pendingItems = pendingRequests.reduce((total, request) => total + (itemMap.get(request.id) ?? []).filter((item) => Number(item.ordered_quantity) < Number(item.requested_quantity)).length, 0);
  const approved = requests.filter((request) => ["approved", "partially_ordered"].includes(request.status)).length;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const dialogBase = { inputs: inputsResult.data, centers: groupsResult.data, supplyPlan: supplyResult.data, approvedBudgetId: approvedBudget?.id ?? "" };

  return <AppShell activeGroup="execution" activeItem="material-requests" eyebrow="Execução · Suprimentos" title="Solicitações de Materiais"
    description={`${company.name} · ${context} · necessidades da obra vinculadas aos insumos e centros de custo do orçamento.`}
    actions={canManage && approvedBudget ? <MaterialRequestCreateDialog {...dialogBase} /> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {requestsResult.error || itemsResult.error ? <div className="auth-message error workspace-message">A estrutura das solicitações ainda não está instalada. Execute a migration <strong>20260728_0033_execution_material_requests.sql</strong>.</div> : null}
    {!projectId ? <div className="material-requests-empty-page">Selecione uma obra no topo.</div> : null}
    {projectId && !approvedBudget ? <div className="auth-message error workspace-message">A obra precisa ter um orçamento com status <strong>Revisão fechada</strong> antes de solicitar materiais.</div> : null}

    <section className="material-request-kpis">
      <article><span>Não atendidas</span><strong>{pendingRequests.length}</strong><small>aguardam aprovação ou pedido</small></article>
      <article><span>Aprovadas</span><strong>{approved}</strong><small>liberadas para Suprimentos</small></article>
      <article><span>Itens pendentes</span><strong>{pendingItems}</strong><small>quantidades ainda não pedidas</small></article>
      <article><span>Atendidas</span><strong>{attended}</strong><small>integralmente convertidas em compra</small></article>
    </section>

    <section className="material-request-flow">
      {[['1','Solicitação','Obra informa a necessidade'],['2','Aprovação','Engenharia valida'],['3','Cotação','Suprimentos negocia'],['4','Pedido','Quantidade é comprometida'],['5','Atendimento','Saldo solicitado chega a zero']].map(([number,title,caption]) => <div key={number}><i>{number}</i><strong>{title}</strong><span>{caption}</span></div>)}
    </section>

    <nav className="material-request-tabs">
      <Link className={view === "pending" ? "active" : ""} href="/execucao/solicitacoes-materiais">Solicitações pendentes</Link>
      <Link className={view === "history" ? "active" : ""} href="/execucao/solicitacoes-materiais?view=history">Atendidas e canceladas</Link>
    </nav>

    <section className="material-request-toolbar">
      <form method="get"><input type="hidden" name="view" value={view} /><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar número, solicitante, código ou material" /><select name="status" defaultValue={statusFilter}><option value="">Todos os status</option>{Object.entries(statusLabels).filter(([key]) => view === "history" ? ["attended", "cancelled"].includes(key) : !["attended", "cancelled"].includes(key)).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href={view === "history" ? "?view=history" : "/execucao/solicitacoes-materiais"}>Limpar</Link></form>
    </section>

    <section className="material-request-table-card">
      <div className="budget-section-head"><div><span>{view === "history" ? "Histórico da obra" : "Necessidades abertas"}</span><h2>{view === "history" ? "Solicitações concluídas" : "Materiais ainda pendentes"}</h2></div><p>{visible.length} solicitação(ões).</p></div>
      <div className="registry-table-wrap"><table className="registry-table material-request-table"><thead><tr><th>Solicitação</th><th>Materiais</th><th>Necessidade</th><th>Solicitante automático</th><th>Centros de custo</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {visible.map((request) => {
          const requestItems = itemMap.get(request.id) ?? [];
          const remaining = requestItems.filter((item) => Number(item.ordered_quantity) < Number(item.requested_quantity));
          const shownItems = view === "history" ? requestItems : remaining;
          const centers = [...new Map(requestItems.map((item) => [item.cost_center_code, item.cost_center_name])).entries()];
          const dialogRequest: MaterialRequestDialogData = { id: request.id, request_number: request.request_number, budget_id: request.budget_id, needed_date: request.needed_date, notes: request.notes, status: request.status, items: requestItems.map((item) => ({ id: item.id, input_id: item.input_id, quantity: Number(item.requested_quantity), cost_center_code: item.cost_center_code, notes: item.notes })) };
          return <tr key={request.id}>
            <td><strong>{request.request_number}</strong><span>{dateBR(request.created_at)}</span><small>{requestItems.length} item(ns)</small></td>
            <td><div className="material-request-item-summary">{shownItems.slice(0, 4).map((item) => <div key={item.id}><code>{item.input_code}</code><span>{item.input_name}</span><b>{quantity(view === "history" ? Number(item.requested_quantity) : Number(item.requested_quantity) - Number(item.ordered_quantity))} {item.unit_snapshot}</b>{Number(item.ordered_quantity) > 0 ? <small>{quantity(Number(item.ordered_quantity))} já pedido</small> : null}</div>)}{shownItems.length > 4 ? <small>+ {shownItems.length - 4} outro(s)</small> : null}{!shownItems.length ? <span>Sem saldo pendente.</span> : null}</div></td>
            <td><strong>{dateBR(request.needed_date)}</strong>{request.approved_at ? <small>Aprovada em {dateBR(request.approved_at)}</small> : null}</td>
            <td><strong>{request.requester_name}</strong><small>preenchido pelo login</small></td>
            <td><div className="material-request-centers">{centers.map(([code,name]) => <span key={code}>{code}<small>{name}</small></span>)}</div></td>
            <td><span className={`material-request-status status-${request.status}`}>{statusLabels[request.status]}</span>{request.cancellation_reason ? <small>{request.cancellation_reason}</small> : null}</td>
            <td><div className="material-request-actions">
              {canManage && request.status === "requested" ? <MaterialRequestEditDialog {...dialogBase} request={dialogRequest} /> : null}
              {canApprove && request.status === "requested" ? <form action={approveMaterialRequest}><input type="hidden" name="request_id" value={request.id} /><button className="table-action primary" type="submit">Aprovar</button></form> : null}
              {canApprove && !["attended", "cancelled"].includes(request.status) ? <details><summary>Cancelar</summary><form action={cancelMaterialRequest}><input type="hidden" name="request_id" value={request.id} /><textarea name="reason" required placeholder="Motivo do cancelamento" rows={2} /><button className="table-action danger" type="submit">Confirmar</button></form></details> : null}
              {!canManage && !canApprove ? "—" : null}
            </div></td>
          </tr>;
        })}
        {!visible.length ? <tr><td colSpan={7}><div className="material-request-empty"><strong>Nenhuma solicitação encontrada.</strong><span>Crie a primeira solicitação ou altere os filtros.</span></div></td></tr> : null}
      </tbody></table></div>
    </section>
  </AppShell>;
}
