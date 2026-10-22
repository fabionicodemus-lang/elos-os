import {toCents,exactCents,isoDay} from './cashflow.mjs';
// Reconstruct event components before delegating the financial position to titles.mjs.
// Audit selects the original amount/document version; it never supplies a cumulative payment for a past T.
export function titlesAt({titles,audits=[],events=[],lines=[],charges=[],cash=[],type,cutoff,knownAt=null}){
 isoDay(cutoff);const known=r=>!knownAt||r.created_at<=knownAt;
 return titles.flatMap(current=>{
  const history=audits.filter(a=>a.title_id===current.id&&a.title_type===(type==='AP'?'payables':'receivables')&&(!knownAt||a.recorded_at<=knownAt));
  const versions=history.filter(a=>(a.effective_date??a.recorded_at.slice(0,10))<=cutoff).sort((a,b)=>(b.effective_date??b.recorded_at.slice(0,10)).localeCompare(a.effective_date??a.recorded_at.slice(0,10))||b.version-a.version);
  const base=versions[0]?.new_value??current;
  if(!versions.length&&history.length)return [];
  const ev=new Map(events.filter(e=>e.effective_date<=cutoff&&known(e)).map(e=>[e.id,e]));
  const rows=lines.filter(l=>l.title_type===type&&l.title_id===current.id&&ev.has(l.event_id));
  const applicableCharges=charges.filter(c=>c.title_id===current.id&&c.title_type===type&&c.effective_date<=cutoff&&known(c));
  if(!rows.length&&!applicableCharges.length){return [{...base,finance_managed:false,finance_cash_pending:0}];}
  const total=(field,filter=()=>true)=>rows.filter(filter).reduce((s,l)=>exactCents(s+toCents(l[field]??0)*(ev.get(l.event_id).kind==='reversal'?-1:1)),0);
  const principal=total('principal'),interest=total('interest'),discount=total('discount'),noncash=total('noncash');
  const gross=rows.filter(l=>ev.get(l.event_id).kind!=='reversal').reduce((s,l)=>exactCents(s+toCents(l.principal)+toCents(l.interest)-toCents(l.fee)+toCents(l.excess_credit)),0);
  const refunds=cash.filter(c=>c.title_id===current.id&&c.title_type===type&&c.cash_kind==='refund'&&c.effective_date<=cutoff&&known(c)).reduce((s,c)=>exactCents(s-toCents(c.cash_signed)),0);
  const due=charges.filter(c=>c.title_id===current.id&&c.title_type===type&&c.effective_date<=cutoff&&known(c)).reduce((s,c)=>exactCents(s+toCents(c.amount)),0);
  const open=toCents(base.adjusted_amount??base.amount)-principal-discount-noncash+due-interest;
  const reversed=rows.filter(l=>ev.get(l.event_id).kind==='reversal').reduce((s,l)=>s+toCents(l.principal)+toCents(l.interest)-toCents(l.fee)+toCents(l.excess_credit),0);
  const advance=total('noncash',l=>l.noncash_kind==='advance_application');if(reversed<refunds)throw Error('Devolução excede o evento estornado; apuração necessária');
  return [{...base,status:base.status==='cancelled'?'cancelled':open===0?'paid':'open',finance_managed:true,finance_principal_paid:principal/100,finance_interest_paid:interest/100,finance_interest_due:due/100,finance_discount:discount/100,finance_noncash:noncash/100,finance_cash_gross:gross/100,finance_cash_refunded:refunds/100,finance_cash_pending:(reversed-refunds)/100,finance_advance_applied:advance/100,finance_open_amount:base.status==='cancelled'?0:open/100}];
 });
}
