import {sql,j} from './finance-rpc-runtime.mjs';
export const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const users={Aadmin:id(1),Badmin:id(2),Afinance:id(3),Bfinance:id(4),Aviewer:id(5),Bviewer:id(6),Bapprover:id(7),Bprogress:id(8)};
export async function fixture(db){
 await sql(db,`set role postgres;insert into auth.users(id,email) values ${Object.entries(users).map(([k,v])=>`('${v}','${k.toLowerCase()}@example.invalid')`).join(',')};`);
 const data={};
 for(const [index,company] of ['A','B'].entries()){
  const n=100+index*100,c=id(n),p=id(n+1),s=id(n+2),svc=id(n+3),bank=id(n+4),admin=users[company+'admin'];
  const d={company:c,project:p,supplier:s,service:svc,bank};data[company]=d;
  await sql(db,`set role postgres;
   insert into companies(id,name,slug,created_by) values('${c}','Construtora ${company==='A'?'Horizonte':'Atlântico'}','ficticia-${company.toLowerCase()}','${admin}');
   insert into projects(id,company_id,name,created_by) values('${p}','${c}','Obra fictícia ${company}','${admin}');
   insert into suppliers(id,company_id,legal_name) values('${s}','${c}','Fornecedor fictício ${company}');
   insert into engineering_services(id,company_id,code,description,unit) values('${svc}','${c}','S-FAKE','Serviço fictício','un');
   insert into finance_bank_accounts(id,company_id,label,bank_name,account_number,opening_balance,allow_negative) values('${bank}','${c}','Conta fictícia','Banco fictício','${index+1}',100000,false);`);
  for(const [key,role,permissions] of [
   [company+'admin','admin',[]],
   [company+'finance','finance',['payables.view','payables.manage','finance.bank_accounts.view','finance.bank_accounts.manage']],
   [company+'viewer','viewer',['payables.view','execution.contracts.view','execution.work_orders.view']],
   ...(company==='B'?[['Bapprover','minimal_approver',['execution.measurements.approve']],['Bprogress','minimal_progress',['execution.work_orders.progress']]]:[])
  ]){
   const r=id(n+50+Object.keys(users).indexOf(key));
   await sql(db,`set role postgres;insert into roles(id,company_id,key,name) values('${r}','${c}','${role}','${role} fictício');insert into company_memberships(company_id,user_id,role_id) values('${c}','${users[key]}','${r}');${permissions.length?`insert into role_permissions(role_id,permission_key) select '${r}',key from permissions where key in(${permissions.map(x=>"'"+x+"'").join(',')});`:''}`);
  }
  for(const [offset,kind,amount] of [[10,'base',100000],[20,'draft',30000],[30,'new',100000]]){
   const request=id(n+offset),ri=id(n+offset+1),competition=id(n+offset+2),offer=id(n+offset+3),contract=id(n+offset+4),item=id(n+offset+5),stage=id(n+offset+6);
   const x={request,request_item:ri,competition,offer,contract,item,stage,amount};d[kind]=x;
   await sql(db,`set role postgres;
    insert into execution_service_requests(id,company_id,project_id,sequence_no,request_number,title,scope_summary,status,created_by) values('${request}','${c}','${p}',${offset},'SS-${offset}','Solicitação fictícia','Escopo fictício','competition','${admin}');
    insert into execution_service_request_items(id,company_id,project_id,request_id,service_id,service_code,service_name,unit_snapshot,requested_quantity,estimated_unit_price,estimated_total) values('${ri}','${c}','${p}','${request}','${svc}','S-FAKE','Serviço fictício','un',100,${amount/100},${amount});
    insert into execution_service_competitions(id,company_id,project_id,request_id,sequence_no,competition_number,title,status,created_by) values('${competition}','${c}','${p}','${request}',${offset},'MC-${offset}','Concorrência fictícia','approved','${admin}');
    insert into execution_service_competition_offers(id,company_id,project_id,competition_id,supplier_id,total_amount,status) values('${offer}','${c}','${p}','${competition}','${s}',${amount},'winner');
    insert into execution_service_competition_offer_items(company_id,project_id,offer_id,request_item_id,offered_quantity,unit_price,total_amount) values('${c}','${p}','${offer}','${ri}',100,${amount/100},${amount});
    update execution_service_competitions set winner_offer_id='${offer}',winner_supplier_id='${s}' where id='${competition}';`);
   if(kind==='new')continue;
   await sql(db,`set role postgres;
    insert into execution_service_contracts(id,company_id,project_id,supplier_id,sequence_no,contract_number,title,scope_summary,status,start_date,end_date,current_value,created_by,source_request_id,source_competition_id,retention_percent)
     values('${contract}','${c}','${p}','${s}',${offset},'CT-${offset}','Contrato fictício','Escopo fictício','${kind==='draft'?'draft':'active'}','2026-01-01','2026-12-31',${amount-10000},'${admin}','${request}','${competition}',10);
    insert into execution_service_contract_items(id,company_id,project_id,contract_id,service_id,service_code,service_name,unit_snapshot,contracted_quantity,unit_price,total_value) values('${item}','${c}','${p}','${contract}','${svc}','S-FAKE','Serviço fictício','un',100,${amount/100},${amount});
    insert into execution_service_contract_stages(id,company_id,project_id,contract_id,contract_item_id,service_id,stage_code,stage_name,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value) values('${stage}','${c}','${p}','${contract}','${item}','${svc}','ET-01','Execução',100,'un',100,${amount/100},${amount});
    update execution_service_competitions set generated_contract_id='${contract}' where id='${competition}';`);
  }
  d.measurement=id(n+40);d.payable=id(n+41);d.bad_payable=id(n+42);d.order=id(n+43);d.order_item=id(n+44);
  await sql(db,`set role postgres;
   insert into execution_contract_measurements(id,company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,gross_amount,contractual_retention_amount,total_deductions,net_amount,created_by) values('${d.measurement}','${c}','${p}','${d.base.contract}','${s}',1,'MED-001','2026-10-01','2026-10-20','invoiced',20000,2000,2000,18000,'${admin}');
   insert into execution_contract_measurement_items(company_id,project_id,measurement_id,contract_id,contract_item_id,service_id,service_code,service_name,unit_snapshot,contracted_quantity,current_quantity,accumulated_quantity,unit_price,current_amount,accumulated_amount,contract_stage_id) values('${c}','${p}','${d.measurement}','${d.base.contract}','${d.base.item}','${svc}','S-FAKE','Serviço fictício','un',100,20,20,1000,20000,20000,'${d.base.stage}');
   insert into payables(id,company_id,project_id,supplier_id,document,due_date,amount,source_system,source_id,created_by) values('${d.payable}','${c}','${p}','${s}','MED-001','2026-10-25',18000,'elos_os','measurement:${d.measurement}','${admin}');
   update execution_contract_measurements set payable_id='${d.payable}' where id='${d.measurement}';
   insert into payables(id,company_id,project_id,supplier_id,document,due_date,amount,created_by) values('${d.bad_payable}','${c}','${p}','${s}','Fictício inválido','2026-10-25',18000,'${admin}');
   insert into execution_work_orders(id,company_id,project_id,contract_id,supplier_id,sequence_no,work_order_number,title,scope_summary,status,planned_start,planned_finish,created_by) values('${d.order}','${c}','${p}','${d.base.contract}','${s}',1,'OS-001','OS fictícia','Escopo fictício','released','2026-10-01','2026-10-31','${admin}');
   insert into execution_work_order_items(id,company_id,project_id,work_order_id,contract_id,contract_item_id,service_id,service_code,service_name,unit_snapshot,authorized_quantity,unit_price,authorized_value,executed_quantity,executed_value,accepted_quantity,accepted_value,measured_quantity,measured_value) values('${d.order_item}','${c}','${p}','${d.order}','${d.base.contract}','${d.base.item}','${svc}','S-FAKE','Serviço fictício','un',20,1000,20000,8,8000,7,7000,6,6000);`);
 }
 return data;
}
export const generateArgs=d=>[d.company,d.project,d.new.competition,'Novo contrato fictício','Escopo fictício','2026-01-01','2026-12-31',null,10,0,0,15,null,null,null,null,null,null,[{request_item_id:d.new.request_item,stages:[{name:'Execução',weight_percent:100}]}]];
export const sqlArgs=args=>args.map(x=>x===null?'null':Array.isArray(x)||typeof x==='object'?j(x):typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'").join(',');
