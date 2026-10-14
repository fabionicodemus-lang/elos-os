"use client";

import { useMemo, useState } from "react";
import { executeRenegotiation } from "./actions";

type IndexOption = { id: string; code: string; name: string };
type Row = {
  key: string;
  category: string;
  description: string;
  due_date: string;
  amount: string;
  correction_index_id: string;
  interest_rate_monthly: string;
};

type InitialRow = Omit<Row, "key">;

const categories = [
  ["entry", "Entrada"],
  ["monthly", "Mensal"],
  ["reinforcement", "Reforço"],
  ["keys", "Chaves"],
  ["post_keys", "Pós-chaves"],
  ["other", "Outro"],
] as const;

function parseMoney(value: string) {
  const raw = value.trim().replace(/\s/g, "");
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
function nextMonth(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

export function RenegotiationBuilder({
  saleId,
  currentOpen,
  initialRows,
  indices,
}: {
  saleId: string;
  currentOpen: number;
  initialRows: InitialRow[];
  indices: IndexOption[];
}) {
  const [impact, setImpact] = useState("0");
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((row, index) => ({ ...row, key: `initial-${index}` })));
  const newTotal = useMemo(() => rows.reduce((sum, row) => sum + parseMoney(row.amount), 0), [rows]);
  const expected = currentOpen + parseMoney(impact);
  const difference = newTotal - expected;

  function update(key: string, field: keyof Omit<Row, "key">, value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }
  function addRow() {
    const last = rows.at(-1);
    setRows((current) => [...current, {
      key: `new-${Date.now()}-${current.length}`,
      category: "monthly",
      description: `Renegociação ${current.length + 1}`,
      due_date: nextMonth(last?.due_date ?? new Date().toISOString().slice(0, 10)),
      amount: "0",
      correction_index_id: last?.correction_index_id ?? "",
      interest_rate_monthly: last?.interest_rate_monthly ?? "",
    }]);
  }
  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  const serialized = JSON.stringify(rows.map((row, index) => ({
    category: row.category,
    description: row.description,
    due_date: row.due_date,
    amount: Number(parseMoney(row.amount).toFixed(2)),
    correction_index_id: row.correction_index_id || null,
    interest_rate_monthly: row.interest_rate_monthly ? parseMoney(row.interest_rate_monthly) : null,
    sequence_number: index + 1,
    sequence_total: rows.length,
  })));

  return <form action={executeRenegotiation} className="registry-form-grid">
    <input type="hidden" name="sale_id" value={saleId} />
    <input type="hidden" name="items_json" value={serialized} />
    <label>
      Vigência do aditivo
      <input name="effective_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
    </label>
    <label>
      Impacto financeiro no contrato
      <input name="financial_impact" inputMode="decimal" value={impact} onChange={(event) => setImpact(event.target.value)} required />
      <small>Use valor negativo para desconto e positivo para acréscimo.</small>
    </label>
    <label className="registry-wide">
      Motivo da renegociação
      <input name="reason" minLength={5} required placeholder="Ex.: reprogramação de fluxo aprovada com o cliente" />
    </label>

    <div className="registry-wide finance-summary-grid">
      <article><span>Saldo aberto atual</span><strong>{brl(currentOpen)}</strong></article>
      <article><span>Impacto</span><strong>{brl(parseMoney(impact))}</strong></article>
      <article><span>Novo plano precisa somar</span><strong>{brl(expected)}</strong></article>
      <article><span>Novo plano informado</span><strong>{brl(newTotal)}</strong><small>{Math.abs(difference) < 0.01 ? "Valores conferem" : `Diferença ${brl(difference)}`}</small></article>
    </div>

    <div className="registry-wide registry-table-wrap">
      <table>
        <thead><tr><th>#</th><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Índice</th><th>Juros a.m.</th><th></th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.key}>
          <td>{index + 1}</td>
          <td><select value={row.category} onChange={(event) => update(row.key, "category", event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
          <td><input value={row.description} onChange={(event) => update(row.key, "description", event.target.value)} required /></td>
          <td><input type="date" value={row.due_date} onChange={(event) => update(row.key, "due_date", event.target.value)} required /></td>
          <td><input inputMode="decimal" value={row.amount} onChange={(event) => update(row.key, "amount", event.target.value)} required /></td>
          <td><select value={row.correction_index_id} onChange={(event) => update(row.key, "correction_index_id", event.target.value)}><option value="">Sem correção</option>{indices.map((indexOption) => <option key={indexOption.id} value={indexOption.id}>{indexOption.code}</option>)}</select></td>
          <td><input inputMode="decimal" value={row.interest_rate_monthly} onChange={(event) => update(row.key, "interest_rate_monthly", event.target.value)} placeholder="0" /></td>
          <td><button type="button" onClick={() => removeRow(row.key)} disabled={rows.length <= 1}>Remover</button></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="registry-wide elos-page-actions">
      <button type="button" onClick={addRow}>+ Adicionar parcela</button>
      <button className="auth-primary" type="submit" disabled={rows.length < 1 || Math.abs(difference) >= 0.01}>Executar renegociação</button>
    </div>
    <p className="registry-wide"><strong>Atenção:</strong> ao executar, as parcelas abertas atuais são canceladas e substituídas pelo novo fluxo. Parcelas já pagas permanecem intactas. Se existir pagamento parcial em parcela ainda aberta, o Elos bloqueia a operação.</p>
  </form>;
}
