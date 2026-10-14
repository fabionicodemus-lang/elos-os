"use client";

import Link from "next/link";
import { useState } from "react";

export type ElosIaClientAction={
  id:string;actionType:string;title:string;summary:string|null;preview:Record<string,unknown>;status:string;
  requiredPermission:string;canExecute:boolean;createdAt:string;expiresAt:string;
};

function money(value:unknown){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:2}).format(Number(value??0));}
function number(value:unknown,digits=3){return Number(value??0).toLocaleString("pt-BR",{maximumFractionDigits:digits});}
function dateBR(value:unknown){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}/.test(value))return "—";const [y,m,d]=value.slice(0,10).split("-");return `${d}/${m}/${y}`;}
function asRecord(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function asArray(value:unknown){return Array.isArray(value)?value.map(asRecord):[];}

export function ElosIaActionCard({action,onChange}:{action:ElosIaClientAction;onChange?:(next:ElosIaClientAction)=>void}){
  const [pending,setPending]=useState<"execute"|"reject"|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [warnings,setWarnings]=useState<string[]>([]);
  const preview=asRecord(action.preview);
  const blocked=preview.blocked===true;
  const kind=String(preview.kind??action.actionType);

  async function decide(decision:"execute"|"reject"){
    if(pending)return;setPending(decision);setError(null);setWarnings([]);
    try{
      const response=await fetch(`/api/elos-ia/actions/${action.id}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision})});
      const payload=await response.json().catch(()=>null) as {ok?:boolean;error?:string;status?:string;warnings?:string[]}|null;
      if(!response.ok||!payload?.ok)throw new Error(payload?.error||"Não foi possível concluir a ação.");
      if(payload.warnings?.length)setWarnings(payload.warnings);
      onChange?.({...action,status:payload.status??(decision==="execute"?"executed":"rejected")});
    }catch(err){setError(err instanceof Error?err.message:"Não foi possível concluir a ação.");}
    finally{setPending(null);}
  }

  const statusLabel=action.status==="pending_review"?"Aguardando revisão":action.status==="executed"?"Executado":action.status==="rejected"?"Descartado":action.status==="failed"?"Falhou":action.status;
  return <section className={`elos-ia-action ${blocked?"blocked":""} ${action.status}`}>
    <header><div><span>Ação preparada · {statusLabel}</span><h3>{action.title}</h3>{action.summary?<p>{action.summary}</p>:null}</div><strong>{kind==="procurement_supplier_offer"?"Suprimentos":"Execução"}</strong></header>

    {kind==="procurement_supplier_offer"?<QuotePreview preview={preview}/>:null}
    {kind==="execution_contract_measurement"?<MeasurementPreview preview={preview}/>:null}
    {blocked?<div className="elos-ia-action-alert"><strong>Bloqueada para execução automática.</strong><span>{String(preview.blockReason??"Existe uma divergência que precisa ser tratada no fluxo normal.")}</span></div>:null}
    {error?<div className="elos-ia-action-alert"><strong>Não executado.</strong><span>{error}</span></div>:null}
    {warnings.map((warning)=><div key={warning} className="elos-ia-action-warning">{warning}</div>)}

    <footer>
      {action.status==="pending_review"?<>
        <button className="elos-button primary" type="button" disabled={!action.canExecute||blocked||pending!==null} onClick={()=>void decide("execute")}>{pending==="execute"?"Lançando…":"Revisado · lançar no Elos"}</button>
        <button className="elos-button" type="button" disabled={pending!==null} onClick={()=>void decide("reject")}>{pending==="reject"?"Descartando…":"Descartar"}</button>
        {!action.canExecute?<small>Seu papel não possui {action.requiredPermission}. Um usuário autorizado pode revisar em Ações pendentes.</small>:null}
      </>:null}
      {action.status==="executed"?<><strong className="positive">Lançamento concluído.</strong><Link className="elos-button" prefetch={false} href={kind==="procurement_supplier_offer"?"/suprimentos/orcamentos-materiais":"/execucao/medicoes-por-etapas"}>Abrir no módulo</Link></>:null}
      <small>Expira em {dateBR(action.expiresAt)} · o Elos revalida permissões e regras no clique.</small>
    </footer>
  </section>;
}

function QuotePreview({preview}:{preview:Record<string,unknown>}){
  const quotation=asRecord(preview.quotation);const supplier=asRecord(preview.supplier);const items=asArray(preview.items);
  return <div className="elos-ia-action-body">
    <div className="elos-ia-action-meta"><div><span>Cotação</span><strong>{String(quotation.number??"—")} · {String(quotation.title??"")}</strong></div><div><span>Fornecedor</span><strong>{String(supplier.name??"—")}</strong></div><div><span>Documento</span><strong>{String(preview.sourceFile??"Texto da conversa")}</strong></div><div><span>Total entregue</span><strong>{money(preview.total)}</strong></div></div>
    <div className="elos-ia-action-table"><table><thead><tr><th>Item</th><th>Qtd.</th><th>Preço</th><th>Frete/outros</th><th>Total</th></tr></thead><tbody>{items.map((item,index)=><tr key={String(item.id??index)}><td><strong>{String(item.code??"")}</strong> {String(item.name??"")}{item.brand?<small> · {String(item.brand)}</small>:null}</td><td>{number(item.quantity)} {String(item.unit??"")}</td><td>{money(item.unitPrice)}</td><td>{money(Number(item.freight??0)+Number(item.otherCost??0))}</td><td>{money(item.total)}</td></tr>)}</tbody></table></div>
    <div className="elos-ia-action-note">Pagamento: {String(preview.paymentTerms??"não informado")} · Entrega: {preview.deliveryDays==null?"não informada":`${number(preview.deliveryDays,0)} dias`} · Frete total: {money(preview.freightTotal)}</div>
  </div>;
}

function MeasurementPreview({preview}:{preview:Record<string,unknown>}){
  const contract=asRecord(preview.contract);const items=asArray(preview.items);
  return <div className="elos-ia-action-body">
    <div className="elos-ia-action-meta"><div><span>Contrato</span><strong>{String(contract.number??"—")} · {String(contract.title??"")}</strong></div><div><span>Empreiteiro</span><strong>{String(contract.supplier??"—")}</strong></div><div><span>Período</span><strong>{dateBR(preview.periodStart)} a {dateBR(preview.periodEnd)}</strong></div><div><span>Valor líquido</span><strong>{money(preview.net)}</strong></div></div>
    <div className="elos-ia-action-table"><table><thead><tr><th>Serviço / local</th><th>Anterior</th><th>Agora</th><th>Acumulado</th><th>Valor atual</th></tr></thead><tbody>{items.map((item,index)=><tr key={String(item.id??index)} className={item.overContract?"danger":""}><td><strong>{String(item.code??"")}</strong> {String(item.name??"")}<small>{item.location?` · ${String(item.location)}`:""}</small></td><td>{number(item.previousQuantity)}</td><td>{number(item.currentQuantity)} {String(item.unit??"")}</td><td>{number(item.accumulatedQuantity)} / {number(item.contractedQuantity)}</td><td>{money(item.currentAmount)}</td></tr>)}</tbody></table></div>
    <div className="elos-ia-action-totals"><span>Bruto <strong>{money(preview.gross)}</strong></span><span>Retenções contratuais <strong>{money(Number(preview.contractualRetention??0)+Number(preview.guaranteeRetention??0))}</strong></span><span>Impostos/descontos <strong>{money(Number(preview.taxWithholding??0)+Number(preview.advanceDeduction??0)+Number(preview.otherDiscount??0))}</strong></span><span>Líquido <strong>{money(preview.net)}</strong></span></div>
    <div className="elos-ia-action-note">Documento: {String(preview.sourceFile??"Texto da conversa")} · O lançamento será criado como <strong>rascunho</strong>; envio e aprovação continuam no fluxo normal.</div>
  </div>;
}
