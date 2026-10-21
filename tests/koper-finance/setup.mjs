import fs from 'node:fs';
import { bootstrap, sql, ids } from '../financeiro/runtime.mjs';
export const migration = 'supabase/migrations/20261021140000_koper_financial_snapshots.sql';
export async function setup(container, candidate = true) {
  await bootstrap(container);
  await sql(container, fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql','utf8'));
  await prepareImportSchema(container);
  await sql(container,`insert into finance_company_controls values('${ids.a}',true),('${ids.b}',true);
    insert into finance_entity_permissions select '${ids.a}',e,'${ids.ug}',true,true from unnest(array['${ids.a1}'::uuid,'${ids.a2}'::uuid]) e;
    insert into finance_entity_permissions values('${ids.a}','${ids.a1}','${ids.ua}',true,true),('${ids.b}','${ids.b1}','${ids.ub}',true,true);`);
  if(candidate)await sql(container,fs.readFileSync(migration,'utf8'));
}

export async function prepareImportSchema(container) {
  // Missing historical DDL for payable_cost_allocations is explicitly scaffolded,
  // not represented as an inspected production schema. Financial bootstrap reused.
  await sql(container, `create table payable_cost_allocations(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,payable_id uuid,service_id uuid,budget_item_id uuid,wbs_code_snapshot text,service_name_snapshot text,allocation_amount numeric(16,2),allocation_percent numeric,resolution_method text,source_system text,source_id text,evidence jsonb,created_by uuid);
    create table engineering_services(id uuid primary key,company_id uuid,code text,description text);
    insert into engineering_services values('10000000-0000-4000-8000-000000000001','${ids.a}','S1','Serviço fictício');`);
  const mapping=fs.readFileSync('supabase/migrations/20261015111500_integration_mapping_foundation.sql','utf8');
  await sql(container,mapping.slice(0,mapping.indexOf('create or replace function public.resolve_integration_mapping'))+'commit;');
  await sql(container,`alter table payable_cost_allocations enable row level security;
    create policy fixture_allocation_read on payable_cost_allocations for select to authenticated using(public.has_company_permission(company_id,'payables.view'));
    grant select on payable_cost_allocations to authenticated;`);
  await sql(container,fs.readFileSync('supabase/migrations/20261018010000_clean_import_foundation.sql','utf8'));
  await sql(container,fs.readFileSync('supabase/migrations/20260801_0067_koper_staging_records.sql','utf8'));
  for(const enterprise of ['fixture-main','concurrent','crash','unknown-project','allocation','invalid','ct26-complete','ct26-retry','ct26-cursor','local-edit','local-bank','closed','bindings','no-entity']) {
    await sql(container,`select elos_import.map_put('${ids.a}',null,'enterprise','${enterprise}','company','${ids.a}','manual',null,null,'{"evidence":"fictitious-only"}');`);
  }
  await sql(container,`select elos_import.map_put('${ids.b}',null,'enterprise','fixture-main','company','${ids.b}','manual',null,null,'{"evidence":"fictitious-only"}');`);

  await sql(container,fs.readFileSync('supabase/migrations/20261018120000_clean_import_wave2e_nfe_payables.sql','utf8'));
}
