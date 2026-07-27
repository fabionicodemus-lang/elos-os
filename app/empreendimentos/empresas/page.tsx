import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { setLegalEntityStatus } from "./actions";
import {
  LegalEntityCreateDialog,
  LegalEntityEditDialog,
  type LegalEntityData,
} from "./legal-entity-dialogs";

const typeLabels: Record<string, string> = {
  incorporator: "Incorporadora / matriz",
  spe: "SPE",
  holding: "Holding",
  other: "Outra empresa",
};

function normalize(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function formatCnpj(value: string | null | undefined) {
  const raw = (value ?? "").replace(/\D/g, "").slice(0, 14);
  if (!raw) return "";
  return raw
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export default async function LegalEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, companyId, roleKey } = await requireCompanyPermission("projects.view");
  const [entitiesResult, projectsResult, manageResult] = await Promise.all([
    supabase
      .from("legal_entities")
      .select("id, parent_entity_id, entity_type, legal_name, trade_name, cnpj, state_registration, municipal_registration, email, phone, postal_code, street, address_number, complement, district, city, state, notes, status, is_primary")
      .eq("company_id", companyId)
      .order("legal_name"),
    supabase
      .from("projects")
      .select("id, code, name, status, legal_entity_id")
      .eq("company_id", companyId)
      .order("name"),
    roleKey === "owner" || roleKey === "admin"
      ? Promise.resolve({ data: true, error: null })
      : supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: "projects.manage",
        }),
  ]);

  const entities = (entitiesResult.data ?? []) as LegalEntityData[];
  const projects = projectsResult.data ?? [];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const parentMap = new Map(entities.map((entity) => [entity.id, entity]));
  const projectsByEntity = new Map<string, typeof projects>();
  for (const project of projects) {
    if (!project.legal_entity_id) continue;
    const list = projectsByEntity.get(project.legal_entity_id) ?? [];
    list.push(project);
    projectsByEntity.set(project.legal_entity_id, list);
  }

  const queryText = normalize(params.q);
  const statusFilter = params.status ?? "";
  const typeFilter = params.type ?? "";
  const filtered = entities.filter((entity) => {
    if (statusFilter && entity.status !== statusFilter) return false;
    if (typeFilter && entity.entity_type !== typeFilter) return false;
    if (!queryText) return true;
    return normalize([entity.legal_name, entity.trade_name, entity.cnpj, entity.city, entity.state].filter(Boolean).join(" ")).includes(queryText);
  });

  const linkedEntities = new Set(projects.filter((project) => project.legal_entity_id).map((project) => project.legal_entity_id));
  const unlinkedProjects = projects.filter((project) => !project.legal_entity_id && project.status !== "archived");

  return (
    <AppShell
      activeGroup="projects"
      activeItem="legal-entities"
      eyebrow="Empreendimentos"
      title="Empresas e SPEs"
      description="Cadastre as pessoas jurídicas que receberão compras, serviços e documentos fiscais."
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {entitiesResult.error || projectsResult.error ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0030_legal_entities.sql</strong> para liberar esta tela: {entitiesResult.error?.message || projectsResult.error?.message}
        </div>
      ) : null}

      <section className="legal-entity-hero">
        <div><span>Empreendimentos</span><h2>Empresas e SPEs</h2><p>Cadastro fiscal central das incorporadoras, matrizes, holdings e sociedades de propósito específico vinculadas aos empreendimentos.</p></div>
        {canManage && !entitiesResult.error ? <LegalEntityCreateDialog entities={entities} /> : null}
      </section>

      <section className="legal-entity-kpis">
        <article><span>Empresas cadastradas</span><strong>{entities.length}</strong><small>base fiscal central</small></article>
        <article><span>Ativas</span><strong>{entities.filter((entity) => entity.status === "active").length}</strong><small>disponíveis para obras</small></article>
        <article><span>SPEs</span><strong>{entities.filter((entity) => entity.entity_type === "spe").length}</strong><small>CNPJs específicos</small></article>
        <article><span>Em uso</span><strong>{linkedEntities.size}</strong><small>vinculadas a empreendimentos</small></article>
      </section>

      <form method="get" className="legal-entity-toolbar">
        <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar razão social, nome fantasia ou CNPJ" aria-label="Buscar empresa fiscal" />
        <select name="status" defaultValue={statusFilter}>
          <option value="">Todos os status</option>
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
        </select>
        <select name="type" defaultValue={typeFilter}>
          <option value="">Todos os tipos</option>
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit">Filtrar</button>
        {(params.q || statusFilter || typeFilter) ? <a href="/empreendimentos/empresas">Limpar</a> : null}
      </form>

      <section className="legal-entity-table-card">
        <div className="legal-entity-table-wrap">
          <table className="legal-entity-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Tipo</th>
                <th>Controladora</th>
                <th>Empreendimentos vinculados</th>
                <th>Contato</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entity) => {
                const parent = entity.parent_entity_id ? parentMap.get(entity.parent_entity_id) : null;
                const linked = projectsByEntity.get(entity.id) ?? [];
                return (
                  <tr key={entity.id} className={entity.status === "inactive" ? "is-inactive" : undefined}>
                    <td><div className="legal-entity-name"><strong>{entity.legal_name}</strong><small>{entity.trade_name || "Sem nome fantasia"}{entity.is_primary ? " · Empresa principal" : ""}</small></div></td>
                    <td><div className="legal-entity-cnpj"><strong>{formatCnpj(entity.cnpj) || "CNPJ pendente"}</strong>{entity.cnpj ? null : <small>Preencha antes de vincular novas obras</small>}</div></td>
                    <td><span className={`legal-entity-type ${entity.entity_type}`}>{typeLabels[entity.entity_type] ?? entity.entity_type}</span></td>
                    <td>{parent ? (parent.trade_name || parent.legal_name) : "—"}</td>
                    <td><div className="legal-entity-project-tags">{linked.length ? linked.slice(0, 4).map((project) => <span key={project.id}>{project.code || "OBRA"} · {project.name}</span>) : <small>Nenhum</small>}{linked.length > 4 ? <span>+{linked.length - 4}</span> : null}</div></td>
                    <td><div className="legal-entity-contact"><strong>{entity.email || "—"}</strong><small>{entity.phone || [entity.city, entity.state].filter(Boolean).join(" / ") || ""}</small></div></td>
                    <td><span className={`legal-entity-status ${entity.status}`}>{entity.status === "active" ? "Ativa" : "Inativa"}</span></td>
                    <td>{canManage ? <div className="legal-entity-actions"><LegalEntityEditDialog entity={entity} entities={entities} /><form action={setLegalEntityStatus}><input type="hidden" name="entity_id" value={entity.id} /><input type="hidden" name="status" value={entity.status === "active" ? "inactive" : "active"} /><button className={entity.status === "active" ? "legal-entity-inactivate" : "legal-entity-reactivate"} type="submit">{entity.status === "active" ? "Inativar" : "Reativar"}</button></form></div> : <span className="legal-entity-readonly">Somente leitura</span>}</td>
                  </tr>
                );
              })}
              {!entitiesResult.error && filtered.length === 0 ? <tr><td colSpan={8} className="legal-entity-empty">Nenhuma empresa encontrada.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {unlinkedProjects.length ? (
        <div className="legal-entity-warning"><b>Atenção:</b> {unlinkedProjects.length} empreendimento(s) ainda está(ão) sem empresa fiscal vinculada. Abra o cadastro do empreendimento e selecione uma empresa ativa com CNPJ válido.</div>
      ) : null}
      <div className="legal-entity-rule"><b>Regra fiscal:</b> cada empreendimento deve estar vinculado a uma empresa com CNPJ válido. O vínculo será a fonte oficial para compras, contratos, contas a pagar, notas manuais e futura conferência dos XMLs.</div>
    </AppShell>
  );
}
