import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { isUuid } from "@/lib/eobra-import/resolution.mjs";
import { dateBR, moneyBR, pageNumber } from "../import-presentation";
import { activateCorrectionPolicy, bindCorrectionIndex, refreshCorrectionBatch } from "./actions";
import "../eobra-import.css";

const PATH = "/configuracoes/importacoes/correcao-eobra";
type IndexSource = { id: string; source_host: string; source_id: string; details: { name?: string; code?: string } };
type CanonicalIndex = { id: string; name: string; code: string };
type Overview = { reference_month?: string; total?: number; active?: number; pending?: number; blocked?: number; history_preserved?: number };
type Candidate = { receivable_id: string; source_record_id: string; description: string; due_date: string; original_amount: string; current_amount: string; paid_amount: string | null; status: string; project_name: string; unit_code: string | null; policy_id: string | null; policy_state: string | null; last_error: string | null; last_reference_month: string | null };
type IndexPreview = { ok: boolean; errors: string[]; preview_hash: string; source_name: string; target_name: string; source_count: number; insert_count: number; unchanged_count: number; conflicts: { month: string; source_value: string; target_value: string }[] };
type PolicyPreview = { ok: boolean; errors: string[]; preview_hash: string; description: string; due_date: string; reference_date: string; original_amount: string; current_amount: string; correction_amount: string; interest_amount: string; penalty_amount: string; other_accrual_amount: string; discount_amount: string; calculation?: { base_month?: string; base_value?: string; reference_month?: string; reference_value?: string; effective_reference_month?: string; effective_reference_value?: string; current_amount?: string; months?: number } | null };
const stateLabel: Record<string, string> = { active: "Regra ativa", blocked: "Índice pendente", review_required: "Revisão necessária", suspended: "Histórico preservado" };
const monthLabel = (value?: string | null) => value && /^\d{4}-\d{2}/.test(value) ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : "—";
const indexLabel = (value?: string) => value ? value.replace(".", ",") : "—";

export default async function EobraCorrectionPage({ searchParams }: { searchParams: Promise<{ page?: string; source_index?: string; target_index?: string; receivable?: string; source_record?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const { supabase, companyId, company } = await requireCompanyPermission("indices.manage");
  const permissions = await Promise.all(["admin.company.manage", "receivables.manage", "receivables.view"].map(permission => supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: permission })));
  const canReview = permissions[0].data === true && permissions[1].data === true;
  const canReadTitles = permissions[1].data === true || permissions[2].data === true;
  const page = Math.min(pageNumber(params.page), 50000);
  const [sourceResult, indexResult, overviewResult, candidatesResult] = await Promise.all([
    canReview ? supabase.from("eobra_source_indices").select("id,source_host,source_id,details").eq("company_id", companyId).eq("entity", "correction_index").order("source_id").limit(100) : Promise.resolve({ data: [], error: null }),
    supabase.from("correction_indices").select("id,name,code").eq("company_id", companyId).eq("value_type", "index_number").eq("status", "active").order("name").limit(100),
    supabase.rpc("receivable_correction_overview", { p_company_id: companyId }),
    canReadTitles ? supabase.rpc("eobra_receivable_correction_candidates", { p_company_id: companyId, p_limit: 20, p_offset: (page - 1) * 20 }) : Promise.resolve({ data: { total: 0, rows: [] }, error: null }),
  ]);
  const unavailable = Boolean(sourceResult.error || indexResult.error || overviewResult.error || candidatesResult.error);
  const sources = (sourceResult.data ?? []) as IndexSource[];
  const indices = (indexResult.data ?? []) as CanonicalIndex[];
  const overview = (overviewResult.data ?? {}) as Overview;
  const listing = (candidatesResult.data ?? { total: 0, rows: [] }) as { total: number; rows: Candidate[] };
  let indexPreview: IndexPreview | null = null;
  let policyPreview: PolicyPreview | null = null;
  let previewUnavailable = false;
  if (!unavailable && canReview) {
    const previews = await Promise.all([
      isUuid(params.source_index) && isUuid(params.target_index)
        ? supabase.rpc("preview_eobra_correction_index", { p_company_id: companyId, p_source_index_id: params.source_index, p_correction_index_id: params.target_index })
        : Promise.resolve({ data: null, error: null }),
      isUuid(params.receivable) && isUuid(params.source_record)
        ? supabase.rpc("preview_eobra_receivable_correction", { p_company_id: companyId, p_receivable_id: params.receivable, p_source_record_id: params.source_record })
        : Promise.resolve({ data: null, error: null }),
    ]);
    indexPreview = previews[0].data as IndexPreview | null;
    policyPreview = previews[1].data as PolicyPreview | null;
    previewUnavailable = Boolean(previews[0].error || previews[1].error);
  }
  return <AppShell activeGroup="system" activeItem="imports" eyebrow="Sistema · Importações" title="Continuidade da correção" description={`${company.name} · confira a política de cada parcela antes de habilitar os próximos reajustes.`}>
    <div className="eobra-import-page">
      <p><Link prefetch={false} href="/configuracoes/importacoes/migracoes" className="eobra-text-link">← Migração do eObra</Link> · <Link prefetch={false} href="/financeiro/indices-de-correcao" className="eobra-text-link">Cadastro de índices</Link></p>
      {params.error ? <div role="alert" className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div role="status" className="auth-message success workspace-message">{params.success}</div> : null}
      {unavailable ? <div role="alert" className="auth-message error workspace-message">A revisão de correção está indisponível. Confirme a atualização do banco e suas permissões antes de continuar.</div> : null}
      {previewUnavailable ? <div role="alert" className="auth-message error workspace-message">Esta prévia não está disponível na empresa selecionada. Abra a parcela ou escolha os índices novamente.</div> : null}

      <section className="registry-table-panel eobra-card">
        <div className="section-heading"><div><span className="eobra-step">Atualização mensal</span><h2>Fila de {monthLabel(overview.reference_month)}</h2></div></div>
        <div className="eobra-kpis">
          <article className="eobra-card"><span>Políticas revisadas</span><strong>{overview.total ?? 0}</strong><small>Ativação individual após conferir o corte da origem.</small></article>
          <article className="eobra-card"><span>Parcelas na fila</span><strong>{overview.pending ?? 0}</strong><small>Continue até concluir os lotes pendentes.</small></article>
          <article className="eobra-card"><span>Pendências</span><strong>{overview.blocked ?? 0}</strong><small>Índice ausente ou revisão necessária; último valor preservado.</small></article>
          <article className="eobra-card"><span>Histórico preservado</span><strong>{overview.history_preserved ?? 0}</strong><small>Parcelas recebidas, canceladas ou com pagamento parcial.</small></article>
        </div>
        <div className="eobra-note"><p>O cadastro de um índice inicia a atualização das políticas já aprovadas. Quando houver parcelas na fila, continue os lotes abaixo. A rotina mensal ainda não está agendada: ao virar o mês, use esta conferência. Se faltar uma competência, o valor anterior permanece e a pendência aparece na lista.</p></div>
        <form action={refreshCorrectionBatch} className="eobra-actions"><input type="hidden" name="company_id" value={companyId} /><button className="elos-button primary" disabled={unavailable || !overview.total}>{(overview.pending ?? 0) > 0 ? "Continuar atualização · até 500 parcelas" : "Conferir competência atual"}</button></form>
      </section>

      {canReview ? <section className="registry-table-panel eobra-card">
        <div className="section-heading"><div><span className="eobra-step">1 · Série mensal</span><h2>Conferir os índices</h2></div><p>Escolha a correspondência entre origem e cadastro do Elos.</p></div>
        <form action={PATH} method="get" className="eobra-form-grid">
          <label>Índice da origem<select name="source_index" required defaultValue={params.source_index ?? ""} disabled={unavailable}><option value="">Selecione</option>{sources.map(item => <option key={item.id} value={item.id}>{item.details?.name ?? item.details?.code ?? item.source_id} · {item.source_host}</option>)}</select></label>
          <label>Índice do Elos<select name="target_index" required defaultValue={params.target_index ?? ""} disabled={unavailable}><option value="">Selecione</option>{indices.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <div className="eobra-actions"><button className="elos-button" disabled={unavailable || !sources.length || !indices.length}>Gerar prévia dos valores</button></div>
        </form>
        {!sources.length && !unavailable ? <p>Os índices da origem aparecem após a promoção de um pacote que preserve a série mensal.</p> : null}
        {indexPreview ? <div className="eobra-note">
          <h3>{indexPreview.source_name} → {indexPreview.target_name}</h3>
          <p>{indexPreview.source_count} competências observadas; {indexPreview.insert_count} novas e {indexPreview.unchanged_count} já iguais no Elos.</p>
          {indexPreview.errors.length ? <ul className="eobra-row-errors">{indexPreview.errors.map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
          {indexPreview.conflicts.length ? <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Competência</th><th>Origem</th><th>Elos</th></tr></thead><tbody>{indexPreview.conflicts.slice(0, 30).map((item, i) => <tr key={i}><td>{monthLabel(item.month)}</td><td>{indexLabel(item.source_value)}</td><td>{indexLabel(item.target_value)}</td></tr>)}</tbody></table><p>{indexPreview.conflicts.length} divergência(s) precisam de revisão.</p></div> : null}
          {indexPreview.ok ? <form action={bindCorrectionIndex}>
            <input type="hidden" name="company_id" value={companyId} /><input type="hidden" name="source_index_id" value={params.source_index} /><input type="hidden" name="correction_index_id" value={params.target_index} /><input type="hidden" name="preview_hash" value={indexPreview.preview_hash} />
            <label className="eobra-checkbox"><input type="checkbox" name="confirm_review" required />Conferi a correspondência dos índices e os valores mensais apresentados.</label>
            <div className="eobra-actions"><button className="elos-button primary">Vincular série conferida</button></div>
          </form> : null}
        </div> : null}
      </section> : null}

      {policyPreview ? <section className="registry-table-panel eobra-card" id="revisao">
        <div className="section-heading"><div><span className="eobra-step">2 · Revisão da parcela</span><h2>{policyPreview.description}</h2></div><p>Vencimento {dateBR(policyPreview.due_date)} · corte {dateBR(policyPreview.reference_date)}</p></div>
        <dl className="eobra-totals"><div><dt>Principal preservado</dt><dd>{moneyBR(policyPreview.original_amount)}</dd></div><div><dt>Correção no corte</dt><dd>{moneyBR(policyPreview.correction_amount)}</dd></div><div><dt>Atualizado na origem</dt><dd>{moneyBR(policyPreview.current_amount)}</dd></div><div><dt>Conferência do cálculo</dt><dd>{moneyBR(policyPreview.calculation?.current_amount)}</dd></div></dl>
        <div className="eobra-note"><dl className="eobra-metadata"><div><dt>Base explícita</dt><dd>{monthLabel(policyPreview.calculation?.base_month)} · {indexLabel(policyPreview.calculation?.base_value)}</dd></div><div><dt>Referência do corte</dt><dd>{monthLabel(policyPreview.calculation?.reference_month)} · {indexLabel(policyPreview.calculation?.reference_value)}</dd></div><div><dt>Máxima do período conferido</dt><dd>{monthLabel(policyPreview.calculation?.effective_reference_month)} · {indexLabel(policyPreview.calculation?.effective_reference_value)}</dd></div></dl>
          <p>Juros {moneyBR(policyPreview.interest_amount)} · multa {moneyBR(policyPreview.penalty_amount)} · outros acréscimos {moneyBR(policyPreview.other_accrual_amount)} · desconto {moneyBR(policyPreview.discount_amount)}. Esses componentes permanecem separados da correção.</p>
          <p>Ao ativar, o Elos aplicará a máxima da série entre a base e o mês corrente em São Paulo, enquanto a parcela estiver aberta e sem recebimento. Competência ausente gera pendência. Recebimento parcial, quitação ou cancelamento preservam o valor histórico.</p>
        </div>
        {policyPreview.errors.length ? <ul className="eobra-row-errors">{policyPreview.errors.map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
        {policyPreview.ok ? <form action={activateCorrectionPolicy} className="eobra-review-actions">
          <input type="hidden" name="company_id" value={companyId} /><input type="hidden" name="receivable_id" value={params.receivable} /><input type="hidden" name="source_record_id" value={params.source_record} /><input type="hidden" name="preview_hash" value={policyPreview.preview_hash} />
          <label className="eobra-checkbox"><input type="checkbox" name="confirm_review" required />Conferi esta parcela, a base, a regra contratual e a paridade no corte. Autorizo a continuidade mensal descrita acima para esta parcela.</label>
          <div className="eobra-actions"><button className="elos-button primary">Ativar regra desta parcela</button></div>
        </form> : <p>A parcela permanece com o valor importado enquanto a pendência é conferida.</p>}
      </section> : null}

      <section className="registry-table-panel eobra-card" id="parcelas"><div className="section-heading"><div><span className="eobra-step">Acompanhamento</span><h2>Parcelas e políticas</h2></div><p>{listing.total.toLocaleString("pt-BR")} parcela(s) importada(s)</p></div>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Obra e parcela</th><th>Vencimento</th><th>Principal</th><th>Atualizado</th><th>Política</th><th>Referência</th><th>Ação</th></tr></thead><tbody>
          {listing.rows.map(item => <tr key={item.receivable_id}><td>{item.project_name}<small>{item.unit_code ? `${item.unit_code} · ` : ""}{item.description}</small></td><td>{dateBR(item.due_date)}</td><td className="eobra-money">{moneyBR(item.original_amount)}</td><td className="eobra-money">{moneyBR(item.current_amount)}</td><td><span className={`eobra-status ${item.policy_state === "active" ? "success" : item.last_error ? "warning" : "neutral"}`}>{item.policy_state ? stateLabel[item.policy_state] ?? item.policy_state : item.status !== "open" || (item.paid_amount && item.paid_amount !== "0.00") ? "Histórico preservado" : "A revisar"}</span>{item.last_error ? <small>{item.last_error}</small> : null}</td><td>{monthLabel(item.last_reference_month)}</td><td>{item.policy_id ? <span>Regra revisada</span> : canReview ? <Link prefetch={false} className="table-action" href={`${PATH}?${new URLSearchParams({ page: String(page), receivable: item.receivable_id, source_record: item.source_record_id })}#revisao`}>Conferir regra</Link> : <span>Aguardando revisão da implantação</span>}</td></tr>)}
          {!listing.rows.length ? <tr><td colSpan={7}><div className="eobra-empty"><strong>{unavailable ? "Lista indisponível." : "Nenhuma parcela importada nesta página."}</strong><p>A revisão fica disponível após a promoção dos recebíveis com seus vínculos de origem.</p></div></td></tr> : null}
        </tbody></table></div>
        {listing.total > 0 ? <nav className="eobra-pagination" aria-label="Páginas de parcelas">{page > 1 ? <Link prefetch={false} className="elos-button" href={`?page=${page - 1}#parcelas`}>← Anterior</Link> : <span />}<span>Página {page} de {Math.max(1, Math.ceil(listing.total / 20))}</span>{page * 20 < listing.total ? <Link prefetch={false} className="elos-button" href={`?page=${page + 1}#parcelas`}>Próxima →</Link> : <span />}</nav> : null}
      </section>
    </div>
  </AppShell>;
}
