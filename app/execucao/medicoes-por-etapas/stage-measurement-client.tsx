"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveStageMeasurement } from "./actions";

export type StageMeasurementContract = {
  id: string; contract_number: string; title: string; supplier_id: string; supplier_name: string; start_date: string; end_date: string;
  status: string; current_value: number; measured_value: number; retention_percent: number; guarantee_percent: number; payment_days: number;
};
export type MeasurementStage = {
  id: string; contract_id: string; contract_item_id: string; service_code: string; service_name: string; location_name: string | null;
  stage_code: string; stage_name: string; description: string | null; measurement_mode: "quantity" | "percent"; weight_percent: number;
  unit_snapshot: string; contracted_quantity: number; unit_price: number; total_value: number; measured_quantity: number; measured_value: number;
};
export type StageMeasurementRecord = {
  id: string; contract_id: string; period_start: string; period_end: string; status: string; tax_withholding_amount: number;
  advance_deduction_amount: number; other_discount_amount: number; notes: string | null; contractor_notes: string | null;
};
export type StageMeasurementItemRecord = { contract_stage_id: string | null; current_quantity: number; notes: string | null };

type Row = MeasurementStage & { current_quantity: number; notes: string };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function monthRange() {
  const date = new Date(); const year = date.getFullYear(); const month = date.getMonth();
  const start = new Date(year, month, 1); const end = new Date(year, month + 1, 0);
  const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start: format(start), end: format(end) };
}

export function StageMeasurementDialog({ contracts, stages, measurement, measurementItems = [], selectedContractId, autoOpen = false, label }: {
  contracts: StageMeasurementContract[]; stages: MeasurementStage[]; measurement?: StageMeasurementRecord | null;
  measurementItems?: StageMeasurementItemRecord[]; selectedContractId?: string; autoOpen?: boolean; label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const range = useMemo(() => monthRange(), []);
  const initialContractId = measurement?.contract_id ?? selectedContractId ?? contracts[0]?.id ?? "";
  const [contractId, setContractId] = useState(initialContractId);
  const [rows, setRows] = useState<Row[]>([]);
  const [tax, setTax] = useState(Number(measurement?.tax_withholding_amount ?? 0));
  const [advance, setAdvance] = useState(Number(measurement?.advance_deduction_amount ?? 0));
  const [other, setOther] = useState(Number(measurement?.other_discount_amount ?? 0));
  const editMap = useMemo(() => new Map(measurementItems.filter((item) => item.contract_stage_id).map((item) => [item.contract_stage_id!, item])), [measurementItems]);
  const selectedContract = contracts.find((contract) => contract.id === contractId) ?? null;

  useEffect(() => {
    setRows(stages.filter((stage) => stage.contract_id === contractId).map((stage) => ({
      ...stage,
      current_quantity: Number(editMap.get(stage.id)?.current_quantity ?? 0),
      notes: editMap.get(stage.id)?.notes ?? "",
    })));
  }, [contractId, stages, editMap]);
  useEffect(() => { if (autoOpen) dialog.current?.showModal(); }, [autoOpen]);

  const gross = rows.reduce((sum, row) => sum + Number(row.current_quantity || 0) * Number(row.unit_price || 0), 0);
  const contractualRetention = gross * Number(selectedContract?.retention_percent ?? 0) / 100;
  const guaranteeRetention = gross * Number(selectedContract?.guarantee_percent ?? 0) / 100;
  const deductions = contractualRetention + guaranteeRetention + tax + advance + other;
  const net = Math.max(0, gross - deductions);
  const payload = rows.filter((row) => Number(row.current_quantity) > 0).map((row) => ({ stage_id: row.id, current_quantity: row.current_quantity, notes: row.notes || null }));
  function updateRow(id: string, patch: Partial<Row>) { setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row)); }

  return <>
    <button className="elos-button" type="button" disabled={!contracts.length} onClick={() => dialog.current?.showModal()}>{label ?? (measurement ? "Editar medição" : "+ Nova medição por etapas")}</button>
    <dialog ref={dialog} className="stage-measurement-dialog">
      <form action={saveStageMeasurement}>
        <input type="hidden" name="measurement_id" value={measurement?.id ?? ""} />
        <input type="hidden" name="items_json" value={JSON.stringify(payload)} />
        <header><div><span>Execução · Contratos</span><h2>{measurement ? "Editar medição por etapas" : "Nova medição por etapas"}</h2><p>Meça chapisco, reboco, requadros ou qualquer etapa configurada no contrato.</p></div><button type="button" onClick={() => dialog.current?.close()}>×</button></header>
        <div className="stage-measurement-body">
          <section className="stage-measurement-form-grid">
            <label className="span2">Contrato<select name="contract_id" value={contractId} onChange={(event) => setContractId(event.target.value)} disabled={Boolean(measurement)} required><option value="">Selecione</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title} · {contract.supplier_name}</option>)}</select>{measurement ? <input type="hidden" name="contract_id" value={contractId} /> : null}</label>
            <label>Início do período<input name="period_start" type="date" defaultValue={measurement?.period_start ?? range.start} min={selectedContract?.start_date} max={selectedContract?.end_date} required /></label>
            <label>Fim do período<input name="period_end" type="date" defaultValue={measurement?.period_end ?? range.end} min={selectedContract?.start_date} max={selectedContract?.end_date} required /></label>
            <div className="stage-contract-summary span4"><div><span>Fornecedor</span><strong>{selectedContract?.supplier_name ?? "—"}</strong></div><div><span>Valor atualizado</span><strong>{money(selectedContract?.current_value ?? 0)}</strong></div><div><span>Já medido</span><strong>{money(selectedContract?.measured_value ?? 0)}</strong></div><div><span>Saldo contratual</span><strong>{money(Math.max(0, Number(selectedContract?.current_value ?? 0) - Number(selectedContract?.measured_value ?? 0)))}</strong></div></div>
          </section>

          <section className="stage-measurement-items">
            <div className="stage-measurement-title"><div><span>Boletim</span><h3>Produção executada por etapa</h3></div><strong>{money(gross)}</strong></div>
            <div className="stage-measurement-head"><span>Serviço / etapa</span><span>Valor da etapa</span><span>Aprovado anterior</span><span>Saldo</span><span>Medir agora</span><span>Valor atual</span><span>Acumulado</span></div>
            <div className="stage-measurement-list">{rows.map((row) => {
              const remaining = Math.max(0, Number(row.contracted_quantity) - Number(row.measured_quantity));
              const accumulated = Number(row.measured_quantity) + Number(row.current_quantity || 0);
              const progress = row.contracted_quantity ? accumulated / Number(row.contracted_quantity) * 100 : 0;
              return <article key={row.id} className={row.current_quantity > 0 ? "measured" : ""}>
                <div><strong>{row.service_code} · {row.service_name}</strong><b>{row.stage_code} · {row.stage_name} · {number(row.weight_percent, 2)}%</b><span>{row.location_name || "Todos / geral"}</span>{row.description ? <small>{row.description}</small> : null}<input value={row.notes} onChange={(event) => updateRow(row.id, { notes: event.target.value })} placeholder="Observação desta etapa" /></div>
                <div><strong>{money(row.total_value)}</strong><span>{number(row.contracted_quantity)} {row.unit_snapshot}</span></div>
                <div><strong>{number(row.measured_quantity)} {row.unit_snapshot}</strong><span>{money(row.measured_value)}</span></div>
                <div><strong>{number(remaining)} {row.unit_snapshot}</strong><span>{money(remaining * row.unit_price)}</span></div>
                <div><input type="number" min="0" max={remaining} step="0.000001" value={row.current_quantity} onChange={(event) => updateRow(row.id, { current_quantity: Math.min(remaining, Math.max(0, Number(event.target.value))) })} /><span>{row.unit_snapshot}</span></div>
                <div><strong>{money(row.current_quantity * row.unit_price)}</strong><span>{money(row.unit_price)} / {row.unit_snapshot}</span></div>
                <div><strong>{number(accumulated)} {row.unit_snapshot}</strong><span>{number(progress, 1)}%</span></div>
              </article>;
            })}{!rows.length ? <div className="stage-measurement-empty">O contrato não possui etapas configuradas.</div> : null}</div>
          </section>

          <section className="stage-deductions-grid">
            <div><span>Retenções e descontos</span><h3>Composição do valor líquido</h3><label>Retenção contratual<input value={`${number(selectedContract?.retention_percent ?? 0, 2)}% · ${money(contractualRetention)}`} readOnly /></label><label>Garantia retida<input value={`${number(selectedContract?.guarantee_percent ?? 0, 2)}% · ${money(guaranteeRetention)}`} readOnly /></label><label>Retenções tributárias<input name="tax_withholding_amount" type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(Math.max(0, Number(event.target.value)))} /></label><label>Desconto de adiantamento<input name="advance_deduction_amount" type="number" min="0" step="0.01" value={advance} onChange={(event) => setAdvance(Math.max(0, Number(event.target.value)))} /></label><label>Outros descontos<input name="other_discount_amount" type="number" min="0" step="0.01" value={other} onChange={(event) => setOther(Math.max(0, Number(event.target.value)))} /></label></div>
            <aside><span>Valor bruto</span><strong>{money(gross)}</strong><div><span>Total de deduções</span><b>{money(deductions)}</b></div><div className="net"><span>Valor líquido</span><b>{money(net)}</b></div>{deductions > gross ? <small>As deduções não podem superar o valor medido.</small> : null}</aside>
          </section>

          <section className="stage-measurement-form-grid notes"><label className="span2">Observações internas<textarea name="notes" rows={3} defaultValue={measurement?.notes ?? ""} /></label><label className="span2">Observações do prestador<textarea name="contractor_notes" rows={3} defaultValue={measurement?.contractor_notes ?? ""} /></label></section>
        </div>
        <footer><div><small>{payload.length} etapa(s) informada(s)</small><strong>{money(net)} líquido</strong></div><div><button type="button" onClick={() => dialog.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!payload.length || gross <= 0 || deductions > gross}>Salvar medição</button></div></footer>
      </form>
    </dialog>
  </>;
}
