import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelBudgetImport } from "../actions";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 4) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

const matchLabel: Record<string, string> = {
  mapped: "Mapa de Integrações",
  exact_code: "Código exato",
  exact_name_unit: "Nome + unidade",
  suggested: "Sugestão",
  ambiguous: "Ambíguo",
  new: "Novo",
  ignored: "Hierarquia",
};

export default async function BudgetImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ kind?: string; match?: string }>;
}) {
  const { batchId } = await params;
  const filters = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("budgets.view");

  const { data: batch, error: batchError } = await supabase
    .from("engineering_budget_import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (batchError || !batch) notFound();

  let rowsQuery = supabase
    .from("engineering_budget_import_rows")
    .select("id,entity_kind,source_row,source_group_code,source_group_name,source_service_code,source_service_name,external_code,external_name,external_unit,quantity,unit_cost,total_cost,coefficient,target_label,match_status,match_method,confidence")
    .eq("batch_id", batchId)
    .eq("company_id", companyId)
    .order("source_row", { ascending: true })
    .limit(500);

  if (["group", "service", "input"].includes(filters.kind ?? "")) rowsQuery = rowsQuery.eq("entity_kind", filters.kind!);
  if (["mapped", "exact_code", "exact_name_unit", "suggested", "ambiguous", "new", "ignored"].includes(filters.match ?? "")) rowsQuery = rowsQuery.eq("match_status", filters.match!);

  const { data: rows, error: rowsError } = await rowsQuery;
  const unresolved = Number(batch.new_total ?? 0) + Number(batch.ambiguous_total ?? 0) + Number(batch.suggested_total ?? 0);

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Importação de orçamento"
      title="Revisar staging"
      description={`${company.name} · ${batch.file_name} · nenhum dado canônico foi alterado.`}
      actions={<Link prefetch={false} className="elos-button" href="/engenharia/orcamentos/importar">← Importações</Link>}
    >
      {rowsError ? <div className="auth-message error workspace-message">{rowsError.message}</div> : null}

      <section className="budget-kpi-grid">
        <article><span>Grupos</span><strong>{batch.groups_total}</strong><small>hierarquia detectada</small></article>
        <article><span>Serviços</span><strong>{batch.services_total}</strong><small>linhas de orçamento</small></article>
        <article><span>Insumos</span><strong>{batch.inputs_total}</strong><small>itens de composição</small></article>
        <article><span>Custo da origem</span><strong>{money(batch.source_total)}</strong><small>{batch.source_budget_code || "—"} · {batch.source_version || "—"}</small></article>
      </section>

      <section className="budget-flow-card">
        <div className="budget-flow-head">
          <div><span>Matching</span><h2>{batch.matched_total} encontrados · {unresolved} pendentes</h2></div>
          <p>O arquivo usa namespace <strong>{batch.catalog_namespace}</strong>; códigos externos permanecem apenas como referência.</p>
        </div>
        <div className="budget-flow-grid">
          <article><b>{batch.matched_total} encontrados</b><span>Mapa, código exato ou nome + unidade.</span></article>
          <article><b>{batch.suggested_total} sugestões</b><span>Precisam de confirmação antes da promoção.</span></article>
          <article><b>{batch.ambiguous_total} ambíguos</b><span>Mais de um destino possível.</span></article>
          <article><b>{batch.new_total} novos</b><span>Sem equivalente localizado na base atual.</span></article>
        </div>
      </section>

      <section className="budget-toolbar-card">
        <form method="get" className="budgets-filter">
          <select name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">Todos os tipos</option>
            <option value="group">Grupos</option>
            <option value="service">Serviços</option>
            <option value="input">Insumos</option>
          </select>
          <select name="match" defaultValue={filters.match ?? ""}>
            <option value="">Todos os vínculos</option>
            <option value="mapped">Mapa de Integrações</option>
            <option value="exact_code">Código exato</option>
            <option value="exact_name_unit">Nome + unidade</option>
            <option value="suggested">Sugestão</option>
            <option value="ambiguous">Ambíguos</option>
            <option value="new">Novos</option>
          </select>
          <button type="submit">Filtrar</button>
          <Link prefetch={false} href={`/engenharia/orcamentos/importar/${batchId}`}>Limpar</Link>
        </form>
      </section>

      <section className="budget-table-card">
        <div className="budget-section-head">
          <div><span>Amostra do staging</span><h2>Linhas interpretadas</h2></div>
          <p>Até 500 linhas por filtro.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table budgets-table">
            <thead><tr><th>Linha</th><th>Tipo</th><th>Código</th><th>Descrição</th><th>Un.</th><th>Qtd.</th><th>Unitário</th><th>Total</th><th>Vínculo</th><th>Destino Elos</th></tr></thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.source_row}</td>
                  <td>{row.entity_kind}</td>
                  <td><strong>{row.external_code || row.source_group_code || "—"}</strong></td>
                  <td>{row.external_name || row.source_group_name || "—"}{row.entity_kind === "input" && row.source_service_code ? <span>em {row.source_service_code} · {row.source_service_name}</span> : null}</td>
                  <td>{row.external_unit || "—"}</td>
                  <td>{row.quantity == null ? "—" : decimal(row.quantity)}</td>
                  <td>{row.unit_cost == null ? "—" : money(row.unit_cost)}</td>
                  <td>{row.total_cost == null ? "—" : money(row.total_cost)}</td>
                  <td>{matchLabel[row.match_status] ?? row.match_status}{row.confidence != null ? <span>{decimal(row.confidence, 0)}%</span> : null}</td>
                  <td>{row.target_label || "—"}</td>
                </tr>
              ))}
              {(rows ?? []).length === 0 ? <tr><td colSpan={10}>Nenhuma linha neste filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="budget-toolbar-card">
        <div className="budget-section-head">
          <div><span>Segurança</span><h2>Promoção ainda bloqueada</h2></div>
          <p>Este primeiro passo só prepara e audita o staging. A promoção será liberada depois de resolver novos/ambíguos e validar os totais.</p>
        </div>
        {batch.status !== "promoted" && batch.status !== "cancelled" ? (
          <form action={cancelBudgetImport}>
            <input type="hidden" name="batch_id" value={batchId} />
            <button type="submit">Cancelar lote</button>
          </form>
        ) : null}
      </section>
    </AppShell>
  );
}
