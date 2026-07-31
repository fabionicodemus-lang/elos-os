"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FinancialInstallmentEditor } from "@/components/financial-installment-editor";
import {
  buildFinancialInstallments,
  financialInstallmentSummary,
  localTodayIso,
  suggestedFirstDueDate,
  type FinancialInstallmentDraft,
} from "@/lib/financial-installments";
import { saveManualInvoice } from "./actions";

export type ManualSupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type ManualServiceOption = { id: string; code: string; description: string; unit: string };
export type ManualContractOption = { id: string; supplier_id: string; contract_number: string; title: string; status: string; current_value: number };
export type ManualMeasurementOption = {
  id: string; contract_id: string; supplier_id: string; measurement_number: string; period_start: string; period_end: string;
  status: string; gross_amount: number; net_amount: number; tax_withholding_amount: number; total_deductions: number;
};
export type ManualContractItemOption = {
  id: string; contract_id: string; service_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; contracted_quantity: number; unit_price: number;
};
export type ManualMeasurementItemOption = {
  id: string; measurement_id: string; contract_item_id: string; service_code: string; service_name: string; location_name: string | null;
  unit_snapshot: string; current_quantity: number; unit_price: number; current_amount: number;
};

export type ManualInvoiceItemDraft = {
  id: string; service_id: string; contract_item_id: string; measurement_item_id: string; description: string;
  unit: string; quantity: number; unit_price: number; discount_amount: number; notes: string;
};
export type ManualInvoiceInstallmentDraft = FinancialInstallmentDraft;
export type ManualInvoiceInitial = {
  id: string; supplier_id: string; contract_id: string | null; measurement_id: string | null; document_type: string;
  document_number: string; series: string | null; issue_date: string; competence_date: string | null; notes: string | null;
  inss_amount: number; iss_amount: number; irrf_amount: number; pis_amount: number; cofins_amount: number; csll_amount: number; other_retention_amount: number;
  items: ManualInvoiceItemDraft[]; installments: ManualInvoiceInstallmentDraft[];
};

type Props = {
  suppliers: ManualSupplierOption[];
  services: ManualServiceOption[];
  contracts: ManualContractOption[];
  measurements: ManualMeasurementOption[];
  contractItems: ManualContractItemOption[];
  measurementItems: ManualMeasurementItemOption[];
  initial?: ManualInvoiceInitial | null;
  label?: string;
  autoOpen?: boolean;
};

type RetentionKey = "inss" | "iss" | "irrf" | "pis" | "cofins" | "csll" | "other";
type Retentions = Record<RetentionKey, number>;

const typeLabels: Record<string, string> = {
  service_invoice: "Nota de serviço",
  transport: "Transporte / frete",
  rent: "Locação",
  reimbursement: "Reembolso",
  utility: "Concessionária / consumo",
  tax_document: "Guia ou documento tributário",
  receipt: "Recibo",
  other: "Outro documento",
};

function today() { return localTodayIso(); }
function uid(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function supplierName(supplier: ManualSupplierOption) { return supplier.trade_name || supplier.legal_name; }

function blankItem(): ManualInvoiceItemDraft {
  return { id: uid("item"), service_id: "", contract_item_id: "", measurement_item_id: "", description: "", unit: "un", quantity: 1, unit_price: 0, discount_amount: 0, notes: "" };
}
function blankInstallments(): ManualInvoiceInstallmentDraft[] {
  return buildFinancialInstallments({ total: 0, count: 1, firstDueDate: suggestedFirstDueDate(), paymentMethod: "Boleto" });
}
function initialRetentions(initial?: ManualInvoiceInitial | null): Retentions {
  return {
    inss: Number(initial?.inss_amount ?? 0), iss: Number(initial?.iss_amount ?? 0), irrf: Number(initial?.irrf_amount ?? 0),
    pis: Number(initial?.pis_amount ?? 0), cofins: Number(initial?.cofins_amount ?? 0), csll: Number(initial?.csll_amount ?? 0),
    other: Number(initial?.other_retention_amount ?? 0),
  };
}

export function ManualInvoiceDialog({ suppliers, services, contracts, measurements, contractItems, measurementItems, initial, label, autoOpen }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ?? "");
  const [contractId, setContractId] = useState(initial?.contract_id ?? "");
  const [measurementId, setMeasurementId] = useState(initial?.measurement_id ?? "");
  const [items, setItems] = useState<ManualInvoiceItemDraft[]>(initial?.items?.length ? initial.items : [blankItem()]);
  const [installments, setInstallments] = useState<ManualInvoiceInstallmentDraft[]>(initial?.installments?.length ? initial.installments : blankInstallments());
  const [retentions, setRetentions] = useState<Retentions>(() => initialRetentions(initial));

  useEffect(() => { if (autoOpen) dialogRef.current?.showModal(); }, [autoOpen]);

  const selectedContractItems = useMemo(() => contractItems.filter((item) => item.contract_id === contractId), [contractId, contractItems]);
  const selectedMeasurementItems = useMemo(() => measurementItems.filter((item) => item.measurement_id === measurementId), [measurementId, measurementItems]);
  const selectedMeasurements = useMemo(() => measurements.filter((measurement) => !supplierId || measurement.supplier_id === supplierId), [measurements, supplierId]);
  const selectedContracts = useMemo(() => contracts.filter((contract) => !supplierId || contract.supplier_id === supplierId), [contracts, supplierId]);

  const gross = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const itemDiscount = items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
  const totalRetentions = Object.values(retentions).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const net = Math.max(0, gross - itemDiscount - totalRetentions);
  const installmentSummary = financialInstallmentSummary(net, installments);

  function updateItem(index: number, patch: Partial<ManualInvoiceItemDraft>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function chooseSupplier(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    const contract = contracts.find((row) => row.id === contractId);
    if (contract && contract.supplier_id !== nextSupplierId) {
      setContractId(""); setMeasurementId("");
      setItems((current) => current.map((item) => ({ ...item, contract_item_id: "", measurement_item_id: "" })));
    }
  }

  function chooseContract(nextContractId: string) {
    setContractId(nextContractId);
    setMeasurementId("");
    const contract = contracts.find((row) => row.id === nextContractId);
    if (contract) setSupplierId(contract.supplier_id);
    setItems((current) => current.map((item) => ({ ...item, contract_item_id: "", measurement_item_id: "" })));
  }

  function chooseMeasurement(nextMeasurementId: string) {
    setMeasurementId(nextMeasurementId);
    const measurement = measurements.find((row) => row.id === nextMeasurementId);
    if (!measurement) return;
    setSupplierId(measurement.supplier_id);
    setContractId(measurement.contract_id);
    const rows = measurementItems.filter((row) => row.measurement_id === nextMeasurementId);
    if (rows.length) {
      setItems(rows.map((row) => {
        const contractItem = contractItems.find((candidate) => candidate.id === row.contract_item_id);
        return {
          id: uid("item"), service_id: contractItem?.service_id ?? "", contract_item_id: row.contract_item_id,
          measurement_item_id: row.id, description: `${row.service_name}${row.location_name ? ` · ${row.location_name}` : ""}`,
          unit: row.unit_snapshot, quantity: Number(row.current_quantity), unit_price: Number(row.unit_price), discount_amount: 0, notes: "",
        };
      }));
    }
    setRetentions({ inss: 0, iss: 0, irrf: 0, pis: 0, cofins: 0, csll: 0, other: Number(measurement.total_deductions || 0) });
    setInstallments(buildFinancialInstallments({ total: Number(measurement.net_amount || 0), count: 1, firstDueDate: suggestedFirstDueDate(), paymentMethod: "Boleto" }));
  }

  function chooseContractItem(index: number, contractItemId: string) {
    const row = contractItems.find((item) => item.id === contractItemId);
    if (!row) { updateItem(index, { contract_item_id: "", measurement_item_id: "" }); return; }
    updateItem(index, {
      contract_item_id: row.id, measurement_item_id: "", service_id: row.service_id,
      description: `${row.service_name}${row.location_name ? ` · ${row.location_name}` : ""}`,
      unit: row.unit_snapshot, unit_price: Number(row.unit_price),
    });
  }

  function chooseMeasurementItem(index: number, measurementItemId: string) {
    const row = measurementItems.find((item) => item.id === measurementItemId);
    const contractItem = row ? contractItems.find((item) => item.id === row.contract_item_id) : null;
    if (!row || !contractItem) { updateItem(index, { measurement_item_id: "" }); return; }
    updateItem(index, {
      measurement_item_id: row.id, contract_item_id: row.contract_item_id, service_id: contractItem.service_id,
      description: `${row.service_name}${row.location_name ? ` · ${row.location_name}` : ""}`,
      unit: row.unit_snapshot, quantity: Number(row.current_quantity), unit_price: Number(row.unit_price),
    });
  }

  const canSave = installmentSummary.valid && net > 0 && Boolean(supplierId);

  return <>
    <button className="elos-button manual-invoice-open" type="button" onClick={() => dialogRef.current?.showModal()}>{label ?? "+ Nova nota manual"}</button>
    <dialog ref={dialogRef} className="manual-invoice-dialog">
      <form action={saveManualInvoice}>
        <input type="hidden" name="invoice_id" value={initial?.id ?? ""} />
        <input type="hidden" name="items_json" value={JSON.stringify(items.map(({ id: _id, ...item }) => item))} />
        <div className="manual-dialog-head">
          <div><span>Financeiro · Documentos</span><h2>{initial ? `Editar ${initial.document_number}` : "Nova nota manual"}</h2><p>Classifique os serviços, retenções e parcelas antes de enviar para aprovação.</p></div>
          <button type="button" aria-label="Fechar" onClick={() => dialogRef.current?.close()}>×</button>
        </div>
        <div className="manual-dialog-body">
          <section className="manual-form-section">
            <div className="manual-section-title"><div><span>Identificação</span><h3>Documento e fornecedor</h3></div></div>
            <div className="manual-form-grid">
              <label>Tipo de documento<select name="document_type" defaultValue={initial?.document_type ?? "service_invoice"}>{Object.entries(typeLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <label>Número<input name="document_number" defaultValue={initial?.document_number ?? ""} required /></label>
              <label>Série<input name="series" defaultValue={initial?.series ?? ""} /></label>
              <label>Emissão<input name="issue_date" type="date" defaultValue={initial?.issue_date ?? today()} required /></label>
              <label>Competência<input name="competence_date" type="date" defaultValue={initial?.competence_date ?? today()} /></label>
              <label className="wide">Fornecedor<select name="supplier_id" value={supplierId} onChange={(event) => chooseSupplier(event.target.value)} required><option value="">Selecione o fornecedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplierName(supplier)}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</option>)}</select></label>
              <label>Contrato<select name="contract_id" value={contractId} onChange={(event) => chooseContract(event.target.value)}><option value="">Sem vínculo contratual</option>{selectedContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title}</option>)}</select></label>
              <label>Medição aprovada<select name="measurement_id" value={measurementId} onChange={(event) => chooseMeasurement(event.target.value)}><option value="">Sem vínculo com medição</option>{selectedMeasurements.map((measurement) => <option key={measurement.id} value={measurement.id}>{measurement.measurement_number} · {money(measurement.net_amount)}</option>)}</select></label>
              <label className="wide">Observações<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} placeholder="Contrato, medição, referência fiscal ou observação" /></label>
            </div>
          </section>

          <section className="manual-form-section">
            <div className="manual-section-title"><div><span>Rateio orçamentário</span><h3>Itens e centros de custo</h3></div><button type="button" onClick={() => setItems((current) => [...current, blankItem()])}>+ Adicionar item</button></div>
            <div className="manual-item-list">
              {items.map((item, index) => {
                const itemGross = Number(item.quantity || 0) * Number(item.unit_price || 0);
                const itemTotal = Math.max(0, itemGross - Number(item.discount_amount || 0));
                return <article key={item.id} className="manual-item-card">
                  <div className="manual-item-number">{index + 1}</div>
                  <div className="manual-item-fields">
                    <label className="service">Serviço / centro de custo<select value={item.service_id} onChange={(event) => updateItem(index, { service_id: event.target.value })} required><option value="">Selecione o serviço</option>{services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description}</option>)}</select></label>
                    <label>Item do contrato<select value={item.contract_item_id} disabled={!contractId} onChange={(event) => chooseContractItem(index, event.target.value)}><option value="">Sem vínculo</option>{selectedContractItems.map((row) => <option key={row.id} value={row.id}>{row.service_code} · {row.service_name}{row.location_name ? ` · ${row.location_name}` : ""}</option>)}</select></label>
                    <label>Item da medição<select value={item.measurement_item_id} disabled={!measurementId} onChange={(event) => chooseMeasurementItem(index, event.target.value)}><option value="">Sem vínculo</option>{selectedMeasurementItems.map((row) => <option key={row.id} value={row.id}>{row.service_code} · {row.service_name}{row.location_name ? ` · ${row.location_name}` : ""}</option>)}</select></label>
                    <label className="description">Descrição complementar<input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /></label>
                    <label>Unidade<input value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} required /></label>
                    <label>Quantidade<input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })} required /></label>
                    <label>Valor unitário<input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => updateItem(index, { unit_price: Number(event.target.value) })} required /></label>
                    <label>Desconto<input type="number" min="0" step="0.01" value={item.discount_amount} onChange={(event) => updateItem(index, { discount_amount: Number(event.target.value) })} /></label>
                    <div className="manual-item-total"><span>Total</span><strong>{money(itemTotal)}</strong><small>{number(item.quantity)} × {money(item.unit_price)}</small></div>
                  </div>
                  <button className="manual-remove" type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </article>;
              })}
            </div>
          </section>

          <section className="manual-values-grid">
            <article className="manual-form-section">
              <div className="manual-section-title"><div><span>Tributos e deduções</span><h3>Retenções</h3></div><strong>{money(totalRetentions)}</strong></div>
              <div className="manual-retention-grid">
                {([['inss','INSS'],['iss','ISS'],['irrf','IRRF'],['pis','PIS'],['cofins','COFINS'],['csll','CSLL'],['other','Outras retenções / descontos']] as [RetentionKey,string][]).map(([key, text]) => <label key={key}>{text}<input name={`retention_${key}`} type="number" min="0" step="0.01" value={retentions[key]} onChange={(event) => setRetentions((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
              </div>
            </article>
            <article className="manual-total-card">
              <span>Resumo do documento</span>
              <dl><div><dt>Valor bruto</dt><dd>{money(gross)}</dd></div><div><dt>Descontos nos itens</dt><dd>- {money(itemDiscount)}</dd></div><div><dt>Retenções</dt><dd>- {money(totalRetentions)}</dd></div><div className="net"><dt>Valor líquido</dt><dd>{money(net)}</dd></div></dl>
            </article>
          </section>

          <FinancialInstallmentEditor
            total={net}
            installments={installments}
            onChange={setInstallments}
            inputName="installments_json"
            eyebrow="Contas a pagar"
            title="Programação das parcelas"
            lockCount={Boolean(measurementId)}
          />
          {measurementId ? <p className="manual-alert">A medição vinculada mantém uma única parcela. A data e o valor continuam editáveis, mas o valor precisa fechar com o líquido aprovado.</p> : null}
        </div>
        <div className="manual-dialog-foot">
          <button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button>
          <button type="submit" name="submit_mode" value="draft" disabled={!canSave}>Salvar rascunho</button>
          <button className="primary" type="submit" name="submit_mode" value="submit" disabled={!canSave}>Salvar e enviar para aprovação</button>
        </div>
      </form>
    </dialog>
  </>;
}
