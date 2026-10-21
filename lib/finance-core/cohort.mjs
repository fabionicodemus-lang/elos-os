import { titlePosition } from './titles.mjs';
export function delinquencyOfCohort(rows,{cutoff,from=null}){
 let due=0,overdue=0,complete=true;
 for(const row of rows){
  const date=row.due_date??row.dueDate;if(!date){complete=false;continue;}
  if(date>cutoff||from&&date<from||row.status==='cancelled')continue;
  const p=titlePosition(row);if(p.principalCents===null){complete=false;continue;}
  due+=p.principalCents;
  if(date<cutoff)overdue+=Math.max(0,p.principalCents-p.paidPrincipalCents-(p.discountCents??0)-(p.noncashCents??0));
 }
 return {due_principal_cents:due,overdue_principal_cents:overdue,percent:complete&&due>0?(overdue*100/due).toFixed(2):null,complete};
}
