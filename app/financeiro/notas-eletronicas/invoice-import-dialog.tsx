"use client";

import { useMemo, useRef, useState } from "react";
import { normalizeMatchText, normalizeTaxId, parseNfeXml, type ParsedNfe } from "@/lib/nfe-xml";
import { importElectronicInvoice } from "./actions";

export type InvoiceSupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type InvoiceInputOption = { id: string; code: string; description: string; unit: string; category: string };
export type InvoiceOrderOption = { id: string; supplier_id: string; order_number: string; status: string; total_amount: number; issue_date: string | null; expected_delivery_date: string | null };
export type InvoiceOrderItemOption = { id: string; order_id: string; input_id: string; cost_center_service_id: string | null; input_code: string; input_name: string; unit_snapshot: string; ordered_quantity: number; unit_price: number; total_amount: number };
export type InvoiceReceiptOption = { id: string; order_id: string; supplier_id: string; receipt_number: string; status: string; receipt_date: string; invoice_number: string | null; invoice_access_key: string | null; invoice_amount: number | null };
export type InvoiceReceiptItemOption = { id: string; receipt_id: string; order_item_id: string; input_id: string; cost_center_service_id: string | null; input_code: string; input_name: string; unit_snapshot: string; accepted_quantity: number; unit_cost: number; accepted_amount: number };
export type InvoiceLegalEntityOption = { legal_name: string; trade_name: string | null; cnpj: string | null };

type Mapping = {
  line_number: number;
  input_id: string;
  order_item_id: string;
  receipt_item_id: string;
  cost_center_service_id: string;
  notes: string;
};

type Installment = { number: string; due_date: string; amount: number; payment_method: string };

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function dateBR(value?: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function bestInput(item: ParsedNfe["items"][number], inputs: InvoiceInputOption[]) {
  const code = normalizeMatchText(item.supplierCode);
  const description = normalizeMatchText(item.description);
  return inputs.find((input) => code && normalizeMatchText(input.code) === code)
    ?? inputs.find((input) => normalizeMatchText(input.description) === description)
    ?? inputs.find((input) => {
      const inputText = normalizeMatchText(input.description);
      return description.length > 10 && (inputText.includes(description) || description.includes(inputText));
    })
    ?? null;
}

function blankMappings(parsed: ParsedNfe, inputs: InvoiceInputOption[]): Mapping[] {
  return parsed.items.map((item) => {
    const input = bestInput(item, inputs);
    return { line_number: item.lineNumber, input_id: input?.id ?? "", order_item_id: "", receipt_item_id: "", cost_center_service_id: "", notes: "" };
  });
}

export function InvoiceImportDialog({ suppliers, inputs, orders, orderItems, receipts, receiptItems, legalEntity }: {
  suppliers: InvoiceSupplierOption[];
  inputs: InvoiceInputOption[];
  orders: InvoiceOrderOption[];
  orderItems: InvoiceOrderItemOption[];
  receipts: InvoiceReceiptOption[];
  receiptItems: InvoiceReceiptItemOption[];
  legalEntity: InvoiceLegalEntityOption | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedNfe | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [orderId, setOrderId] = useState("");
  const [receiptId, setReceiptId] = useState("");

  const issuerSupplier = useMemo(() => parsed ? suppliers.find((supplier) => normalizeTaxId(supplier.tax_id) === normalizeTaxId(parsed.issuer.taxId)) ?? null : null, [parsed, suppliers]);
  const candidateOrders = useMemo(() => issuerSupplier ? orders.filter((order) => order.supplier_id === issuerSupplier.id) : orders, [issuerSupplier, orders]);
  const candidateReceipts = useMemo(() => receipts.filter((receipt) => (!issuerSupplier || receipt.supplier_id === issuerSupplier.id) && (!orderId || receipt.order_id === orderId)), [receipts, issuerSupplier, orderId]);
  const selectedOrderItems = useMemo(() => orderItems.filter((item) => item.order_id === orderId), [orderItems, orderId]);
  const selectedReceiptItems = useMemo(() => receiptItems.filter((item) => item.receipt_id === receiptId), [receiptItems, receiptId]);
  const legalEntityMatches = parsed && legalEntity?.cnpj ? normalizeTaxId(parsed.recipient.taxId) === normalizeTaxId(legalEntity.cnpj) : false;
  const installmentTotal = installments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0);

  function reset() {
    setParsed(null);
    setFileName("");
    setParseError("");
    setMappings([]);
    setInstallments([]);
    setOrderId("");
    setReceiptId("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function parseFile(file?: File) {
    if (!file) return;
    setParseError("");
    try {
      const result = parseNfeXml(await file.text());
      setParsed(result);
      setFileName(file.name);
      setMappings(blankMappings(result, inputs));
      setInstallments(result.installments.map((installment) => ({ number: installment.number, due_date: installment.dueDate, amount: installment.amount, payment_method: installment.paymentMethod })));
      const supplier = suppliers.find((row) => normalizeTaxId(row.tax_id) === normalizeTaxId(result.issuer.taxId));
      const matchingOrders = supplier ? orders.filter((order) => order.supplier_id === supplier.id) : [];
      const likelyOrder = matchingOrders.find((order) => Math.abs(Number(order.total_amount) - result.totals.invoice) <= 0.05) ?? (matchingOrders.length === 1 ? matchingOrders[0] : null);
      if (likelyOrder) chooseOrder(likelyOrder.id, result, blankMappings(result, inputs));
    } catch (error) {
      reset();
      setParseError(error instanceof Error ? error.message : "Não foi possível interpretar o XML.");
    }
  }

  function updateMapping(index: number, patch: Partial<Mapping>) {
    setMappings((current) => current.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...patch } : mapping));
  }

  function chooseOrder(nextOrderId: string, sourceParsed = parsed, sourceMappings = mappings) {
    setOrderId(nextOrderId);
    setReceiptId("");
    if (!sourceParsed) return;
    const available = orderItems.filter((item) => item.order_id === nextOrderId);
    setMappings(sourceParsed.items.map((xmlItem, index) => {
      const current = sourceMappings[index] ?? blankMappings(sourceParsed, inputs)[index];
      const description = normalizeMatchText(xmlItem.description);
      const candidate = available.find((item) => current.input_id && item.input_id === current.input_id)
        ?? available.find((item) => normalizeMatchText(item.input_name) === description)
        ?? available.find((item) => {
          const itemText = normalizeMatchText(item.input_name);
          return description.length > 10 && (itemText.includes(description) || description.includes(itemText));
        });
      return candidate ? { ...current, input_id: candidate.input_id, order_item_id: candidate.id, receipt_item_id: "", cost_center_service_id: candidate.cost_center_service_id ?? "" } : { ...current, order_item_id: "", receipt_item_id: "" };
    }));
  }

  function chooseReceipt(nextReceiptId: string) {
    setReceiptId(nextReceiptId);
    const receipt = receipts.find((row) => row.id === nextReceiptId);
    if (receipt && receipt.order_id !== orderId) {
      setOrderId(receipt.order_id);
    }
    if (!parsed) return;
    const available = receiptItems.filter((item) => item.receipt_id === nextReceiptId);
    setMappings((current) => parsed.items.map((xmlItem, index) => {
      const mapping = current[index];
      const candidate = available.find((item) => mapping?.order_item_id && item.order_item_id === mapping.order_item_id)
        ?? available.find((item) => mapping?.input_id && item.input_id === mapping.input_id)
        ?? available.find((item) => normalizeMatchText(item.input_name) === normalizeMatchText(xmlItem.description));
      return candidate ? { ...mapping, input_id: candidate.input_id, order_item_id: candidate.order_item_id, receipt_item_id: candidate.id, cost_center_service_id: candidate.cost_center_service_id ?? "" } : mapping;
    }));
  }

  return <>
    <button className="elos-button xml-import-main" type="button" onClick={() => dialogRef.current?.showModal()}>⇧ Importar XML</button>
    <dialog ref={dialogRef} className="xml-import-dialog" onClose={reset}>
      <form action={importElectronicInvoice} encType="multipart/form-data">
        <input type="hidden" name="items_json" value={JSON.stringify(mappings)} />
        <input type="hidden" name="installments_json" value={JSON.stringify(installments)} />
        <div className="xml-dialog-head">
          <div><span>Financeiro · NF-e</span><h2>Importar nota eletrônica</h2><p>O XML será conferido com a SPE, fornecedor, pedido, recebimento e cadastro de insumos.</p></div>
          <button type="button" onClick={() => dialogRef.current?.close()}>×</button>
        </div>
        <div className="xml-dialog-body">
          <label className={`xml-dropzone ${parsed ? "loaded" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (fileRef.current && file) { const transfer = new DataTransfer(); transfer.items.add(file); fileRef.current.files = transfer.files; void parseFile(file); } }}>
            <input ref={fileRef} name="xml_file" type="file" accept=".xml,text/xml,application/xml" required onChange={(event) => void parseFile(event.target.files?.[0])} />
            <strong>{parsed ? `✓ ${fileName}` : "Arraste o XML da NF-e aqui"}</strong>
            <span>{parsed ? "Arquivo interpretado. Revise os vínculos abaixo." : "ou clique para selecionar o arquivo"}</span>
            <small>Limite de 5 MB · somente XML de NF-e/NFC-e</small>
          </label>
          {parseError ? <div className="auth-message error">{parseError}</div> : null}

          {parsed ? <>
            <section className="xml-summary-grid">
              <article><span>NF-e</span><strong>{parsed.number}/{parsed.series || "—"}</strong><small>modelo {parsed.model} · {dateBR(parsed.issueDate)}</small></article>
              <article><span>Emitente</span><strong>{parsed.issuer.tradeName || parsed.issuer.name}</strong><small>{parsed.issuer.taxId || "CNPJ não informado"}</small></article>
              <article className={legalEntityMatches ? "ok" : "danger"}><span>Destinatário</span><strong>{parsed.recipient.name || "Não informado"}</strong><small>{legalEntityMatches ? "CNPJ confere com a SPE" : `XML ${parsed.recipient.taxId || "sem CNPJ"} · SPE ${legalEntity?.cnpj || "sem CNPJ"}`}</small></article>
              <article><span>Valor total</span><strong>{money(parsed.totals.invoice)}</strong><small>{parsed.items.length} produto(s)</small></article>
            </section>

            <section className="xml-link-panel">
              <div className="xml-section-title"><div><span>Vínculos de origem</span><h3>Fornecedor, pedido e recebimento</h3></div></div>
              <div className="xml-link-grid">
                <div className={`xml-match-card ${issuerSupplier ? "ok" : "warning"}`}><span>Fornecedor</span><strong>{issuerSupplier ? issuerSupplier.trade_name || issuerSupplier.legal_name : "Não cadastrado"}</strong><small>{issuerSupplier ? "Correspondência automática pelo CNPJ" : "Será necessário cadastrar o emitente"}</small>{!issuerSupplier ? <label className="xml-check"><input type="checkbox" name="create_supplier" value="1" defaultChecked /> Cadastrar fornecedor automaticamente</label> : null}</div>
                <label>Pedido de compra<select name="order_id" value={orderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">Sem vínculo com pedido</option>{candidateOrders.map((order) => <option key={order.id} value={order.id}>{order.order_number} · {money(order.total_amount)} · {order.status}</option>)}</select></label>
                <label>Recebimento aprovado<select name="receipt_id" value={receiptId} onChange={(event) => chooseReceipt(event.target.value)}><option value="">Sem vínculo com recebimento</option>{candidateReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.receipt_number} · {dateBR(receipt.receipt_date)}{receipt.invoice_number ? ` · NF ${receipt.invoice_number}` : ""}</option>)}</select></label>
              </div>
            </section>

            <section className="xml-items-panel">
              <div className="xml-section-title"><div><span>Mapeamento</span><h3>Produtos do XML × Insumos do Elos OS</h3></div><strong>{mappings.filter((mapping) => mapping.input_id).length}/{parsed.items.length} vinculados</strong></div>
              <div className="xml-items-list">
                {parsed.items.map((item, index) => {
                  const mapping = mappings[index];
                  const availableOrderItems = selectedOrderItems;
                  const availableReceiptItems = selectedReceiptItems;
                  return <article key={item.lineNumber} className={`xml-item-row ${mapping?.input_id ? "mapped" : "pending"}`}>
                    <div className="xml-item-product"><span>Item {item.lineNumber} · {item.supplierCode || "sem código"}</span><strong>{item.description}</strong><small>{item.quantity} {item.unit} × {money(item.unitPrice)} · NCM {item.ncm || "—"} · CFOP {item.cfop || "—"}</small></div>
                    <label>Insumo Elos<select value={mapping?.input_id ?? ""} onChange={(event) => updateMapping(index, { input_id: event.target.value })} required><option value="">Selecione o insumo</option>{inputs.map((input) => <option key={input.id} value={input.id}>{input.code} · {input.description} · {input.unit}</option>)}</select></label>
                    <label>Item do pedido<select value={mapping?.order_item_id ?? ""} disabled={!orderId} onChange={(event) => { const selected = availableOrderItems.find((row) => row.id === event.target.value); updateMapping(index, { order_item_id: event.target.value, input_id: selected?.input_id ?? mapping?.input_id ?? "", cost_center_service_id: selected?.cost_center_service_id ?? "" }); }}><option value="">Sem vínculo</option>{availableOrderItems.map((orderItem) => <option key={orderItem.id} value={orderItem.id}>{orderItem.input_code} · {orderItem.input_name} · {orderItem.ordered_quantity} {orderItem.unit_snapshot}</option>)}</select></label>
                    <label>Item recebido<select value={mapping?.receipt_item_id ?? ""} disabled={!receiptId} onChange={(event) => { const selected = availableReceiptItems.find((row) => row.id === event.target.value); updateMapping(index, { receipt_item_id: event.target.value, order_item_id: selected?.order_item_id ?? mapping?.order_item_id ?? "", input_id: selected?.input_id ?? mapping?.input_id ?? "", cost_center_service_id: selected?.cost_center_service_id ?? "" }); }}><option value="">Sem vínculo</option>{availableReceiptItems.map((receiptItem) => <option key={receiptItem.id} value={receiptItem.id}>{receiptItem.input_code} · {receiptItem.input_name} · {receiptItem.accepted_quantity} {receiptItem.unit_snapshot}</option>)}</select></label>
                  </article>;
                })}
              </div>
            </section>

            <section className="xml-payment-panel">
              <div className="xml-section-title"><div><span>Financeiro</span><h3>Parcelas a gerar no Contas a Pagar</h3></div><strong className={Math.abs(installmentTotal - parsed.totals.invoice) <= 0.02 ? "positive" : "negative"}>{money(installmentTotal)}</strong></div>
              <div className="xml-installments">
                {installments.map((installment, index) => <div key={index}>
                  <label>Parcela<input value={installment.number} onChange={(event) => setInstallments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, number: event.target.value } : row))} /></label>
                  <label>Vencimento<input type="date" value={installment.due_date} onChange={(event) => setInstallments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, due_date: event.target.value } : row))} required /></label>
                  <label>Valor<input type="number" min="0" step="0.01" value={installment.amount} onChange={(event) => setInstallments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(event.target.value) } : row))} required /></label>
                  <label>Forma<input value={installment.payment_method} onChange={(event) => setInstallments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, payment_method: event.target.value } : row))} /></label>
                  <button type="button" disabled={installments.length === 1} onClick={() => setInstallments((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remover</button>
                </div>)}
              </div>
              <button className="xml-add-installment" type="button" onClick={() => setInstallments((current) => [...current, { number: String(current.length + 1), due_date: current.at(-1)?.due_date ?? parsed.issueDate, amount: 0, payment_method: current.at(-1)?.payment_method ?? "Não informado" }])}>+ Adicionar parcela</button>
              {Math.abs(installmentTotal - parsed.totals.invoice) > 0.02 ? <p className="xml-payment-warning">A soma das parcelas difere da NF-e em {money(installmentTotal - parsed.totals.invoice)}. A importação será bloqueada para aprovação até a correção.</p> : null}
            </section>
          </> : null}
        </div>
        <div className="xml-dialog-foot"><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!parsed}>Importar e revisar NF-e</button></div>
      </form>
    </dialog>
  </>;
}
