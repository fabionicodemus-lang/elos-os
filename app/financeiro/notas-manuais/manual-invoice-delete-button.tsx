"use client";

import { deleteManualInvoice } from "./actions";

export function ManualInvoiceDeleteButton({ invoiceId, registryNumber }: { invoiceId: string; registryNumber: string }) {
  return <form
    action={deleteManualInvoice}
    onSubmit={(event) => {
      const confirmed = window.confirm(`Excluir definitivamente a nota ${registryNumber} e todos os lançamentos ainda não pagos? Esta ação não poderá ser desfeita.`);
      if (!confirmed) event.preventDefault();
    }}
  >
    <input type="hidden" name="invoice_id" value={invoiceId} />
    <button className="danger" type="submit">Excluir nota</button>
  </form>;
}
