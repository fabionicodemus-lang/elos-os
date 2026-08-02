"use client";

import { useState } from "react";
import { FinancialInstallmentEditor } from "@/components/financial-installment-editor";
import { buildFinancialInstallments, financialInstallmentSummary, suggestedFirstDueDate, type FinancialInstallmentDraft } from "@/lib/financial-installments";
import { createReceivableSeries } from "./actions";

export type ReceivableSaleOption = { id: string; number: string; total_amount: number; client_name: string; unit_code: string };
export type ReceivableIndexOption = { id: string; code: string; unit_label: string };

const categoryLabels: Record<string, string> = {
  entry: "Entrada",
  monthly: "Mensal",
  reinforcement: "Reforço",
  keys: "Chaves",
  post_keys: "Pós-chaves",
  other: "Outra",
};

export function ReceivableCreateForm({ sales, indices, defaultIndexId, selectedSaleId }: {
  sales: ReceivableSaleOption[];
  indices: ReceivableIndexOption[];
  defaultIndexId: string;
  selectedSaleId?: string;
}) {
  const [total, setTotal] = useState(0);
  const [installments, setInstallments] = useState<FinancialInstallmentDraft[]>(() => buildFinancialInstallments({
    total: 0,
    count: 1,
    firstDueDate: suggestedFirstDueDate(),
    paymentMethod: "Boleto",
  }));
  const summary = financialInstallmentSummary(total, installments);

  return (
    <form action={createReceivableSeries} className="payable-create-form">
      <input type="hidden" name="total_amount" value={total} />
      <div className="payable-create-summary">
        <label className="wide">Venda<select name="sale_id" required defaultValue={selectedSaleId ?? ""}><option value="" disabled>Selecione a venda</option>{sales.map((sale) => <option key={sale.id} value={sale.id}>{sale.unit_code} · {sale.client_name} · venda {sale.number}</option>)}</select></label>
        <label>Tipo<select name="category" defaultValue="monthly" required>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Descrição<input name="description" placeholder="Ex.: Saldo parcelado" /></label>
        <label>Valor total do lançamento<input type="number" min="0.01" step="0.01" value={total || ""} onChange={(event) => setTotal(Number(event.target.value))} placeholder="0,00" required /></label>
        <label>Índice de correção<select name="correction_index_id" defaultValue={defaultIndexId}><option value="">Sem correção</option>{indices.map((index) => <option key={index.id} value={index.id}>{index.code} · {index.unit_label}</option>)}</select></label>
        <label>Juros ao mês (%)<input name="interest_rate_monthly" type="number" min="0" step="0.0001" placeholder="0,00" /></label>
        <label className="wide">Observações<textarea name="notes" rows={3} /></label>
      </div>
      <FinancialInstallmentEditor total={total} installments={installments} onChange={setInstallments} inputName="installments_json" eyebrow="Contas a receber" title="Parcelas do plano" compact />
      <button className="auth-primary" type="submit" disabled={!summary.valid}>Adicionar {installments.length} parcela(s) ao plano</button>
    </form>
  );
}
