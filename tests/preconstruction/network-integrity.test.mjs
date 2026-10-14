import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261014094000_schedule_network_integrity.sql", import.meta.url), "utf8");
const company = "11111111-1111-4111-8111-111111111111";
const project = "22222222-2222-4222-8222-222222222222";
const baseline = "33333333-3333-4333-8333-333333333333";
const a = "44444444-4444-4444-8444-444444444444";
const b = "55555555-5555-4555-8555-555555555555";

async function bootstrap(db) {
  await db.exec(`
    create role authenticated;
    create table engineering_schedule_baselines(
      id uuid primary key, company_id uuid, project_id uuid, status text,
      work_on_saturday boolean default false
    );
    create table engineering_schedule_activities(
      id uuid primary key, company_id uuid, project_id uuid, baseline_id uuid,
      planned_start date, planned_finish date, duration_days integer, sort_order integer default 0,
      code text, record_status text default 'active', planning_status text default 'draft'
    );
    create table engineering_schedule_dependencies(
      id uuid primary key default gen_random_uuid(), company_id uuid, project_id uuid, baseline_id uuid,
      predecessor_id uuid, successor_id uuid, relation_type text default 'FS', lag_days integer default 0
    );
    create table engineering_schedule_calendar_exceptions(
      id uuid primary key default gen_random_uuid(), company_id uuid, project_id uuid,
      exception_date date, exception_type text, name text
    );
    create function engineering_schedule_shift_workdays(uuid,uuid,date,integer,boolean)
    returns date language sql stable as $$ select $3 + greatest($4,0) $$;
    create function recalculate_engineering_schedule_successors(uuid,uuid,uuid,uuid)
    returns integer language sql as $$ select 0 $$;

    insert into engineering_schedule_baselines values('${baseline}','${company}','${project}','draft',false);
    insert into engineering_schedule_activities values
      ('${a}','${company}','${project}','${baseline}','2026-01-01','2026-01-02',2,1,'A','active','approved'),
      ('${b}','${company}','${project}','${baseline}','2026-01-03','2026-01-04',2,2,'B','active','approved');
  `);
  await db.exec(migration);
}

test("aprovação bloqueia ciclo e aceita rede acíclica", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.query("insert into engineering_schedule_dependencies(company_id,project_id,baseline_id,predecessor_id,successor_id) values($1,$2,$3,$4,$5)", [company, project, baseline, a, b]);
    await db.query("update engineering_schedule_baselines set status='approved' where id=$1", [baseline]);
    assert.equal((await db.query("select status from engineering_schedule_baselines where id=$1", [baseline])).rows[0].status, "approved");

    await db.query("update engineering_schedule_baselines set status='draft' where id=$1", [baseline]);
    await db.query("insert into engineering_schedule_dependencies(company_id,project_id,baseline_id,predecessor_id,successor_id) values($1,$2,$3,$4,$5)", [company, project, baseline, b, a]);
    await assert.rejects(() => db.query("update engineering_schedule_baselines set status='approved' where id=$1", [baseline]), /circular/i);
  } finally {
    await db.close();
  }
});

test("aprovação exige todas as atividades aprovadas", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.query("update engineering_schedule_activities set planning_status='draft' where id=$1", [b]);
    await assert.rejects(() => db.query("update engineering_schedule_baselines set status='approved' where id=$1", [baseline]), /Aprove todas/i);
  } finally {
    await db.close();
  }
});