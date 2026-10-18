import Link from "next/link";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { ImportSubmitButton } from "../submit-button";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelBudgetImport } from "../actions";
import { promoteBudgetImport, resolveBudgetImportEntity } from "../review-actions";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function entityKey(row: { entity_kind: string; external_code: string | null; external_name: string | null; external_unit: string | null }) {
  return [row.entity_kind, normalized(row.external_code), normalized(row.external_name), normalized(row.external_unit)].join("|");
}

type NormalizedTarget = { target: CatalogEntity; code: string; name: string; unit: string; tokens: Set<string> };

function normalizeCatalog(catalog: CatalogEntity[]): NormalizedTarget[] {
  return catalog.map((target) => {
    const name = normalized(target.description);
    return { target, code: normalized(target.code), name, unit: normalized(target.unit), tokens: new Set(name.split(" ").filter((token) => token.length > 2)) };
  });
}

function candidateScore(
  pending: { external_code: string | null; external_name: string | null; external_unit: string | null },
  target: NormalizedTarget,
) {
  const pCode = normalized(pending.external_code);
  const pName = normalized(pending.external_name);
  const pUnit = normalized(pending.external_unit);
  let score = 0;
  if (pUnit && pUnit === target.unit) score += 25;
  if (pCode && pCode === target.code) score += 100;
  if (pName && pName === target.name) score += 90;
  if (pName && (target.name.includes(pName) || pName.includes(target.name))) score += 45;
  pName.split(" ").filter((token) => token.length > 2).forEach((token) => { if (target.tokens.has(token)) score += 8; });
  return score;
}

const matchLabel: Record<string, string> = {
  mapped: "Mapa / confirmado",
  exact_code: "Código exato",
  exact_name_unit: "Nome + unidade",
  suggested: "Sugestão",
  ambiguous: "Ambíguo",
  new: "Novo",
  ignored: "Hierarquia",
};

const resolutionLabel: Record<string, string> = {
  unresolved: "Pendente",
  auto: "Aceito automaticamente",
  reuse: "Reutilizar cadastro",
  create: "Criar na promoção",
  created: "Criado na promoção",
  ignored: "Hierarquia",
};

type CatalogEntity = { id: string; code: string; description: string; unit: string };
type PendingRow = {
  id: string;
  entity_kind: "service" | "input";
  external_code: string | null;
  external_name: string | null;
  external_unit: string | null;
  source_row: number;
  match_status: string;
};

export default async function BudgetImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ kind?: string; match?: string; page?: string; success?: string; error?: string }>;
}) {
  const { batchId } = await params;
  const filters = await searchParams;
  const workspace = await requireCompanyPermission("budgets.view");
  const { supabase, company, companyId, roleKey } = workspace;

  const manageResult = roleKey === "owner" || roleKey === "admin"
    ? { data: true, error: null }
    : await supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "budgets.manage" });
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const { data: batch, error: batchError } = await supabase
    .from("engineering_budget_import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (batchError || !batch) notFound();

  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page ?? "1", 10) || 1));
  const pageSize = 100;
  const editable = !["promoted", "cancelled", "failed"].includes(batch.status);
  let rowsQuery = supabase
    .from("engineering_budget_import_rows")
    .select("id,entity_kind,source_row,source_group_code,source_group_name,source_service_code,source_service_name,external_code,external_name,external_unit,quantity,unit_cost,total_cost,coefficient,target_label,match_status,match_method,confidence,resolution_action,canonical_category", { count: "exact" })
    .eq("batch_id", batchId)
    .eq("company_id", companyId)
    .order("source_row", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (["group", "service", "input"].includes(filters.kind ?? "")) rowsQuery = rowsQuery.eq("entity_kind", filters.kind!);
  if (["mapped", "exact_code", "exact_name_unit", "suggested", "ambiguous", "new", "ignored"].includes(filters.match ?? "")) rowsQuery = rowsQuery.eq("match_status", filters.match!);

  const [rowsResult, pendingResult, invalidServicesResult] = await Promise.all([
    rowsQuery,
    fetchAllRows<PendingRow>(async (from, to) => await supabase.from("engineering_budget_import_rows")
      .select("id,entity_kind,external_code,external_name,external_unit,source_row,match_status")
      .eq("batch_id", batchId).eq("company_id", companyId).eq("resolution_action", "unresolved")
      .in("entity_kind", ["service", "input"]).order("source_row").order("id").range(from, to)),
    supabase.from("engineering_budget_import_rows").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("batch_id", batchId).eq("entity_kind", "service")
      .or("quantity.lte.0,quantity.is.null"),
  ]);

  // Os catálogos (milhares de insumos) só são carregados quando há pendência a resolver,
  // e apenas do tipo que aparece nas pendências — senão a página estoura o tempo do servidor.
  const pendingKinds = new Set(((pendingResult.data ?? []) as PendingRow[]).map((row) => row.entity_kind));
  const emptyCatalog = { data: [] as CatalogEntity[], error: null };
  const [servicesResult, inputsResult] = await Promise.all([
    pendingKinds.has("service")
      ? fetchAllRows<CatalogEntity>(async (from, to) => await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("id").range(from, to))
      : Promise.resolve(emptyCatalog),
    pendingKinds.has("input")
      ? fetchAllRows<CatalogEntity>(async (from, to) => await supabase.from("engineering_inputs").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("id").range(from, to))
      : Promise.resolve(emptyCatalog),
  ]);

  const pendingMap = new Map<string, PendingRow>();
  ((pendingResult.data ?? []) as PendingRow[]).forEach((row) => {
    const key = entityKey(row);
    if (!pendingMap.has(key)) pendingMap.set(key, row);
  });
  const uniquePending = [...pendingMap.values()];
  const visiblePending = uniquePending.slice(0, 25);
  const services = normalizeCatalog((servicesResult.data ?? []) as CatalogEntity[]);
  const inputs = normalizeCatalog((inputsResult.data ?? []) as CatalogEntity[]);
  const loadError = rowsResult.error || pendingResult.error || servicesResult.error || inputsResult.error || invalidServicesResult.error;
  const metadata = batch.metadata as { skipped_zero_services?: number; skipped_zero_inputs?: number } | null;
  const pageHref = (nextPage: number) => `${"/engenharia/orcamentos/importar"}/${batchId}?${new URLSearchParams({ ...(filters.kind ? { kind: filters.kind } : {}), ...(filters.match ? { match: filters.match } : {}), page: String(nextPage) })}`;
  const promotion = (batch.metadata as { promotion?: { canonical_total?: number; source_total?: number; difference?: number } } | null)?.promotion;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Importação de orçamento"
      title="Revisar e promover"
      description={`${company.name} · ${batch.file_name} · origem preservada até a promoção.`}
      actions={<Link prefetch={false} className="elos-button" href="/engenharia/orcamentos/importar">← Importações</Link>}
    >
      {filters.success ? <div className="auth-message success workspace-message">{filters.success}</div> : null}
      {filters.error ? <div className="auth-message error workspace-message">{filters.error}</div> : null}
      {rowsResult.error ? <div className="auth-message error workspace-message">{rowsResult.error.message}</div> : null}
      {pendingResult.error ? <div className="auth-message error workspace-message">{pendingResult.error.message}</div> : null}

      {servicesResult.error || inputsResult.error ? <div role="alert" className="auth-message error workspace-message">Não foi possível consultar os cadastros. Atualize a página antes de revisar ou importar.</div> : null}
      {editable && ((invalidServicesResult.count ?? 0) > 0 || invalidServicesResult.error) ? <div role="alert" className="auth-message error workspace-message">Este lote precisa ser relido. Cancele-o e envie a planilha novamente para aplicar a regra de desconsiderar serviços zerados e suas composições.</div> : null}
      {Number(metadata?.skipped_zero_services) > 0 ? <div className="auth-message success workspace-message">{metadata?.skipped_zero_services} serviço(s) com quantidade zero e {metadata?.skipped_zero_inputs ?? 0} insumo(s) dessas composições foram desconsiderados.</div> : null}

      <section className="budget-kpi-grid">
        <article><span>Grupos</span><strong>{batch.groups_total}</strong><small>hierarquia detectada</small></article>
        <article><span>Serviços</span><strong>{batch.services_total}</strong><small>linhas de orçamento</small></article>
        <article><span>Insumos</span><strong>{batch.inputs_total}</strong><small>itens de composição</small></article>
        <article><span>Custo da origem</span><strong>{money(batch.source_total)}</strong><small>{batch.source_budget_code || "—"} · {batch.source_version || "—"}</small></article>
      </section>

      <section className="budget-flow-card">
        <div className="budget-flow-head">
          <div><span>Revisão</span><h2>{uniquePending.length} entidade(s) única(s) ainda pendente(s)</h2></div>
          <p>Status do lote: <strong>{batch.status}</strong>. O namespace externo é <strong>{batch.catalog_namespace}</strong>; o código externo não vira identidade do Elos.</p>
        </div>
        <div className="budget-flow-grid">
          <article><b>{batch.matched_total} encontrados</b><span>Mapa, código exato ou nome + unidade.</span></article>
          <article><b>{batch.ambiguous_total} ambíguos na origem</b><span>Podem ser vinculados manualmente abaixo.</span></article>
          <article><b>{batch.new_total} sem equivalente inicial</b><span>Podem reutilizar um cadastro ou criar um novo na promoção.</span></article>
          <article><b>{batch.status === "ready" ? "Pronto" : "Em revisão"}</b><span>A promoção só libera com zero pendências.</span></article>
        </div>
      </section>

      {canManage && editable && !loadError && uniquePending.length > 0 ? (
        <section className="budget-table-card">
          <div className="budget-section-head">
            <div><span>Pendências únicas</span><h2>Resolver antes de promover</h2></div>
            <p>{visiblePending.length} de {uniquePending.length} entidade(s) exibida(s). Resolver uma entidade atualiza todas as ocorrências iguais no lote.</p>
          </div>
          <div className="registry-table-wrap">
            <table className="registry-table budgets-table">
              <thead><tr><th>Tipo</th><th>Origem</th><th>Un.</th><th>Reutilizar cadastro Elos</th><th>Ou criar novo</th></tr></thead>
              <tbody>
                {visiblePending.map((pending) => {
                  const catalog = pending.entity_kind === "service" ? services : inputs;
                  const candidates = catalog
                    .map((entry) => ({ target: entry.target, unit: entry.unit, score: candidateScore(pending, entry) }))
                    .filter(({ score, unit }) => score > 0 || unit === normalized(pending.external_unit))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 8);
                  return (
                    <tr key={entityKey(pending)}>
                      <td><strong>{pending.entity_kind === "service" ? "Serviço" : "Insumo"}</strong><span>linha {pending.source_row}</span></td>
                      <td><strong>{pending.external_code || "sem código"}</strong><span>{pending.external_name || "—"}</span></td>
                      <td>{pending.external_unit || "—"}</td>
                      <td>
                        <form action={resolveBudgetImportEntity}>
                          <input type="hidden" name="batch_id" value={batchId} />
                          <input type="hidden" name="row_id" value={pending.id} />
                          <input type="hidden" name="resolution_action" value="reuse" />
                          <select name="target_id" aria-label={`Cadastro equivalente para ${pending.external_name}`} required defaultValue="">
                            <option value="" disabled>Selecionar equivalente</option>
                            {candidates.map(({ target, score }) => (
                              <option key={target.id} value={target.id}>{target.code} · {target.description} · {target.unit} ({score})</option>
                            ))}
                          </select>
                          <button type="submit">Vincular</button>
                        </form>
                      </td>
                      <td>
                        <form action={resolveBudgetImportEntity}>
                          <input type="hidden" name="batch_id" value={batchId} />
                          <input type="hidden" name="row_id" value={pending.id} />
                          <input type="hidden" name="resolution_action" value="create" />
                          {pending.entity_kind === "input" ? (
                            <select name="category" aria-label={`Categoria de ${pending.external_name}`} required defaultValue="">
                              <option value="" disabled>Categoria</option>
                              <option value="material">Material</option>
                              <option value="labor">Mão de obra</option>
                              <option value="equipment">Equipamento</option>
                              <option value="service">Serviço terceirizado</option>
                              <option value="freight">Frete</option>
                              <option value="other">Outro</option>
                            </select>
                          ) : null}
                          <button type="submit">Criar novo na promoção</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canManage && editable && !batch.promoted_budget_id ? (
        <section className="budget-toolbar-card">
          <div className="budget-section-head">
            <div><span>Confirmação da importação</span><h2>Aceitar e importar orçamento</h2></div>
            <p>Novos cadastros, mapa, orçamento e composições são criados juntos. O orçamento nasce em revisão e não vira base automaticamente.</p>
          </div>
          {loadError ? <p role="alert">Importação bloqueada: não foi possível conferir todas as linhas e cadastros.</p> : uniquePending.length > 0 ? <p role="status">Resolva as {uniquePending.length} pendência(s) acima para liberar a importação. Cadastros existentes devem ser vinculados; crie apenas os realmente novos.</p> : <p role="status">Todas as pendências foram resolvidas. Confira os dados e confirme a importação.</p>}
          <form action={promoteBudgetImport} className="budget-modal-form">
            <input type="hidden" name="batch_id" value={batchId} />
            <label><span>Código da revisão</span><input name="budget_code" defaultValue={batch.source_budget_code || "ORC-IMP"} required /></label>
            <label><span>Nome</span><input name="budget_name" defaultValue={batch.source_budget_name || "Orçamento importado"} required /></label>
            <label><span>Versão</span><input name="budget_version" defaultValue={batch.source_version || "R01"} required /></label>
            <ImportSubmitButton pendingLabel="Importando orçamento…" disabled={Boolean(loadError) || uniquePending.length > 0 || batch.services_total === 0 || (invalidServicesResult.count ?? 0) > 0}>Aceitar e importar orçamento</ImportSubmitButton>
          </form>
        </section>
      ) : null}

      {batch.promoted_budget_id ? (
        <section className="budget-flow-card">
          <div className="budget-flow-head">
            <div><span>Promovido</span><h2>Orçamento canônico criado</h2></div>
            <Link className="elos-button" href={`/engenharia/orcamentos/${batch.promoted_budget_id}`}>Abrir orçamento</Link>
          </div>
          {promotion ? (
            <div className="budget-flow-grid">
              <article><b>{money(promotion.source_total)}</b><span>Total da origem</span></article>
              <article><b>{money(promotion.canonical_total)}</b><span>Total promovido</span></article>
              <article><b>{money(promotion.difference)}</b><span>Diferença de conciliação</span></article>
              <article><b>Em revisão</b><span>Só depois da conferência deve virar orçamento base.</span></article>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="budget-toolbar-card">
        <form method="get" className="budgets-filter">
          <select name="kind" aria-label="Tipo de linha" defaultValue={filters.kind ?? ""}>
            <option value="">Todos os tipos</option><option value="group">Grupos</option><option value="service">Serviços</option><option value="input">Insumos</option>
          </select>
          <select name="match" aria-label="Situação do vínculo" defaultValue={filters.match ?? ""}>
            <option value="">Todos os vínculos</option><option value="mapped">Mapa / confirmado</option><option value="exact_code">Código exato</option>
            <option value="exact_name_unit">Nome + unidade</option><option value="ambiguous">Ambíguos</option><option value="new">Novos</option>
          </select>
          <button type="submit">Filtrar staging</button>
          <Link prefetch={false} href={`/engenharia/orcamentos/importar/${batchId}`}>Limpar</Link>
        </form>
      </section>

      <section className="budget-table-card">
        <div className="budget-section-head"><div><span>Staging auditável</span><h2>Linhas interpretadas</h2></div><p>Página {page} · {rowsResult.count ?? 0} linha(s) neste filtro.</p></div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-table">
            <thead><tr><th>Linha</th><th>Tipo</th><th>Código</th><th>Descrição</th><th>Un.</th><th>Qtd.</th><th>Unitário</th><th>Total</th><th>Matching</th><th>Decisão</th><th>Destino Elos</th></tr></thead>
            <tbody>
              {(rowsResult.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.source_row}</td><td>{row.entity_kind}</td><td><strong>{row.external_code || row.source_group_code || "—"}</strong></td>
                  <td>{row.external_name || row.source_group_name || "—"}{row.entity_kind === "input" && row.source_service_code ? <span>em {row.source_service_code} · {row.source_service_name}</span> : null}</td>
                  <td>{row.external_unit || "—"}</td><td>{row.quantity == null ? "—" : decimal(row.quantity)}</td>
                  <td>{row.unit_cost == null ? "—" : money(row.unit_cost)}</td><td>{row.total_cost == null ? "—" : money(row.total_cost)}</td>
                  <td>{matchLabel[row.match_status] ?? row.match_status}{row.confidence != null ? <span>{decimal(row.confidence, 0)}%</span> : null}</td>
                  <td>{resolutionLabel[row.resolution_action] ?? row.resolution_action}</td><td>{row.target_label || "—"}</td>
                </tr>
              ))}
              {(rowsResult.data ?? []).length === 0 ? <tr><td colSpan={11}>Nenhuma linha neste filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <nav className="budgets-filter" aria-label="Páginas das linhas importadas">
        {page > 1 ? <Link prefetch={false} className="elos-button" href={pageHref(page - 1)}>← Anterior</Link> : null}
        {page * pageSize < (rowsResult.count ?? 0) ? <Link prefetch={false} className="elos-button" href={pageHref(page + 1)}>Próxima →</Link> : null}
      </nav>

      {canManage && editable ? (
        <section className="budget-toolbar-card">
          <form action={cancelBudgetImport}><input type="hidden" name="batch_id" value={batchId} /><button type="submit">Cancelar lote</button></form>
        </section>
      ) : null}
    </AppShell>
  );
}
