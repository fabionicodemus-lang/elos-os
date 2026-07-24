"use client";

import { useRef } from "react";
import {
  createEngineeringCompositionItem,
  updateEngineeringCompositionItem,
} from "./actions";

export type CompositionServiceOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type CompositionInputOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
};

export type CompositionItemDialogData = {
  id: string;
  input_id: string;
  coefficient: number;
  waste_percentage: number;
  notes: string | null;
  status: "active" | "inactive";
};

const categoryLabels: Record<string, string> = {
  material: "Materiais",
  labor: "Mão de obra",
  equipment: "Equipamentos",
  service: "Serviços terceirizados",
  freight: "Fretes",
  other: "Outros custos",
};

function CompositionFields({
  service,
  inputs,
  item,
}: {
  service: CompositionServiceOption;
  inputs: CompositionInputOption[];
  item?: CompositionItemDialogData;
}) {
  const categories = [...new Set(inputs.map((input) => input.category))];

  return (
    <div className="composition-modal-grid">
      <input type="hidden" name="service_id" value={service.id} />

      <div className="composition-service-context">
        <span>Serviço composto</span>
        <strong>{service.code} · {service.description}</strong>
        <small>Custo calculado por {service.unit} do serviço.</small>
      </div>

      <label className="composition-modal-wide">
        <span>Insumo</span>
        <select name="input_id" defaultValue={item?.input_id ?? ""} required autoFocus>
          <option value="">Selecione o insumo</option>
          {categories.map((category) => (
            <optgroup key={category} label={categoryLabels[category] ?? category}>
              {inputs.filter((input) => input.category === category).map((input) => (
                <option key={input.id} value={input.id}>
                  {input.code} · {input.description} ({input.unit})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label>
        <span>Coeficiente base</span>
        <input
          name="coefficient"
          type="number"
          min="0.00000001"
          step="0.00000001"
          defaultValue={item?.coefficient ?? 1}
          required
        />
        <small>Quantidade do insumo para produzir 1 unidade do serviço.</small>
      </label>

      <label>
        <span>Perda / acréscimo (%)</span>
        <input
          name="waste_percentage"
          type="number"
          min="0"
          max="1000"
          step="0.0001"
          defaultValue={item?.waste_percentage ?? 0}
        />
        <small>O coeficiente efetivo inclui este percentual.</small>
      </label>

      <label className="composition-modal-wide">
        <span>Observações técnicas</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={item?.notes ?? ""}
          placeholder="Ex.: consumo conforme fabricante, produtividade considerada ou condição específica."
        />
      </label>

      {item ? (
        <label>
          <span>Status na composição</span>
          <select name="status" defaultValue={item.status}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </label>
      ) : null}

      <div className="composition-formula-note">
        <strong>Coeficiente efetivo</strong>
        <span>coeficiente base × (1 + perda ÷ 100)</span>
      </div>
    </div>
  );
}

export function CompositionItemCreateDialog({
  service,
  inputs,
}: {
  service: CompositionServiceOption;
  inputs: CompositionInputOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="elos-button budget-primary-button"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        disabled={inputs.length === 0}
      >
        + Adicionar insumo
      </button>
      <dialog ref={dialogRef} className="budget-modal composition-modal">
        <form action={createEngineeringCompositionItem} className="budget-modal-form">
          <header className="budget-modal-head">
            <div><span>Engenharia · Composições</span><h2>Adicionar insumo ao serviço</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body">
            <CompositionFields service={service} inputs={inputs} />
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Adicionar à composição</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function CompositionItemEditDialog({
  service,
  inputs,
  item,
}: {
  service: CompositionServiceOption;
  inputs: CompositionInputOption[];
  item: CompositionItemDialogData;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="table-action" type="button" onClick={() => dialogRef.current?.showModal()}>Editar</button>
      <dialog ref={dialogRef} className="budget-modal composition-modal">
        <form action={updateEngineeringCompositionItem} className="budget-modal-form">
          <input type="hidden" name="item_id" value={item.id} />
          <header className="budget-modal-head">
            <div><span>Composição atual</span><h2>Editar insumo e coeficiente</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body">
            <CompositionFields service={service} inputs={inputs} item={item} />
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Salvar alterações</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
