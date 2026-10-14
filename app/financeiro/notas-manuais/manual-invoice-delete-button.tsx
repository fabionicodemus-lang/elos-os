"use client";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { deleteManualInvoice } from "./actions";

export function ManualInvoiceDeleteButton({ invoiceId, registryNumber }: { invoiceId: string; registryNumber: string }) {
  return <form action={deleteManualInvoice}>
    <input type="hidden" name="invoice_id" value={invoiceId} />
    <ConfirmSubmitButton
      className="danger"
      label="Excluir nota"
      confirmLabel={`Confirmar exclusão ${registryNumber}`}
      title="Clique uma vez para preparar a exclusão e novamente para confirmar."
    />
  </form>;
}
