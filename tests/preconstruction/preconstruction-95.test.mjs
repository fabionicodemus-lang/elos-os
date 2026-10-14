import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { classifyAbc } from "../../lib/preconstruction/abc.mjs";
import { calculateCpm } from "../../lib/preconstruction/cpm.mjs";

const coreMigration = readFileSync(new URL("../../supabase/migrations/20261014090000_preconstruction_95.sql", import.meta.url), "utf8");
const indexMigration = readFileSync(new URL("../../supabase/migrations/20261014091000_preconstruction_budget_indexation.sql", import.meta.url), "utf8");
const cascadeMigration = readFileSync(new URL("../../supabase/migrations/20261014092000_schedule_calendar_cascade.sql", import.meta.url), "utf8");

const user = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const service = "44444444-4444-4444-8444-444444444444";
const input = "55555555-5555-4555-8555-555555555555";
const budget = "66666666-6666-4666-8666-666666666666";
const group = "77777777-7777-4777-8777-777777777777";
const item = "88888888-8888-4888-8888-888888888888";
const composition = "99999999-9999-4999-8999-999999999999";
const compItem = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const baseline = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const activityA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const activityB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const cub = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const incc = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
}

async function bootstrap(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;

    create table public.companies(id uuid primary key);
    create table public.projects(id uuid primary key, company_id uuid not null);
    create function public.has_company_permission(target_company_id uuid, target_permission text)
    returns boolean language sql stable as $$
      select auth.uid() is not null and target_company_id = nullif(current_setting('test.company', true), '')::uuid
    $$;

    create table public.correction_indices(
      id uuid primary key, company_id uuid not null, code text not null, name text not null,
      value_type text not null, unit_label text not null, source_name text, status text not null default 'active'
    );
    create table public.correction_index_values(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, correction_index_id uuid not null,
      reference_month date not null, value numeric not null
    );

    create table public.engineering_services(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, code text not null, description text not null,
      unit text not null default 'un', default_method text default 'unit', status text default 'active',
      source_system text default 'elos_os', source_id text, created_by uuid, updated_at timestamptz default now(),
      unique(company_id, code), unique(company_id, source_system, source_id)
    );
    create table public.engineering_inputs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, code text not null, description text not null,
      unit text not null default 'un', category text default 'material', source_system text default 'elos_os',
      source_code text, source_id text, status text default 'active', unique(company_id, code), unique(company_id, source_system, source_id)
    );
    create table public.engineering_input_prices(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid, input_id uuid not null,
      price_date date not null default current_date, unit_price numeric default 0, final_unit_price numeric default 0,
      is_adopted boolean default false, status text default 'active'
    );

    create table public.engineering_budgets(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      code text not null, name text not null, version text not null, status text not null, reference_date date,
      area_m2 numeric default 0, bdi_percentage numeric default 0, notes text, source_system text default 'elos_os',
      source_id text, created_by uuid, is_base boolean default false, updated_at timestamptz default now(),
      unique(company_id, project_id, code, version)
    );
    create table public.engineering_budget_groups(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      budget_id uuid not null, code text not null, name text not null, sort_order integer default 0,
      notes text, status text default 'active', created_by uuid
    );
    create table public.engineering_budget_items(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      budget_id uuid not null, group_id uuid, service_id uuid, code text, description text not null, unit text not null,
      quantity numeric not null default 0, material_unit_cost numeric not null default 0,
      labor_unit_cost numeric not null default 0, equipment_unit_cost numeric not null default 0,
      other_unit_cost numeric not null default 0,
      unit_direct_cost numeric generated always as (material_unit_cost+labor_unit_cost+equipment_unit_cost+other_unit_cost) stored,
      total_direct_cost numeric generated always as (quantity*(material_unit_cost+labor_unit_cost+equipment_unit_cost+other_unit_cost)) stored,
      sort_order integer default 0, notes text, status text default 'active', created_by uuid
    );
    create table public.engineering_budget_item_compositions(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      budget_id uuid not null, budget_item_id uuid not null, source_service_id uuid, source_composition_id uuid,
      is_customized boolean default false, notes text, status text default 'active', created_by uuid, unique(budget_item_id)
    );
    create table public.engineering_budget_item_composition_items(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, composition_id uuid not null, input_id uuid not null,
      source_composition_item_id uuid, coefficient numeric not null, waste_percentage numeric not null default 0,
      effective_coefficient numeric generated always as (coefficient*(1+waste_percentage/100.0)) stored,
      unit_price numeric not null default 0, price_source text default 'catalog_snapshot', sort_order integer default 0,
      notes text, status text default 'active', created_by uuid
    );

    create table public.engineering_schedule_baselines(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null, budget_id uuid,
      code text, name text, version text, start_date date not null, work_on_saturday boolean default false,
      status text not null default 'draft', updated_at timestamptz default now()
    );
    create table public.engineering_schedule_activities(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      baseline_id uuid not null, service_id uuid, code text, name text, unit_snapshot text default 'un',
      quantity_snapshot numeric default 0, productivity_per_team_day numeric default 1, team_count numeric default 1,
      duration_days integer default 1, planned_start date not null, planned_finish date not null,
      planned_cost numeric default 0, sort_order integer default 0, planning_status text default 'draft',
      source text default 'manual', notes text, record_status text default 'active', created_by uuid,
      updated_at timestamptz default now()
    );
    create table public.engineering_schedule_dependencies(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      baseline_id uuid not null, predecessor_id uuid not null, successor_id uuid not null,
      relation_type text not null default 'FS', lag_days integer default 0, created_by uuid
    );
    create table public.engineering_schedule_activity_tracking(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, project_id uuid not null,
      baseline_id uuid not null, activity_id uuid not null, current_start date not null, current_finish date not null,
      actual_start date, actual_finish date, progress_percent numeric default 0, actual_quantity numeric default 0,
      actual_cost numeric default 0, team_count numeric, last_measurement_date date
    );

    insert into auth.users values ('${user}');
    insert into companies values ('${company}');
    insert into projects values ('${project}','${company}');
    insert into engineering_services(id,company_id,code,description,unit) values ('${service}','${company}','01.01','Alvenaria','m2');
    insert into engineering_inputs(id,company_id,code,description,unit,category) values ('${input}','${company}','MAT-1','Bloco','un','material');
    insert into engineering_budgets(id,company_id,project_id,code,name,version,status,reference_date,area_m2,created_by)
      values ('${budget}','${company}','${project}','ORC','Orçamento base','R00','draft','2026-01-01',3000,'${user}');
    insert into engineering_budget_groups(id,company_id,project_id,budget_id,code,name,sort_order,status,created_by)
      values ('${group}','${company}','${project}','${budget}','01','Estrutura',1,'active','${user}');
    insert into engineering_budget_items(id,company_id,project_id,budget_id,group_id,service_id,code,description,unit,quantity,material_unit_cost,labor_unit_cost,equipment_unit_cost,other_unit_cost,sort_order,status,created_by)
      values ('${item}','${company}','${project}','${budget}','${group}','${service}','01.01','Alvenaria','m2',100,50,20,0,0,1,'active','${user}');
    insert into engineering_budget_item_compositions(id,company_id,project_id,budget_id,budget_item_id,source_service_id,is_customized,status,created_by)
      values ('${composition}','${company}','${project}','${budget}','${item}','${service}',false,'active','${user}');
    insert into engineering_budget_item_composition_items(id,company_id,composition_id,input_id,coefficient,waste_percentage,unit_price,sort_order,status,created_by)
      values ('${compItem}','${company}','${composition}','${input}',10,5,2,1,'active','${user}');
    insert into engineering_schedule_baselines(id,company_id,project_id,budget_id,code,name,version,start_date,work_on_saturday,status)
      values ('${baseline}','${company}','${project}','${budget}','LB','Linha Base','LB-00','2026-10-15',false,'draft');
    insert into correction_indices values ('${cub}','${company}','CUB-SC','CUB-SC','index_number','R$/m2','Sinduscon/SC','active');
    insert into correction_indices values ('${incc}','${company}','INCC','INCC','percentage','%','FGV','active');
    insert into correction_index_values(company_id,correction_index_id,reference_month,value) values
      ('${company}','${cub}','2026-01-01',100),('${company}','${cub}','2026-03-01',110),
      ('${company}','${incc}','2026-01-01',1),('${company}','${incc}','2026-02-01',1),('${company}','${incc}','2026-03-01',2);
    select set_config('test.uid','${user}',false), set_config('test.company','${company}',false);
  `);
  await db.exec(coreMigration);
  await db.exec(indexMigration);
  await db.exec(cascadeMigration);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    set role authenticated;
  `);
}

test("Curva ABC classifica participação acumulada", () => {
  const rows = classifyAbc([
    { id: "a", label: "A", value: 70 },
    { id: "b", label: "B", value: 20 },
    { id: "c", label: "C", value: 10 },
  ]);
  assert.deepEqual(rows.map((row) => row.classification), ["A", "B", "C"]);
  assert.equal(rows[0].rank, 1);
  assert.equal(Math.round(rows.at(-1).accumulatedPercentage), 100);
});

test("CPM calcula caminho crítico e detecta ciclo", () => {
  const activities = [
    { id: "A", code: "A", duration_days: 3, record_status: "active" },
    { id: "B", code: "B", duration_days: 2, record_status: "active" },
    { id: "C", code: "C", duration_days: 5, record_status: "active" },
  ];
  const deps = [
    { predecessor_id: "A", successor_id: "B", relation_type: "FS", lag_days: 0 },
    { predecessor_id: "A", successor_id: "C", relation_type: "FS", lag_days: 0 },
  ];
  const result = calculateCpm(activities, deps);
  assert.equal(result.cycleDetected, false);
  assert.equal(result.projectDuration, 8);
  assert.equal(result.rows.find((row) => row.id === "A").critical, true);
  assert.equal(result.rows.find((row) => row.id === "C").critical, true);
  assert.equal(result.rows.find((row) => row.id === "B").totalFloat, 3);
  const cycle = calculateCpm(activities, [...deps, { predecessor_id: "C", successor_id: "A", relation_type: "FS", lag_days: 0 }]);
  assert.equal(cycle.cycleDetected, true);
});

test("Pré-Obra 9.5 preserva snapshots, calendário e reajustes", async (t) => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    await t.test("produtividade padrão dimensiona duração na geração", async () => {
      await db.query("update engineering_services set default_productivity_per_team_day=10, default_team_count=2 where id=$1", [service]);
      await db.query(
        `insert into engineering_schedule_activities(id,company_id,project_id,baseline_id,service_id,code,name,quantity_snapshot,productivity_per_team_day,team_count,duration_days,planned_start,planned_finish,source,record_status)
         values($1,$2,$3,$4,$5,'A','Alvenaria',100,1,1,30,'2026-10-15','2026-11-30','takeoff','active')`,
        [activityA, company, project, baseline, service],
      );
      const row = (await db.query("select productivity_per_team_day,team_count,duration_days from engineering_schedule_activities where id=$1", [activityA])).rows[0];
      assert.equal(Number(row.productivity_per_team_day), 10);
      assert.equal(Number(row.team_count), 2);
      assert.equal(Number(row.duration_days), 5);
    });

    await t.test("feriado estende predecessora e empurra sucessora FS", async () => {
      await db.query("insert into engineering_schedule_calendar_exceptions(company_id,project_id,exception_date,exception_type,name) values($1,$2,'2026-10-16','non_working','Feriado')", [company, project]);
      await db.query("update engineering_schedule_activities set duration_days=3, planned_start='2026-10-15' where id=$1", [activityA]);
      await db.query(
        `insert into engineering_schedule_activities(id,company_id,project_id,baseline_id,service_id,code,name,quantity_snapshot,productivity_per_team_day,team_count,duration_days,planned_start,planned_finish,source,record_status)
         values($1,$2,$3,$4,$5,'B','Sucessora',1,1,1,1,'2026-10-19','2026-10-19','manual','active')`,
        [activityB, company, project, baseline, service],
      );
      await db.query("insert into engineering_schedule_dependencies(company_id,project_id,baseline_id,predecessor_id,successor_id,relation_type,lag_days) values($1,$2,$3,$4,$5,'FS',0)", [company, project, baseline, activityA, activityB]);
      await db.query("update engineering_schedule_activities set planned_start='2026-10-15' where id=$1", [activityA]);
      const a = (await db.query("select planned_finish from engineering_schedule_activities where id=$1", [activityA])).rows[0];
      const b = (await db.query("select planned_start from engineering_schedule_activities where id=$1", [activityB])).rows[0];
      assert.equal(isoDate(a.planned_finish), "2026-10-20");
      assert.equal(isoDate(b.planned_start), "2026-10-21");
    });

    await t.test("orçamento aprovado fica imutável e clona snapshot completo", async () => {
      await db.query("update engineering_budgets set status='approved' where id=$1", [budget]);
      await assert.rejects(() => db.query("update engineering_budget_items set quantity=200 where id=$1", [item]), /imutável/i);
      const cloneId = (await db.query("select clone_engineering_budget_revision($1,$2,'R01','Revisão 1') id", [company, budget])).rows[0].id;
      const clone = (await db.query("select status,version from engineering_budgets where id=$1", [cloneId])).rows[0];
      assert.equal(clone.status, "draft");
      assert.equal(clone.version, "R01");
      assert.equal(Number((await db.query("select count(*) n from engineering_budget_items where budget_id=$1", [cloneId])).rows[0].n), 1);
      assert.equal(Number((await db.query("select count(*) n from engineering_budget_item_composition_items ci join engineering_budget_item_compositions c on c.id=ci.composition_id where c.budget_id=$1", [cloneId])).rows[0].n), 1);
    });

    await t.test("linha de base aprovada não pode ter atividades reescritas", async () => {
      await db.query("update engineering_schedule_baselines set status='approved' where id=$1", [baseline]);
      await assert.rejects(() => db.query("update engineering_schedule_activities set planned_start='2026-11-01' where id=$1", [activityA]), /imutável/i);
    });

    await t.test("CUB e INCC calculam fator mensal corretamente", async () => {
      const cubFactor = Number((await db.query("select engineering_correction_factor($1,$2,'2026-01-01','2026-03-20',100) f", [company, cub])).rows[0].f);
      const inccFactor = Number((await db.query("select engineering_correction_factor($1,$2,'2026-01-01','2026-03-20',null) f", [company, incc])).rows[0].f);
      assert.equal(cubFactor, 1.1);
      assert.ok(Math.abs(inccFactor - 1.0302) < 0.000001);
    });

    await t.test("aditivo aprovado herda índice e congela seus itens", async () => {
      await db.query("update engineering_budgets set adjustment_enabled=true, correction_index_id=$2, correction_base_month='2026-01-01' where id=$1", [budget, cub]);
      const amendmentId = (await db.query(
        `insert into engineering_budget_amendments(company_id,project_id,budget_id,code,description,approval_date,status,adjustment_enabled,created_by)
         values($1,$2,$3,'ADT-01','Aditivo','2026-02-10','draft',true,$4) returning id`,
        [company, project, budget, user],
      )).rows[0].id;
      await db.query(
        `insert into engineering_budget_amendment_items(company_id,project_id,budget_id,amendment_id,service_id,budget_item_id,service_name_snapshot,amount,created_by)
         values($1,$2,$3,$4,$5,$6,'Alvenaria',1000,$7)`,
        [company, project, budget, amendmentId, service, item, user],
      );
      await db.query("update engineering_budget_amendments set status='approved' where id=$1", [amendmentId]);
      const amendment = (await db.query("select correction_index_id,correction_base_month from engineering_budget_amendments where id=$1", [amendmentId])).rows[0];
      assert.equal(amendment.correction_index_id, cub);
      assert.equal(isoDate(amendment.correction_base_month), "2026-02-01");
      await assert.rejects(() => db.query("update engineering_budget_amendment_items set amount=2000 where amendment_id=$1", [amendmentId]), /imutável/i);
    });
  } finally {
    await db.close();
  }
});