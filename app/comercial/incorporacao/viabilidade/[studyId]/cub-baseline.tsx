import { updateFeasibilityCubBaseline } from "../cub-actions";

type Props = {
  studyId: string;
  editable: boolean;
  vgvIndexName: string | null;
  vgvReferenceMonth: string | null;
  vgvBaseValue: number | null;
  costIndexName: string | null;
  costReferenceMonth: string | null;
  costBaseValue: number | null;
  grossVgv: number;
  availableVgv: number;
  constructionCost: number;
  totalCost: number;
};

function money(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(value ?? 0));
}

function number(value: unknown, digits = 2) {
  return Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits:digits, maximumFractionDigits:digits });
}

function monthInput(value: string | null) {
  return value ? value.slice(0, 7) : "";
}

export function FeasibilityCubBaseline(props: Props) {
  const vgvBase = Number(props.vgvBaseValue ?? 0);
  const costBase = Number(props.costBaseValue ?? 0);
  const vgvReady = Boolean(props.vgvIndexName && props.vgvReferenceMonth && vgvBase > 0);
  const costReady = Boolean(props.costIndexName && props.costReferenceMonth && costBase > 0);
  const complete = vgvReady && costReady;

  return (
    <section className="feasibility-card feasibility-section">
      <div className="feasibility-section-title">
        <div><span>Referência de reajuste</span><h2>CUB-base do estudo</h2></div>
        <p>O CUB-base fica congelado na aprovação e permite trazer VGV e custos para a mesma moeda de comparação no futuro.</p>
      </div>

      <form action={updateFeasibilityCubBaseline}>
        <input type="hidden" name="study_id" value={props.studyId} />
        <div className="feasibility-form">
          <label>CUB do VGV · índice/padrão
            <input name="vgv_cub_index_name" defaultValue={props.vgvIndexName ?? ""} placeholder="CUB/SC R8-N" disabled={!props.editable} required />
          </label>
          <label>CUB do VGV · mês-base
            <input name="vgv_cub_reference_month" type="month" defaultValue={monthInput(props.vgvReferenceMonth)} disabled={!props.editable} required />
          </label>
          <label>CUB do VGV · valor
            <input name="vgv_cub_base_value" type="number" min="0.01" step="0.01" defaultValue={props.vgvBaseValue ?? ""} placeholder="R$ / m²" disabled={!props.editable} required />
          </label>
          <label>VGV disponível em CUB
            <input value={vgvReady ? `${number(props.availableVgv / vgvBase)} CUB` : "Informe o CUB-base"} disabled />
          </label>

          <label>CUB dos custos · índice/padrão
            <input name="cost_cub_index_name" defaultValue={props.costIndexName ?? ""} placeholder="CUB/SC R8-N" disabled={!props.editable} required />
          </label>
          <label>CUB dos custos · mês-base
            <input name="cost_cub_reference_month" type="month" defaultValue={monthInput(props.costReferenceMonth)} disabled={!props.editable} required />
          </label>
          <label>CUB dos custos · valor
            <input name="cost_cub_base_value" type="number" min="0.01" step="0.01" defaultValue={props.costBaseValue ?? ""} placeholder="R$ / m²" disabled={!props.editable} required />
          </label>
          <label>Custo da obra em CUB
            <input value={costReady ? `${number(props.constructionCost / costBase)} CUB` : "Informe o CUB-base"} disabled />
          </label>
        </div>

        <div className={`feasibility-note ${complete ? "" : "feasibility-warning"}`} style={{ marginTop:12 }}>
          {complete ? <>
            <strong>Baseline indexado.</strong> VGV bruto: {number(props.grossVgv / vgvBase)} CUB · VGV disponível: {number(props.availableVgv / vgvBase)} CUB · custo da obra: {number(props.constructionCost / costBase)} CUB · custo total: {number(props.totalCost / costBase)} CUB.
            <br />Reajuste futuro: valor atualizado = valor-base × (CUB atual ÷ CUB-base).
          </> : <>
            <strong>CUB pendente.</strong> Preencha as referências do VGV e dos custos. O estudo poderá ser salvo em rascunho, mas não poderá ser aprovado sem esses dados.
          </>}
        </div>

        {props.editable ? <div className="feasibility-actions"><button className="feasibility-primary" type="submit">Salvar referências CUB</button></div> : null}
      </form>
    </section>
  );
}
