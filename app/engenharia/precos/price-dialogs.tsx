"use client";

import { useEffect, useRef, useState } from "react";
import { createEngineeringInputPrice, updateEngineeringInputPrice } from "./actions";

export type PriceInputOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type PriceSupplierOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
};

export type EngineeringInputPriceDialogData = {
  id: string;
  input_id: string;
  supplier_id: string | null;
  project_id: string | null;
  price_date: string;
  unit_price: number;
  freight_unit_cost: number;
  other_unit_cost: number;
  discount_percentage: number;
  source: string | null;
  notes: string | null;
  is_adopted: boolean;
  status: "active" | "inactive";
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function useLazyDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.showModal());
    return () => window.cancelAnimationFrame(frame);
  }, [mounted]);

  const open = () => setMounted(true);
  const close = () => {
    dialogRef.current?.close();
    setMounted(false);
  };

  return { dialogRef, mounted, open, close, unmount: () => setMounted(false) };
}

function PriceFields({
  price,
  inputs,
  suppliers,
  projectName,
  lockInput = false,
}: {
  price?: EngineeringInputPriceDialogData;
  inputs: PriceInputOption[];
  suppliers: PriceSupplierOption[];
  projectName: string | null;
  lockInput?: boolean;
}) {
  const selectedInput = price ? inputs.find((input) => input.id === price.input_id) ?? null : null;

  return (
    <div className="price-modal-grid">
      <label className="price-modal-wide">
        <span>Insumo</span>
        {lockInput && price ? (
          <>
            <input type="hidden" name="input_id" value={price.input_id} />
            <input
              value={selectedInput ? `${selectedInput.code} · ${selectedInput.description} (${selectedInput.unit})` : "Insumo vinculado à cotação"}
              readOnly
              aria-label="Insumo da cotação"
            />
          </>
        ) : (
          <select name="input_id" defaultValue={price?.input_id ?? ""} required autoFocus>
            <option value="">Selecione o insumo</option>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>{input.code} · {input.description} ({input.unit})</option>
            ))}
          </select>
        )}
      </label>

      <label>
        <span>Escopo do preço</span>
        <select name="scope" defaultValue={price?.project_id ? "project" : "corporate"}>
          <option value="corporate">Corporativo · todas as obras</option>
          {projectName ? <option value="project">Obra atual · {projectName}</option> : null}
        </select>
      </label>

      <label>
        <span>Data do preço</span>
        <input name="price_date" type="date" defaultValue={price?.price_date ?? today()} required />
      </label>

      <label className="price-modal-wide">
        <span>Fornecedor</span>
        <select name="supplier_id" defaultValue={price?.supplier_id ?? ""}>
          <option value="">Sem fornecedor informado</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Preço unitário</span>
        <input name="unit_price" type="number" min="0" step="0.000001" defaultValue={price?.unit_price ?? 0} required />
      </label>

      <label>
        <span>Desconto (%)</span>
        <input name="discount_percentage" type="number" min="0" max="100" step="0.0001" defaultValue={price?.discount_percentage ?? 0} />
      </label>

      <label>
        <span>Frete por unidade</span>
        <input name="freight_unit_cost" type="number" min="0" step="0.000001" defaultValue={price?.freight_unit_cost ?? 0} />
      </label>

      <label>
        <span>Outros custos por unidade</span>
        <input name="other_unit_cost" type="number" min="0" step="0.000001" defaultValue={price?.other_unit_cost ?? 0} />
      </label>

      <label className="price-modal-wide">
        <span>Origem / documento</span>
        <input name="source" defaultValue={price?.source ?? ""} placeholder="Ex.: cotação, pedido de compra, contrato ou base corporativa" />
      </label>

      <label className="price-modal-wide">
        <span>Observações</span>
        <textarea name="notes" rows={3} defaultValue={price?.notes ?? ""} placeholder="Prazo, validade, condição de pagamento, impostos e observações comerciais." />
      </label>

      <label className="price-checkbox-field">
        <input name="is_adopted" type="checkbox" defaultChecked={price?.is_adopted ?? false} />
        <span>Adotar como preço de referência</span>
      </label>

      {price ? (
        <label>
          <span>Status</span>
          <select name="status" defaultValue={price.status}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function PriceCreateDialog({
  inputs,
  suppliers,
  projectName,
}: {
  inputs: PriceInputOption[];
  suppliers: PriceSupplierOption[];
  projectName: string | null;
}) {
  const { dialogRef, mounted, open, close, unmount } = useLazyDialog();

  return (
    <>
      <button className="elos-button budget-primary-button" type="button" onClick={open}>
        + Nova cotação
      </button>
      {mounted ? (
        <dialog ref={dialogRef} className="budget-modal price-modal" onClose={unmount}>
          <form action={createEngineeringInputPrice} className="budget-modal-form">
            <header className="budget-modal-head">
              <div><span>Engenharia · Preços e cotações</span><h2>Novo preço de insumo</h2></div>
              <button type="button" className="budget-modal-close" onClick={close} aria-label="Fechar">×</button>
            </header>
            <div className="budget-modal-body"><PriceFields inputs={inputs} suppliers={suppliers} projectName={projectName} /></div>
            <footer className="budget-modal-foot">
              <button type="button" className="budget-secondary-button" onClick={close}>Cancelar</button>
              <button type="submit" className="budget-primary-button">Salvar cotação</button>
            </footer>
          </form>
        </dialog>
      ) : null}
    </>
  );
}

export function PriceEditDialog({
  price,
  inputs,
  suppliers,
  projectName,
}: {
  price: EngineeringInputPriceDialogData;
  inputs: PriceInputOption[];
  suppliers: PriceSupplierOption[];
  projectName: string | null;
}) {
  const { dialogRef, mounted, open, close, unmount } = useLazyDialog();

  return (
    <>
      <button className="table-action" type="button" onClick={open}>Editar</button>
      {mounted ? (
        <dialog ref={dialogRef} className="budget-modal price-modal" onClose={unmount}>
          <form action={updateEngineeringInputPrice} className="budget-modal-form">
            <input type="hidden" name="price_id" value={price.id} />
            <header className="budget-modal-head">
              <div><span>Preço registrado</span><h2>Editar cotação</h2></div>
              <button type="button" className="budget-modal-close" onClick={close} aria-label="Fechar">×</button>
            </header>
            <div className="budget-modal-body"><PriceFields price={price} inputs={inputs} suppliers={suppliers} projectName={projectName} lockInput /></div>
            <footer className="budget-modal-foot">
              <button type="button" className="budget-secondary-button" onClick={close}>Cancelar</button>
              <button type="submit" className="budget-primary-button">Salvar alterações</button>
            </footer>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
