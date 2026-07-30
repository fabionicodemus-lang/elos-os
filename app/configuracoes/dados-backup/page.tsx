import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  cancelDataRestore,
  deleteDataExport,
  generateDataExport,
  requestDataRestore,
  reviewDataRestore,
} from "./actions";
import "../../system-data-backup.css";

type Project = { id: string; name: string; code: string | null };
type InventoryRow = { table_name: string; module_key: string; row_count: number | string; project_scoped: boolean };
type DataExport = {
  id: string;
  project_id: string | null;
  scope_type: "company" | "project";
  modules: string[];
  format: "json" | "xlsx";
  status: "processing" | "ready" | "failed" | "expired" | "deleted";
  file_name: string | null;
  file_size: number | string | null;
  checksum_sha256: string | null;
  table_count: number;
  row_count: number | string;
  download_count: number;
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string;
  error_message: string | null;
};
type RestoreRequest = {
  id: string;
  export_id: string;
  project_id: string | null;
  status: "pending_review" | "approved_for_manual_restore" | "rejected" | "cancelled" | "completed";
  reason: string;
  requested_by: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
};
type Audit = {
  id: string;
  export_id: string | null;
  restore_request_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
};
type Profile = { id: string; full_name: string | null; email: string };

const MODULES = [
  ["system", "Sistema e acessos"],
  ["registries", "Cadastros gerais"],
  ["projects", "Empreendimentos"],
  ["engineering", "Engenharia"],
  ["execution", "Execução"],
  ["procurement", "Suprimentos"],
  ["finance", "Financeiro"],
  ["commercial", "Comercial"],
  ["postwork", "Pós-Obra"],
  ["documents", "Documentos"],
  ["other", "Outros dados"],
] as const;

const MODULE_LABELS = Object.fromEntries(MODULES) as Record<string, string>;
const STATUS_LABELS: Record<string, string> = {
  processing: "Gerando",
  ready: "Disponível",
  failed: "Falhou",
  expired: "Expirado",
  deleted: "Excluído",
  pending_review: "Aguardando revisão",
  approved_for_manual_restore: "Aprovada para procedimento",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
  completed: "Concluída",
};
const AUDIT_LABELS: Record<string, string> = {
  export_requested: "Exportação solicitada",
  export_completed: "Pacote concluído",
  export_failed: "Falha na exportação",
  export_downloaded: "Pacote baixado",
  export_deleted: "Pacote excluído",
  restore_requested: "Restauração solicitada",
  restore_approved: "Restauração aprovada",
  restore_rejected: "Restauração rejeitada",
  restore_cancelled: "Restauração cancelada",
  restore_completed: "Restauração concluída",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value: number | string | null) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString("pt-BR", { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

function effectiveStatus(record: DataExport) {
  if (record.status === "ready" && new Date(record.expires_at).getTime() <= Date.now()) return "expired";
  return record.status;
}

function shortChecksum(value: string | null) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
}

function actorName(id: string | null, profiles: Profile[]) {
  const profile = profiles.find((item) => item.id === id);
  return profile?.full_name || profile?.email || "Sistema";
}

export default async function DataBackupPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey, projectId: activeProjectId } = await requireCompanyPermission("admin.data.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const [exportPermission, restorePermission, managePermission] = privileged
    ? [{ data: true }, { data: true }, { data: true }]
    : await Promise.all([
        supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.export" }),
        supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.restore" }),
        supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "admin.data.manage" }),
      ]);
  const canExport = exportPermission.data === true;
  const canRestore = restorePermission.data === true;
  const canManage = managePermission.data === true;

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, name, code")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("name");
  const projects = (projectData ?? []) as Project[];
  const requestedProject = params.project || activeProjectId || "";
  const inventoryProjectId = projects.some((project) => project.id === requestedProject) ? requestedProject : null;

  const [inventoryResult, exportsResult, restoresResult, auditResult] = await Promise.all([
    supabase.rpc("system_company_data_inventory", { p_company_id: companyId, p_project_id: inventoryProjectId }),
    supabase
      .from("system_data_exports")
      .select("id, project_id, scope_type, modules, format, status, file_name, file_size, checksum_sha256, table_count, row_count, download_count, requested_by, requested_at, completed_at, expires_at, error_message")
      .eq("company_id", companyId)
      .order("requested_at", { ascending: false })
      .limit(40),
    canRestore
      ? supabase
          .from("system_data_restore_requests")
          .select("id, export_id, project_id, status, reason, requested_by, requested_at, reviewed_by, reviewed_at, review_notes")
          .eq("company_id", companyId)
          .order("requested_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("system_data_audit")
      .select("id, export_id, restore_request_id, action, details, actor_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const inventory = (inventoryResult.data ?? []) as InventoryRow[];
  const exports = (exportsResult.data ?? []) as DataExport[];
  const restores = (restoresResult.data ?? []) as RestoreRequest[];
  const audit = (auditResult.data ?? []) as Audit[];
  const actorIds = [...new Set([
    ...exports.map((item) => item.requested_by),
    ...restores.flatMap((item) => [item.requested_by, item.reviewed_by]),
    ...audit.map((item) => item.actor_id),
  ].filter((value): value is string => Boolean(value)))];
  const { data: profileData } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const profiles = (profileData ?? []) as Profile[];

  const totalRows = inventory.reduce((sum, item) => sum + Number(item.row_count || 0), 0);
  const populatedTables = inventory.filter((item) => Number(item.row_count || 0) > 0).length;
  const readyExports = exports.filter((item) => effectiveStatus(item) === "ready");
  const storageUsed = readyExports.reduce((sum, item) => sum + Number(item.file_size || 0), 0);
  const latestReady = readyExports[0] ?? null;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const moduleSummary = MODULES.map(([key, label]) => {
    const rows = inventory.filter((item) => item.module_key === key);
    return {
      key,
      label,
      tables: rows.length,
      populated: rows.filter((item) => Number(item.row_count || 0) > 0).length,
      records: rows.reduce((sum, item) => sum + Number(item.row_count || 0), 0),
      rows,
    };
  }).filter((module) => module.tables > 0);

  return (
    <AppShell
      activeGroup="system"
      activeItem="data-backup"
      eyebrow="Sistema · Segurança dos dados"
      title="Dados & Backup"
      description={`${company.name} · inventário, exportações lógicas privadas, integridade e recuperação controlada.`}
    >
      <div className="data-backup-page">
        {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
        {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}

        <section className="data-backup-kpis">
          <article><span>Registros no escopo</span><strong>{totalRows.toLocaleString("pt-BR")}</strong><small>{populatedTables} tabelas com dados</small></article>
          <article><span>Pacotes disponíveis</span><strong>{readyExports.length}</strong><small>{formatBytes(storageUsed)} armazenados</small></article>
          <article><span>Último backup</span><strong>{latestReady ? formatDate(latestReady.completed_at) : "Nenhum"}</strong><small>{latestReady?.format.toUpperCase() ?? "Gere o primeiro pacote"}</small></article>
          <article><span>Restaurações abertas</span><strong>{restores.filter((item) => ["pending_review", "approved_for_manual_restore"].includes(item.status)).length}</strong><small>Nenhuma execução automática</small></article>
        </section>

        <section className="data-backup-grid">
          <article className="data-backup-card inventory-card">
            <header className="data-backup-card-header">
              <div><span>Inventário</span><h2>Volume por módulo</h2><p>Os números respeitam a empresa ativa e o empreendimento escolhido.</p></div>
              <form className="data-backup-filter" method="get">
                <label>
                  Escopo do inventário
                  <select name="project" defaultValue={inventoryProjectId ?? ""}>
                    <option value="">Empresa inteira</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <button type="submit">Atualizar</button>
              </form>
            </header>
            <div className="module-inventory-list">
              {moduleSummary.map((module) => (
                <details key={module.key} className="module-inventory-item">
                  <summary>
                    <span><strong>{module.label}</strong><small>{module.populated} de {module.tables} tabelas com registros</small></span>
                    <b>{module.records.toLocaleString("pt-BR")}</b>
                  </summary>
                  <div className="inventory-table-list">
                    {module.rows.map((row) => (
                      <div key={row.table_name}>
                        <code>{row.table_name}</code>
                        <span>{row.project_scoped ? "Por empreendimento" : "Compartilhada"}</span>
                        <strong>{Number(row.row_count || 0).toLocaleString("pt-BR")}</strong>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              {!moduleSummary.length ? <div className="data-backup-empty">Nenhuma tabela foi encontrada neste escopo.</div> : null}
            </div>
          </article>

          <article className="data-backup-card new-export-card">
            <header className="data-backup-card-header"><div><span>Novo pacote</span><h2>Gerar backup lógico</h2><p>O arquivo é criado com os dados que o Elos OS consegue reconstruir e auditar.</p></div></header>
            {canExport ? (
              <form className="data-backup-form" action={generateDataExport}>
                <div className="data-backup-form-grid">
                  <label>Escopo<select name="scope_type" defaultValue="company"><option value="company">Empresa inteira</option><option value="project">Um empreendimento</option></select></label>
                  <label>Empreendimento<select name="project_id" defaultValue={activeProjectId ?? ""}><option value="">Selecione quando necessário</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                  <label>Formato<select name="format" defaultValue="json"><option value="json">JSON · preserva estrutura</option><option value="xlsx">Excel · leitura humana</option></select></label>
                  <label>Retenção<select name="retention_days" defaultValue="30"><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">365 dias</option></select></label>
                </div>
                <fieldset className="backup-module-fieldset">
                  <legend>Módulos incluídos</legend>
                  <p>Deixe todos marcados para um pacote completo.</p>
                  <div className="backup-module-options">
                    {MODULES.map(([key, label]) => <label key={key}><input type="checkbox" name="modules" value={key} defaultChecked /><span>{label}</span></label>)}
                  </div>
                </fieldset>
                <div className="backup-callout"><strong>O que não vai dentro do arquivo?</strong><p>Fotos, PDFs e outros binários permanecem nos buckets privados. O pacote registra as tabelas e caminhos desses documentos.</p></div>
                <button className="data-backup-primary" type="submit">Gerar pacote privado</button>
              </form>
            ) : <div className="data-backup-empty">Seu papel permite consultar o inventário, mas não gerar exportações.</div>}
          </article>
        </section>

        <section className="data-backup-card">
          <header className="data-backup-card-header"><div><span>Histórico</span><h2>Pacotes de exportação</h2><p>Checksum SHA-256, retenção, tamanho e downloads ficam registrados.</p></div></header>
          <div className="backup-export-list">
            {exports.map((record) => {
              const status = effectiveStatus(record);
              return (
                <article className="backup-export-item" key={record.id}>
                  <div className="backup-export-main">
                    <div className="backup-export-title"><span className={`backup-status ${status}`}>{STATUS_LABELS[status] ?? status}</span><strong>{record.file_name || `Pacote ${record.id.slice(0, 8)}`}</strong></div>
                    <p>{record.scope_type === "project" ? projectNames.get(record.project_id || "") || "Empreendimento" : "Empresa inteira"} · {record.format.toUpperCase()} · solicitado por {actorName(record.requested_by, profiles)}</p>
                    {record.error_message ? <div className="backup-error">{record.error_message}</div> : null}
                    <div className="backup-export-meta">
                      <span><b>{Number(record.row_count || 0).toLocaleString("pt-BR")}</b> registros</span>
                      <span><b>{record.table_count}</b> tabelas</span>
                      <span><b>{formatBytes(record.file_size)}</b> arquivo</span>
                      <span><b>{record.download_count}</b> downloads</span>
                      <span>Gerado: <b>{formatDate(record.completed_at || record.requested_at)}</b></span>
                      <span>Expira: <b>{formatDate(record.expires_at)}</b></span>
                    </div>
                    <code className="backup-checksum" title={record.checksum_sha256 || undefined}>SHA-256 {shortChecksum(record.checksum_sha256)}</code>
                  </div>
                  <div className="backup-export-actions">
                    {status === "ready" ? <Link className="data-backup-primary" href={`/configuracoes/dados-backup/download/${record.id}`}>Baixar</Link> : null}
                    {canRestore && status === "ready" ? (
                      <details className="backup-action-details">
                        <summary>Solicitar restauração</summary>
                        <form action={requestDataRestore}>
                          <input type="hidden" name="export_id" value={record.id} />
                          <label>Motivo<textarea name="reason" minLength={20} required placeholder="Explique o que precisa ser recuperado e por quê." /></label>
                          <label>Confirmação<input name="confirmation" required placeholder="SOLICITAR RESTAURAÇÃO" /></label>
                          <button type="submit">Abrir revisão</button>
                        </form>
                      </details>
                    ) : null}
                    {canManage && status !== "deleted" ? (
                      <details className="backup-action-details danger">
                        <summary>Excluir pacote</summary>
                        <form action={deleteDataExport}>
                          <input type="hidden" name="export_id" value={record.id} />
                          <label>Confirmação<input name="confirmation" required placeholder="EXCLUIR" /></label>
                          <button type="submit">Excluir arquivo</button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {!exports.length ? <div className="data-backup-empty">Nenhum pacote foi gerado ainda.</div> : null}
          </div>
        </section>

        {canRestore ? (
          <section className="data-backup-card">
            <header className="data-backup-card-header"><div><span>Recuperação</span><h2>Solicitações de restauração</h2><p>A aprovação autoriza apenas o procedimento operacional; o sistema não sobrescreve o banco automaticamente.</p></div></header>
            <div className="restore-request-list">
              {restores.map((request) => {
                const source = exports.find((item) => item.id === request.export_id);
                return (
                  <article className="restore-request-item" key={request.id}>
                    <div>
                      <span className={`backup-status ${request.status}`}>{STATUS_LABELS[request.status] ?? request.status}</span>
                      <h3>{source?.file_name || `Pacote ${request.export_id.slice(0, 8)}`}</h3>
                      <p>{request.reason}</p>
                      <small>Solicitada por {actorName(request.requested_by, profiles)} em {formatDate(request.requested_at)}</small>
                      {request.reviewed_at ? <small>Revisada por {actorName(request.reviewed_by, profiles)} em {formatDate(request.reviewed_at)}</small> : null}
                      {request.review_notes ? <div className="restore-notes">{request.review_notes}</div> : null}
                    </div>
                    <div className="restore-request-actions">
                      {privileged && request.status === "pending_review" ? (
                        <>
                          <details className="backup-action-details approve"><summary>Aprovar</summary><form action={reviewDataRestore}><input type="hidden" name="request_id" value={request.id} /><input type="hidden" name="decision" value="approve" /><label>Notas<textarea name="notes" placeholder="Orientações para a recuperação." /></label><label>Confirmação<input name="confirmation" required placeholder="APROVAR RESTAURAÇÃO" /></label><button type="submit">Aprovar procedimento</button></form></details>
                          <details className="backup-action-details danger"><summary>Rejeitar</summary><form action={reviewDataRestore}><input type="hidden" name="request_id" value={request.id} /><input type="hidden" name="decision" value="reject" /><label>Motivo<textarea name="notes" minLength={10} required /></label><label>Confirmação<input name="confirmation" required placeholder="REJEITAR" /></label><button type="submit">Rejeitar</button></form></details>
                        </>
                      ) : null}
                      {["pending_review", "approved_for_manual_restore"].includes(request.status) ? (
                        <details className="backup-action-details"><summary>Cancelar</summary><form action={cancelDataRestore}><input type="hidden" name="request_id" value={request.id} /><label>Motivo<input name="reason" /></label><label>Confirmação<input name="confirmation" required placeholder="CANCELAR" /></label><button type="submit">Cancelar solicitação</button></form></details>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {!restores.length ? <div className="data-backup-empty">Nenhuma restauração foi solicitada.</div> : null}
            </div>
          </section>
        ) : null}

        <section className="data-backup-card">
          <header className="data-backup-card-header"><div><span>Auditoria</span><h2>Movimentações recentes</h2><p>Registro imutável das operações realizadas nesta área.</p></div></header>
          <div className="data-audit-list">
            {audit.map((event) => (
              <div className="data-audit-item" key={event.id}>
                <span className="data-audit-icon">{event.action.includes("restore") ? "↺" : "⇩"}</span>
                <div><strong>{AUDIT_LABELS[event.action] ?? event.action}</strong><small>{actorName(event.actor_id, profiles)} · {formatDate(event.created_at)}</small></div>
                <code>{event.export_id?.slice(0, 8) || event.restore_request_id?.slice(0, 8) || "sistema"}</code>
              </div>
            ))}
            {!audit.length ? <div className="data-backup-empty">A auditoria começará no primeiro pacote gerado.</div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
