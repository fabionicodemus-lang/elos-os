import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  acceptAssistanceResolution,
  addAssistanceNote,
  completeAssistanceVisit,
  createAssistanceTicket,
  removeAssistanceDocument,
  scheduleAssistanceVisit,
  setAssistanceStatus,
  updateAssistanceTicket,
  uploadAssistanceDocuments,
} from "./actions";
import "../../postwork-assistance.css";

type Unit = { id: string; code: string; floor: number | null; type: string | null; status: string };
type Client = { id: string; name: string; tax_id: string | null; status: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null; status: string };
type Ticket = {
  id: string; company_id: string; project_id: string; unit_id: string | null; client_id: string | null; sale_id: string | null;
  number: string; opened_at: string; channel: string; scope_type: string; category: string; priority: string; title: string; description: string;
  location_detail: string | null; status: string; warranty_claimed: boolean; warranty_status: string; warranty_reason: string | null;
  sla_due_at: string | null; scheduled_at: string | null; responsible_name: string | null; supplier_id: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; access_notes: string | null;
  diagnosis: string | null; execution_notes: string | null; resolution_notes: string | null;
  supplier_cost: number; material_cost: number; customer_charge: number; resolved_at: string | null; accepted_at: string | null;
  accepted_by_name: string | null; customer_rating: number | null; rejection_reason: string | null; cancellation_reason: string | null;
  created_at: string; units: Unit | Unit[] | null; clients: Client | Client[] | null; suppliers: Supplier | Supplier[] | null;
};
type Visit = { id: string; ticket_id: string; visit_type: string; scheduled_at: string; status: string; technician_name: string | null; supplier_id: string | null; started_at: string | null; finished_at: string | null; diagnosis: string | null; service_performed: string | null; materials_used: string | null; requires_return: boolean; return_recommendation: string | null; notes: string | null };
type Document = { id: string; ticket_id: string; document_type: string; storage_path: string; file_name: string; caption: string | null; uploaded_at: string; signed_url?: string | null };
type Audit = { id: string; ticket_id: string; action: string; previous_status: string | null; new_status: string | null; notes: string | null; details: unknown; changed_at: string };
type Summary = { total_count: number; open_count: number; urgent_count: number; overdue_count: number; scheduled_count: number; in_progress_count: number; resolved_count: number; covered_count: number; supplier_cost: number; material_cost: number; customer_charge: number; average_rating: number | null };

const statusLabels: Record<string, string> = {
  open: "Aberto", triage: "Em triagem", inspection_scheduled: "Vistoria agendada", awaiting_supplier: "Aguardando prestador",
  approved: "Aprovado", in_progress: "Em execução", awaiting_acceptance: "Aguardando aceite", resolved: "Resolvido",
  rejected: "Rejeitado", cancelled: "Cancelado",
};
const priorityLabels: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const categoryLabels: Record<string, string> = {
  waterproofing: "Impermeabilização", hydraulic: "Hidráulica", electrical: "Elétrica", finishes: "Acabamentos", frames: "Esquadrias",
  painting: "Pintura", flooring: "Pisos e revestimentos", equipment: "Equipamentos", structure: "Estrutura", gas: "Gás",
  common_area: "Área comum", other: "Outro",
};
const warrantyLabels: Record<string, string> = { pending: "Em análise", covered: "Coberta", not_covered: "Não coberta", courtesy: "Cortesia", not_applicable: "Não aplicável" };
const channelLabels: Record<string, string> = { internal: "Interno", phone: "Telefone", whatsapp: "WhatsApp", email: "E-mail", portal: "Portal", in_person: "Presencial", other: "Outro" };
const visitTypeLabels: Record<string, string> = { inspection: "Vistoria", execution: "Execução", return: "Retorno", acceptance: "Aceite" };
const visitStatusLabels: Record<string, string> = { scheduled: "Agendada", confirmed: "Confirmada", completed: "Concluída", no_access: "Sem acesso", rescheduled: "Reagendada", cancelled: "Cancelada" };
const documentLabels: Record<string, string> = { opening: "Abertura", inspection: "Vistoria", execution: "Execução", acceptance: "Aceite", invoice: "Nota/custo", evidence: "Evidência", other: "Outro" };
const auditLabels: Record<string, string> = { opened: "Chamado aberto", status_changed: "Etapa alterada", visit_scheduled: "Visita agendada", visit_completed: "Visita concluída", visit_no_access: "Visita sem acesso", visit_cancelled: "Visita cancelada", note: "Observação" };

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0)); }
function inputMoney(value: number | null | undefined) { return Number(value ?? 0).toFixed(2).replace(".", ","); }
function dateBR(value: string | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value)); }
function dateTimeBR(value: string | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
function datetimeLocal(value: string | null | undefined) { if (!value) return ""; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function supplierName(supplier: Supplier | null | undefined) { return supplier ? supplier.trade_name || supplier.legal_name : "—"; }

export default async function AssistancePage({ searchParams }: { searchParams: Promise<{ ticket?: string; q?: string; status?: string; priority?: string; category?: string; new?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("postwork.assistance.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, unitsResult, clientsResult, suppliersResult, ticketsResult, visitsResult, documentsResult, auditResult, summaryResult, manageResult, inspectResult, executeResult, closeResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<Unit>(async (from, to) => { const { data, error } = await supabase.from("units").select("id,code,floor,type,status").eq("company_id", companyId).eq("project_id", projectId).order("code").range(from, to); return { data: (data ?? []) as Unit[], error }; }) : Promise.resolve({ data: [] as Unit[], error: null }),
    fetchAllRows<Client>(async (from, to) => { const { data, error } = await supabase.from("clients").select("id,name,tax_id,status").eq("company_id", companyId).order("name").range(from, to); return { data: (data ?? []) as Client[], error }; }),
    fetchAllRows<Supplier>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,status").eq("company_id", companyId).order("legal_name").range(from, to); return { data: (data ?? []) as Supplier[], error }; }),
    projectId ? fetchAllRows<Ticket>(async (from, to) => { const { data, error } = await supabase.from("postwork_assistance_tickets").select("id,company_id,project_id,unit_id,client_id,sale_id,number,opened_at,channel,scope_type,category,priority,title,description,location_detail,status,warranty_claimed,warranty_status,warranty_reason,sla_due_at,scheduled_at,responsible_name,supplier_id,contact_name,contact_phone,contact_email,access_notes,diagnosis,execution_notes,resolution_notes,supplier_cost,material_cost,customer_charge,resolved_at,accepted_at,accepted_by_name,customer_rating,rejection_reason,cancellation_reason,created_at,units(id,code,floor,type,status),clients(id,name,tax_id,status),suppliers(id,legal_name,trade_name,status)").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to); return { data: (data ?? []) as unknown as Ticket[], error }; }) : Promise.resolve({ data: [] as Ticket[], error: null }),
    projectId ? fetchAllRows<Visit>(async (from, to) => { const { data, error } = await supabase.from("postwork_assistance_visits").select("id,ticket_id,visit_type,scheduled_at,status,technician_name,supplier_id,started_at,finished_at,diagnosis,service_performed,materials_used,requires_return,return_recommendation,notes").eq("company_id", companyId).eq("project_id", projectId).order("scheduled_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Visit[], error }; }) : Promise.resolve({ data: [] as Visit[], error: null }),
    projectId ? fetchAllRows<Document>(async (from, to) => { const { data, error } = await supabase.from("postwork_assistance_documents").select("id,ticket_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id", companyId).eq("project_id", projectId).order("uploaded_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Document[], error }; }) : Promise.resolve({ data: [] as Document[], error: null }),
    projectId ? fetchAllRows<Audit>(async (from, to) => { const { data, error } = await supabase.from("postwork_assistance_audit").select("id,ticket_id,action,previous_status,new_status,notes,details,changed_at").eq("company_id", companyId).eq("project_id", projectId).order("changed_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Audit[], error }; }) : Promise.resolve({ data: [] as Audit[], error: null }),
    supabase.rpc("postwork_assistance_summary", { p_company_id: companyId, p_project_id: projectId }),
    permission("postwork.assistance.manage"), permission("postwork.assistance.inspect"), permission("postwork.assistance.execute"), permission("postwork.assistance.close"),
  ]);

  const project = projectResult.data;
  const units = unitsResult.data;
  const clients = clientsResult.data.filter((item) => item.status === "active");
  const suppliers = suppliersResult.data.filter((item) => item.status === "active");
  const supplierMap = new Map(suppliersResult.data.map((supplier) => [supplier.id, supplier]));
  const tickets = ticketsResult.data;
  const selected = params.ticket ? tickets.find((ticket) => ticket.id === params.ticket) ?? null : null;
  const selectedVisits = selected ? visitsResult.data.filter((visit) => visit.ticket_id === selected.id) : [];
  let selectedDocuments: Document[] = selected ? documentsResult.data.filter((document) => document.ticket_id === selected.id) : [];
  if (selectedDocuments.length) {
    const signed = await supabase.storage.from("postwork-assistance").createSignedUrls(selectedDocuments.map((document) => document.storage_path), 3600);
    const map = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    selectedDocuments = selectedDocuments.map((document) => ({ ...document, signed_url: map.get(document.storage_path) ?? null }));
  }
  const selectedAudit = selected ? auditResult.data.filter((audit) => audit.ticket_id === selected.id) : [];
  const summary = (summaryResult.data ?? { total_count: 0, open_count: 0, urgent_count: 0, overdue_count: 0, scheduled_count: 0, in_progress_count: 0, resolved_count: 0, covered_count: 0, supplier_cost: 0, material_cost: 0, customer_charge: 0, average_rating: null }) as Summary;
  const canManage = manageResult.data === true || privileged;
  const canInspect = inspectResult.data === true || privileged;
  const canExecute = executeResult.data === true || privileged;
  const canClose = closeResult.data === true || privileged;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const now = new Date();
  const filtered = tickets.filter((ticket) => !params.status || ticket.status === params.status)
    .filter((ticket) => !params.priority || ticket.priority === params.priority)
    .filter((ticket) => !params.category || ticket.category === params.category)
    .filter((ticket) => !query || [ticket.number, ticket.title, ticket.description, relatedOne(ticket.units)?.code, relatedOne(ticket.clients)?.name, ticket.contact_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const structureError = ticketsResult.error || visitsResult.error || documentsResult.error || auditResult.error;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione um empreendimento";
  const today = new Date().toISOString().slice(0, 10);
  const activeStatuses = !selected || !["resolved", "rejected", "cancelled"].includes(selected.status);

  return <AppShell activeGroup="postwork" activeItem="assistance" eyebrow="Pós-Obra · Relacionamento" title="Assistências Técnicas" description={`${company.name} · ${context} · chamados, garantia, vistoria, execução e aceite.`}
    actions={canManage && projectId ? <a className="elos-button" href="?new=1">+ Abrir chamado</a> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura de Assistências Técnicas ainda não está instalada. Execute a migration <strong>20260729_0053_postwork_assistance.sql</strong>.</div> : null}
    {!projectId ? <div className="assistance-empty">Selecione um empreendimento no topo.</div> : null}

    {projectId ? <>
      <section className="assistance-summary-grid">
        <article className={summary.overdue_count > 0 ? "attention" : ""}><span>Chamados abertos</span><strong>{summary.open_count}</strong><small>{summary.overdue_count} fora do SLA · {summary.urgent_count} urgente(s)</small></article>
        <article><span>Em atendimento</span><strong>{summary.in_progress_count}</strong><small>{summary.scheduled_count} vistoria(s) agendada(s)</small></article>
        <article><span>Resolvidos</span><strong>{summary.resolved_count}</strong><small>{summary.covered_count} cobertos pela garantia</small></article>
        <article><span>Custo pós-obra</span><strong>{money(Number(summary.supplier_cost) + Number(summary.material_cost))}</strong><small>{summary.average_rating ? `Nota média ${summary.average_rating}/5` : "Sem avaliações ainda"}</small></article>
      </section>

      {(params.new === "1" || (!tickets.length && canManage)) ? <details className="registry-create assistance-create" open>
        <summary>+ Novo chamado técnico</summary>
        <form action={createAssistanceTicket}>
          <div className="registry-form-grid assistance-form-grid">
            <label>Escopo<select name="scope_type" defaultValue="unit"><option value="unit">Unidade privativa</option><option value="common_area">Área comum</option></select></label>
            <label>Unidade<select name="unit_id" defaultValue=""><option value="">Sem unidade / área comum</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code}{unit.type ? ` · ${unit.type}` : ""}</option>)}</select></label>
            <label>Cliente<select name="client_id" defaultValue=""><option value="">Sem cliente definido</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.tax_id ? ` · ${client.tax_id}` : ""}</option>)}</select></label>
            <label>Data de abertura<input name="opened_at" type="date" defaultValue={today} required /></label>
            <label>Canal<select name="channel" defaultValue="whatsapp">{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Categoria<select name="category" defaultValue="other">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Prioridade<select name="priority" defaultValue="normal">{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Local específico<input name="location_detail" placeholder="Ex.: suíte, sacada ou salão de festas" /></label>
            <label>Contato<input name="contact_name" /></label><label>Telefone<input name="contact_phone" /></label><label>E-mail<input name="contact_email" type="email" /></label>
            <label>SLA manual<input name="sla_due_at" type="datetime-local" /><small>Em branco: calculado pela prioridade.</small></label>
            <label className="registry-wide">Título<input name="title" required placeholder="Resumo objetivo do problema" /></label>
            <label className="registry-wide">Descrição<textarea name="description" rows={4} required placeholder="Sintomas, quando começou e condições observadas" /></label>
            <label className="registry-wide">Orientações de acesso<textarea name="access_notes" rows={2} /></label>
            <label className="assistance-check"><input name="warranty_claimed" type="checkbox" defaultChecked /> Cliente solicita atendimento em garantia</label>
          </div>
          <div className="assistance-form-actions"><button className="auth-primary" type="submit">Abrir chamado</button><Link href="/pos-obra/assistencias">Cancelar</Link></div>
        </form>
      </details> : null}

      <section className="registry-toolbar assistance-toolbar">
        <form method="get" className="finance-filter">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Número, unidade, cliente ou problema" />
          <select name="status" defaultValue={params.status ?? ""}><option value="">Todas as etapas</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select name="priority" defaultValue={params.priority ?? ""}><option value="">Todas as prioridades</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select name="category" defaultValue={params.category ?? ""}><option value="">Todas as categorias</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button type="submit">Filtrar</button><Link href="/pos-obra/assistencias">Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel assistance-list-panel">
        <div className="section-heading"><div><span>Central de atendimento</span><h2>Chamados encontrados</h2></div><p>{filtered.length} de {tickets.length} chamado(s)</p></div>
        <div className="registry-table-wrap"><table className="registry-table assistance-table"><thead><tr><th>Chamado</th><th>Unidade / local</th><th>Cliente</th><th>Problema</th><th>Prioridade</th><th>SLA / agenda</th><th>Garantia</th><th>Etapa</th><th>Ação</th></tr></thead><tbody>
          {filtered.map((ticket) => { const unit = relatedOne(ticket.units); const client = relatedOne(ticket.clients); const overdue = Boolean(ticket.sla_due_at && new Date(ticket.sla_due_at) < now && !["resolved", "rejected", "cancelled"].includes(ticket.status)); return <tr key={ticket.id} className={`${overdue ? "assistance-overdue" : ""} ${selected?.id === ticket.id ? "selected" : ""}`}>
            <td><strong>{ticket.number}</strong><small>{dateBR(ticket.opened_at)} · {channelLabels[ticket.channel] || ticket.channel}</small></td>
            <td><strong>{unit?.code || ticket.location_detail || "Área comum"}</strong><small>{unit?.type || ticket.location_detail}</small></td>
            <td><strong>{client?.name || ticket.contact_name || "—"}</strong><small>{ticket.contact_phone}</small></td>
            <td><strong>{ticket.title}</strong><small>{categoryLabels[ticket.category] || ticket.category}</small></td>
            <td><span className={`assistance-priority ${ticket.priority}`}>{priorityLabels[ticket.priority] || ticket.priority}</span></td>
            <td><span className={overdue ? "assistance-deadline overdue" : "assistance-deadline"}>{ticket.scheduled_at ? dateTimeBR(ticket.scheduled_at) : dateTimeBR(ticket.sla_due_at)}</span><small>{ticket.scheduled_at ? "Visita" : overdue ? "SLA vencido" : "SLA"}</small></td>
            <td><span className={`assistance-warranty ${ticket.warranty_status}`}>{warrantyLabels[ticket.warranty_status] || ticket.warranty_status}</span></td>
            <td><span className={`assistance-status ${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span></td>
            <td><Link className="table-action table-action-link" href={`?ticket=${ticket.id}`}>Abrir</Link></td>
          </tr>; })}
          {!filtered.length ? <tr><td className="empty-table" colSpan={9}>Nenhum chamado encontrado.</td></tr> : null}
        </tbody></table></div>
      </section>

      {selected ? <section className="assistance-detail">
        <div className="assistance-detail-hero"><div><span>{selected.number} · {categoryLabels[selected.category]}</span><h2>{selected.title}</h2><p>{relatedOne(selected.units)?.code || selected.location_detail || "Área comum"} · {relatedOne(selected.clients)?.name || selected.contact_name || "Sem cliente definido"}</p></div><div><span className={`assistance-status ${selected.status}`}>{statusLabels[selected.status]}</span><small>{priorityLabels[selected.priority]} · {warrantyLabels[selected.warranty_status]}</small></div></div>

        <div className="assistance-detail-grid">
          <div className="assistance-main-column">
            <section className="assistance-card"><div className="section-heading"><div><span>Relato</span><h2>Dados do chamado</h2></div></div>
              <p className="assistance-description">{selected.description}</p>
              {canManage && activeStatuses ? <details className="registry-create"><summary>Editar dados e custos</summary><form action={updateAssistanceTicket}><input type="hidden" name="ticket_id" value={selected.id} /><div className="registry-form-grid assistance-form-grid">
                <label>Prioridade<select name="priority" defaultValue={selected.priority}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Categoria<select name="category" defaultValue={selected.category}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="registry-wide">Título<input name="title" defaultValue={selected.title} required /></label>
                <label className="registry-wide">Descrição<textarea name="description" rows={4} defaultValue={selected.description} required /></label>
                <label>Local<input name="location_detail" defaultValue={selected.location_detail ?? ""} /></label><label>SLA<input name="sla_due_at" type="datetime-local" defaultValue={datetimeLocal(selected.sla_due_at)} /></label>
                <label>Responsável interno<input name="responsible_name" defaultValue={selected.responsible_name ?? ""} /></label>
                <label>Prestador<select name="supplier_id" defaultValue={selected.supplier_id ?? ""}><option value="">Sem prestador</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplierName(supplier)}</option>)}</select></label>
                <label>Contato<input name="contact_name" defaultValue={selected.contact_name ?? ""} /></label><label>Telefone<input name="contact_phone" defaultValue={selected.contact_phone ?? ""} /></label><label>E-mail<input name="contact_email" type="email" defaultValue={selected.contact_email ?? ""} /></label>
                <label className="registry-wide">Acesso<textarea name="access_notes" rows={2} defaultValue={selected.access_notes ?? ""} /></label>
                <label>Custo prestador<input name="supplier_cost" inputMode="decimal" defaultValue={inputMoney(selected.supplier_cost)} /></label><label>Custo materiais<input name="material_cost" inputMode="decimal" defaultValue={inputMoney(selected.material_cost)} /></label><label>Cobrança do cliente<input name="customer_charge" inputMode="decimal" defaultValue={inputMoney(selected.customer_charge)} /></label>
              </div><button className="auth-primary" type="submit">Salvar dados</button></form></details> : null}
              <div className="assistance-facts"><div><span>Responsável</span><strong>{selected.responsible_name || "Não definido"}</strong></div><div><span>Prestador</span><strong>{supplierName(relatedOne(selected.suppliers) || supplierMap.get(selected.supplier_id || ""))}</strong></div><div><span>Custo total</span><strong>{money(Number(selected.supplier_cost) + Number(selected.material_cost))}</strong></div><div><span>Cobrança cliente</span><strong>{money(selected.customer_charge)}</strong></div></div>
            </section>

            <section className="assistance-card"><div className="section-heading"><div><span>Agenda</span><h2>Vistorias e execuções</h2></div><p>{selectedVisits.length} registro(s)</p></div>
              {canInspect && activeStatuses ? <details className="registry-create"><summary>+ Agendar visita</summary><form action={scheduleAssistanceVisit}><input type="hidden" name="ticket_id" value={selected.id} /><div className="registry-form-grid assistance-visit-form"><label>Tipo<select name="visit_type" defaultValue="inspection">{Object.entries(visitTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Data e hora<input name="scheduled_at" type="datetime-local" required /></label><label>Técnico<input name="technician_name" /></label><label>Prestador<select name="supplier_id" defaultValue={selected.supplier_id ?? ""}><option value="">Equipe própria</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplierName(supplier)}</option>)}</select></label><label className="registry-wide">Orientações<textarea name="notes" rows={2} /></label></div><button className="auth-primary" type="submit">Agendar visita</button></form></details> : null}
              <div className="assistance-visit-list">{selectedVisits.map((visit) => <article key={visit.id}><header><div><strong>{visitTypeLabels[visit.visit_type] || visit.visit_type}</strong><span>{dateTimeBR(visit.scheduled_at)}</span></div><span className={`assistance-visit-status ${visit.status}`}>{visitStatusLabels[visit.status] || visit.status}</span></header><p>{visit.technician_name || supplierName(supplierMap.get(visit.supplier_id || ""))}</p>{visit.diagnosis ? <small><b>Diagnóstico:</b> {visit.diagnosis}</small> : null}{visit.service_performed ? <small><b>Executado:</b> {visit.service_performed}</small> : null}
                {canInspect && ["scheduled", "confirmed", "rescheduled"].includes(visit.status) ? <details><summary>Registrar resultado</summary><form action={completeAssistanceVisit}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="visit_id" value={visit.id} /><div className="registry-form-grid assistance-visit-result"><label>Resultado<select name="outcome" defaultValue="completed"><option value="completed">Concluída</option><option value="no_access">Sem acesso</option><option value="cancelled">Cancelada</option></select></label><label>Início<input name="started_at" type="datetime-local" /></label><label>Término<input name="finished_at" type="datetime-local" /></label><label className="registry-wide">Diagnóstico<textarea name="diagnosis" rows={3} /></label><label className="registry-wide">Serviço executado<textarea name="service_performed" rows={3} /></label><label className="registry-wide">Materiais utilizados<textarea name="materials_used" rows={2} /></label><label className="assistance-check"><input name="requires_return" type="checkbox" /> Necessita retorno</label><label className="registry-wide">Recomendação de retorno<textarea name="return_recommendation" rows={2} /></label><label className="registry-wide">Observações<textarea name="notes" rows={2} /></label></div><button className="auth-primary" type="submit">Registrar resultado</button></form></details> : null}
              </article>)}{!selectedVisits.length ? <p className="assistance-muted">Nenhuma visita agendada.</p> : null}</div>
            </section>

            <section className="assistance-card"><div className="section-heading"><div><span>Evidências</span><h2>Fotos e documentos</h2></div><p>{selectedDocuments.length} arquivo(s)</p></div>
              {(canInspect || canExecute) && activeStatuses ? <details className="registry-create"><summary>+ Anexar evidências</summary><form action={uploadAssistanceDocuments} encType="multipart/form-data"><input type="hidden" name="ticket_id" value={selected.id} /><div className="registry-form-grid"><label>Tipo<select name="document_type" defaultValue="evidence">{Object.entries(documentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="registry-wide">Arquivos<input name="documents" type="file" accept="image/*,.pdf,.docx" multiple required /></label><label className="registry-wide">Legenda<input name="caption" /></label></div><button className="auth-primary" type="submit">Enviar arquivos</button></form></details> : null}
              <div className="assistance-document-list">{selectedDocuments.map((document) => <article key={document.id}><div><strong>{documentLabels[document.document_type] || document.document_type}</strong><span>{document.file_name}</span><small>{document.caption || dateTimeBR(document.uploaded_at)}</small></div><div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{canManage && activeStatuses ? <form action={removeAssistanceDocument}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="document_id" value={document.id} /><button type="submit">Excluir</button></form> : null}</div></article>)}{!selectedDocuments.length ? <p className="assistance-muted">Nenhuma evidência anexada.</p> : null}</div>
            </section>
          </div>

          <aside className="assistance-side-column">
            <section className="assistance-card assistance-workflow"><span>Fluxo do atendimento</span><h2>Próxima ação</h2>
              {canManage && selected.status === "open" ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="triage" /><label>Triagem inicial<textarea name="notes" rows={3} required /></label><button className="auth-primary" type="submit">Iniciar triagem</button></form> : null}
              {canExecute && ["triage", "inspection_scheduled", "awaiting_supplier"].includes(selected.status) ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="approved" /><label>Análise de garantia<select name="warranty_status" defaultValue={selected.warranty_status === "pending" ? "covered" : selected.warranty_status}>{Object.entries(warrantyLabels).filter(([value]) => value !== "pending").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Fundamentação<textarea name="warranty_reason" rows={3} defaultValue={selected.warranty_reason ?? ""} required /></label><label>Diagnóstico / autorização<textarea name="notes" rows={3} defaultValue={selected.diagnosis ?? ""} required /></label><button className="auth-primary" type="submit">Aprovar atendimento</button></form> : null}
              {canManage && ["triage", "inspection_scheduled"].includes(selected.status) ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="awaiting_supplier" /><label>Motivo / retorno esperado<textarea name="notes" rows={2} required /></label><button type="submit">Aguardar prestador</button></form> : null}
              {canExecute && ["approved", "triage", "awaiting_supplier"].includes(selected.status) ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="in_progress" /><label>Início da execução<textarea name="notes" rows={2} required /></label><button className="auth-primary" type="submit">Iniciar execução</button></form> : null}
              {canExecute && selected.status === "in_progress" ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="awaiting_acceptance" /><label>Solução executada<textarea name="notes" rows={3} required /></label><button className="auth-primary" type="submit">Solicitar aceite</button></form> : null}
              {canClose && selected.status === "awaiting_acceptance" ? <form action={acceptAssistanceResolution}><input type="hidden" name="ticket_id" value={selected.id} /><label>Responsável pelo aceite<input name="accepted_by_name" defaultValue={selected.contact_name ?? ""} required /></label><label>Avaliação<select name="customer_rating" defaultValue="5"><option value="5">5 · Excelente</option><option value="4">4 · Muito bom</option><option value="3">3 · Bom</option><option value="2">2 · Regular</option><option value="1">1 · Ruim</option></select></label><label>Solução final<textarea name="notes" rows={4} defaultValue={selected.execution_notes ?? ""} required /></label><button className="auth-primary" type="submit">Aceitar e encerrar</button></form> : null}
              {selected.status === "resolved" ? <div className="assistance-completed"><strong>Atendimento encerrado</strong><p>{selected.resolution_notes}</p><small>Aceite: {selected.accepted_by_name || "registrado"} · nota {selected.customer_rating || "—"}/5</small></div> : null}
              {selected.status === "rejected" ? <div className="assistance-completed rejected"><strong>Atendimento rejeitado</strong><p>{selected.rejection_reason}</p></div> : null}
              {selected.status === "cancelled" ? <div className="assistance-completed cancelled"><strong>Chamado cancelado</strong><p>{selected.cancellation_reason}</p></div> : null}
              {canClose && activeStatuses ? <details className="assistance-close-actions"><summary>Encerrar sem execução</summary><form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><label>Resultado<select name="status" defaultValue="rejected"><option value="rejected">Rejeitar solicitação</option><option value="cancelled">Cancelar chamado</option></select></label><label>Justificativa<textarea name="notes" rows={3} required /></label><button className="danger" type="submit">Confirmar encerramento</button></form></details> : null}
              {canManage && ["resolved", "rejected", "cancelled"].includes(selected.status) ? <form action={setAssistanceStatus}><input type="hidden" name="ticket_id" value={selected.id} /><input type="hidden" name="status" value="triage" /><label>Motivo da reabertura<textarea name="notes" rows={3} required /></label><button type="submit">Reabrir para triagem</button></form> : null}
            </section>

            <section className="assistance-card"><div className="section-heading"><div><span>Histórico</span><h2>Linha do tempo</h2></div></div>
              {canManage ? <details className="registry-create"><summary>+ Adicionar observação</summary><form action={addAssistanceNote}><input type="hidden" name="ticket_id" value={selected.id} /><label>Observação<textarea name="notes" rows={3} required /></label><button type="submit">Registrar</button></form></details> : null}
              <div className="assistance-timeline">{selectedAudit.map((audit) => <article key={audit.id}><i></i><div><strong>{auditLabels[audit.action] || audit.action}</strong><span>{dateTimeBR(audit.changed_at)}</span>{audit.previous_status || audit.new_status ? <small>{audit.previous_status ? statusLabels[audit.previous_status] : ""}{audit.previous_status && audit.new_status ? " → " : ""}{audit.new_status ? statusLabels[audit.new_status] : ""}</small> : null}{audit.notes ? <p>{audit.notes}</p> : null}</div></article>)}{!selectedAudit.length ? <p className="assistance-muted">Sem movimentações registradas.</p> : null}</div>
            </section>
          </aside>
        </div>
      </section> : null}
    </> : null}
  </AppShell>;
}
