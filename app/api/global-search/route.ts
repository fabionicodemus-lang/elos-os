import { NextRequest, NextResponse } from "next/server";
import { resolveActiveWorkspace } from "@/lib/workspace";

type SearchResult = {
  id: string;
  kind: string;
  group: string;
  icon: string;
  title: string;
  subtitle: string;
  meta?: string;
  href: string;
  projectId?: string | null;
  projectName?: string | null;
  score?: number;
};

type RelatedProject = { id?: string; name?: string; code?: string | null };

type SearchTask = () => Promise<SearchResult[]>;

const RESULT_LIMIT = 6;
const TOTAL_LIMIT = 60;

const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  available: "Disponível",
  reserved: "Reservada",
  sold: "Vendida",
  draft: "Em elaboração",
  sent: "Enviada",
  negotiation: "Em negociação",
  approved: "Aprovado",
  rejected: "Recusado",
  expired: "Vencido",
  converted: "Convertido",
  cancelled: "Cancelado",
  open: "Em aberto",
  paid: "Pago",
  issued: "Emitido",
  confirmed: "Confirmado",
  released: "Liberada",
  in_progress: "Em execução",
  paused: "Pausado",
  finished: "Concluído",
  resolved: "Resolvido",
  triage: "Em triagem",
  inspection_scheduled: "Vistoria agendada",
  awaiting_supplier: "Aguardando prestador",
  awaiting_acceptance: "Aguardando aceite",
  pending_acceptance: "Aguardando aceite",
  partially_received: "Recebimento parcial",
  received: "Recebido",
  closed: "Encerrado",
  completed: "Concluído",
};

function cleanTerm(value: string) {
  return value
    .replace(/[,%()'"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function asText(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function relatedProject(value: unknown): RelatedProject | null {
  return one(value as RelatedProject | RelatedProject[] | null);
}

function projectLabel(value: unknown) {
  const project = relatedProject(value);
  if (!project) return "";
  return [project.code, project.name].filter(Boolean).join(" · ");
}

function money(value: unknown) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function dateBR(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  const date = new Date(text.length === 10 ? `${text}T12:00:00-03:00` : text);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat("pt-BR").format(date);
}

function statusLabel(value: unknown) {
  const key = asText(value);
  return statusLabels[key] ?? key.replaceAll("_", " ");
}

function withProjectScope<T>(query: T, scopeProjectId: string | null): T {
  if (!scopeProjectId) return query;
  return (query as T & { eq: (column: string, value: string) => T }).eq("project_id", scopeProjectId);
}

function scoreResult(result: SearchResult, term: string) {
  const query = normalize(term);
  const title = normalize(result.title);
  const subtitle = normalize(result.subtitle);
  const meta = normalize(result.meta ?? "");
  let score = 0;
  if (title === query) score += 120;
  else if (title.startsWith(query)) score += 85;
  else if (title.includes(query)) score += 55;
  if (subtitle.startsWith(query)) score += 35;
  else if (subtitle.includes(query)) score += 20;
  if (meta.includes(query)) score += 8;
  return score;
}

function openHref(href: string, resultProjectId: string | null | undefined, activeProjectId: string | null) {
  if (!resultProjectId || resultProjectId === activeProjectId) return href;
  const params = new URLSearchParams({ project_id: resultProjectId, dest: href });
  return `/busca/abrir?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  const { supabase, companyId, projectId, role } = await resolveActiveWorkspace();
  const term = cleanTerm(request.nextUrl.searchParams.get("q") ?? "");
  const scope = request.nextUrl.searchParams.get("scope") === "company" ? "company" : "project";
  const scopeProjectId = scope === "project" ? projectId : null;

  if (term.length < 2) {
    return NextResponse.json({ results: [], query: term, scope, activeProjectId: projectId });
  }

  const privileged = role.key === "owner" || role.key === "admin";
  const permissionRows = privileged || !role.id
    ? []
    : ((await supabase
        .from("role_permissions")
        .select("permission_key")
        .eq("role_id", role.id)
        .eq("allowed", true)).data ?? []);
  const permissions = new Set(permissionRows.map((item) => item.permission_key));
  const can = (permission: string) => privileged || permissions.has(permission);
  const like = `%${term}%`;
  const tasks: SearchTask[] = [];
  const add = (enabled: boolean, task: SearchTask) => { if (enabled) tasks.push(task); };

  add(can("clients.view"), async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("id,name,tax_id,email,phone,city,state,status")
      .eq("company_id", companyId)
      .or(`name.ilike.${like},tax_id.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .order("name")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `client:${row.id}`,
      kind: "client",
      group: "Clientes",
      icon: "◇",
      title: row.name,
      subtitle: [row.tax_id, row.email, row.phone].filter(Boolean).join(" · ") || "Cadastro de cliente",
      meta: [row.city, row.state, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/cadastros/clientes?q=${encodeURIComponent(row.name)}`,
    }));
  });

  add(can("suppliers.view"), async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,legal_name,trade_name,tax_id,email,phone,category,city,state,status")
      .eq("company_id", companyId)
      .or(`legal_name.ilike.${like},trade_name.ilike.${like},tax_id.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .order("legal_name")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `supplier:${row.id}`,
      kind: "supplier",
      group: "Fornecedores",
      icon: "▦",
      title: row.trade_name || row.legal_name,
      subtitle: [row.legal_name !== row.trade_name ? row.legal_name : null, row.tax_id, row.category].filter(Boolean).join(" · ") || "Cadastro de fornecedor",
      meta: [row.city, row.state, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/cadastros/fornecedores?q=${encodeURIComponent(row.trade_name || row.legal_name)}`,
    }));
  });

  add(can("projects.view"), async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,code,city,state,status")
      .eq("company_id", companyId)
      .or(`name.ilike.${like},code.ilike.${like},city.ilike.${like}`)
      .neq("status", "archived")
      .order("name")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `project:${row.id}`,
      kind: "project",
      group: "Empreendimentos",
      icon: "▥",
      title: [row.code, row.name].filter(Boolean).join(" · "),
      subtitle: [row.city, row.state].filter(Boolean).join(" · ") || "Empreendimento",
      meta: statusLabel(row.status),
      href: `/empreendimentos?q=${encodeURIComponent(row.name)}`,
      projectId: row.id,
      projectName: row.name,
    }));
  });

  add(can("projects.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("units")
      .select("id,project_id,code,tower,floor,type,position,status,registry,projects(id,name,code)")
      .eq("company_id", companyId)
      .or(`code.ilike.${like},tower.ilike.${like},type.ilike.${like},position.ilike.${like},registry.ilike.${like}`)
      .order("code")
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `unit:${row.id}`,
      kind: "unit",
      group: "Unidades",
      icon: "▤",
      title: `Unidade ${row.code}`,
      subtitle: [projectLabel(row.projects), row.tower ? `Torre ${row.tower}` : null, row.floor !== null ? `${row.floor}º pav.` : null, row.type].filter(Boolean).join(" · "),
      meta: [row.position, row.registry, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/empreendimentos/unidades?q=${encodeURIComponent(row.code)}`,
      projectId: row.project_id,
      projectName: relatedProject(row.projects)?.name ?? null,
    }));
  });

  add(can("services.view"), async () => {
    const { data, error } = await supabase
      .from("engineering_services")
      .select("id,code,description,unit,group_code,status")
      .eq("company_id", companyId)
      .or(`code.ilike.${like},description.ilike.${like},group_code.ilike.${like}`)
      .order("code")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `service:${row.id}`,
      kind: "service",
      group: "Serviços de engenharia",
      icon: "♙",
      title: `${row.code} · ${row.description}`,
      subtitle: [row.group_code, row.unit].filter(Boolean).join(" · ") || "Serviço",
      meta: statusLabel(row.status),
      href: `/engenharia/servicos?service=${encodeURIComponent(row.id)}`,
    }));
  });

  add(can("inputs.view"), async () => {
    const { data, error } = await supabase
      .from("engineering_inputs")
      .select("id,code,description,unit,category,family_label,status")
      .eq("company_id", companyId)
      .or(`code.ilike.${like},description.ilike.${like},family_label.ilike.${like}`)
      .order("code")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `input:${row.id}`,
      kind: "input",
      group: "Insumos",
      icon: "□",
      title: `${row.code} · ${row.description}`,
      subtitle: [row.family_label, row.category, row.unit].filter(Boolean).join(" · "),
      meta: statusLabel(row.status),
      href: `/engenharia/insumos?q=${encodeURIComponent(row.code)}`,
    }));
  });

  add(can("commercial.brokers.view"), async () => {
    const { data, error } = await supabase
      .from("commercial_brokers")
      .select("id,name,kind,document,creci,email,phone,company_name,status")
      .eq("company_id", companyId)
      .or(`name.ilike.${like},document.ilike.${like},creci.ilike.${like},email.ilike.${like},phone.ilike.${like},company_name.ilike.${like}`)
      .order("name")
      .limit(RESULT_LIMIT);
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `broker:${row.id}`,
      kind: "broker",
      group: "Corretores e parceiros",
      icon: "◇",
      title: row.name,
      subtitle: [row.company_name, row.creci, row.document].filter(Boolean).join(" · ") || row.kind,
      meta: [row.email, row.phone, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/comercial/corretores?q=${encodeURIComponent(row.name)}`,
    }));
  });

  add(can("commercial.proposals.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("commercial_proposals")
      .select("id,project_id,number,version_no,proposal_date,valid_until,proposed_amount,broker_name,status,clients(id,name),units(id,code),projects(id,name,code)")
      .eq("company_id", companyId)
      .or(`number.ilike.${like},broker_name.ilike.${like},source_channel.ilike.${like},notes.ilike.${like}`)
      .order("proposal_date", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const client = one(row.clients as { name?: string } | { name?: string }[] | null);
      const unit = one(row.units as { code?: string } | { code?: string }[] | null);
      return {
        id: `proposal:${row.id}`,
        kind: "proposal",
        group: "Propostas",
        icon: "◇",
        title: row.number,
        subtitle: [client?.name, unit?.code ? `Unidade ${unit.code}` : null, money(row.proposed_amount)].filter(Boolean).join(" · "),
        meta: [projectLabel(row.projects), `V${row.version_no}`, statusLabel(row.status), row.valid_until ? `válida até ${dateBR(row.valid_until)}` : null].filter(Boolean).join(" · "),
        href: `/comercial/propostas/${row.id}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("sales.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("sales")
      .select("id,project_id,number,contract_number,sale_date,total_amount,broker_name,status,clients(id,name),units(id,code),projects(id,name,code)")
      .eq("company_id", companyId)
      .or(`number.ilike.${like},contract_number.ilike.${like},broker_name.ilike.${like},source_code.ilike.${like}`)
      .order("sale_date", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const client = one(row.clients as { name?: string } | { name?: string }[] | null);
      const unit = one(row.units as { code?: string } | { code?: string }[] | null);
      return {
        id: `sale:${row.id}`,
        kind: "sale",
        group: "Vendas",
        icon: "$",
        title: row.number,
        subtitle: [client?.name, unit?.code ? `Unidade ${unit.code}` : null, money(row.total_amount)].filter(Boolean).join(" · "),
        meta: [row.contract_number, projectLabel(row.projects), dateBR(row.sale_date), statusLabel(row.status)].filter(Boolean).join(" · "),
        href: `/comercial/vendas?q=${encodeURIComponent(row.number)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("execution.contracts.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("execution_service_contracts")
      .select("id,project_id,contract_number,title,scope_summary,status,current_value,responsible_name,projects(id,name,code)")
      .eq("company_id", companyId)
      .or(`contract_number.ilike.${like},title.ilike.${like},scope_summary.ilike.${like},responsible_name.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `contract:${row.id}`,
      kind: "contract",
      group: "Contratos de serviços",
      icon: "▣",
      title: `${row.contract_number} · ${row.title}`,
      subtitle: [row.scope_summary, money(row.current_value)].filter(Boolean).join(" · "),
      meta: [projectLabel(row.projects), row.responsible_name, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/execucao/contratos-servicos?contract=${encodeURIComponent(row.id)}`,
      projectId: row.project_id,
      projectName: relatedProject(row.projects)?.name ?? null,
    }));
  });

  add(can("execution.work_orders.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("execution_work_orders")
      .select("id,project_id,work_order_number,title,scope_summary,status,authorized_value,responsible_name,projects(id,name,code)")
      .eq("company_id", companyId)
      .or(`work_order_number.ilike.${like},title.ilike.${like},scope_summary.ilike.${like},responsible_name.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: `work-order:${row.id}`,
      kind: "work_order",
      group: "Ordens de serviço",
      icon: "✓",
      title: `${row.work_order_number} · ${row.title}`,
      subtitle: [row.scope_summary, money(row.authorized_value)].filter(Boolean).join(" · "),
      meta: [projectLabel(row.projects), row.responsible_name, statusLabel(row.status)].filter(Boolean).join(" · "),
      href: `/execucao/ordens-servico?work_order=${encodeURIComponent(row.id)}`,
      projectId: row.project_id,
      projectName: relatedProject(row.projects)?.name ?? null,
    }));
  });

  add(can("procurement.orders.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("procurement_purchase_orders")
      .select("id,project_id,order_number,status,total_amount,expected_delivery_date,buyer_name,supplier_confirmation_reference,projects(id,name,code),suppliers(id,legal_name,trade_name)")
      .eq("company_id", companyId)
      .or(`order_number.ilike.${like},buyer_name.ilike.${like},supplier_confirmation_reference.ilike.${like},notes.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const supplier = one(row.suppliers as { legal_name?: string; trade_name?: string | null } | { legal_name?: string; trade_name?: string | null }[] | null);
      return {
        id: `purchase-order:${row.id}`,
        kind: "purchase_order",
        group: "Pedidos de compra",
        icon: "🛒",
        title: row.order_number,
        subtitle: [supplier?.trade_name || supplier?.legal_name, money(row.total_amount)].filter(Boolean).join(" · "),
        meta: [projectLabel(row.projects), row.expected_delivery_date ? `entrega ${dateBR(row.expected_delivery_date)}` : null, statusLabel(row.status)].filter(Boolean).join(" · "),
        href: `/suprimentos/pedidos-compras?order=${encodeURIComponent(row.id)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("payables.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("payables")
      .select("id,project_id,document,due_date,amount,status,installment_label,notes,source_system,projects(id,name,code),suppliers(id,legal_name,trade_name)")
      .eq("company_id", companyId)
      .or(`document.ilike.${like},installment_label.ilike.${like},notes.ilike.${like},source_system.ilike.${like}`)
      .order("due_date", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const supplier = one(row.suppliers as { legal_name?: string; trade_name?: string | null } | { legal_name?: string; trade_name?: string | null }[] | null);
      const searchText = row.document || row.installment_label || row.notes || row.id;
      return {
        id: `payable:${row.id}`,
        kind: "payable",
        group: "Contas a pagar",
        icon: "$",
        title: row.document || row.installment_label || "Conta a pagar",
        subtitle: [supplier?.trade_name || supplier?.legal_name, money(row.amount), row.due_date ? `vence ${dateBR(row.due_date)}` : null].filter(Boolean).join(" · "),
        meta: [projectLabel(row.projects), statusLabel(row.status)].filter(Boolean).join(" · "),
        href: `/financeiro/contas-a-pagar?q=${encodeURIComponent(searchText)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("receivables.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("receivables")
      .select("id,project_id,sale_id,description,category,due_date,adjusted_amount,status,sequence_number,sequence_total,projects(id,name,code),clients(id,name),units(id,code),sales(id,number)")
      .eq("company_id", companyId)
      .or(`description.ilike.${like},adjustment_index.ilike.${like}`)
      .order("due_date")
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const client = one(row.clients as { name?: string } | { name?: string }[] | null);
      const unit = one(row.units as { code?: string } | { code?: string }[] | null);
      const sale = one(row.sales as { number?: string } | { number?: string }[] | null);
      return {
        id: `receivable:${row.id}`,
        kind: "receivable",
        group: "Contas a receber",
        icon: "$",
        title: row.description,
        subtitle: [client?.name, unit?.code ? `Unidade ${unit.code}` : null, money(row.adjusted_amount), row.due_date ? `vence ${dateBR(row.due_date)}` : null].filter(Boolean).join(" · "),
        meta: [sale?.number, `${row.sequence_number}/${row.sequence_total}`, projectLabel(row.projects), statusLabel(row.status)].filter(Boolean).join(" · "),
        href: `/financeiro/contas-a-receber?sale=${encodeURIComponent(row.sale_id)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("postwork.assistance.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("postwork_assistance_tickets")
      .select("id,project_id,number,title,description,location_detail,status,priority,category,contact_name,opened_at,projects(id,name,code),units(id,code),clients(id,name)")
      .eq("company_id", companyId)
      .or(`number.ilike.${like},title.ilike.${like},description.ilike.${like},location_detail.ilike.${like},contact_name.ilike.${like}`)
      .order("opened_at", { ascending: false })
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const client = one(row.clients as { name?: string } | { name?: string }[] | null);
      const unit = one(row.units as { code?: string } | { code?: string }[] | null);
      return {
        id: `assistance:${row.id}`,
        kind: "assistance",
        group: "Assistências técnicas",
        icon: "⌁",
        title: `${row.number} · ${row.title}`,
        subtitle: [client?.name, unit?.code ? `Unidade ${unit.code}` : row.location_detail, row.category].filter(Boolean).join(" · "),
        meta: [projectLabel(row.projects), row.priority, statusLabel(row.status), dateBR(row.opened_at)].filter(Boolean).join(" · "),
        href: `/pos-obra/assistencias?ticket=${encodeURIComponent(row.id)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(can("postwork.warranties.view") && (scope === "company" || Boolean(scopeProjectId)), async () => {
    let query = supabase
      .from("postwork_warranty_assets")
      .select("id,project_id,asset_code,item_name,location_detail,brand,model,serial_number,invoice_number,start_date,end_date,status,projects(id,name,code),units(id,code)")
      .eq("company_id", companyId)
      .or(`asset_code.ilike.${like},item_name.ilike.${like},location_detail.ilike.${like},brand.ilike.${like},model.ilike.${like},serial_number.ilike.${like},invoice_number.ilike.${like}`)
      .order("end_date")
      .limit(RESULT_LIMIT);
    query = withProjectScope(query, scopeProjectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).map((row) => {
      const unit = one(row.units as { code?: string } | { code?: string }[] | null);
      return {
        id: `warranty:${row.id}`,
        kind: "warranty",
        group: "Garantias",
        icon: "⌁",
        title: `${row.asset_code} · ${row.item_name}`,
        subtitle: [unit?.code ? `Unidade ${unit.code}` : row.location_detail, row.brand, row.model, row.serial_number].filter(Boolean).join(" · "),
        meta: [projectLabel(row.projects), row.end_date ? `até ${dateBR(row.end_date)}` : null, statusLabel(row.status)].filter(Boolean).join(" · "),
        href: `/pos-obra/garantias?asset=${encodeURIComponent(row.id)}`,
        projectId: row.project_id,
        projectName: relatedProject(row.projects)?.name ?? null,
      };
    });
  });

  add(
    can("execution.contracts.view") || can("execution.work_orders.view") || can("procurement.orders.view") || can("postwork.assistance.view") || can("postwork.warranties.view"),
    async () => {
      const documentQueries: Promise<SearchResult[]>[] = [];
      const runDocumentQuery = async (
        table: string,
        parentColumn: string,
        permission: string,
        group: string,
        hrefBuilder: (parentId: string) => string,
      ) => {
        if (!can(permission) || (scope === "project" && !scopeProjectId)) return [];
        let query = supabase
          .from(table)
          .select(`id,project_id,${parentColumn},file_name,caption,document_type,uploaded_at,projects(id,name,code)`)
          .eq("company_id", companyId)
          .or(`file_name.ilike.${like},caption.ilike.${like}`)
          .order("uploaded_at", { ascending: false })
          .limit(3);
        query = withProjectScope(query, scopeProjectId);
        const { data, error } = await query;
        if (error) return [];
        return (data ?? []).map((row) => {
          const parentId = asText((row as Record<string, unknown>)[parentColumn]);
          return {
            id: `document:${table}:${row.id}`,
            kind: "document",
            group,
            icon: "▧",
            title: row.file_name,
            subtitle: [row.caption, row.document_type].filter(Boolean).join(" · ") || "Documento",
            meta: [projectLabel(row.projects), dateBR(row.uploaded_at)].filter(Boolean).join(" · "),
            href: hrefBuilder(parentId),
            projectId: row.project_id,
            projectName: relatedProject(row.projects)?.name ?? null,
          };
        });
      };

      documentQueries.push(runDocumentQuery("execution_service_contract_documents", "contract_id", "execution.contracts.view", "Documentos de contratos", (id) => `/execucao/contratos-servicos?contract=${encodeURIComponent(id)}`));
      documentQueries.push(runDocumentQuery("execution_work_order_documents", "work_order_id", "execution.work_orders.view", "Documentos de O.S.", (id) => `/execucao/ordens-servico?work_order=${encodeURIComponent(id)}`));
      documentQueries.push(runDocumentQuery("procurement_purchase_order_documents", "order_id", "procurement.orders.view", "Documentos de compras", (id) => `/suprimentos/pedidos-compras?order=${encodeURIComponent(id)}`));
      documentQueries.push(runDocumentQuery("postwork_assistance_documents", "ticket_id", "postwork.assistance.view", "Evidências de assistência", (id) => `/pos-obra/assistencias?ticket=${encodeURIComponent(id)}`));
      documentQueries.push(runDocumentQuery("postwork_warranty_documents", "asset_id", "postwork.warranties.view", "Documentos de garantia", (id) => `/pos-obra/garantias?asset=${encodeURIComponent(id)}`));
      return (await Promise.all(documentQueries)).flat();
    },
  );

  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const results = settled
    .flatMap((item) => item.status === "fulfilled" ? item.value : [])
    .map((result) => ({ ...result, href: openHref(result.href, result.projectId, projectId), score: scoreResult(result, term) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.group.localeCompare(b.group, "pt-BR") || a.title.localeCompare(b.title, "pt-BR"))
    .slice(0, TOTAL_LIMIT)
    .map(({ score: _score, ...result }) => result);

  return NextResponse.json({
    results,
    query: term,
    scope,
    activeProjectId: projectId,
    total: results.length,
  });
}
