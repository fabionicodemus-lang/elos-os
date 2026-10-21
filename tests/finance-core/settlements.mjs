import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {start,sql,exec,ids,asUser} from '../financeiro/runtime.mjs';
import {setup} from '../koper-finance/setup.mjs';
const output=process.env.FINANCE7_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa7-calculos/evidencias';fs.mkdirSync(output,{recursive:true});
const migration='supabase/migrations/20261021160000_financial_settlement_ledger.sql';
const container=await start(),results=[],states={};
const q=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
const j=s=>JSON.parse(s.split('\n').findLast(x=>x.startsWith('{')));
const query=text=>sql(container,asUser(ids.ug,text));
const run=(lines,command=crypto.randomUUID(),reason='Liquidação fictícia aprovada')=>query(`select settle_finance_titles('${ids.a}','${command}','${ids.bank1}','2026-10-21',${q(lines)},'${reason}')`).then(j);
const title=async(amount,id=crypto.randomUUID())=>{await query(`select set_config('finance.reason','Criação fictícia',true);insert into payables(id,company_id,project_id,supplier_id,amount,due_date,created_by) values('${id}','${ids.a}','${ids.pa1}','${ids.sa}',${amount},'2026-10-21','${ids.ug}')`);return id;};
const balance=id=>query(`select to_jsonb(p) from payables p where id='${id}'`).then(j);
async function check(name,fn){try{results.push({name,pass:true,evidence:await fn()});}catch(e){results.push({name,pass:false,error:e.message});}}
try{
 await setup(container);
 await sql(container,fs.readFileSync(migration,'utf8'));
 await check('exemplo_100000_30000_70000',async()=>{
  const id=await title(100000);const a=await run([{type:'AP',title_id:id,principal:30000}]);const partial=await balance(id);
  assert.equal(partial.finance_open_amount,70000);assert.equal(partial.status,'open');assert.equal(partial.finance_principal_paid,30000);
  await run([{type:'AP',title_id:id,principal:70000}]);const final=await balance(id);assert.equal(final.finance_open_amount,0);assert.equal(final.status,'paid');return {partial,final,first_event:a};
 });
 await check('CT07_componentes',async()=>{
  const id=await title(100000);await run([{type:'AP',title_id:id,principal:40000}]);const first=await balance(id);
  await query(`select add_finance_title_interest('${ids.a}','AP','${id}','${crypto.randomUUID()}',2000,'2026-10-21','Juros explícitos da fixture CT07')`);
  const second=await run([{type:'AP',title_id:id,principal:55000,interest:2000,discount:5000,evidence:'desconto-contratual-ficticio'}]);
  const final=await balance(id);assert.equal(first.finance_open_amount,60000);assert.equal(final.finance_open_amount,0);assert.equal(final.finance_principal_paid,95000);assert.equal(final.finance_interest_paid,2000);assert.equal(final.finance_cash_gross,97000);assert.equal(final.finance_discount,5000);
  states.CT07={after_first_open_principal_cents:first.finance_open_amount*100,second_principal_cents:Number(await sql(container,`select principal*100 from finance_settlement_lines where event_id='${second.event_id}'`)),final_open_cents:final.finance_open_amount*100,H_principal_cents:final.finance_principal_paid*100,N_discount_cents:final.finance_discount*100,interest_paid_cents:final.finance_interest_paid*100,I02_cash_cents:final.finance_cash_gross*100,C_cents:(100000-final.finance_principal_paid-final.finance_discount)*100};
  return {id,first,final,second,actual:states.CT07};
 });
 await check('replay_concorrencia_e_excesso',async()=>{
  const id=await title(1000);const command=crypto.randomUUID();const request=[{type:'AP',title_id:id,principal:300}];
  const pair=await Promise.all([run(request,command),run(request,command)]);assert.equal(pair[0].event_id,pair[1].event_id);assert.equal((await balance(id)).finance_open_amount,700);
  await assert.rejects(()=>run([{type:'AP',title_id:id,principal:701}]),/superior ao saldo/);await assert.rejects(()=>run([{type:'AP',title_id:id,principal:301}],command),/conteúdo diferente/);
  assert.equal((await balance(id)).finance_open_amount,700);return {pair,balance:await balance(id)};
 });
 await check('estorno_sem_devolucao_nao_reescreve_caixa',async()=>{
  const id=await title(1000);const paid=await run([{type:'AP',title_id:id,principal:300}]);const cmd=crypto.randomUUID();
  const r=await query(`select reverse_finance_settlement('${ids.a}','${paid.event_id}','${cmd}','2026-10-21','Estorno sem devolução fictício',true,0,null)`).then(j);
  const b=await balance(id);assert.equal(b.finance_open_amount,1000);assert.equal(b.finance_cash_gross,300);assert.equal(b.finance_cash_pending,300);assert.equal(b.finance_cash_refunded,0);
  const retry=await query(`select reverse_finance_settlement('${ids.a}','${paid.event_id}','${cmd}','2026-10-21','Estorno sem devolução fictício',true,0,null)`).then(j);assert.equal(retry.event_id,r.event_id);
  await assert.rejects(()=>query(`select reverse_finance_settlement('${ids.a}','${paid.event_id}','${crypto.randomUUID()}','2026-10-21','Segundo estorno inválido',true,0,null)`),/já estornado/);return b;
 });
 for(const [variant,keep,refund] of [['A',true,57000],['B',false,57000],['C',true,0]])await check('CT08_'+variant,async()=>{
  const id=await title(100000);await run([{type:'AP',title_id:id,principal:40000}]);await query(`select add_finance_title_interest('${ids.a}','AP','${id}','${crypto.randomUUID()}',2000,'2026-10-21','Juros explícitos da fixture CT08')`);
  const second=await run([{type:'AP',title_id:id,principal:55000,interest:2000,discount:5000,evidence:'desconto-ficticio'}]);
  await query(`select reverse_finance_settlement('${ids.a}','${second.event_id}','${crypto.randomUUID()}','2026-10-21','Reversão explícita da fixture CT08',${keep},${refund},'extrato-ficticio')`);
  const b=await balance(id);assert.equal(b.finance_open_amount,keep?57000:62000);assert.equal(b.finance_cash_refunded,refund);assert.equal(b.finance_cash_gross,97000);
  states.CT08??={};states.CT08[variant]=variant==='C'?{confirmed_refund_cents:b.finance_cash_refunded*100,gross_historical_outflow_cents:b.finance_cash_gross*100,cash_awaiting_reallocation_cents:b.finance_cash_pending*100,Q_complete:b.finance_cash_pending===0}:{open_principal_cents:(b.amount-b.finance_principal_paid-b.finance_discount)*100,open_interest_cents:(b.finance_interest_due-b.finance_interest_paid)*100,R_cents:b.finance_open_amount*100,...(variant==='A'?{gross_historical_outflow_cents:b.finance_cash_gross*100,confirmed_refund_cents:b.finance_cash_refunded*100}:{}),net_outflow_cents:(b.finance_cash_gross-b.finance_cash_refunded)*100};return {balance:b,actual:states.CT08[variant]};
 });
 await check('CT23_pagamento_agrupado',async()=>{
  const a=await title(10000),b=await title(10000);const one=await run([{type:'AP',title_id:a,principal:6000},{type:'AP',title_id:b,principal:4000}]);
  const pa=await balance(a),pb=await balance(b);const cmd=crypto.randomUUID();const two=await run([{type:'AP',title_id:a,principal:4000},{type:'AP',title_id:b,principal:2000}],cmd);await run([{type:'AP',title_id:a,principal:4000},{type:'AP',title_id:b,principal:2000}],cmd);
  const fa=await balance(a),fb=await balance(b);const bank=j(await sql(container,`select jsonb_build_object('count',count(*),'cash',sum(amount)) from finance_bank_transactions where id in('${one.bank_transaction_id}','${two.bank_transaction_id}')`));
  states.CT23={after_P1_A_open_cents:pa.finance_open_amount*100,after_P1_B_open_cents:pb.finance_open_amount*100,final_A_open_cents:fa.finance_open_amount*100,final_B_open_cents:fb.finance_open_amount*100,final_I03_cents:(fa.finance_open_amount+fb.finance_open_amount)*100,I02_cash_cents:bank.cash*100,unique_bank_debits:bank.count,new_cash_from_reimport_cents:(bank.count-2)*100};
  assert.equal(fa.finance_open_amount,0);assert.equal(fb.finance_open_amount,4000);return states.CT23;
 });
 await check('CT30_excedente_classificado',async()=>{
  const id=await title(1000);await assert.rejects(()=>run([{type:'AP',title_id:id,principal:1200}]),/superior/);
  const r=await run([{type:'AP',title_id:id,principal:1000,excess_credit:200,credit_class:'refund_receivable',evidence:'credito-aprovado-fixture'}]);const b=await balance(id);
  const before=Number(await sql(container,`select count(*) from finance_settlement_lines where title_id='${id}'`));
  await assert.rejects(()=>run([{type:'AP',title_id:id,principal:1200}]),/não disponível/);
  const after=Number(await sql(container,`select count(*) from finance_settlement_lines where title_id='${id}'`));
  const credit=Number(await sql(container,`select excess_credit from finance_settlement_lines where event_id='${r.event_id}'`));
  states.CT30={open_payable_cents:b.finance_open_amount*100,principal_settled_cents:b.finance_principal_paid*100,refund_receivable_cents:credit*100,confirmed_cash_outflow_cents:b.finance_cash_gross*100,unexplained_negative_balance_cents:Math.min(0,b.finance_open_amount)*100,second_allocation_mutations:after-before};assert.equal(credit,200);return states.CT30;
 });
 await check('adiantamento_AP_disponibilidade_aplicacao_e_reversao',async()=>{
  const advance=await title(20000),invoice=await title(40000);const funding=await run([{type:'AP',title_id:advance,principal:20000,credit_class:'supplier_advance',scope_ref:'CONTRACT-FICTITIOUS',evidence:'adiantamento-aprovado'}]);
  const credit=await sql(container,`select id from finance_settlement_lines where event_id='${funding.event_id}'`);
  const cmd=crypto.randomUUID();const application=[{type:'AP',title_id:invoice,noncash:20000,noncash_kind:'advance_application',credit_line_id:credit,scope_ref:'CONTRACT-FICTITIOUS',evidence:'aplicacao-ficticia'}];
  const applied=await run(application,cmd);await run(application,cmd);
  assert.equal((await balance(invoice)).finance_open_amount,20000);assert.equal((await balance(invoice)).finance_cash_gross,0);
  await assert.rejects(()=>run([{...application[0],noncash:1}]),/crédito disponível/);
  await assert.rejects(()=>query(`select reverse_finance_settlement('${ids.a}','${funding.event_id}','${crypto.randomUUID()}','2026-10-21','Origem com aplicação vigente',true,0,null)`),/aplicações/);
  await query(`select reverse_finance_settlement('${ids.a}','${applied.event_id}','${crypto.randomUUID()}','2026-10-21','Reversão de aplicação fictícia',true,0,null)`);
  assert.equal((await balance(invoice)).finance_open_amount,40000);return {funding,applied,balance:await balance(invoice)};
 });
 await check('recebimento_parcial_tarifa_permuta_e_coorte',async()=>{
  // Uses real sales/clients/units from the reused foundation fixture.
  const ar=crypto.randomUUID();await query(`insert into receivables(id,company_id,project_id,sale_id,unit_id,client_id,category,description,sequence_number,sequence_total,amount,adjusted_amount,due_date) values('${ar}','${ids.a}','${ids.pa1}','${ids.sale1}','${ids.u1}','${ids.ca}','monthly','Fixture AR',1,1,10000,10000,'2026-10-21')`);
  await run([{type:'AR',title_id:ar,principal:3000}]);
  const first=j(await query(`select to_jsonb(r) from receivables r where id='${ar}'`));assert.equal(first.finance_open_amount,7000);assert.equal(first.correction_locked,true);
  await run([{type:'AR',title_id:ar,principal:7000,fee:200,evidence:'tarifa-extrato-ficticio'}]);
  const final=j(await query(`select to_jsonb(r) from receivables r where id='${ar}'`));assert.equal(final.finance_open_amount,0);assert.equal(final.finance_cash_gross,9800);return {first,final};
 });
 await check('permissoes_integridade_e_auditoria',async()=>{
  const id=await title(1000);const req=[{type:'AP',title_id:id,principal:1}];
  await assert.rejects(()=>sql(container,asUser(ids.ur,`select settle_finance_titles('${ids.a}','${crypto.randomUUID()}','${ids.bank1}','2026-10-21',${q(req)},'Tentativa sem perfil')`)),/Sem permissão/);
  await assert.rejects(()=>sql(container,asUser(ids.ub,`select settle_finance_titles('${ids.a}','${crypto.randomUUID()}','${ids.bank1}','2026-10-21',${q(req)},'Outra organização')`)),/Sem permissão/);
  await assert.rejects(()=>run([{type:'AP',title_id:id,principal:1.005}]),/exato/);
  const r=await run(req);await assert.rejects(()=>sql(container,`update finance_settlement_events set reason='forjado' where id='${r.event_id}'`),/Histórico imutável/);
  await assert.rejects(()=>sql(container,asUser(ids.ug,`update payables set finance_principal_paid=500 where id='${id}'`)),/operação financeira/);
  return {preserved:await balance(id)};
 });
 await check('concorrencia_dois_comandos_nao_excede_saldo_e_agendamento_nao_baixa',async()=>{
  const id=await title(1000);
  const requests=await Promise.allSettled([run([{type:'AP',title_id:id,principal:300}]),run([{type:'AP',title_id:id,principal:800}])]);
  assert.equal(requests.filter(x=>x.status==='fulfilled').length,1);const b=await balance(id);assert.ok(b.finance_open_amount===700||b.finance_open_amount===200);
  await assert.rejects(()=>query(`select settle_finance_titles('${ids.a}','${crypto.randomUUID()}','${ids.bank1}','2099-01-01',${q([{type:'AP',title_id:id,principal:1}])},'Pagamento apenas agendado')`),/Agendamento/);
  assert.equal((await balance(id)).finance_open_amount,b.finance_open_amount);
  await assert.rejects(()=>sql(container,asUser(ids.ug,`update payables set status='paid' where id='${id}'`)),/operação/);
  return {accepted:1,rejected:1,balance:b};
 });
 await check('rateio_de_devolucao_agrupada_conserva_centavos',async()=>{
  const titles=await Promise.all([title(1),title(1),title(1)]);
  const paid=await run(titles.map(id=>({type:'AP',title_id:id,principal:1})));
  const reverse=await query(`select reverse_finance_settlement('${ids.a}','${paid.event_id}','${crypto.randomUUID()}','2026-10-21','Devolução parcial agrupada',true,0.01,'extrato-ficticio-centavo')`).then(j);
  const actual=j(await sql(container,`select jsonb_build_object('refund',sum(cash_signed),'rows',count(*)) from finance_settlement_cash_rows where event_id='${reverse.event_id}'`));
  assert.equal(actual.refund,-0.01);
  const b=await Promise.all(titles.map(balance));assert.equal(b.reduce((s,x)=>s+Math.round(x.finance_cash_refunded*100),0),1);return actual;
 });
 await check('IA_propostas_iguais_distintas_replay_e_isolamento',async()=>{
  const raw=fs.readFileSync('supabase/migrations/20261014100000_elos_ia_safe_write.sql','utf8');
  await sql(container,raw.slice(raw.indexOf('create table if not exists public.ai_action_proposals'),raw.indexOf('create index if not exists ai_action_proposals_company_status_idx')));
  await sql(container,`alter table ai_action_proposals drop constraint ai_action_proposals_action_type_check;alter table ai_action_proposals enable row level security;`);
  await sql(container,fs.readFileSync('supabase/migrations/20261021163000_financial_ai_settlements.sql','utf8'));
  const id=await title(1000);const proposals=[crypto.randomUUID(),crypto.randomUUID()];
  for(const proposal of proposals){await sql(container,`insert into ai_action_proposals(id,company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,created_by) values('${proposal}','${ids.a}','${ids.pa1}','${crypto.randomUUID()}','financeiro','finance_payable_payment','payables.manage','Parcial fictícia',${q({payableId:id,accountId:ids.bank1,paidAt:'2026-10-21',paidAmount:300})},'${ids.ug}')`);await query(`select ai_execute_action_proposal('${proposal}')`);}
  await query(`select ai_execute_action_proposal('${proposals[0]}')`);assert.equal((await balance(id)).finance_open_amount,400);
  const foreign=crypto.randomUUID();await sql(container,`insert into ai_action_proposals(id,company_id,project_id,turn_id,persona,action_type,required_permission,title,status,result,created_by) values('${foreign}','${ids.b}','${ids.pb1}','${crypto.randomUUID()}','financeiro','finance_payable_payment','payables.manage','Outro contexto','executed','{"private":"fictitious-B"}','${ids.ub}')`);
  await assert.rejects(()=>sql(container,asUser(ids.ua,`select ai_execute_action_proposal('${foreign}')`)),/permissão/);
  return {balance:await balance(id),distinct_proposals:2,replay_without_new_payment:true,foreign_executed_result_denied:true};
 });
 await check('CT12_limitacao_operacional_sem_obra_reproduzida',async()=>{
  const rows=[{external_id:'CT12-A',installment:'1',principal_cents:600000,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-21',effective_date:'2026-10-21',legal_entity_id:ids.a1,project_id:ids.pa1,supplier_id:ids.sa,obligation_evidence:'fato-ficticio-documentado'},
   {external_id:'CT12-U',installment:'1',principal_cents:400000,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-21',effective_date:'2026-10-21',legal_entity_id:ids.a1,project_id:null,supplier_id:ids.sa,obligation_evidence:'fato-ficticio-documentado'}];
  const raw=JSON.stringify(rows);const body={enterprise_id:'unknown-project',currency:'BRL',monetary_basis:'principal',extracted_at:'2026-10-21T12:00:00Z',period_start:'2026-10-01',period_end:'2026-10-21',cutoff:'2026-10-21',reason:'Caso CT12 sem obra definida',records:rows,pages:[{raw,sha256:crypto.createHash('sha256').update(raw).digest('hex'),request_cursor:null,next_cursor:null}],manifest:{complete:true,expected_count:2,unique_count:2,subtotal_cents:1000000}};
  const imported=await sql(container,`begin;set local role service_role;select set_config('request.jwt.claim.sub','${ids.ug}',true);select elos_import.apply_financial_batch('${ids.a}','${crypto.randomUUID()}',${q(body)});commit;`).then(j);
  const pending=imported.reconciliation.rows.find(x=>x.external_id==='CT12-U');assert.equal(pending.target_id,null);
  await assert.rejects(()=>run([{type:'AP',title_id:pending.object_id,principal:2000}]),/Título indisponível/);
  return {classification:'reprovado_no_fluxo_integral',expected_entity_open_cents:800000,observed_reported_entity_open_cents:imported.after.principal_minus_declared_paid_cents,quarantined_cents:imported.after.without_project_cents,payment_blocked_without_operational_title:true,automatic_Flow_allocation_cents:0,imported};
 });
}catch(e){results.push({name:'bootstrap',pass:false,error:e.message});}
finally{await exec('docker',['rm','-f',container]);const report={base_commit:'95d659e',executed_at:new Date().toISOString(),migration_sha256:crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex'),network:'none',container_removed:true,results,states,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length};fs.writeFileSync(output+'/liquidacoes.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:results.filter(r=>!r.pass)}));if(report.failed)process.exitCode=1;}
