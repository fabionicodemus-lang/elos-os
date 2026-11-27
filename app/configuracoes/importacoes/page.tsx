import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { EobraImportForm } from "./eobra-import-form";
import { BATCH_LABELS, ENTITY_LABELS, dateBR, pageNumber, statusTone, type ImportSummary } from "./import-presentation";
import "./eobra-import.css";

type Batch = {
  id: string;
  project_id: string | null;
  entity_kind: string;
  source_host: string;
  file_name: string;
  status: string;
  summary: ImportSummary | null;
  created_at: string;
};

export default async function ImportsPage({ searchParams }: {
  searchParams: Promise<{ page?: string; kind?: string; status?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId } = await requireCompanyPermission("admin.company.manage");
  const page = pageNumber(params.page);
  const kind = params.kind && Object.hasOwn(ENTITY_LABELS, params.kind) ? params.kind : "";
  const status = params.status && Object.hasOwn(BATCH_LABELS, params.status) ? params.status : "";
  let batchesQuery = supabase.from("integration_import_batches")
    .select("id,project_id,entity_kind,source_host,file_name,status,summary,created_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 20, page * 20 - 1);
  if (kind) batchesQuery = batchesQuery.eq("entity_kind", kind);
  if (status) batchesQuery = batchesQuery.eq("status", status);
  const [projectsResult, batchesResult] = await Promise.all([
    supabase.from("projects").select("id,name,code").eq("company_id", companyId).neq("status", "archived").order("name"),
    batchesQuery,
  ]);
  const projects = (projectsResult.data ?? []) as { id: string; name: string; code: string | null }[];
  const batches = (batchesResult.data ?? []) as Batch[];
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const count = batchesResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / 20));
  const unavailable = Boolean(projectsResult.error || batchesResult.error);
  const referenceDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const pageHref = (target: number) => {
    const query = new URLSearchParams({ page: String(target) });
    if (kind) query.set("kind", kind);
    if (status) query.set("status", status);
    return `/configuracoes/importacoes?${query.toString()}#historico`;
  };

  return (
    <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Importar dados do eObra"
      description={`${company.name} · traga cadastros e lançamentos por arquivo, com conferência antes de gravar.`}>
      <div className="eobra-import-page">
        {params.success ? <div role="status" className="auth-message success workspace-message">{params.success}</div> : null}
        {params.error ? <div role="alert" className="auth-message error workspace-message">{params.error}</div> : null}
        {unavailable ? <div role="alert" className="auth-message error workspace-message">Não foi possível carregar o importador agora. Atualize a página antes de enviar um arquivo.</div> : null}

        <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">Migração vinculada</span><h2>Vendas, parcelas e histórico financeiro</h2></div><Link prefetch={false} className="elos-button primary" href="/configuracoes/importacoes/migracoes">Abrir migração do eObra</Link></div>
          <p>Revise um pacote com empreendimentos, unidades, pessoas, vendas, parcelas, baixas e índices. A cobertura identifica o que foi coletado e o que ainda precisa de tratamento antes de entrar nos módulos do Elos.</p>
        </section>

        <section className="registry-table-panel eobra-intro">
          <div><span className="eobra-step">Importação por arquivos</span><h2>Do relatório à conferência no Elos</h2>
            <p>Exporte os dados no ambiente eObra da empresa e envie os arquivos aqui. O endereço de origem identifica os registros; esta tela não faz uma conexão automática com o eObra.</p></div>
          <ol className="eobra-steps" aria-label="Etapas da importação">
            <li><b>01</b><span>Escolher o arquivo<small>Um tipo de registro por lote</small></span></li>
            <li><b>02</b><span>Associar colunas<small>Conferir nomes e exemplos</small></span></li>
            <li><b>03</b><span>Revisar a prévia<small>Obra, vínculos e totais</small></span></li>
            <li><b>04</b><span>Confirmar importação<small>Acompanhar o resultado</small></span></li>
          </ol>
        </section>

        <EobraImportForm key={companyId} companyId={companyId} projects={projects} defaultSourceHost={company.slug === "ar-incorporadora" ? "armais.eobra.com.br" : ""}
          referenceDate={referenceDate} disabled={unavailable} />

        <section className="registry-table-panel eobra-card" id="historico">
          <div className="section-heading"><div><span className="eobra-step">Histórico</span><h2>Prévias e importações</h2></div><p>{unavailable ? "Histórico indisponível" : `${count.toLocaleString("pt-BR")} lote(s) nos filtros selecionados`}</p></div>
          <form method="get" className="eobra-filter">
            <label>Tipo<select name="kind" defaultValue={kind}><option value="">Todos os tipos</option>{Object.entries(ENTITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Situação<select name="status" defaultValue={status}><option value="">Todas as situações</option>{Object.entries(BATCH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <button type="submit" className="elos-button">Filtrar histórico</button>
            {kind || status ? <Link prefetch={false} href="/configuracoes/importacoes#historico" className="eobra-text-link">Limpar filtros</Link> : null}
          </form>
          <div className="registry-table-wrap">
            <table className="registry-table eobra-history-table">
              <thead><tr><th>Arquivo e origem</th><th>Tipo</th><th>Obra</th><th>Situação</th><th>Registros</th><th>Preparado em</th><th>Ação</th></tr></thead>
              <tbody>
                {batches.map((batch) => <tr key={batch.id}>
                  <td><strong>{batch.file_name}</strong><span>{batch.source_host}</span></td>
                  <td>{ENTITY_LABELS[batch.entity_kind] ?? batch.entity_kind}</td>
                  <td>{batch.project_id ? projectNames.get(batch.project_id) ?? "Obra vinculada" : "Cadastro da empresa"}</td>
                  <td><span className={`eobra-status ${statusTone(batch.status)}`}>{BATCH_LABELS[batch.status] ?? batch.status}</span></td>
                  <td>{Number(batch.summary?.total ?? 0).toLocaleString("pt-BR")}</td>
                  <td>{dateBR(batch.created_at, true)}</td>
                  <td><Link prefetch={false} className="table-action" href={`/configuracoes/importacoes/${batch.id}`}>{batch.status === "ready" || batch.status === "review" ? "Revisar prévia" : "Ver lote"}</Link></td>
                </tr>)}
                {!batches.length ? <tr><td colSpan={7}><div className="eobra-empty"><strong>{unavailable ? "Não foi possível consultar o histórico." : count > 0 ? "Nenhum lote nesta página. Volte para uma página anterior." : kind || status ? "Nenhum lote encontrado nestes filtros." : "Aguardando arquivos do eObra"}</strong>{!unavailable && count === 0 && !kind && !status ? <p>Nenhum lote foi preparado. Envie o primeiro arquivo para conferir os dados; nenhum registro do eObra foi importado por este importador.</p> : null}</div></td></tr> : null}
              </tbody>
            </table>
          </div>
          {!unavailable && count > 0 ? <nav className="eobra-pagination" aria-label="Páginas do histórico">
            {page > 1 ? <Link prefetch={false} className="elos-button" href={pageHref(page - 1)}>← Anterior</Link> : <span />}
            <span>Página {page} de {pages} · até 20 lotes por página</span>
            {page < pages ? <Link prefetch={false} className="elos-button" href={pageHref(page + 1)}>Próxima →</Link> : <span />}
          </nav> : null}
        </section>
      </div>
    </AppShell>
  );
}
