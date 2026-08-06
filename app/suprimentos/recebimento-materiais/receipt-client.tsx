"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveMaterialReceipt } from "./actions";

export type OrderOption = { id:string; order_number:string; supplier_id:string; supplier_name:string; status:string; expected_delivery_date:string|null };
export type OrderItemOption = { id:string; order_id:string; input_code:string; input_name:string; unit_snapshot:string; cost_center_code:string; cost_center_name:string; ordered_quantity:number; accepted_quantity:number; rejected_quantity:number; delivered_unit_cost:number; brand:string|null; manufacturer:string|null };
export type ReceiptRecord = { id:string; order_id:string; receipt_date:string; arrival_time:string|null; invoice_number:string|null; invoice_series:string|null; invoice_access_key:string|null; invoice_date:string|null; invoice_amount:number|null; carrier_name:string|null; vehicle_plate:string|null; driver_name:string|null; delivery_document:string|null; warehouse_location:string|null; general_condition:string|null; notes:string|null; status:string };
export type ReceiptItemRecord = { order_item_id:string; delivered_quantity:number; accepted_quantity:number; rejected_quantity:number; batch_number:string|null; expiration_date:string|null; condition:string; rejection_reason:string|null; destination_location:string|null; notes:string|null };

type Row = ReceiptItemRecord & { input_code:string; input_name:string; unit_snapshot:string; cost_center_name:string; ordered_quantity:number; previously_accepted:number; available:number };
function today(){return new Date().toISOString().slice(0,10);}
function qty(value:number){return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:4}).format(Number(value||0));}

export function MaterialReceiptDialog({orders,orderItems,receipt,items=[],autoOpen=false,label}:{orders:OrderOption[];orderItems:OrderItemOption[];receipt?:ReceiptRecord|null;items?:ReceiptItemRecord[];autoOpen?:boolean;label?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  const [orderId,setOrderId]=useState(receipt?.order_id??orders[0]?.id??"");
  const orderMap=useMemo(()=>new Map(orders.map(order=>[order.id,order])),[orders]);
  // Base derivada do pedido selecionado; as edições do usuário ficam por cima.
  // Trocar de pedido reinicia a base no próprio render, sem efeito.
  const baseRows=useMemo<Row[]>(()=>orderItems.filter(item=>item.order_id===orderId).map(item=>{const saved=items.find(row=>row.order_item_id===item.id);const available=Math.max(0,Number(item.ordered_quantity)-Number(item.accepted_quantity));return{order_item_id:item.id,input_code:item.input_code,input_name:item.input_name,unit_snapshot:item.unit_snapshot,cost_center_name:item.cost_center_name,ordered_quantity:Number(item.ordered_quantity),previously_accepted:Number(item.accepted_quantity),available,delivered_quantity:Number(saved?.delivered_quantity??0),accepted_quantity:Number(saved?.accepted_quantity??0),rejected_quantity:Number(saved?.rejected_quantity??0),batch_number:saved?.batch_number??null,expiration_date:saved?.expiration_date??null,condition:saved?.condition??"good",rejection_reason:saved?.rejection_reason??null,destination_location:saved?.destination_location??null,notes:saved?.notes??null};}),[orderId,orderItems,items]);
  const [rows,setRows]=useState<Row[]>(baseRows);
  const [syncedRows,setSyncedRows]=useState(baseRows);

  if(syncedRows!==baseRows){setSyncedRows(baseRows);setRows(baseRows);}

  useEffect(()=>{if(autoOpen)ref.current?.showModal();},[autoOpen]);
  const selectedOrder=orderMap.get(orderId);
  const update=(index:number,patch:Partial<Row>)=>setRows(current=>current.map((row,i)=>i===index?{...row,...patch}:row));
  const payload=rows.filter(row=>row.delivered_quantity>0).map(row=>({order_item_id:row.order_item_id,delivered_quantity:row.delivered_quantity,accepted_quantity:row.accepted_quantity,rejected_quantity:row.rejected_quantity,batch_number:row.batch_number,expiration_date:row.expiration_date,condition:row.condition,rejection_reason:row.rejection_reason,destination_location:row.destination_location,notes:row.notes}));

  return <>
    <button className="elos-button receipt-main-button" type="button" onClick={()=>ref.current?.showModal()}>{label??(receipt?"Editar recebimento":"+ Novo recebimento")}</button>
    <dialog ref={ref} className="receipt-dialog"><form action={saveMaterialReceipt}>
      <input type="hidden" name="receipt_id" value={receipt?.id??""}/><input type="hidden" name="items_json" value={JSON.stringify(payload)}/>
      <div className="receipt-dialog-head"><div><span>Suprimentos · Conferência</span><h2>{receipt?"Editar recebimento":"Novo recebimento de materiais"}</h2><p>Confira o pedido, a nota, as quantidades e as condições dos materiais.</p></div><button type="button" onClick={()=>ref.current?.close()}>×</button></div>
      <div className="receipt-dialog-body">
        <section className="receipt-form-grid">
          <label className="span2">Pedido de compra<select name="order_id" value={orderId} onChange={event=>setOrderId(event.target.value)} disabled={Boolean(receipt)} required><option value="">Selecione</option>{orders.map(order=><option key={order.id} value={order.id}>{order.order_number} · {order.supplier_name} · {order.status}</option>)}</select>{receipt?<input type="hidden" name="order_id" value={orderId}/>:null}</label>
          <label>Data do recebimento<input name="receipt_date" type="date" defaultValue={receipt?.receipt_date??today()} required/></label>
          <label>Hora da chegada<input name="arrival_time" type="time" defaultValue={receipt?.arrival_time?.slice(0,5)??""}/></label>
          <label>Número da NF<input name="invoice_number" defaultValue={receipt?.invoice_number??""}/></label><label>Série<input name="invoice_series" defaultValue={receipt?.invoice_series??""}/></label>
          <label>Emissão da NF<input name="invoice_date" type="date" defaultValue={receipt?.invoice_date??""}/></label><label>Valor da NF<input name="invoice_amount" type="number" min="0" step="0.01" defaultValue={receipt?.invoice_amount??""}/></label>
          <label className="span2">Chave de acesso<input name="invoice_access_key" defaultValue={receipt?.invoice_access_key??""} maxLength={60}/></label>
          <label>Transportadora<input name="carrier_name" defaultValue={receipt?.carrier_name??""}/></label><label>Placa<input name="vehicle_plate" defaultValue={receipt?.vehicle_plate??""}/></label>
          <label>Motorista<input name="driver_name" defaultValue={receipt?.driver_name??""}/></label><label>Romaneio / documento<input name="delivery_document" defaultValue={receipt?.delivery_document??""}/></label>
          <label>Destino / depósito<input name="warehouse_location" defaultValue={receipt?.warehouse_location??""}/></label>
          <label>Condição geral<select name="general_condition" defaultValue={receipt?.general_condition??"good"}><option value="good">Boa</option><option value="partial_damage">Danos parciais</option><option value="damaged">Danificada</option><option value="divergent">Divergente</option></select></label>
        </section>
        <section className="receipt-items-card"><div className="receipt-section-title"><div><span>Pedido {selectedOrder?.order_number??""}</span><h3>Conferência por material</h3></div><strong>{payload.length} item(ns) informados</strong></div>
          <div className="receipt-items">{rows.map((row,index)=><article key={row.order_item_id} className="receipt-item"><div className="receipt-item-name"><strong>{row.input_code} · {row.input_name}</strong><span>{row.cost_center_name}</span><small>Pedido: {qty(row.ordered_quantity)} {row.unit_snapshot} · Aceito antes: {qty(row.previously_accepted)} · Saldo: {qty(row.available)}</small></div><div className="receipt-item-fields">
            <label>Entregue<input type="number" min="0" step="0.000001" max={row.available+row.rejected_quantity} value={row.delivered_quantity} onChange={e=>{const delivered=Number(e.target.value);update(index,{delivered_quantity:delivered,accepted_quantity:delivered,rejected_quantity:0});}}/></label>
            <label>Aceito<input type="number" min="0" step="0.000001" max={row.delivered_quantity} value={row.accepted_quantity} onChange={e=>{const accepted=Number(e.target.value);update(index,{accepted_quantity:accepted,rejected_quantity:Math.max(0,row.delivered_quantity-accepted)});}}/></label>
            <label>Rejeitado<input type="number" min="0" step="0.000001" max={row.delivered_quantity} value={row.rejected_quantity} onChange={e=>{const rejected=Number(e.target.value);update(index,{rejected_quantity:rejected,accepted_quantity:Math.max(0,row.delivered_quantity-rejected)});}}/></label>
            <label>Condição<select value={row.condition} onChange={e=>update(index,{condition:e.target.value})}><option value="good">Boa</option><option value="damaged">Danificado</option><option value="wrong_specification">Especificação incorreta</option><option value="shortage">Falta</option><option value="excess">Excesso</option><option value="other">Outra</option></select></label>
            <label>Lote<input value={row.batch_number??""} onChange={e=>update(index,{batch_number:e.target.value})}/></label><label>Validade<input type="date" value={row.expiration_date??""} onChange={e=>update(index,{expiration_date:e.target.value||null})}/></label>
            <label>Destino<input value={row.destination_location??""} onChange={e=>update(index,{destination_location:e.target.value})}/></label>
            <label className="wide">Motivo da rejeição<input value={row.rejection_reason??""} onChange={e=>update(index,{rejection_reason:e.target.value})} placeholder={row.rejected_quantity>0?"Obrigatório para quantidade rejeitada":""}/></label>
            <label className="wide">Observações<input value={row.notes??""} onChange={e=>update(index,{notes:e.target.value})}/></label>
          </div></article>)}</div>
        </section>
        <section className="receipt-form-grid"><label className="span4">Observações gerais<textarea name="notes" rows={3} defaultValue={receipt?.notes??""}/></label></section>
      </div>
      <div className="receipt-dialog-foot"><div><small>Itens com entrega informada</small><strong>{payload.length}</strong></div><div><button type="button" onClick={()=>ref.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar recebimento</button></div></div>
    </form></dialog>
  </>;
}
