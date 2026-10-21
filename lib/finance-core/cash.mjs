import {openTitleAmount,paidTitleCash} from './titles.mjs';
// This is the existing title schedule, not the complete cash-flow model of Etapa 8.
// Managed cash comes from dated events, never from the last payment date of a title.
export function financialTitleEntries(rows,type,cashRows=[]){
 const result=[];
 for(const row of rows){
  const due=row.due_date??row.dueDate;const paid=row.paid_at??row.paidAt;
  const add=(id,situation,date,amount,kind)=>result.push({id,titleId:row.id,type,situation,effectiveDate:date,dueDate:due,paidAt:situation==='realized'?date:null,amount,cashKind:kind,source:row});
  if(row.status!=='cancelled'&&openTitleAmount(row)>0)add(row.id+':open','forecast',due,openTitleAmount(row),'open');
  if(row.finance_managed&&Number(row.finance_cash_gross)>0&&!cashRows.some(c=>c.title_id===row.id&&c.title_type===type))throw Error('Liquidações datadas não carregadas; não publicar caixa parcial');
  if(row.finance_managed){for(const c of cashRows.filter(c=>c.title_id===row.id&&c.title_type===type&&Number(c.cash_signed)!==0))add(`${row.id}:${c.event_id}`,'realized',c.effective_date,Number(c.cash_signed),c.cash_kind);}
  else if(row.status==='paid'&&paid)add(row.id+':legacy','realized',paid,paidTitleCash(row),'legacy_declared');
 }
 return result;
}
