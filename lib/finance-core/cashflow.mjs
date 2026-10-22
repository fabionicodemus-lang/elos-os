import {titlesAt} from './ledger-position.mjs';
import {decimalToCents} from '../money.mjs';
import {titlePosition,openPrincipalTitleAmount} from './titles.mjs';
import {contractRemainder,nativeFinancialBindings} from './coverage.mjs';
export const toCents=value=>decimalToCents(value,{rounding:'half-away-from-zero'});
export function exactCents(value){if(!Number.isSafeInteger(value))throw Error('Centavos fora do intervalo seguro');return value;}
const sum=rows=>rows.reduce((a,b)=>exactCents(a+exactCents(b)),0);
export function isoDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Data financeira inválida');return value;}
export const addCashDays=(date,n)=>new Date(new Date(isoDay(date)+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
const sign=row=>row.direction==='credit'?1:row.direction==='debit'?-1:(()=>{throw Error('Direção inválida');})();

// Internal ledger and independently linked bank facts remain separate bases.
// Scope must already be authorized by RLS. No bank opening is allocated to a work.
export function realizedCashflow({accounts,movements,links=[],entries=[],transfers=[],from,to,knownAt=null,eliminateInterentity=false}){
 isoDay(from);isoDay(to);if(from>to)throw Error('Intervalo inválido');
 if(accounts.some(a=>a.currency_code!=='BRL'))throw Error('Consolidar moedas exige conversão aprovada; este cálculo usa BRL');
 const accountById=new Map(accounts.map(a=>[a.id,a]));if(accountById.size!==accounts.length)throw Error('Conta duplicada');
 const known=r=>!knownAt||r.created_at&&r.created_at<=knownAt;
 const visible=movements.filter(m=>accountById.has(m.bank_account_id)&&known(m)&&m.status!=='cancelled');
 const seen=new Set();for(const m of visible){if(seen.has(m.id))throw Error('Movimento duplicado');seen.add(m.id);isoDay(m.transaction_date);if(toCents(m.amount)<=0)throw Error('Movimento inválido');}
 const entryById=new Map(entries.filter(known).map(e=>[e.id,e]));
 const bankFacts=[];const allocated=new Map(),entryUsed=new Map(),linkIds=new Set();
 for(const l of links.filter(l=>known(l)&&(!l.reversed_at||knownAt&&l.reversed_at>knownAt))){
  const m=visible.find(m=>m.id===l.transaction_id),e=entryById.get(l.entry_id);if(!m||!e)continue;
  if(linkIds.has(l.id))throw Error('Vínculo de extrato duplicado');linkIds.add(l.id);
  const n=toCents(l.amount);if(n<=0||e.bank_account_id!==m.bank_account_id||Math.sign(toCents(e.amount))!==sign(m))throw Error('Conciliação incompatível');
  entryUsed.set(e.id,sum([entryUsed.get(e.id)??0,n]));if(entryUsed.get(e.id)>Math.abs(toCents(e.amount)))throw Error('Conciliação excede extrato');
  allocated.set(m.id,sum([allocated.get(m.id)??0,n]));if(allocated.get(m.id)>toCents(m.amount))throw Error('Conciliação excede movimento');
  bankFacts.push({...m,id:l.id,transaction_date:isoDay(e.transaction_date),amount:n/100,linked_transaction_id:m.id});
 }
 const transfersById=new Map(transfers.filter(known).map(t=>[t.id,t]));
 const isInternal=m=>{
  const t=transfersById.get(m.transfer_id);if(m.transaction_type!=='transfer'||!t||t.status==='cancelled'||!t.evidence&&t.nature) return false;
  const a=accountById.get(t.from_account_id),b=accountById.get(t.to_account_id);if(!a||!b||a.currency_code!==b.currency_code||toCents(t.amount)!==toCents(m.amount))return false;
  return a.legal_entity_id===b.legal_entity_id&&a.legal_entity_id!=null||(eliminateInterentity&&t.nature==='loan'&&a.legal_entity_id&&b.legal_entity_id);
 };
 const table=accounts.map(a=>{
  const position=(rows,before)=>sum(rows.filter(m=>m.bank_account_id===a.id&&(before?m.transaction_date<from:m.transaction_date<=to)&&m.transaction_date>=a.opening_balance_date).map(m=>sign(m)*toCents(m.amount)));
  const covered=isoDay(a.opening_balance_date)<=from;
  const opening=covered?sum([toCents(a.opening_balance),position(visible,true)]):null;
  const closing=covered?sum([toCents(a.opening_balance),position(visible,false)]):null;
  const confirmed=a.opening_validated===true&&covered;
  const period=visible.filter(m=>m.bank_account_id===a.id&&m.transaction_date>=from&&m.transaction_date<=to);
  return {account_id:a.id,legal_entity_id:a.legal_entity_id,opening_cents:opening,closing_cents:closing,confirmed_opening_cents:confirmed?sum([toCents(a.opening_balance),position(bankFacts,true)]):null,confirmed_closing_cents:confirmed?sum([toCents(a.opening_balance),position(bankFacts,false)]):null,
   incoming_cents:sum(period.filter(m=>m.direction==='credit').map(m=>toCents(m.amount))),outgoing_cents:sum(period.filter(m=>m.direction==='debit').map(m=>toCents(m.amount))),unconfirmed_movement_cents:sum(period.map(m=>toCents(m.amount)-(allocated.get(m.id)??0))),opening_validated:confirmed};
 });
 const inPeriod=visible.filter(m=>m.transaction_date>=from&&m.transaction_date<=to);
 const bankInPeriod=bankFacts.filter(m=>m.transaction_date>=from&&m.transaction_date<=to);
 const total=key=>table.some(a=>a[key]===null)?null:sum(table.map(a=>a[key]));
 const external=(rows,dir)=>sum(rows.filter(m=>m.direction===dir&&!isInternal(m)).map(m=>toCents(m.amount)));
 const transit=sum(transfers.filter(t=>known(t)&&accountById.has(t.from_account_id)&&accountById.has(t.to_account_id)).map(t=>{
  const debit=visible.some(m=>m.id===t.debit_transaction_id&&m.transaction_date<=to),credit=visible.some(m=>m.id===t.credit_transaction_id&&m.transaction_date<=to);
  return debit&&!credit?toCents(t.amount):0;
 }));
 return {from,to,accounts:table,unconfirmed_through_cutoff_cents:sum(visible.filter(m=>m.transaction_date<=to&&m.transaction_date>=accountById.get(m.bank_account_id).opening_balance_date).map(m=>toCents(m.amount)-(allocated.get(m.id)??0))),unlinked_statement_cents:sum([...entryById.values()].filter(e=>accountById.has(e.bank_account_id)&&e.transaction_date<=to&&e.transaction_date>=accountById.get(e.bank_account_id).opening_balance_date).map(e=>Math.abs(toCents(e.amount))-(entryUsed.get(e.id)??0))),opening_cents:total('opening_cents'),closing_cents:total('closing_cents'),confirmed_opening_cents:total('confirmed_opening_cents'),confirmed_closing_cents:total('confirmed_closing_cents'),transfer_in_transit_cents:transit,external_incoming_cents:external(inPeriod,'credit'),external_outgoing_cents:external(inPeriod,'debit'),confirmed_external_incoming_cents:external(bankInPeriod,'credit'),confirmed_external_outgoing_cents:external(bankInPeriod,'debit'),unconfirmed_movement_cents:sum(table.map(a=>a.unconfirmed_movement_cents)),project_bank_balance_available:false};
}

// One map consumes coverage once, including already-paid titles. Recurrences keep stable scope IDs.
export function futureCashRows({payables=[],receivables=[],scenarioRows=[],coverageLinks=[],nativeBindings=[],cutoff}){
 isoDay(cutoff);const rows=[],warnings=[];const titleById=new Map([...payables.map(t=>['AP:'+t.id,t]),...receivables.map(t=>['AR:'+t.id,t])]);
 for(const [type,titles] of [['AP',payables],['AR',receivables]])for(const t of titles){const p=titlePosition(t);if(p.openCents===null){warnings.push('Saldo desconhecido: '+t.id);continue;}if(p.openCents===0)continue;
  const override=scenarioRows.find(r=>r.category===(type==='AP'?'R':'AR')&&r.title_id===t.id);
  const due=t.due_date??t.dueDate;rows.push({id:type+':'+t.id,scope_key:type+':'+t.id,category:type==='AP'?'R':'AR',amount_cents:p.openCents,legal_due:due??null,expected_date:override?.expected_date??(due>=cutoff?due:null),project_id:t.project_id??null,source_id:t.id,title_id:t.id,title_type:type,source_kind:'title'});
  if(!p.complete)warnings.push('Saldo informado não certificado: '+t.id);
 }
 const effectiveLinks=[...coverageLinks];
 for(const binding of nativeBindings){const title=payables.find(t=>t.id===binding.title_id);if(!title)continue;
  const candidates=scenarioRows.filter(r=>r.category==='C'&&r.source_id===binding.contract_id);
  const existing=effectiveLinks.find(l=>l.title_type==='AP'&&l.title_id===title.id);
  if(existing){const scope=scenarioRows.find(r=>r.scope_key===existing.scope_key);if(scope?.category==='C'&&scope.source_id!==binding.contract_id)throw Error('Vínculo manual e contrato nativo divergem');continue;}
  if(candidates.length>1)throw Error('Contrato dividido exige vínculo monetário por escopo; não presumir rateio');
  if(candidates.length===1)effectiveLinks.push({scope_key:candidates[0].scope_key,scope_project_id:candidates[0].project_id??null,title_type:'AP',title_id:title.id,amount_cents:titlePosition(title).principalCents});
 }
 const scopes=new Set();
 for(const r of scenarioRows.filter(r=>!['R','AR'].includes(r.category))){
  if(scopes.has(r.scope_key))throw Error('Escopo repetido entre previsão/compromisso');scopes.add(r.scope_key);
  if(!['C','P','AR_FUTURE','REVENUE','AF','FINANCING_IN','FINANCING_OUT'].includes(r.category))throw Error('Categoria inválida');
  const links=effectiveLinks.filter(l=>l.scope_key===r.scope_key&&(!Object.hasOwn(l,'scope_project_id')||(l.scope_project_id??null)===(r.project_id??null)));let amount=exactCents(r.amount_cents);
  if(links.length){
   let H=0,N=0,Rv=0;for(const l of links){const t=titleById.get(l.title_type+':'+l.title_id);if(!t)throw Error('Vínculo fora do perímetro ou fonte ausente');const p=titlePosition(t);if(p.principalCents===null||!p.complete)warnings.push('Cobertura não validada: '+l.title_id);
    if(l.amount_cents!==p.principalCents)throw Error('Cobertura parcial exige desdobramento explícito');H=sum([H,p.paidPrincipalCents]);N=sum([N,p.discountCents??0,(p.noncashCents??0)-toCents(t.finance_advance_applied??0)]);Rv=sum([Rv,toCents(openPrincipalTitleAmount(t))]);
   }
   const c=contractRemainder({valueCents:amount,paidPrincipalCents:H,noncashReductionCents:N,representedOpenCents:Rv});if(c.C_cents===null)throw Error('Sobreposição excede cobertura aprovada');amount=c.C_cents;
  }
  if(amount>0)rows.push({...r,id:r.id??r.category+':'+r.scope_key,reference_amount_cents:r.amount_cents,amount_cents:amount,project_id:r.project_id??null});
 }
 return {rows,warnings,complete:warnings.length===0};
}

export function projectCashflow({openingCents,restrictedCents=0,minimumCashCents=null,rows,cutoff,through,complete=false}){
 isoDay(cutoff);isoDay(through);if(through<cutoff)throw Error('Horizonte anterior ao corte');
 if(restrictedCents<0||minimumCashCents!==null&&minimumCashCents<0)throw Error('Restrição e caixa mínimo não negativos');
 const opening=openingCents===null?null:sum([openingCents,-exactCents(restrictedCents)]);
 if(minimumCashCents!==null)exactCents(minimumCashCents);
 const seen=new Set();for(const r of rows){if(seen.has(r.id))throw Error('Evento futuro duplicado');seen.add(r.id);if(exactCents(r.amount_cents)<0)throw Error('Projeção negativa');if(r.expected_date)isoDay(r.expected_date);}
 const undated=rows.filter(r=>!r.expected_date);const past=rows.filter(r=>r.expected_date&&r.expected_date<cutoff);
 const dated=rows.filter(r=>r.expected_date&&r.expected_date>=cutoff&&r.expected_date<=through);
 const incoming=r=>['AR','AR_FUTURE','REVENUE','FINANCING_IN'].includes(r.category);
 let balance=opening,commercial=opening,peak=opening===null||minimumCashCents===null?null:Math.max(0,minimumCashCents-opening);
 const months=[],events=[];let day=cutoff;
 while(day<=through){const month=day.slice(0,7);const monthOpening=balance;let entries=0,exits=0,estimated=0;const components={R:0,C:0,P:0,AR:0,AR_FUTURE:0,REVENUE:0,AF:0,FINANCING_IN:0,FINANCING_OUT:0};
  while(day<=through&&day.slice(0,7)===month){const current=dated.filter(r=>r.expected_date===day);const base=current.filter(r=>r.category!=='REVENUE');
   const ins=sum(base.filter(incoming).map(r=>r.amount_cents)),outs=sum(base.filter(r=>!incoming(r)).map(r=>r.amount_cents)),sales=sum(current.filter(r=>r.category==='REVENUE').map(r=>r.amount_cents));
   entries=sum([entries,ins]);exits=sum([exits,outs]);estimated=sum([estimated,sales]);for(const r of current)components[r.category]=sum([components[r.category],r.amount_cents]);
   if(balance!==null)balance=sum([balance,ins,-outs]);if(commercial!==null)commercial=sum([commercial,ins,sales,-outs]);if(peak!==null)peak=Math.max(peak,minimumCashCents-balance,0);
   if(current.length)events.push({date:day,closing_cents:balance,commercial_closing_cents:commercial});day=addCashDays(day,1);
  }
  months.push({month,opening_cents:monthOpening,incoming_cents:entries,outgoing_cents:exits,estimated_revenue_cents:estimated,closing_cents:balance,commercial_closing_cents:commercial,components});
 }
 const horizon=n=>{const end=addCashDays(cutoff,n);const selected=rows.filter(r=>r.expected_date&&r.expected_date>cutoff&&r.expected_date<=end);return {through:end,outgoing_cents:sum(selected.filter(r=>!incoming(r)).map(r=>r.amount_cents)),receivables_cents:sum(selected.filter(r=>['AR','AR_FUTURE'].includes(r.category)).map(r=>r.amount_cents)),estimated_revenue_cents:sum(selected.filter(r=>r.category==='REVENUE').map(r=>r.amount_cents))};};
 return {cutoff,through,available_opening_cents:opening,months,events,closing_cents:balance,commercial_closing_cents:commercial,peak_additional_funding_cents:peak,horizon_30:horizon(30),horizon_90:horizon(90),undated_cents:sum(undated.map(r=>r.amount_cents)),past_expected_cents:sum(past.map(r=>r.amount_cents)),complete:complete&&opening!==null&&minimumCashCents!==null&&undated.length===0&&past.length===0,unused_credit_limit_in_cash_cents:0};
}

// Frozen inputs are captured together by the version RPC. Reuse the same calculators.
export function snapshotCashProjection(snapshot,rows,{cutoff,through,minimumCashCents,projectId=null}){
 const accounts=(snapshot.accounts??[]).map(a=>{
  const proof=(snapshot.openings??[]).filter(o=>o.bank_account_id===a.id&&o.opening_date===a.opening_balance_date&&toCents(o.opening_amount)===toCents(a.opening_balance)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  return {...a,opening_validated:!!proof,restriction:proof?toCents(proof.restricted_amount):null};
 });
 const bank=realizedCashflow({...snapshot,accounts,from:cutoff,to:cutoff});
 const historical=type=>titlesAt({...snapshot,titles:(type==='AP'?snapshot.payables:snapshot.receivables)??[],type,cutoff});
 const future=futureCashRows({payables:historical('AP'),receivables:historical('AR'),scenarioRows:rows,coverageLinks:snapshot.coverage??[],nativeBindings:snapshot.native_bindings??nativeFinancialBindings({invoices:snapshot.native_invoices??[],installments:snapshot.native_installments??[],measurements:snapshot.native_measurements??[]}),cutoff});
 return projectCashflow({openingCents:projectId||!accounts.length||accounts.some(a=>a.restriction===null)||bank.unconfirmed_through_cutoff_cents||bank.unlinked_statement_cents?null:bank.confirmed_closing_cents,restrictedCents:sum(accounts.map(a=>a.restriction??0)),minimumCashCents,rows:future.rows,cutoff,through,complete:future.complete});
}
