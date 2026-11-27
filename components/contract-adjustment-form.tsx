import type { ContractAdjustment } from "@/lib/contract-adjustments/types";
import { saveContractAdjustments } from "@/app/comercial/vendas/adjustment-actions";

type Index = { id: string; code: string; name: string };
export function ContractAdjustmentForm({ saleId, saleDate, policy, indices, canApply }: {
  saleId: string; saleDate: string; policy: ContractAdjustment | null; indices: Index[]; canApply: boolean;
}) {
  return <form action={saveContractAdjustments}>
    <input type="hidden" name="sale_id" value={saleId} /><input type="hidden" name="expected_policy_id" value={policy?.id ?? ""} />
    <div className="registry-form-grid">
      <label>Condição negociada<select name="mode" defaultValue={policy?.mode === "none" ? "none" : "phased"}><option value="none">Sem reajuste monetário</option><option value="phased">Definir até e após as chaves</option></select></label>
      <label>Mês-base do contrato<input type="month" name="base_month" required defaultValue={policy?.base_month.slice(0, 7) ?? saleDate.slice(0, 7)} /></label>
      <label>Mês das chaves no contrato<input type="month" name="keys_month" defaultValue={policy?.keys_month?.slice(0, 7) ?? ""} /><small>Obrigatório para as duas fases; não muda quando a previsão da obra é editada.</small></label>
      <label>Reajustar parcelas a partir do mês<input type="number" name="start_month" min={0} max={60} defaultValue={policy?.start_month ?? 0} required /><small>Mês-base = 0. Parcelas anteriores a este marco ficam sem correção.</small></label>
      <label>Limite da atualização<select name="limit_rule" defaultValue={policy?.limit_rule ?? "current_month"}><option value="current_month">Até o mês atual, inclusive vencidas</option><option value="due_month">Até o vencimento, limitado ao mês atual</option></select></label>
    </div>
    {(["pre", "post"] as const).map(phase => <fieldset key={phase} className="registry-table-panel">
      <legend>{phase === "pre" ? "Até o mês das chaves, inclusive" : "Após as chaves, a partir do mês seguinte"}</legend>
      <div className="registry-form-grid">
        <label>Índice<select name={`${phase}_index_id`} defaultValue={policy?.[`${phase}_index_id`] ?? ""}><option value="">Sem reajuste nesta fase</option>{indices.map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label>Periodicidade<select name={`${phase}_interval`} defaultValue={policy?.[`${phase}_interval`] ?? 1}><option value={1}>Mensal</option><option value={12}>Anual</option></select></label>
        <label>Defasagem contratual do índice<select name={`${phase}_lag`} defaultValue={policy?.[`${phase}_lag`] ?? 0}><option value={0}>Sem defasagem</option><option value={1}>1 mês anterior</option><option value={2}>2 meses anteriores</option></select></label>
      </div>
    </fieldset>)}
    <p>O reajuste é calculado por competências mensais, sem proporção por dia. Na troca de índice, a correção acumulada até as chaves é preservada; a nova série começa com base no mês das chaves. Juros e encargos da parcela permanecem separados.</p>
    <div className="registry-form-grid">
      <label className="registry-wide">Motivo / condição negociada<textarea name="reason" required minLength={5} rows={2} placeholder="Descreva o acordo ou aditivo que definiu estas condições." /></label>
      <label>Parcelas já cadastradas<select name="apply_existing" defaultValue="false"><option value="false">Preservar todas; aplicar somente às novas</option>{canApply ? <option value="true">Aplicar também às parcelas abertas elegíveis</option> : null}</select></label>
    </div>
    <p>Parcelas recebidas, parciais, travadas, importadas do eObra ou com cobrança preparada/registrada ficam preservadas. Falta de índice gera pendência e bloqueia a emissão.</p>
    <button className="auth-primary" type="submit">Salvar condições do contrato</button>
  </form>;
}
