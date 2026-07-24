"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { importEngineeringInputPrices } from "./import-actions";

function ImportSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="budget-primary-button" type="submit" disabled={pending}>
      {pending ? "Validando e importando..." : "Importar cotações"}
    </button>
  );
}

export function PriceImportDialog({ projectName }: { projectName: string | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="elos-button price-import-button" type="button" onClick={() => dialogRef.current?.showModal()}>
        ↑ Importar XLSX
      </button>

      <dialog ref={dialogRef} className="budget-modal price-import-modal">
        <form action={importEngineeringInputPrices} className="budget-modal-form">
          <header className="budget-modal-head">
            <div>
              <span>Engenharia · Preços e cotações</span>
              <h2>Importar várias cotações</h2>
            </div>
            <button type="button" className="budget-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Fechar">×</button>
          </header>

          <div className="budget-modal-body price-import-body">
            <section className="price-import-intro">
              <div>
                <strong>1. Baixe o modelo atualizado</strong>
                <p>O arquivo já traz as listas de insumos, fornecedores e obras cadastradas na sua empresa.</p>
              </div>
              <a className="budget-secondary-button price-template-link" href="/engenharia/precos/modelo">
                ↓ Baixar modelo XLSX
              </a>
            </section>

            <section className="price-import-rules">
              <div>
                <span>Colunas obrigatórias</span>
                <strong>codigo_insumo, fornecedor_nome ou fornecedor_cnpj, data_preco, escopo e preco_unitario</strong>
              </div>
              <div>
                <span>Valores controlados</span>
                <strong>escopo: Corporativo ou Obra · adotar_preco: Sim ou Não</strong>
              </div>
              <div>
                <span>Obra selecionada</span>
                <strong>{projectName ?? "Nenhuma obra selecionada"}</strong>
                <small>Quando o escopo for Obra e codigo_obra estiver vazio, esta obra será usada.</small>
              </div>
              <div>
                <span>Importação segura</span>
                <strong>Até 2.000 linhas e 5 MB</strong>
                <small>Se uma linha tiver erro, nenhuma cotação do arquivo será gravada.</small>
              </div>
            </section>

            <label className="price-import-file-field">
              <span>2. Selecione a planilha preenchida</span>
              <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
              <small>Use somente arquivos .xlsx criados a partir do modelo do Elos OS.</small>
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
