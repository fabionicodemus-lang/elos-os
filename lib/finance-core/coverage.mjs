// Approved definitions §7, §9, §11; values are integer BRL cents, never budget residuals.
function money(v){if(!Number.isSafeInteger(v)||v<0)throw Error('Valor financeiro desconhecido/inválido');return v;}
export function contractRemainder({valueCents,paidPrincipalCents,noncashReductionCents=0,representedOpenCents,complete=true}){
 if(!complete||[valueCents,paidPrincipalCents,noncashReductionCents,representedOpenCents].some(v=>v===null||v===undefined))return {C_cents:null,complete:false};
 const remainder=money(valueCents)-money(paidPrincipalCents)-money(noncashReductionCents)-money(representedOpenCents);
 return {C_cents:remainder<0?null:remainder,credit_or_overcoverage_cents:Math.max(0,-remainder),complete:remainder>=0};
}
export function financialCoverage({R_cents,items=[],P_cents,AF_cents=0,coverageComplete=false,incurred_cents=null,ETC_cents=null,budget_cents=null,expectedExternalCount=null,loadedExternalCount=0,reportedContractFutureCents=null}){
 const known=R_cents===null?null:money(R_cents);
 const coverage=items.map(contractRemainder);const complete=coverageComplete&&known!==null&&P_cents!==null&&coverage.every(x=>x.complete);
 const C=coverage.every(x=>x.complete)?coverage.reduce((s,x)=>s+x.C_cents,0):null;
 const Q=complete?known+C+money(P_cents):null;
 const economic=incurred_cents!==null&&ETC_cents!==null;
 const EAC=economic?money(incurred_cents)+money(ETC_cents):null;
 return {known_obligations_subtotal_cents:known,contract_amount_shown_separately_cents:reportedContractFutureCents,C_cents:C,P_cents,Q_cents:Q,AF_cents:money(AF_cents),Q_scenario_cents:Q===null?null:Q+AF_cents,
  incurred_cost_cents:incurred_cents,ETC_cents,EAC_cents:EAC,budget_variance_cents:EAC===null||budget_cents===null?null:EAC-money(budget_cents),
  budget_variance_percent:EAC===null||budget_cents===null||budget_cents===0?null:((EAC-budget_cents)*100/budget_cents).toFixed(2),
  external_coverage_percent:expectedExternalCount===null||expectedExternalCount===0?null:(loadedExternalCount*100/expectedExternalCount).toFixed(2),
  status:complete&&economic?'completo':'incompleto'};
}
export function economicEstimate({contracts=[],incurredOtherCents=0,uncoveredRemainingCents,budgetCents=null,riskCents=0}){
 if(uncoveredRemainingCents===null)return {ETC_cents:null,EAC_cents:null,complete:false};
 let incurred=money(incurredOtherCents),remaining=money(uncoveredRemainingCents);const firm=[];
 for(const contract of contracts){
  const value=money(contract.originalCents)+(contract.amendments??[]).filter(a=>a.status==='approved').reduce((s,a)=>s+money(a.amountCents),0);
  const accepted=money(contract.incurredCents);if(accepted>value)throw Error('Execução excede cobertura; reestimativa adicional necessária');
  firm.push(value);incurred+=accepted;remaining+=value-accepted;
 }
 const EAC=incurred+remaining;return {firm_values_cents:firm,incurred_cost_cents:incurred,ETC_cents:remaining,EAC_cents:EAC,variance_cents:budgetCents===null?null:EAC-money(budgetCents),variance_percent:budgetCents>0?((EAC-budgetCents)*100/budgetCents).toFixed(2):null,scenario_EAC_cents:EAC+money(riskCents),complete:true};
}
export function exclusiveFutureAdjustments(future,recognizedIds){const seen=new Set();return future.reduce((s,a)=>{if(seen.has(a.id))throw Error('Ajuste futuro duplicado');seen.add(a.id);return s+(recognizedIds.has(a.id)?0:money(a.amountCents));},0);}
