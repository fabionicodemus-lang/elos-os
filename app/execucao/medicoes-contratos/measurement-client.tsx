"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveContractMeasurement } from "./actions";

export type MeasurementContract = {
  id: string; contract_number: string; title: string; supplier_id: string; supplier_name: string;
  start_date: string; end_date: string; status: string; current_value: number; measured_value: number;
  retention_percent: number; guarantee_percent: number; payment_days: number;
};
export type MeasurementContractItem = {
  id: string; contract_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; contracted_quantity: number; measured_quantity: number; unit_price: number; measured_value: number;
};
export type MeasurementRecord = {
  id: string; contract_id: string; period_start: string; period_end: string; status: string;
  tax_withholding_amount: number; advance_deduction_amount: number; other_discount_amount: number;
  notes: string | null; contractor_notes: string | null;
};
export type MeasurementItemRecord = { contract_item_id: string; current_quantity: number; notes: string | null };

type Row = MeasurementContractItem & { current_quantity: number; notes: string };

function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function monthRange() {
  const date = new Date();
  const year = date.getFullYear(); const month = date.getMonth();
  const start = new Date(year, month, 1); const end = new Date(year, month + 1, 0);
  const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start: format(start), end: format(end) };
}

export function ContractMeasurementDialog({ contracts, contractItems, measurement, measurementItems = [], autoOpen = false, label }: {
  contracts: MeasurementContract[]; contractItems: MeasurementContractItem[]; measurement?: MeasurementRecord | null;
  measurementItems?: MeasurementItemRecord[]; autoOpen?: boolean; label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const range = useMemo(() => monthRange(), []);
  const initialContractId = measurement?.contract_id ?? contracts[0]?.id ?? "";
  const [contractId, setContractId] = useState(initialContractId);
  const [rows, setRows] = useState<Row[]>([]);
  const [tax, setTax] = useState(Number(measurement?.tax_withholding_amount ?? 0));
  const [advance, setAdvance] = useState(Number(measurement?.advance_deduction_amount ?? 0));
  const [other, setOther] = useState(Number(measurement?.other_discount_amount ?? 0));
  const editMap = useMemo(() => new Map(measurementItems.map((item) => [item.contract_item_id, item])), [measurementItems]);
  const selectedContract = contracts.find((contract) => contract.id === contractId) ?? null;

  useEffect(() => {
    const selected = contractItems.filter((item) => item.contract_id === contractId).map((item) => ({
      ...item,
      current_quantity: Number(editMap.get(item.id)?.current_quantity ?? 0),
      notes: editMap.get(item.id)?.notes ?? "",
    }));
    setRows(selected);
  }, [contractId, contractItems, editMap]);
  useEffect(() => { if (autoOpen) dialog.current?.showModal(); }, [autoOpen]);

  const gross = rows.reduce((sum, row) => sum + Number(row.current_quantity || 0) * Number(row.unit_price || 0), 0);
  const contractualRetention = gross * Number(selectedContract?.retention_percent ?? 0) / 100;
  const guaranteeRetention = gross * Number(selectedContract?.guarantee_percent ?? 0) / 100;
  const deductions = contractualRetention + guaranteeRetention + tax + advance + other;
  const net = Math.max(0, gross - deductions);
  const payload = rows.filter((row) => Number(row.current_quantity) > 0).map((row) => ({ contract_item_id: row.id, current_quantity: row.current_quantity, notes: row.notes || null }));

  function updateRow(id: string, patch: Partial<Row>) { setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row)); }

  return <>
    <button className="elos-button measurement-main-button" type="button" disabled={!contracts.length} onClick={() => dialog.current?.showModal()}>{label ?? (measurement ? "Editar medição" : "+ Nova medição")}</button>
    <dialog ref={dialog} className="measurement-dialog">
      <form action={saveContractMeasurement}>
        <input type="hidden" name="measurement_id" value={measurement?.id ?? ""} />
        <input type="hidden" name="items_json" value={JSON.stringify(payload)} />
        <div className="measurement-dialog-head"><div><span>Execução · Contratos</span><h2>{measurement ? "Editar medição" : "Nova medição contratual"}</h2><p>Informe o executado no período. O acumulado considera somente medições já aprovadas.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="measurement-dialog-body">
          <section className="measurement-form-grid">
            <label className="span2">Contrato<select name="contract_id" value={contractId} onChange={(event) => setContractId(event.target.value)} disabled={Boolean(measurement)} required><option value="">Selecione</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title} · {contract.supplier_name}</option>)}</select>{measurement ? <input type="hidden" name="contract_id" value={contractId} /> : null}</label>
            <label>Início do período<input name="period_start" type="date" defaultValue={measurement?.period_start ?? range.start} min={selectedContract?.start_date} max={selectedContract?.end_date} required /></label>
            <label>Fim do período<input name="period_end" type="date" defaultValue={measurement?.period_end ?? range.end} min={selectedContract?.start_date} max={selectedContract?.end_date} required /></label>
            <div className="measurement-contract-summary span4"><div><span>Fornecedor</span><strong>{selectedContract?.supplier_name ?? "—"}</strong></div><div><span>Valor atualizado</span><strong>{money(selectedContract?.current_value ?? 0)}</strong></div><div><span>Já medido</span><strong>{money(selectedContract?.measured_value ?? 0)}</strong></div><div><span>Saldo</span><strong>{money(Math.max(0, Number(selectedContract?.current_value ?? 0) - Number(selectedContract?.measured_value ?? 0)))}</strong></div></div>
          </section>

          <section className="measurement-items-section">
            <div className="measurement-section-title"><div><span>Boletim de medição</span><h3>Quantidades executadas no período</h3></div><strong>{money(gross)}</strong></div>
            <div className="measurement-items-head"><span>Serviço / local</span><span>Contratado</span><span>Aprovado anterior</span><span>Saldo</span><span>Medir agora</span><span>Valor atual</span><span>Acumulado</span></div>
            <div className="measurement-items-list">{rows.map((row) => {
              const remaining = Math.max(0, Number(row.contracted_quantity) - Number(row.measured_quantity));
              const accumulated = Number(row.measured_quantity) + Number(row.current_quantity || 0);
              const progress = row.contracted_quantity ? accumulated / Number(row.contracted_quantity) * 100 : 0;
              return <article key={row.id} className={row.current_quantity > 0 ? "measured" : ""}>
                <div><strong>{row.service_code} · {row.service_name}</strong><span>{row.location_name || "Todos / não definido"}</span><input value={row.notes} onChange={(event) => updateRow(row.id, { notes: event.target.value })} placeholder="Observação deste item" /></div>
                <div><strong>{number(row.contracted_quantity)} {row.unit_snapshot}</strong><span>{money(row.contracted_quantity * row.unit_price)}</span></div>
                <div><strong>{number(row.measured_quantity)} {row.unit_snapshot}</strong><span>{money(row.measured_value)}</span></div>
                <div><strong>{number(remaining)} {row.unit_snapshot}</strong><span>{money(remaining * row.unit_price)}</span></div>
                <div><input type="number" min="0" max={remaining} step="0.000001" value={row.current_quantity} onChange={(event) => updateRow(row.id, { current_quantity: Math.min(remaining, Math.max(0, Number(event.target.value))) })} /><span>{row.unit_snapshot}</span></div>
                <div><strong>{money(row.current_quantity * row.unit_price)}</strong><span>{money(row.unit_price)} / {row.unit_snapshot}</span></div>
                <div><strong>{number(accumulated)} {row.unit_snapshot}</strong><span>{number(progress, 1)}%</span></div>
              </article>;
            })}{!rows.length ? <div className="measurement-no-items">O contrato não possui itens disponíveis para medição.</div> : null}</div>
          </section>

          <section className="measurement-deductions-grid">
            <div className="measurement-deductions-form"><div><span>Retenções e descontos</span><h3>Composição do valor líquido</h3></div><label>Retenção contratual<input value={`${number(selectedContract?.retention_percent ?? 0, 2)}% · ${money(contractualRetention)}`} readOnly /></label><label>Garantia retida<input value={`${number(selectedContract?.guarantee_percent ?? 0, 2)}% · ${money(guaranteeRetention)}`} readOnly /></label><label>Retenções tributárias<input name="tax_withholding_amount" type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(Math.max(0, Number(event.target.value)))} /></label><label>Desconto de adiantamento<input name="advance_deduction_amount" type="number" min="0" step="0.01" value={advance} onChange={(event) => setAdvance(Math.max(0, Number(event.target.value)))} /></label><label>Outros descontos<input name="other_discount_amount" type="number" min="0" step="0.01" value={other} onChange={(event) => setOther(Math.max(0, Number(event.target.value)))} /></label></div>
            <div className="measurement-total-card"><span>Valor bruto</span><strong>{money(gross)}</strong><div><span>Total de deduções</span><b>{money(deductions)}</b></div><div className="net"><span>Valor líquido</span><b>{money(net)}</b></div>{deductions > gross ? <small>As deduções não podem superar o valor medido.</small> : null}</div>
          </section>

          <section className="measurement-form-grid notes"><label className="span2">Observações internas<textarea name="notes" rows={3} defaultValue={measurement?.notes ?? ""} placeholder="Critérios, verificações e comentários da fiscalização." /></label><label className="span2">Observações do prestador<textarea name="contractor_notes" rows={3} defaultValue={measurement?.contractor_notes ?? ""} placeholder="Ressalvas apresentadas pelo prestador ou informações do boletim." /></label></section>
        </div>
        <div className="measurement-dialog-foot"><div><small>{payload.length} item(ns) com quantidade informada</small><strong>{money(net)} líquido</strong></div><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!payload.length || gross <= 0 || deductions > gross}>Salvar medição</button></div></div>
      </form>
    </dialog>
  </>;
}
