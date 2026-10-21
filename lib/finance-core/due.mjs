import {titlePosition} from './titles.mjs';
export function dueBuckets(rows,cutoff){
 const date=new Date(cutoff+'T12:00:00Z');if(Number.isNaN(date.getTime()))throw Error('Corte inválido');
 const add=d=>new Date(date.getTime()+d*86400000).toISOString().slice(0,10);
 const result={R_cents:0,overdue_cents:0,due_today_cents:0,next_30_days_cents:0,next_90_days_cents:0,beyond_90_days_cents:0,unknown_due_cents:0,immediate_need_through_30_days_cents:0};
 for(const row of rows){const p=titlePosition(row);if(p.openCents===null)throw Error('Obrigação com saldo desconhecido');const n=p.openCents;const due=row.due_date??row.dueDate;result.R_cents+=n;
 if(!due){result.unknown_due_cents+=n;continue;}if(due<cutoff)result.overdue_cents+=n;else if(due===cutoff)result.due_today_cents+=n;else{if(due<=add(30))result.next_30_days_cents+=n;if(due<=add(90))result.next_90_days_cents+=n;else result.beyond_90_days_cents+=n;}}
 result.immediate_need_through_30_days_cents=result.overdue_cents+result.due_today_cents+result.next_30_days_cents;return result;
}
