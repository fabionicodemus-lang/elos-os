"use client";

import { useRef } from "react";
import { createBudget } from "./actions";

export function BudgetCreateDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button className="elos-button budget-primary-button" type="button" onClick={openDialog}>
        + Nova revisão
      </button>
      <dialog ref={dialogRef} className="budget-modal">
        <form action={createBudget} className="budget-modal-form">
          <header className="budget-modal-head">
            <div>
              <span>Engenharia · Orçamento de Obras</span>
              <h2>Nova revisão do orçamento</h2>
            </div>
            <button type="button" className="budget-modal-close" onClick={closeDialog} aria-label="Fechar">
              ×
            </button>
          </header>

          <div className="budget-modal-body budget-modal-grid">
            <label>
              <span>Código</span>
              <input name="code" placeholder="Ex.: ORC-FLOW" required autoFocus />
            </label>
            <label>
              <span>Revisão</span>
              <input name="version" defaultValue="R00" required />
            </label>
            <label className="budget-modal-wide">
              <span>Nome da revisão</span>
              <input name="name" placeholder="Ex.: Orçamento executivo da obra" required />
            </label>
            <label>
              <span>Data-base</span>
              <input name="reference_date" type="date" />
            </label>
            <label>
              <span>Área construída (m²)</span>
              <input name="area_m2" type="number" min="0" step="0.01" defaultValue="0" />
            </label>
            <label className="budget-modal-wide">
              <span>Premissas e observações</span>
              <textarea
                name="notes"
                rows={4}
                placeholder="Escopo, critérios de levantamento, fontes de preço e premissas desta revisão."
              />
            </label>
          </div>

          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={closeDialog}>
              Cancelar
            </button>
            <button type="submit" className="budget-primary-button">
              Criar revisão
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
