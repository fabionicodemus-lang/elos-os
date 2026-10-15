import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { stageBudgetImport } from "./actions";

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

const statusLabel: Record<string, string> = {
  staged: "Em staging",
  review: "Em revisão",
  ready: "Pronto",
  promoted: "Importado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export default async function BudgetImportPage({ searchParams }: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("budgets.manage");

  const projectResult = projectId
    ? await supabase.from("projects").select("id,name,code").eq("id", projectId).maybeSingle()
    : { data: null, error: null };

  const batchesResult = projectId
    ? await supabase
        .from("engineering_budget_import_batches")
        .select("id,file_name,status,source_budget_code,source_version,source_total,services_total,inputs_total,matched_total,new_total,ambiguous_total,created_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };

  const project = projectResult.data;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="budgets"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Importar orçamento"
      description={`${company.name} · ${project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "selecione uma obra"} · staging seguro antes de alterar a base.`}
      actions={<Link prefetch={false} className="elos-button" href="/engenharia/orcamentos">← Orçamentos</Link>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {!projectId ? <div className="auth-message error workspace-message">Selecione uma obra no topo antes de importar.</div> : null}

      <section className="budget-flow-card">
        <div className="budget-flow-head">
          <div><span>Importação segura</span><h2>O arquivo entra primeiro em staging</h2></div>
          <p>Nenhum serviço, insumo ou orçamento canônico é criado nesta etapa.</p>
        </div>
        <div className="budget-flow-grid">
          <article><b>1. Ler</b><span>Detecta hierarquia, serviços, insumos, quantidades e preços.</span></article>
          <article><b>2. Mapear</b><span>Consulta o Mapa de Integrações e os catálogos do Elos.</span></article>
          <article><b>3. Revisar</b><span>Separa encontrados, ambíguos e realmente novos.</span></article>
          <article><b>4. Promover</b><span>Só depois da validação o orçamento vira revisão do Elos.</span></article>
        </div>
      </section>

      <section className="budget-toolbar-card">
        <form action={stageBudgetImport} className="budget-modal-form">
          <div className="budget-section-head">
            <div><span>Novo lote</span><h2>Enviar planilha XLSX</h2></div>
            <p>O primeiro adaptador reconhece o formato legado usado no orçamento do Flow.</p>
          </div>
          <label>
            <span>Arquivo do orçamento</span>
            <input name="file" type="file" accept=".xlsx" required disabled={!projectId} />
          </label>
          <button type="submit" className="elos-button" disabled={!projectId}>Ler e preparar staging</button>
        </form>
      </section>

      <section className="budget-table-card">
        <div className="budget-section-head">
          <div><span>Histórico</span><h2>Lotes recentes</h2></div>
          <p>{batchesResult.data?.length ?? 0} lote(s) recente(s).</p>
        </div>
        {batchesResult.error ? <div className="auth-message error workspace-message">A migration do importador ainda não foi aplicada: {batchesResult.error.message}</div> : null}
        <div className="registry-table-wrap">
          <table className="registry-table budgets-table">
            <thead><tr><th>Arquivo</th><th>Status</th><th>Serviços</th><th>Insumos</th><th>Encontrados</th><th>Novos / ambíguos</th><th>Total origem</th><th>Data</th><th>Ação</th></tr></thead>
            <tbody>
              {(batchesResult.data ?? []).map((batch) => (
                <tr key={batch.id}>
                  <td><strong>{batch.file_name}</strong><span>{batch.source_budget_code || "—"} · {batch.source_version || "—"}</span></td>
                  <td>{statusLabel[batch.status] ?? batch.status}</td>
                  <td>{batch.services_total}</td>
                  <td>{batch.inputs_total}</td>
                  <td>{batch.matched_total}</td>
                  <td>{batch.new_total} / {batch.ambiguous_total}</td>
                  <td>{money(batch.source_total)}</td>
                  <td>{dateBR(batch.created_at)}</td>
                  <td><Link prefetch={false} className="table-action" href={`/engenharia/orcamentos/importar/${batch.id}`}>Revisar</Link></td>
                </tr>
              ))}
              {(batchesResult.data ?? []).length === 0 ? <tr><td colSpan={9}>Nenhum lote importado ainda.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
