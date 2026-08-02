"use client";

import { useState } from "react";
import { FinancialInstallmentEditor } from "@/components/financial-installment-editor";
import {
  buildFinancialInstallments,
  financialInstallmentSummary,
  suggestedFirstDueDate,
  type FinancialInstallmentDraft,
} from "@/lib/financial-installments";
import { createPayable } from "./actions";

export type PayableSupplierOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
};

export function PayableCreateForm({ suppliers }: { suppliers: PayableSupplierOption[] }) {
  const [total, setTotal] = useState(0);
  const [installments, setInstallments] = useState<FinancialInstallmentDraft[]>(() =>
    buildFinancialInstallments({ total: 0, count: 1, firstDueDate: suggestedFirstDueDate(), paymentMethod: "Boleto" }),
  );
  const summary = financialInstallmentSummary(total, installments);

  return (
    <form action={createPayable} className="payable-create-form">
      <div className="payable-create-summary">
        <label className="wide">Fornecedor<select name="supplier_id" required defaultValue=""><option value="" disabled>Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name} {supplier.tax_id ? `· ${supplier.tax_id}` : ""}</option>)}</select></label>
        <label>Documento<input name="document" /></label>
        <label>Valor total<input name="total_amount" type="number" min="0.01" step="0.01" value={total || ""} onChange={(event) => setTotal(Number(event.target.value))} placeholder="0,00" required /></label>
        <label>Classe fiscal<input name="fiscal_class" /></label>
        <label className="wide">Observações<textarea name="notes" rows={3} /></label>
      </div>
      <FinancialInstallmentEditor
        total={total}
        installments={installments}
        onChange={setInstallments}
        inputName="installments_json"
        eyebrow="Contas a pagar"
        title="Parcelamento do lançamento"
        compact
      />
      <button className="auth-primary" type="submit" disabled={!summary.valid}>Salvar {installments.length} parcela(s)</button>
    </form>
  );
}
