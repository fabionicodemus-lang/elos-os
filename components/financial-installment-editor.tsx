"use client";

import { useEffect, useState } from "react";
import {
  buildFinancialInstallments,
  financialInstallmentSummary,
  installmentsForPayload,
  suggestedFirstDueDate,
  type FinancialInstallmentDraft,
} from "@/lib/financial-installments";

const paymentMethods = ["Não informado", "Boleto", "PIX", "Transferência", "Débito automático", "Dinheiro", "Cartão", "Outro"];

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

export function FinancialInstallmentEditor({
  total,
  installments,
  onChange,
  inputName = "installments_json",
  title = "Programação das parcelas",
  eyebrow = "Financeiro",
  defaultPaymentMethod = "Boleto",
  lockCount = false,
  maxInstallments = 120,
  compact = false,
}: {
  total: number;
  installments: FinancialInstallmentDraft[];
  onChange: (installments: FinancialInstallmentDraft[]) => void;
  inputName?: string;
  title?: string;
  eyebrow?: string;
  defaultPaymentMethod?: string;
  lockCount?: boolean;
  maxInstallments?: number;
  compact?: boolean;
}) {
  const [count, setCount] = useState(Math.max(1, installments.length || 1));
  const summary = financialInstallmentSummary(total, installments);

  useEffect(() => {
    setCount(Math.max(1, installments.length || 1));
  }, [installments.length]);

  function regenerate(nextCount = count, preserveFirstDate = true) {
    const safeCount = Math.max(1, Math.min(maxInstallments, Math.trunc(Number(nextCount) || 1)));
    const firstDueDate = preserveFirstDate && installments[0]?.due_date
      ? installments[0].due_date
      : suggestedFirstDueDate();
    const paymentMethod = installments[0]?.payment_method || defaultPaymentMethod;
    onChange(buildFinancialInstallments({ total, count: safeCount, firstDueDate, paymentMethod }));
    setCount(safeCount);
  }

  function update(index: number, patch: Partial<FinancialInstallmentDraft>) {
    onChange(installments.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function addInstallment() {
    regenerate(Math.min(maxInstallments, installments.length + 1));
  }

  function removeInstallment(index: number) {
    const remaining = installments.filter((_, rowIndex) => rowIndex !== index);
    if (!remaining.length) return;
    const firstDueDate = remaining[0].due_date || suggestedFirstDueDate();
    const paymentMethod = remaining[0].payment_method || defaultPaymentMethod;
    onChange(buildFinancialInstallments({ total, count: remaining.length, firstDueDate, paymentMethod }));
  }

  return (
    <section className={`financial-installment-editor ${compact ? "compact" : ""}`}>
      <input type="hidden" name={inputName} value={JSON.stringify(installmentsForPayload(installments))} />
      <div className="financial-installment-head">
        <div><span>{eyebrow}</span><h3>{title}</h3><p>Primeiro vencimento sugerido em 15 dias; os demais avançam um mês.</p></div>
        <div className="financial-installment-controls">
          <label>Parcelas<input type="number" min="1" max={maxInstallments} value={count} disabled={lockCount} onChange={(event) => setCount(Number(event.target.value))} /></label>
          <button type="button" disabled={lockCount} onClick={() => regenerate(count, false)}>Gerar {Math.max(1, count)}x</button>
          <button type="button" onClick={() => regenerate(installments.length || 1)}>Redistribuir valores</button>
        </div>
      </div>

      <div className="financial-installment-list">
        {installments.map((installment, index) => (
          <article key={installment.id || `${installment.due_date}-${index}`}>
            <label>Parcela<input value={installment.label} onChange={(event) => update(index, { label: event.target.value })} /></label>
            <label>Vencimento<input type="date" value={installment.due_date} onChange={(event) => update(index, { due_date: event.target.value })} required /></label>
            <label>Valor<input type="number" min="0.01" step="0.01" value={installment.amount} onChange={(event) => update(index, { amount: Number(event.target.value) })} required /></label>
            <label>Forma<select value={installment.payment_method} onChange={(event) => update(index, { payment_method: event.target.value })}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
            <button type="button" disabled={lockCount || installments.length === 1} onClick={() => removeInstallment(index)}>Remover</button>
          </article>
        ))}
      </div>

      {!lockCount ? <button className="financial-installment-add" type="button" onClick={addInstallment} disabled={installments.length >= maxInstallments}>+ Adicionar parcela</button> : null}

      <div className={`financial-installment-balance ${summary.valid ? "ok" : "warning"}`}>
        <span>Total do lançamento <strong>{money(summary.total)}</strong></span>
        <span>Soma das parcelas <strong>{money(summary.installmentTotal)}</strong></span>
        <span>Diferença <strong>{money(summary.difference)}</strong></span>
      </div>
      {!summary.valid ? <p className="financial-installment-error">O salvamento ficará bloqueado até que todas as datas sejam válidas e a soma das parcelas coincida exatamente com o total.</p> : null}
    </section>
  );
}
