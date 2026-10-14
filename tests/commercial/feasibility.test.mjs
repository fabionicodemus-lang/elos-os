import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calculateFeasibility } from "../../lib/commercial/feasibility.mjs";

const migration = readFileSync(new URL("../../supabase/migrations/20261014062000_commercial_feasibility_studies.sql", import.meta.url), "utf8");
const integrity = readFileSync(new URL("../../supabase/migrations/20261014062100_commercial_feasibility_integrity.sql", import.meta.url), "utf8");

const baseStudy = {
  garage_stairs_area_m2:500, garage_stairs_cost_m2:1000,
  lobby_area_m2:100, lobby_cost_m2:2000,
  decorated_common_area_m2:200, decorated_common_cost_m2:3000,
  apartment_cost_m2:2500, design_cost_m2:100,
  land_cash_amount:1000000, iptu_amount:100000, onerous_grant_amount:500000, other_land_amount:0,
  commission_pct:6, tax_regime:"ret", tax_rate_pct:4,
  marketing_amount:300000, central_office_amount:400000, financial_cost_amount:200000, contingency_pct:5,
  preconstruction_months:6, construction_duration_months:30, sales_start_offset_months:-3, sales_velocity_units_month:2,
  entry_pct:10, during_construction_pct:40, keys_pct:20, post_keys_pct:30, post_keys_months:24, discount_rate_annual_pct:15,
};
const units=[{name:"Tipo 70",quantity:36,private_area_m2:70,sale_price_m2:10000,barter_units:6}];

test("motor de viabilidade separa permuta do custo do terreno e calcula retorno",()=>{
  const r=calculateFeasibility(baseStudy,units);
  assert.equal(r.gross_vgv,25_200_000);
  assert.equal(r.barter_vgv,4_200_000);
  assert.equal(r.available_vgv,21_000_000);
  assert.equal(r.land_cost,1_600_000);
  assert.equal(r.apartment_area_m2,2520);
  assert.equal(r.built_area_m2,3320);
  assert.equal(r.construction_cost,7_600_000);
  assert.equal(r.design_cost,332_000);
  assert.equal(r.total_cost,12_912_000);
  assert.equal(r.profit,8_088_000);
  assert.ok(r.margin_pct > 38 && r.margin_pct < 39);
  assert.ok(r.exposure_max > 0);
  assert.ok(r.irr_annual_pct !== null && Number.isFinite(r.irr_annual_pct));
  const receipts=r.cashflow.reduce((sum,row)=>sum+row.receipts,0);
  const taxes=r.cashflow.reduce((sum,row)=>sum+row.taxes,0);
  assert.ok(Math.abs(receipts-r.available_vgv)<0.01);
  assert.ok(Math.abs(taxes-r.tax_cost)<0.01);
});

test("aumentar permuta reduz VGV disponível sem duplicar custo de terreno",()=>{
  const low=calculateFeasibility(baseStudy,[{...units[0],barter_units:2}]);
  const high=calculateFeasibility(baseStudy,[{...units[0],barter_units:10}]);
  assert.equal(low.land_cost,high.land_cost);
  assert.ok(high.available_vgv<low.available_vgv);
  assert.ok(high.barter_vgv>low.barter_vgv);
});

test("migration converte estudo aprovado em empreendimento e congela baseline",async()=>{
  const db=new PGlite();
  const uid="11111111-1111-4111-8111-111111111111";
  const company="22222222-2222-4222-8222-222222222222";
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table public.companies(id uuid primary key);
      create table public.legal_entities(id uuid primary key,company_id uuid not null,legal_name text,unique(company_id,id));
      create table public.projects(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, name text not null, code text, city text, state text,
        status text, project_type text, legal_entity_id uuid, built_area_m2 numeric default 0, private_area_m2 numeric default 0,
        common_area_m2 numeric default 0,total_units integer default 0,construction_start_date date,delivery_date date,
        description text,notes text,created_by uuid,unique(company_id,name)
      );
      create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated;
      grant select,insert,update on public.projects to authenticated;
      insert into auth.users values('${uid}'); insert into companies values('${company}');
      select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false);
    `);
    await db.exec(migration);
    await db.exec(integrity);
    await db.exec(`set role authenticated;`);
    const study=(await db.query(`insert into commercial_feasibility_studies(company_id,name,code,apartment_cost_m2,garage_stairs_area_m2,garage_stairs_cost_m2,approved_metrics,approved_cashflow,created_by) values($1,'Tom Jobim','TJ',2500,500,1000,$2::jsonb,$3::jsonb,$4) returning id`,[
      company, JSON.stringify({total_units:36,apartment_area_m2:2520,built_area_m2:3320}), JSON.stringify([{month:0,net:-1000},{month:1,net:2000}]), uid,
    ])).rows[0].id;
    await db.query(`insert into commercial_feasibility_unit_types(company_id,study_id,name,quantity,private_area_m2,sale_price_m2,barter_units,created_by) values($1,$2,'Tipo 70',36,70,10000,6,$3)`,[company,study,uid]);
    const result=(await db.query(`select commercial_convert_feasibility_study($1) result`,[study])).rows[0].result;
    assert.ok(result.project_id);
    const project=(await db.query(`select name,status,total_units,built_area_m2,private_area_m2 from projects where id=$1`,[result.project_id])).rows[0];
    assert.equal(project.name,"Tom Jobim"); assert.equal(project.status,"planning"); assert.equal(project.total_units,36);
    assert.equal(Number(project.built_area_m2),3320); assert.equal(Number(project.private_area_m2),2520);
    const converted=(await db.query(`select status,converted_project_id from commercial_feasibility_studies where id=$1`,[study])).rows[0];
    assert.equal(converted.status,"converted"); assert.equal(converted.converted_project_id,result.project_id);
    await assert.rejects(db.query(`update commercial_feasibility_studies set name='Alterado' where id=$1`,[study]),/imutável/);
    await assert.rejects(db.query(`delete from commercial_feasibility_unit_types where study_id=$1`,[study]),/imutáveis/);
  }finally{await db.close();}
});
