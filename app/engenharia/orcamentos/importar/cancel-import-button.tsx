"use client";

import { useFormStatus } from "react-dom";
import { cancelBudgetImport } from "./actions";

function CancelSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="elos-button elos-button-danger" disabled={pending} aria-disabled={pending}>
      {pending ? "Cancelando…" : "Cancelar importação"}
    </button>
  );
}

export function CancelBudgetImportButton({ batchId, fileName }: { batchId: string; fileName: string }) {
  return (
    <form
      action={cancelBudgetImport}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Cancelar a importação "${fileName}"?\n\nO lote ficará cancelado e poderá ser enviado novamente. Nenhum orçamento, serviço ou insumo oficial será alterado.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="batch_id" value={batchId} />
      <CancelSubmitButton />
    </form>
  );
}
