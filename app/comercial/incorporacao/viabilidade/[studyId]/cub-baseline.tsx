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

function number(value: unknown, digits = 2) {
  return Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits:digits, maximumFractionDigits:digits });
}

function monthInput(value: string | null) {
  return value ? value.slice(0, 7) : "";
}

export function FeasibilityCubBaseline(props: Props) {
  const indexName = props.vgvIndexName || props.costIndexName || "";
  const referenceMonth = props.vgvReferenceMonth || props.costReferenceMonth || null;
  const baseValue = Number(props.vgvBaseValue ?? props.costBaseValue ?? 0);
  const ready = Boolean(indexName && referenceMonth && baseValue > 0);

  return (
    <section className="feasibility-card feasibility-section" id="cub">
      <div className="feasibility-section-title">
        <div><span>Referência de reajuste</span><h2>CUB-base do estudo</h2></div>
        <p>Uma única referência monetária para VGV e custos. O CUB-base fica congelado quando o estudo é aprovado.</p>
      </div>

      <form action={updateFeasibilityCubBaseline}>
        <input type="hidden" name="study_id" value={props.studyId} />
        <div className="feasibility-form">
          <label>Índice / padrão
            <input name="cub_index_name" defaultValue={indexName} placeholder="CUB/SC R8-N" disabled={!props.editable} required />
          </label>
          <label>Mês-base
            <input name="cub_reference_month" type="month" defaultValue={monthInput(referenceMonth)} disabled={!props.editable} required />
          </label>
          <label>Valor do CUB
            <input name="cub_base_value" type="number" min="0.01" step="0.01" defaultValue={baseValue || ""} placeholder="R$ / m²" disabled={!props.editable} required />
          </label>
          <label>VGV disponível em CUB
            <input value={ready ? `${number(props.availableVgv / baseValue)} CUB` : "Informe o CUB-base"} disabled />
          </label>
          <label>VGV bruto em CUB
            <input value={ready ? `${number(props.grossVgv / baseValue)} CUB` : "Informe o CUB-base"} disabled />
          </label>
          <label>Custo da obra em CUB
            <input value={ready ? `${number(props.constructionCost / baseValue)} CUB` : "Informe o CUB-base"} disabled />
          </label>
          <label>Custo total em CUB
            <input value={ready ? `${number(props.totalCost / baseValue)} CUB` : "Informe o CUB-base"} disabled />
          </label>
        </div>

        <div className={`feasibility-note ${ready ? "" : "feasibility-warning"}`} style={{ marginTop:12 }}>
          {ready ? <>
            <strong>Baseline indexado.</strong> VGV bruto: {number(props.grossVgv / baseValue)} CUB · VGV disponível: {number(props.availableVgv / baseValue)} CUB · custo da obra: {number(props.constructionCost / baseValue)} CUB · custo total: {number(props.totalCost / baseValue)} CUB.
            <br />Reajuste futuro: valor atualizado = valor-base × (CUB atual ÷ CUB-base).
          </> : <>
            <strong>CUB pendente.</strong> Informe índice, mês-base e valor. Essa mesma referência será usada para VGV e custos.
          </>}
        </div>

        {props.editable ? <div className="feasibility-actions"><button className="feasibility-primary" type="submit">Salvar CUB-base</button></div> : null}
      </form>
    </section>
  );
}
