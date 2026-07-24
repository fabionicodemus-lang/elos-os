"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { importEngineeringInputs } from "./import-actions";

function ImportSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="budget-primary-button" type="submit" disabled={pending}>
      {pending ? "Validando e importando..." : "Importar insumos"}
    </button>
  );
}

export function InputImportDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="elos-button price-import-button" type="button" onClick={() => dialogRef.current?.showModal()}>
        ↑ Importar XLSX
      </button>

      <dialog ref={dialogRef} className="budget-modal price-import-modal">
        <form action={importEngineeringInputs} className="budget-modal-form">
          <header className="budget-modal-head">
            <div>
              <span>Engenharia · Catálogo de Insumos</span>
              <h2>Importar lista de insumos</h2>
            </div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>

          <div className="budget-modal-body price-import-body">
            <section className="price-import-intro">
              <div>
                <strong>Sincronização do catálogo corporativo</strong>
                <p>Insumos novos serão cadastrados. Códigos já existentes terão seus dados técnicos atualizados sem criar duplicidades.</p>
              </div>
            </section>

            <section className="price-import-rules">
              <div>
                <span>Aba esperada</span>
                <strong>Insumos</strong>
                <small>Quando a aba não existir, o sistema tentará ler a primeira aba do arquivo.</small>
              </div>
              <div>
                <span>Colunas obrigatórias</span>
                <strong>codigo_insumo, descricao, unidade e natureza</strong>
              </div>
              <div>
                <span>Colunas técnicas aceitas</span>
                <strong>Família, marca, especificação, origem, observações e status</strong>
                <small>O arquivo do consumo do Flow já está neste padrão.</small>
              </div>
              <div>
                <span>Importação segura</span>
                <strong>Até 5.000 linhas e 5 MB</strong>
                <small>Se uma linha tiver erro, nenhum insumo do arquivo será gravado.</small>
              </div>
            </section>

            <label className="price-import-file-field">
              <span>Selecione a planilha de insumos</span>
              <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
              <small>Use o arquivo XLSX com os 13 campos do catálogo técnico do Elos OS.</small>
            </label>
          </div>

          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
            <ImportSubmitButton />
          </footer>
        </form>
      </dialog>
    </>
  );
}
