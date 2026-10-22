'use server';
import {redirect} from 'next/navigation';
import {requireCompanyPermission} from '@/lib/workspace';
import {revalidateFinancialViews} from '@/lib/finance-core/revalidate';
import {toCents} from '@/lib/finance-core/cashflow.mjs';
const path='/financeiro/fluxo-de-caixa';
const text=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const optional=(f:FormData,k:string)=>text(f,k)||null;
function amount(s:string){if(!s.trim())throw Error('Valor não informado');const v=s.includes(',')?s.replaceAll('.','').replace(',','.'):s;return toCents(v)/100;}
export async function saveCashScenario(form:FormData){
 const {supabase,companyId,projectId}=await requireCompanyPermission('cashflow.manage');
 const parent=optional(form,'parent_id');const scopes=form.getAll('scope_key').map(String);const categories=form.getAll('category').map(String);const amounts=form.getAll('amount').map(String);const dates=form.getAll('expected_date').map(String);const titles=form.getAll('title_id').map(String);const sources=form.getAll('source_id').map(String);const activities=form.getAll('activity_id').map(String),lags=form.getAll('payment_lag_days').map(String);
 let rows;
 try{rows=scopes.flatMap((scope,i)=>scope.trim()?[{scope_key:scope.trim(),category:categories[i],amount_cents:toCents(String(amount(amounts[i]))),expected_date:dates[i]||null,title_id:titles[i]||null,title_type:categories[i]==='AR'?'AR':categories[i]==='R'?'AP':null,source_kind:categories[i]==='C'?'contract':['R','AR'].includes(categories[i])?'title':'documented_estimate',source_id:sources[i]||null,activity_id:activities[i]||null,payment_lag_days:activities[i]?Number(lags[i]):null}]:[]);}catch{redirect(path+'?error=Valores+financeiros+inválidos');}
 const {error}=await supabase.rpc('save_cash_scenario',{p_company:companyId,p_entity:text(form,'entity_id'),p_project:projectId,p_parent:parent,p_command:text(form,'command_id'),p_cutoff:text(form,'cutoff'),p_completion:text(form,'completion'),p_minimum:optional(form,'minimum')===null?null:amount(text(form,'minimum')),p_baseline:optional(form,'baseline_id'),p_rows:rows,p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Versão+financeira+preservada');
}
export async function validateCashOpening(form:FormData){
 const {supabase}=await requireCompanyPermission('finance.bank_accounts.reconcile');
 const {error}=await supabase.rpc('validate_cash_opening',{p_account:text(form,'account_id'),p_command:text(form,'command_id'),p_restricted:amount(text(form,'restricted')),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Evidência+do+saldo+inicial+registrada');
}
export async function linkCashCoverage(form:FormData){
 const {supabase,companyId,projectId}=await requireCompanyPermission('cashflow.manage');
 const [type,id]=text(form,'title').split(':');if(!['AP','AR'].includes(type)||!id)redirect(path+'?error=Título+inválido');
 const target=await supabase.from(type==='AP'?'payables':'receivables').select('project_id').eq('company_id',companyId).eq('id',id).maybeSingle();
 if(target.error||!target.data||projectId&&target.data.project_id!==projectId)redirect(path+'?error=Título+fora+do+escopo');
 const {error}=await supabase.rpc('link_cash_coverage',{p_company:companyId,p_entity:text(form,'entity_id'),p_project:target.data.project_id,p_scope:text(form,'scope_key'),p_scenario:text(form,'scenario_id'),p_type:type,p_title:id,p_command:text(form,'command_id'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Cobertura+documentada+sem+dupla+contagem');
}
export async function reprogramCashSchedule(form:FormData){
 const {supabase,companyId}=await requireCompanyPermission('cashflow.manage');
 const {error}=await supabase.rpc('reprogram_cash_schedule',{p_company:companyId,p_parent:text(form,'parent_id'),p_command:text(form,'command_id'),p_cutoff:text(form,'cutoff'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Nova+versão+ligada+ao+cronograma');
}
export async function convertCashScopeToContract(form:FormData){
 const {supabase,companyId}=await requireCompanyPermission('cashflow.manage');
 const {error}=await supabase.rpc('convert_cash_scope_to_contract',{p_company:companyId,p_parent:text(form,'parent_id'),p_command:text(form,'command_id'),p_scope:text(form,'scope_key'),p_contract:text(form,'contract_id'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Previsão+substituída+por+compromisso+na+nova+versão');
}
export async function recordCashTransfer(form:FormData){
 const {supabase,companyId}=await requireCompanyPermission('finance.bank_accounts.transfer');
 const {error}=await supabase.rpc('record_cash_transfer',{p_company:companyId,p_from:text(form,'from_account'),p_to:text(form,'to_account'),p_command:text(form,'command_id'),p_debit:text(form,'debit_date'),p_credit:optional(form,'credit_date'),p_amount:amount(text(form,'amount')),p_fee:amount(text(form,'fee')),p_nature:text(form,'nature'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Transferência+registrada+com+origem+e+destino');
}
export async function completeCashTransfer(form:FormData){
 const {supabase}=await requireCompanyPermission('finance.bank_accounts.transfer');
 const {error}=await supabase.rpc('complete_cash_transfer',{p_transfer:text(form,'transfer_id'),p_date:text(form,'credit_date'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Crédito+efetivo+registrado');
}
export async function reverseCashTransfer(form:FormData){
 const {supabase}=await requireCompanyPermission('finance.bank_accounts.transfer');
 const {error}=await supabase.rpc('reverse_cash_transfer',{p_original:text(form,'transfer_id'),p_command:text(form,'command_id'),p_debit:text(form,'debit_date'),p_credit:optional(form,'credit_date'),p_fee:amount(text(form,'fee')),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Evento+inverso+registrado+com+original+preservado');
}
export async function cancelSupplierAdvanceContract(form:FormData){
 const {supabase,companyId,projectId}=await requireCompanyPermission('payables.manage');
 const [contractId,advanceLine]=text(form,'advance').split(':');
 const target=await supabase.from('execution_service_contracts').select('project_id').eq('company_id',companyId).eq('id',contractId).maybeSingle();
 if(target.error||!target.data||projectId&&target.data.project_id!==projectId)redirect(path+'?error=Contrato+fora+do+escopo');
 const {error}=await supabase.rpc('cancel_supplier_advance_contract',{p_company:companyId,p_contract:contractId,p_advance_line:advanceLine,p_command:text(form,'command_id'),p_date:text(form,'effective_date'),p_no_execution_evidence:text(form,'no_execution_evidence'),p_refund_evidence:text(form,'refund_evidence'),p_reason:text(form,'reason'),p_expected_refund_date:optional(form,'expected_refund_date')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Cancelamento+documentado+e+direito+de+restituição+registrados');
}
export async function receiveSupplierRefund(form:FormData){
 const {supabase,companyId,projectId}=await requireCompanyPermission('payables.manage');
 const target=await supabase.from('finance_supplier_refund_rights').select('project_id').eq('company_id',companyId).eq('id',text(form,'right_id')).maybeSingle();
 if(target.error||!target.data||projectId&&target.data.project_id!==projectId)redirect(path+'?error=Direito+fora+do+escopo');
 const {error}=await supabase.rpc('receive_supplier_refund',{p_company:companyId,p_right:text(form,'right_id'),p_account:text(form,'account_id'),p_command:text(form,'command_id'),p_date:text(form,'effective_date'),p_amount:amount(text(form,'amount')),p_external_id:text(form,'external_id'),p_evidence:text(form,'evidence'),p_reason:text(form,'reason')});
 if(error)redirect(path+'?error='+encodeURIComponent(error.message));revalidateFinancialViews();redirect(path+'?success=Restituição+registrada+sem+reabrir+o+título+original');
}
