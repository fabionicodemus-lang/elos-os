import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  addFeasibilityConstructionArea,
  addFeasibilitySalesVelocity,
  addFeasibilityUnitType,
  deleteFeasibilityConstructionArea,
  deleteFeasibilitySalesVelocity,
  deleteFeasibilityUnitType,
  updateFeasibilityConstructionArea,
  updateFeasibilitySalesVelocity,
  updateFeasibilityUnitType,
} from "../actions";

export type FeasibilityUnitType = {
  id:string;
  name:string;
  quantity:number;
  private_area_m2:number;
  sale_price_m2:number;
  barter_units:number;
  sort_order:number;
  notes:string|null;
};

export type FeasibilityConstructionArea = {
  id:string;
  name:string;
  area_m2:number;
  cost_m2:number;
  source_key:string|null;
  sort_order:number;
  notes:string|null;
};

export type FeasibilitySalesVelocity = {
  id:string;
  name:string;
  start_offset_months:number;
  units_per_month:number;
  sort_order:number;
  notes:string|null;
};

function money(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", maximumFractionDigits:0 }).format(Number(value ?? 0));
}
function number(value: unknown, digits = 1) {
  return Number(value ?? 0).toLocaleString("pt-BR", { maximumFractionDigits:digits });
}
function offsetLabel(value: number) {
  if (value === 0) return "No início da obra";
  if (value < 0) return `${Math.abs(value)} mês(es) antes da obra`;
  return `${value} mês(es) após o início da obra`;
}

export function FeasibilityUnitTypesManager({
  studyId,
  unitTypes,
  editable,
}: {
  studyId:string;
  unitTypes:FeasibilityUnitType[];
  editable:boolean;
}) {
  return <section className="feasibility-card feasibility-section" id="produto">
    <div className="feasibility-section-title">
      <div><span>Produto e permuta física</span><h2>Tipologias dos apartamentos</h2></div>
      <p>Veja todas as tipologias cadastradas; edite ou exclua sem perder o contexto do estudo.</p>
    </div>

    {editable ? <form action={addFeasibilityUnitType} className="feasibility-unit-grid">
      <input type="hidden" name="study_id" value={studyId} />
      <label>Tipologia<input name="name" required placeholder="Tipo 01" /></label>
      <label>Quantidade<input name="quantity" type="number" min="1" required /></label>
      <label>Área privativa m²<input name="private_area_m2" type="number" min="0.01" step="0.01" required /></label>
      <label>Preço venda / m²<input name="sale_price_m2" type="number" min="0.01" step="0.01" required /></label>
      <label>Unidades permuta<input name="barter_units" type="number" min="0" defaultValue="0" required /></label>
      <button className="feasibility-primary" type="submit">Adicionar tipologia</button>
    </form> : null}

    <div className="registry-table-wrap" style={{marginTop:14}}><table className="registry-table">
      <thead><tr><th>Tipologia</th><th>Qtd.</th><th>Área/un.</th><th>Preço/m²</th><th>VGV</th><th>Permuta</th><th>VGV permuta</th>{editable ? <th>Ações</th> : null}</tr></thead>
      <tbody>{unitTypes.map(item => <tr key={item.id}>
        <td><strong>{item.name}</strong>{item.notes ? <small>{item.notes}</small> : null}</td>
        <td>{item.quantity}</td>
        <td>{number(item.private_area_m2,2)} m²</td>
        <td>{money(item.sale_price_m2)}</td>
        <td>{money(Number(item.quantity)*Number(item.private_area_m2)*Number(item.sale_price_m2))}</td>
        <td>{item.barter_units}</td>
        <td>{money(Number(item.barter_units)*Number(item.private_area_m2)*Number(item.sale_price_m2))}</td>
        {editable ? <td><div className="feasibility-row-actions">
          <details className="feasibility-row-editor">
            <summary>Editar</summary>
            <form action={updateFeasibilityUnitType} className="feasibility-unit-grid feasibility-inline-editor">
              <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="unit_type_id" value={item.id}/>
              <label>Tipologia<input name="name" defaultValue={item.name} required /></label>
              <label>Qtd.<input name="quantity" type="number" min="1" defaultValue={item.quantity} required /></label>
              <label>Área m²<input name="private_area_m2" type="number" min="0.01" step="0.01" defaultValue={item.private_area_m2} required /></label>
              <label>Venda/m²<input name="sale_price_m2" type="number" min="0.01" step="0.01" defaultValue={item.sale_price_m2} required /></label>
              <label>Permuta<input name="barter_units" type="number" min="0" max={item.quantity} defaultValue={item.barter_units} required /></label>
              <label>Observação<input name="notes" defaultValue={item.notes ?? ""} /></label>
              <button className="feasibility-primary" type="submit">Salvar alteração</button>
            </form>
          </details>
          <form action={deleteFeasibilityUnitType}>
            <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="unit_type_id" value={item.id}/>
            <ConfirmSubmitButton className="feasibility-danger" label="Excluir" confirmLabel="Confirmar exclusão" />
          </form>
        </div></td> : null}
      </tr>)}</tbody>
    </table></div>
    {!unitTypes.length ? <p>Nenhuma tipologia cadastrada.</p> : null}
  </section>;
}

export function FeasibilityConstructionAreasManager({
  studyId,
  constructionAreas,
  apartmentAreaM2,
  apartmentCostM2,
  editable,
}: {
  studyId:string;
  constructionAreas:FeasibilityConstructionArea[];
  apartmentAreaM2:number;
  apartmentCostM2:number;
  editable:boolean;
}) {
  return <section className="feasibility-card feasibility-section" id="areas">
    <div className="feasibility-section-title">
      <div><span>Áreas de construção</span><h2>Áreas e custos por m²</h2></div>
      <p>A área dos apartamentos vem das tipologias. As demais áreas podem ser criadas, editadas e excluídas livremente.</p>
    </div>

    {editable ? <form action={addFeasibilityConstructionArea} className="feasibility-unit-grid">
      <input type="hidden" name="study_id" value={studyId} />
      <label>Área / ambiente<input name="name" required placeholder="Ex.: Garagem + escadas" /></label>
      <label>Área total m²<input name="area_m2" type="number" min="0" step="0.01" required /></label>
      <label>Custo / m²<input name="cost_m2" type="number" min="0" step="0.01" required /></label>
      <label>Observação<input name="notes" placeholder="Opcional" /></label>
      <button className="feasibility-primary" type="submit">Adicionar área</button>
    </form> : null}

    <div className="registry-table-wrap" style={{marginTop:14}}><table className="registry-table">
      <thead><tr><th>Área</th><th>m²</th><th>Custo/m²</th><th>Custo estimado</th><th>Origem</th>{editable ? <th>Ações</th> : null}</tr></thead>
      <tbody>
        <tr>
          <td><strong>Apartamentos</strong></td><td>{number(apartmentAreaM2,2)} m²</td><td>{money(apartmentCostM2)}</td>
          <td>{money(apartmentAreaM2 * apartmentCostM2)}</td><td><span className="feasibility-source-badge">Tipologias</span></td>{editable ? <td><small>Edite o custo no bloco acima.</small></td> : null}
        </tr>
        {constructionAreas.map(item => <tr key={item.id}>
          <td><strong>{item.name}</strong>{item.notes ? <small>{item.notes}</small> : null}</td>
          <td>{number(item.area_m2,2)} m²</td><td>{money(item.cost_m2)}</td><td>{money(Number(item.area_m2)*Number(item.cost_m2))}</td>
          <td>{item.source_key ? <span className="feasibility-source-badge">Migrada</span> : "Manual"}</td>
          {editable ? <td><div className="feasibility-row-actions">
            <details className="feasibility-row-editor"><summary>Editar</summary>
              <form action={updateFeasibilityConstructionArea} className="feasibility-unit-grid feasibility-inline-editor">
                <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="construction_area_id" value={item.id}/>
                <label>Área / ambiente<input name="name" defaultValue={item.name} required /></label>
                <label>Área total m²<input name="area_m2" type="number" min="0" step="0.01" defaultValue={item.area_m2} required /></label>
                <label>Custo / m²<input name="cost_m2" type="number" min="0" step="0.01" defaultValue={item.cost_m2} required /></label>
                <label>Observação<input name="notes" defaultValue={item.notes ?? ""} /></label>
                <button className="feasibility-primary" type="submit">Salvar alteração</button>
              </form>
            </details>
            <form action={deleteFeasibilityConstructionArea}>
              <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="construction_area_id" value={item.id}/>
              <ConfirmSubmitButton className="feasibility-danger" label="Excluir" confirmLabel="Confirmar exclusão" />
            </form>
          </div></td> : null}
        </tr>)}
      </tbody>
    </table></div>
    {!constructionAreas.length ? <p className="feasibility-note" style={{marginTop:12}}>Nenhuma área adicional cadastrada. A área construída considera apenas os apartamentos até você adicionar garagem, circulação, lazer, hall ou outras áreas.</p> : null}
  </section>;
}

export function FeasibilitySalesVelocitiesManager({
  studyId,
  salesVelocities,
  editable,
}: {
  studyId:string;
  salesVelocities:FeasibilitySalesVelocity[];
  editable:boolean;
}) {
  const canDelete = salesVelocities.length > 1;
  return <section className="feasibility-card feasibility-section">
    <div className="feasibility-section-title">
      <div><span>Velocidades de venda</span><h2>Fases comerciais</h2></div>
      <p>Cada fase passa a valer no mês indicado e permanece até a próxima fase. O estudo precisa manter ao menos uma velocidade.</p>
    </div>

    {editable ? <form action={addFeasibilitySalesVelocity} className="feasibility-unit-grid">
      <input type="hidden" name="study_id" value={studyId} />
      <label>Fase<input name="name" required placeholder="Ex.: Lançamento" /></label>
      <label>Início vs obra (meses)<input name="start_offset_months" type="number" min="-60" max="240" required placeholder="-3" /></label>
      <label>Unidades / mês<input name="units_per_month" type="number" min="0.01" step="0.01" required placeholder="2" /></label>
      <label>Observação<input name="notes" placeholder="Opcional" /></label>
      <button className="feasibility-primary" type="submit">Adicionar velocidade</button>
    </form> : null}

    <div className="registry-table-wrap" style={{marginTop:14}}><table className="registry-table">
      <thead><tr><th>Fase</th><th>Início</th><th>Velocidade</th><th>Observação</th>{editable ? <th>Ações</th> : null}</tr></thead>
      <tbody>{salesVelocities.map(item => <tr key={item.id}>
        <td><strong>{item.name}</strong></td><td>{offsetLabel(Number(item.start_offset_months))}</td><td><strong>{number(item.units_per_month,2)} un./mês</strong></td><td>{item.notes || "—"}</td>
        {editable ? <td><div className="feasibility-row-actions">
          <details className="feasibility-row-editor"><summary>Editar</summary>
            <form action={updateFeasibilitySalesVelocity} className="feasibility-unit-grid feasibility-inline-editor">
              <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="sales_velocity_id" value={item.id}/>
              <label>Fase<input name="name" defaultValue={item.name} required /></label>
              <label>Início vs obra<input name="start_offset_months" type="number" min="-60" max="240" defaultValue={item.start_offset_months} required /></label>
              <label>Unidades / mês<input name="units_per_month" type="number" min="0.01" step="0.01" defaultValue={item.units_per_month} required /></label>
              <label>Observação<input name="notes" defaultValue={item.notes ?? ""} /></label>
              <button className="feasibility-primary" type="submit">Salvar alteração</button>
            </form>
          </details>
          <form action={deleteFeasibilitySalesVelocity}>
            <input type="hidden" name="study_id" value={studyId}/><input type="hidden" name="sales_velocity_id" value={item.id}/>
            <ConfirmSubmitButton className="feasibility-danger" label="Excluir" confirmLabel="Confirmar exclusão" disabled={!canDelete} title={!canDelete ? "O estudo precisa manter ao menos uma velocidade de vendas." : undefined} />
          </form>
        </div></td> : null}
      </tr>)}</tbody>
    </table></div>
    {!salesVelocities.length ? <p>Nenhuma velocidade de vendas cadastrada.</p> : null}
  </section>;
}
