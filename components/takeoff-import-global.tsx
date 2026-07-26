"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { importEngineeringTakeoffs } from "@/app/engenharia/levantamento/import-actions";

function ImportSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="takeoff-primary-button" type="submit" disabled={pending}>
      {pending ? "Validando e importando..." : "Importar levantamento"}
    </button>
  );
}

export function TakeoffImportGlobal() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dialogRef = useRef<HTMLDialogElement>(null);

  if (pathname !== "/engenharia/levantamento") return null;

  const budgetId = searchParams.get("budget") ?? "";
  const templateHref = budgetId
    ? `/engenharia/levantamento/modelo?budget=${encodeURIComponent(budgetId)}`
    : "/engenharia/levantamento/modelo";

  return (
    <>
      <button
        className="takeoff-import-launcher"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        ↑ Importar XLSX
      </button>

      <dialog ref={dialogRef} className="budget-modal price-import-modal takeoff-import-modal">
        <form action={importEngineeringTakeoffs} className="budget-modal-form">
          <input type="hidden" name="budget_id" value={budgetId} />
          <header className="budget-modal-head">
            <div>
              <span>Engenharia · Levantamento</span>
              <h2>Importar pavimentos e quantitativos</h2>
            </div>
            <button
              type="button"
              className="budget-modal-close"
              onClick={() => dialogRef.current?.close()}
              aria-label="Fechar"
            >
              ×
            </button>
          </header>

          <div className="budget-modal-body price-import-body">
            <section className="price-import-intro">
              <div>
                <strong>1. Baixe o modelo atualizado</strong>
                <p>O arquivo traz os serviços ativos, os locais já cadastrados e as revisões disponíveis.</p>
              </div>
              <a className="budget-secondary-button price-template-link" href={templateHref}>
                ↓ Baixar modelo XLSX
              </a>
            </section>

            <section className="price-import-rules">
              <div>
                <span>Estrutura da obra</span>
                <strong>Pavimento, local superior, repetições e ordem</strong>
                <small>Locais novos são criados e códigos existentes são sincronizados.</small>
              </div>
              <div>
                <span>Quantitativos</span>
                <strong>Serviço, memória de cálculo e quantidade total</strong>
                <small>A unidade é obtida automaticamente do catálogo de serviços.</small>
              </div>
              <div>
                <span>Rastreabilidade</span>
                <strong>Origem, prancha, revisão e status</strong>
                <small>Cada linha vira uma memória vinculada à revisão ativa.</small>
              </div>
              <div>
                <span>Importação segura</span>
                <strong>Até 5.000 linhas e 5 MB</strong>
                <small>Se uma linha tiver erro, nenhum local nem memória será gravado.</small>
              </div>
            </section>

            <label className="price-import-file-field">
              <span>2. Selecione a planilha preenchida</span>
              <input
                name="file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
              />
              <small>Use somente arquivos .xlsx criados a partir do modelo do Elos OS.</small>
            </label>
          </div>

          <footer className="budget-modal-foot">
            <button
              type="button"
              className="budget-secondary-button"
              onClick={() => dialogRef.current?.close()}
            >
              Cancelar
            </button>
            <ImportSubmitButton />
          </footer>
        </form>
      </dialog>
    </>
  );
}
