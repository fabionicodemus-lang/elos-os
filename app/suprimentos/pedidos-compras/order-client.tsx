"use client";

import { useEffect, useRef } from "react";
import { savePurchaseOrderHeader } from "./actions";

export type PurchaseOrderRecord = {
  id:string; quotation_id:string|null; supplier_id:string; order_number:string; status:string; issue_date:string|null;
  expected_delivery_date:string|null; delivery_address:string|null; payment_terms:string|null; freight_terms:string|null;
  warranty_terms:string|null; supplier_contact_name:string|null; supplier_contact_email:string|null; supplier_contact_phone:string|null;
  notes:string|null; supplier_notes:string|null;
};

export function PurchaseOrderHeaderDialog({ order, autoOpen = false }: { order: PurchaseOrderRecord; autoOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);
  return <>
    <button className="purchase-order-button" type="button" onClick={() => ref.current?.showModal()}>Editar dados do pedido</button>
    <dialog ref={ref} className="purchase-order-dialog">
      <form action={savePurchaseOrderHeader}>
        <input type="hidden" name="order_id" value={order.id} />
        <header><div><span>Suprimentos · Pedido de Compra</span><h2>{order.order_number}</h2><p>Revise entrega, pagamento e contato antes da emissão.</p></div><button type="button" onClick={() => ref.current?.close()}>×</button></header>
        <div className="purchase-order-dialog-body">
          <label>Data prevista de entrega<input name="expected_delivery_date" type="date" defaultValue={order.expected_delivery_date ?? ""} required /></label>
          <label className="wide">Endereço de entrega<textarea name="delivery_address" rows={3} defaultValue={order.delivery_address ?? ""} required /></label>
          <label>Condição de pagamento<input name="payment_terms" defaultValue={order.payment_terms ?? ""} placeholder="Ex.: 28/56 dias" /></label>
          <label>Condição do frete<input name="freight_terms" defaultValue={order.freight_terms ?? ""} placeholder="CIF, FOB ou incluso" /></label>
          <label>Garantia<input name="warranty_terms" defaultValue={order.warranty_terms ?? ""} /></label>
          <label>Contato do fornecedor<input name="supplier_contact_name" defaultValue={order.supplier_contact_name ?? ""} /></label>
          <label>Telefone<input name="supplier_contact_phone" defaultValue={order.supplier_contact_phone ?? ""} /></label>
          <label>E-mail<input name="supplier_contact_email" type="email" defaultValue={order.supplier_contact_email ?? ""} /></label>
          <label className="wide">Observações internas<textarea name="notes" rows={3} defaultValue={order.notes ?? ""} /></label>
          <label className="wide">Instruções ao fornecedor<textarea name="supplier_notes" rows={3} defaultValue={order.supplier_notes ?? ""} /></label>
        </div>
        <footer><button type="button" onClick={() => ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar pedido</button></footer>
      </form>
    </dialog>
  </>;
}

export function PrintPurchaseOrderButton() {
  return <button className="purchase-order-button print" type="button" onClick={() => window.print()}>Imprimir pedido</button>;
}
