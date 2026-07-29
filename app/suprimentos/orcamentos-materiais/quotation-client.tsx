"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { approveMaterialQuotation, saveMaterialQuotation, saveMaterialSupplierOffer } from "./actions";

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type EligibleRequestItem = {
  id: string; request_id: string; request_number: string; input_code: string; input_name: string; unit_snapshot: string;
  category_snapshot: string; cost_center_code: string; cost_center_name: string; requested_quantity: number;
  ordered_quantity: number; needed_date: string; notes: string | null;
};
export type QuotationRecord = {
  id: string; title: string; award_mode: string; response_deadline: string; desired_delivery_date: string | null;
  payment_terms: string | null; delivery_address: string | null; notes: string | null; status: string;
};
export type QuotationItemRecord = {
  id: string; request_item_id: string; request_number: string; input_code: string; input_name: string; unit_snapshot: string;
  cost_center_code: string; cost_center_name: string; requested_quantity: number; previously_ordered_quantity: number;
  quantity_to_quote: number; best_delivered_unit_cost: number | null; best_total_cost: number | null; notes: string | null;
};
export type QuotationSupplierRecord = {
  id: string; supplier_id: string; supplier_name: string; contact_name: string | null; contact_email: string | null;
  contact_phone: string | null; status: string; notes: string | null;
};
export type OfferRecord = {
  id: string; supplier_id: string; proposal_number: string | null; proposal_date: string | null; validity_date: string | null;
  payment_terms: string | null; delivery_days: number | null; freight_terms: string | null; warranty_terms: string | null;
  notes: string | null; total_delivered_cost: number;
};
export type OfferItemRecord = {
  id: string; offer_id: string; supplier_id: string; quotation_item_id: string; quantity_offered: number; unit_price: number;
  discount_percent: number; tax_percent: number; freight_amount: number; other_cost_amount: number; delivered_unit_cost: number;
  total_delivered_cost: number; brand: string | null; manufacturer: string | null; delivery_days: number | null;
  meets_specification: boolean; technical_notes: string | null; is_selected: boolean;
};

function isoDate(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function quantity(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function supplierName(supplier: SupplierOption) { return supplier.trade_name || supplier.legal_name; }

export function MaterialQuotationDialog({ eligibleItems, suppliers, quotation, quotationItems = [], invitedSuppliers = [], autoOpen = false, label }: {
  eligibleItems: EligibleRequestItem[]; suppliers: SupplierOption[]; quotation?: QuotationRecord | null;
  quotationItems?: QuotationItemRecord[]; invitedSuppliers?: QuotationSupplierRecord[]; autoOpen?: boolean; label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initialItems = new Map<string, number>(quotationItems.map((item) => [item.request_item_id, Number(item.quantity_to_quote)]));
  const initialSuppliers = new Set(invitedSuppliers.map((item) => item.supplier_id));
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(initialItems);
  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(initialSuppliers);
  const [itemQuery, setItemQuery] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);

  const allItems = useMemo(() => {
    const map = new Map(eligibleItems.map((item) => [item.id, item]));
    quotationItems.forEach((item) => {
      if (!map.has(item.request_item_id)) map.set(item.request_item_id, {
        id: item.request_item_id, request_id: "", request_number: item.request_number, input_code: item.input_code,
        input_name: item.input_name, unit_snapshot: item.unit_snapshot, category_snapshot: "material",
        cost_center_code: item.cost_center_code, cost_center_name: item.cost_center_name,
        requested_quantity: item.requested_quantity, ordered_quantity: item.previously_ordered_quantity,
        needed_date: quotation?.desired_delivery_date ?? quotation?.response_deadline ?? isoDate(7), notes: item.notes,
      });
    });
    return [...map.values()];
  }, [eligibleItems, quotationItems, quotation]);
  const visibleItems = allItems.filter((item) => !itemQuery || [item.request_number,item.input_code,item.input_name,item.cost_center_code,item.cost_center_name].join(" ").toLocaleLowerCase("pt-BR").includes(itemQuery.toLocaleLowerCase("pt-BR")));
  const visibleSuppliers = suppliers.filter((supplier) => !supplierQuery || [supplier.legal_name,supplier.trade_name ?? "",supplier.tax_id ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(supplierQuery.toLocaleLowerCase("pt-BR")));
  const itemPayload = [...selectedItems.entries()].map(([request_item_id, quantity_to_quote]) => ({ request_item_id, quantity_to_quote }));
  const supplierPayload = [...selectedSuppliers].map((supplier_id) => ({ supplier_id }));
  const selectedQuantity = itemPayload.reduce((sum, item) => sum + Number(item.quantity_to_quote || 0), 0);

  function toggleItem(item: EligibleRequestItem, checked: boolean) {
    setSelectedItems((current) => { const next = new Map(current); if (checked) next.set(item.id, Math.max(0, Number(item.requested_quantity) - Number(item.ordered_quantity))); else next.delete(item.id); return next; });
  }
  function toggleSupplier(id: string, checked: boolean) {
    setSelectedSuppliers((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  }

  return <>
    <button className="elos-button quotation-main-button" type="button" onClick={() => ref.current?.showModal()}>{label ?? (quotation ? "Editar cotação" : "+ Nova cotação")}</button>
    <dialog ref={ref} className="quotation-dialog">
      <form action={saveMaterialQuotation}>
        <input type="hidden" name="quotation_id" value={quotation?.id ?? ""} />
        <input type="hidden" name="items_json" value={JSON.stringify(itemPayload)} />
        <input type="hidden" name="suppliers_json" value={JSON.stringify(supplierPayload)} />
        <div className="quotation-dialog-head"><div><span>Suprimentos · Orçamentos</span><h2>{quotation ? "Editar cotação em elaboração" : "Nova cotação de materiais"}</h2><p>Selecione necessidades aprovadas e os fornecedores que participarão do mapa comparativo.</p></div><button type="button" onClick={() => ref.current?.close()}>×</button></div>
        <div className="quotation-dialog-body">
          <section className="quotation-form-grid">
            <label className="span2">Título da cotação<input name="title" defaultValue={quotation?.title ?? ""} placeholder="Ex.: Porcelanatos e argamassas — pavimentos 5 ao 10" required /></label>
            <label>Forma de fechamento<select name="award_mode" defaultValue={quotation?.award_mode ?? "item"}><option value="item">Melhor fornecedor por item</option><option value="lot">Fornecedor único por lote</option></select></label>
            <label>Prazo para resposta<input name="response_deadline" type="date" min={isoDate()} defaultValue={quotation?.response_deadline ?? isoDate(5)} required /></label>
            <label>Entrega desejada<input name="desired_delivery_date" type="date" defaultValue={quotation?.desired_delivery_date ?? isoDate(15)} /></label>
            <label>Condição desejada<input name="payment_terms" defaultValue={quotation?.payment_terms ?? ""} placeholder="Ex.: 28/35/42 dias" /></label>
            <label className="span2">Endereço / instrução de entrega<input name="delivery_address" defaultValue={quotation?.delivery_address ?? ""} placeholder="Obra, almoxarifado, horário e contato de recebimento" /></label>
            <label className="span2">Observações<textarea name="notes" rows={2} defaultValue={quotation?.notes ?? ""} placeholder="Marcas homologadas, equivalências, lotes mínimos e condições técnicas." /></label>
          </section>

          <section className="quotation-selection-section">
            <div className="quotation-section-title"><div><span>Origem da demanda</span><h3>Itens das solicitações aprovadas</h3></div><strong>{selectedItems.size} item(ns) · {quantity(selectedQuantity)} un.</strong></div>
            <input className="quotation-search" value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder="Buscar solicitação, material ou serviço" />
            <div className="quotation-request-items">{visibleItems.map((item) => {
              const remaining = Math.max(0, Number(item.requested_quantity) - Number(item.ordered_quantity));
              const selected = selectedItems.has(item.id);
              return <article key={item.id} className={selected ? "selected" : ""}><label className="quotation-check"><input type="checkbox" checked={selected} onChange={(event) => toggleItem(item,event.target.checked)} /><span /></label><div><strong>{item.input_code} · {item.input_name}</strong><span>{item.request_number} · {item.cost_center_code} · {item.cost_center_name}</span><small>Necessidade: {item.needed_date.split("-").reverse().join("/")} · saldo {quantity(remaining)} {item.unit_snapshot}</small></div><label className="quotation-qty">Qtd. a cotar<input type="number" min="0.000001" max={remaining} step="0.000001" disabled={!selected} value={selectedItems.get(item.id) ?? remaining} onChange={(event) => setSelectedItems((current) => { const next=new Map(current); next.set(item.id,Number(event.target.value)); return next; })} /></label></article>;
            })}{!visibleItems.length ? <p className="quotation-muted">Nenhum item pendente encontrado.</p> : null}</div>
          </section>

          <section className="quotation-selection-section">
            <div className="quotation-section-title"><div><span>Concorrência</span><h3>Fornecedores convidados</h3></div><strong>{selectedSuppliers.size} selecionado(s)</strong></div>
            <input className="quotation-search" value={supplierQuery} onChange={(event) => setSupplierQuery(event.target.value)} placeholder="Buscar fornecedor ou CPF/CNPJ" />
            <div className="quotation-supplier-grid">{visibleSuppliers.map((supplier) => { const selected=selectedSuppliers.has(supplier.id); return <label key={supplier.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={(event) => toggleSupplier(supplier.id,event.target.checked)} /><div><strong>{supplierName(supplier)}</strong><span>{supplier.tax_id || "CPF/CNPJ não informado"}</span></div></label>; })}</div>
            <p className="quotation-hint">O sistema permite um fornecedor, mas sinaliza a qualidade da concorrência. Para compras relevantes, convide três ou mais.</p>
          </section>
        </div>
        <div className="quotation-dialog-foot"><div><small>Resumo da cotação</small><strong>{selectedItems.size} itens · {selectedSuppliers.size} fornecedores</strong></div><div><button type="button" onClick={() => ref.current?.close()}>Cancelar</button><button className="primary" type="submit" disabled={!selectedItems.size || !selectedSuppliers.size}>{quotation ? "Salvar alterações" : "Criar cotação"}</button></div></div>
      </form>
    </dialog>
  </>;
}

type OfferRow = { quotation_item_id: string; quantity_offered: number; unit_price: number; discount_percent: number; tax_percent: number; freight_amount: number; other_cost_amount: number; brand: string; manufacturer: string; delivery_days: number | null; meets_specification: boolean; technical_notes: string };

export function SupplierOfferForm({ quotationId, supplier, items, offer, offerItems = [] }: {
  quotationId: string; supplier: QuotationSupplierRecord; items: QuotationItemRecord[]; offer?: OfferRecord | null; offerItems?: OfferItemRecord[];
}) {
  const offerMap = useMemo(() => new Map(offerItems.map((item) => [item.quotation_item_id,item])), [offerItems]);
  const [rows,setRows] = useState<OfferRow[]>(items.map((item) => {
    const current=offerMap.get(item.id);
    return { quotation_item_id:item.id, quantity_offered:Number(current?.quantity_offered ?? item.quantity_to_quote), unit_price:Number(current?.unit_price ?? 0), discount_percent:Number(current?.discount_percent ?? 0), tax_percent:Number(current?.tax_percent ?? 0), freight_amount:Number(current?.freight_amount ?? 0), other_cost_amount:Number(current?.other_cost_amount ?? 0), brand:current?.brand ?? "", manufacturer:current?.manufacturer ?? "", delivery_days:current?.delivery_days ?? null, meets_specification:current?.meets_specification ?? true, technical_notes:current?.technical_notes ?? "" };
  }));
  function update(index:number,patch:Partial<OfferRow>){ setRows((current)=>current.map((row,i)=>i===index?{...row,...patch}:row)); }
  function total(row:OfferRow){ const subtotal=row.quantity_offered*row.unit_price*(1-row.discount_percent/100); return subtotal*(1+row.tax_percent/100)+row.freight_amount+row.other_cost_amount; }
  const grandTotal=rows.reduce((sum,row)=>sum+total(row),0);
  return <details className="quotation-offer-card" open={!offer}><summary><div><span>{supplier.status === "responded" ? "Proposta recebida" : "Aguardando proposta"}</span><strong>{supplier.supplier_name}</strong></div><b>{offer ? money(offer.total_delivered_cost) : "Registrar preços"}</b></summary><form action={saveMaterialSupplierOffer}><input type="hidden" name="quotation_id" value={quotationId}/><input type="hidden" name="supplier_id" value={supplier.supplier_id}/><input type="hidden" name="items_json" value={JSON.stringify(rows)}/><div className="quotation-offer-terms"><label>Proposta nº<input name="proposal_number" defaultValue={offer?.proposal_number ?? ""}/></label><label>Data da proposta<input name="proposal_date" type="date" defaultValue={offer?.proposal_date ?? isoDate()}/></label><label>Validade<input name="validity_date" type="date" defaultValue={offer?.validity_date ?? isoDate(15)}/></label><label>Prazo geral (dias)<input name="delivery_days" type="number" min="0" defaultValue={offer?.delivery_days ?? ""}/></label><label className="wide">Condição de pagamento<input name="payment_terms" defaultValue={offer?.payment_terms ?? ""}/></label><label>Frete / entrega<input name="freight_terms" defaultValue={offer?.freight_terms ?? ""}/></label><label>Garantia<input name="warranty_terms" defaultValue={offer?.warranty_terms ?? ""}/></label></div><div className="quotation-offer-items">{rows.map((row,index)=>{const item=items[index]; return <article key={item.id}><div className="quotation-offer-item-head"><div><strong>{item.input_code} · {item.input_name}</strong><span>{item.request_number} · {item.cost_center_name} · solicitado {quantity(item.quantity_to_quote)} {item.unit_snapshot}</span></div><b>{money(total(row))}</b></div><div className="quotation-offer-item-grid"><label>Qtd. ofertada<input type="number" min="0" max={item.quantity_to_quote} step="0.000001" value={row.quantity_offered} onChange={(e)=>update(index,{quantity_offered:Number(e.target.value)})}/></label><label>Preço unitário<input type="number" min="0" step="0.000001" value={row.unit_price} onChange={(e)=>update(index,{unit_price:Number(e.target.value)})}/></label><label>Desconto %<input type="number" min="0" max="100" step="0.01" value={row.discount_percent} onChange={(e)=>update(index,{discount_percent:Number(e.target.value)})}/></label><label>Impostos %<input type="number" min="0" max="100" step="0.01" value={row.tax_percent} onChange={(e)=>update(index,{tax_percent:Number(e.target.value)})}/></label><label>Frete alocado<input type="number" min="0" step="0.01" value={row.freight_amount} onChange={(e)=>update(index,{freight_amount:Number(e.target.value)})}/></label><label>Outros custos<input type="number" min="0" step="0.01" value={row.other_cost_amount} onChange={(e)=>update(index,{other_cost_amount:Number(e.target.value)})}/></label><label>Marca<input value={row.brand} onChange={(e)=>update(index,{brand:e.target.value})}/></label><label>Fabricante<input value={row.manufacturer} onChange={(e)=>update(index,{manufacturer:e.target.value})}/></label><label>Entrega (dias)<input type="number" min="0" value={row.delivery_days ?? ""} onChange={(e)=>update(index,{delivery_days:e.target.value?Number(e.target.value):null})}/></label><label className="quotation-spec"><input type="checkbox" checked={row.meets_specification} onChange={(e)=>update(index,{meets_specification:e.target.checked})}/>Atende à especificação</label><label className="wide">Observação técnica<input value={row.technical_notes} onChange={(e)=>update(index,{technical_notes:e.target.value})}/></label><div className="quotation-delivered-cost"><span>Custo posto/unit.</span><strong>{row.quantity_offered?money(total(row)/row.quantity_offered):money(0)}</strong></div></div></article>})}</div><label className="quotation-offer-notes">Observações gerais<textarea name="notes" rows={2} defaultValue={offer?.notes ?? ""}/></label><div className="quotation-offer-foot"><div><span>Total posto na obra</span><strong>{money(grandTotal)}</strong></div><button type="submit">Salvar proposta</button></div></form></details>;
}

export function QuotationAwardForm({ quotationId, awardMode, items, offerItems, supplierNames }: {
  quotationId:string; awardMode:string; items:QuotationItemRecord[]; offerItems:OfferItemRecord[]; supplierNames:Record<string,string>;
}) {
  const validByItem=useMemo(()=>{const map=new Map<string,OfferItemRecord[]>(); offerItems.filter((item)=>item.meets_specification&&item.quantity_offered>0).forEach((item)=>map.set(item.quotation_item_id,[...(map.get(item.quotation_item_id)??[]),item])); map.forEach((values)=>values.sort((a,b)=>a.delivered_unit_cost-b.delivered_unit_cost)); return map;},[offerItems]);
  const [selection,setSelection]=useState<Record<string,string>>(()=>Object.fromEntries(items.map((item)=>[item.id,(validByItem.get(item.id)??[])[0]?.id??""])));
  const [justifications,setJustifications]=useState<Record<string,string>>({});
  const awards=items.map((item)=>({quotation_item_id:item.id,offer_item_id:selection[item.id]??"",justification:justifications[item.id]??""}));
  const selectedRows=awards.map((award)=>offerItems.find((item)=>item.id===award.offer_item_id)).filter(Boolean) as OfferItemRecord[];
  const total=items.reduce((sum,item,index)=>sum+(selectedRows[index]?Number(item.quantity_to_quote)*Number(selectedRows[index].delivered_unit_cost):0),0);
  return <form action={approveMaterialQuotation} className="quotation-award-form"><input type="hidden" name="quotation_id" value={quotationId}/><input type="hidden" name="awards_json" value={JSON.stringify(awards)}/><div className="quotation-award-alert"><strong>{awardMode==="lot"?"Fechamento por lote":"Fechamento por item"}</strong><span>{awardMode==="lot"?"Todos os itens devem usar o mesmo fornecedor.":"Cada item pode ter um fornecedor vencedor diferente."}</span></div>{items.map((item)=>{const options=validByItem.get(item.id)??[]; const selected=options.find((option)=>option.id===selection[item.id]); const best=options[0]; return <article key={item.id}><div><strong>{item.input_code} · {item.input_name}</strong><span>{quantity(item.quantity_to_quote)} {item.unit_snapshot} · {item.cost_center_name}</span></div><label>Fornecedor vencedor<select value={selection[item.id]??""} onChange={(e)=>setSelection((current)=>({...current,[item.id]:e.target.value}))} required><option value="">Selecione</option>{options.map((option)=><option key={option.id} value={option.id}>{supplierNames[option.supplier_id]??"Fornecedor"} · {money(option.delivered_unit_cost)}/{item.unit_snapshot} · total {money(option.delivered_unit_cost*item.quantity_to_quote)}</option>)}</select></label><label>Justificativa<input value={justifications[item.id]??""} onChange={(e)=>setJustifications((current)=>({...current,[item.id]:e.target.value}))} placeholder={selected&&best&&selected.id!==best.id?"Obrigatória quando não for o menor custo":"Critério técnico, prazo ou negociação"}/></label><div className="quotation-award-cost"><span>Selecionado</span><strong>{selected?money(selected.delivered_unit_cost*item.quantity_to_quote):"—"}</strong>{best&&selected&&selected.id!==best.id?<small>Menor opção: {money(best.delivered_unit_cost*item.quantity_to_quote)}</small>:null}</div></article>})}<label className="quotation-approval-notes">Observações da aprovação<textarea name="approval_notes" rows={2} placeholder="Condições negociadas, divisão por fornecedor e orientações para o pedido."/></label><div className="quotation-award-foot"><div><span>Total aprovado</span><strong>{money(total)}</strong></div><button type="submit" disabled={awards.some((award)=>!award.offer_item_id)}>Aprovar vencedores</button></div></form>;
}
