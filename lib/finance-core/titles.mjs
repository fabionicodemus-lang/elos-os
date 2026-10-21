import { decimalToCents } from '../money.mjs';
export const FINANCE_TITLE_COLUMNS='finance_managed,finance_open_amount,finance_principal_paid,finance_interest_due,finance_interest_paid,finance_discount,finance_noncash,finance_advance_applied,finance_cash_gross,finance_cash_refunded,finance_cash_pending';
const cents=v=>decimalToCents(v,{rounding:'half-away-from-zero'});
const value=(row,snake,camel)=>row[snake]??row[camel];
export function titlePosition(row) {
 const principal=cents(row.adjusted_amount??row.adjustedAmount??row.amount);
 if(principal===null)return {principalCents:null,openCents:null,cashCents:null,paidPrincipalCents:null,status:'unknown',complete:false};
 const managed=row.finance_managed===true;
 if(managed&&['finance_open_amount','finance_principal_paid','finance_cash_gross','finance_cash_refunded','finance_cash_pending','finance_discount','finance_noncash','finance_interest_due','finance_interest_paid'].some(key=>row[key]===null||row[key]===undefined))throw Error('Projeção financeira incompleta; não converter desconhecido em zero');
 const cash=managed?cents(row.finance_cash_gross)-cents(row.finance_cash_refunded):row.status==='paid'?cents(value(row,'paid_amount','paidAmount')??row.adjusted_amount??row.adjustedAmount??row.amount):0;
 const open=managed?cents(row.finance_open_amount):row.status==='open'?principal:0;
 const legacyPaid=cents(value(row,'paid_amount','paidAmount')??(row.status==='paid'?row.adjusted_amount??row.adjustedAmount??row.amount:0));
 const paidPrincipal=managed?cents(row.finance_principal_paid):Math.min(principal,Math.max(0,legacyPaid));
 const discount=managed?cents(row.finance_discount):0;
 const noncash=managed?cents(row.finance_noncash):0;
 const interest=managed?cents(row.finance_interest_due)-cents(row.finance_interest_paid):0;
 return {principalCents:principal,openCents:open,cashCents:cash,paidPrincipalCents:paidPrincipal,discountCents:discount,noncashCents:noncash,interestOpenCents:interest,
  status:row.status==='cancelled'?'cancelled':open===0?'paid':paidPrincipal+discount+noncash>0?'partial':'open',
  complete:managed&&cents(row.finance_cash_pending)===0,origin:managed?'settlement_ledger':'legacy_declared'};
}
export const openTitleAmount=row=>{const v=titlePosition(row).openCents;if(v===null)throw Error('Saldo desconhecido');return v/100;};
export const paidTitleCash=row=>{const v=titlePosition(row).cashCents;if(v===null)throw Error('Caixa desconhecido');return v/100;};
export const paidTitlePrincipal=row=>{const v=titlePosition(row).paidPrincipalCents;if(v===null)throw Error('Principal desconhecido');return v/100;};
export const titleStatusLabel=row=>({paid:'Quitado',partial:'Parcialmente pago',open:'Em aberto',cancelled:'Cancelado',unknown:'Pendente'})[titlePosition(row).status];
// Shared by screens, reports and AI: partial titles contribute to both columns.
export function sumTitlePositions(rows){return rows.reduce((s,r)=>{
 const p=titlePosition(r);if(p.openCents===null||p.cashCents===null){s.complete=false;return s;}
 s.openCents+=p.openCents;s.cashCents+=p.cashCents;s.paidPrincipalCents+=p.paidPrincipalCents;s.complete&&=p.complete;return s;
},{openCents:0,cashCents:0,paidPrincipalCents:0,complete:true});}

export const openPrincipalTitleAmount=row=>{const p=titlePosition(row);if(p.principalCents===null)throw Error("Principal desconhecido");return (p.principalCents-p.paidPrincipalCents-(p.discountCents??0)-(p.noncashCents??0))/100;};
