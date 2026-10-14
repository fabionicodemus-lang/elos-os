import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261014093000_preconstruction_governance_hardening.sql", import.meta.url), "utf8");

const budget = "11111111-1111-4111-8111-111111111111";
const baseline = "22222222-2222-4222-8222-222222222222";
const company = "33333333-3333-4333-8333-333333333333";
const project = "44444444-4444-4444-8444-444444444444";

async function bootstrap(db) {
  await db.exec(`
    create role authenticated;
    create table public.engineering_budgets(
      id uuid primary key, company_id uuid not null, project_id uuid not null,
      code text not null, name text not null, version text not null, status text not null,
      reference_date date, area_m2 numeric default 0, bdi_percentage numeric default 0,
      notes text, source_system text default 'elos_os', source_id text,
      is_base boolean default false, adjustment_enabled boolean default false,
      updated_at timestamptz default now()
    );
    create table public.engineering_schedule_baselines(
      id uuid primary key, company_id uuid not null, project_id uuid not null, budget_id uuid,
      code text not null, name text not null, version text not null, start_date date not null,
      work_on_saturday boolean default false, status text not null, notes text,
      approved_at timestamptz, approved_by uuid, updated_at timestamptz default now()
    );
    create table public.engineering_schedule_activities(
      id uuid primary key, company_id uuid not null, project_id uuid not null, baseline_id uuid not null,
      service_id uuid, team_count numeric default 1
    );
    create table public.engineering_schedule_activity_tracking(
      id uuid primary key default gen_random_uuid(), activity_id uuid not null,
      progress_percent numeric default 0, actual_quantity numeric default 0,
      team_count numeric, actual_start date, actual_finish date
    );
    create function public.engineering_schedule_is_workday(uuid, uuid, date, boolean)
    returns boolean language sql stable as $$ select extract(isodow from $3) < 6 or ($4 and extract(isodow from $3) = 6) $$;

    insert into engineering_budgets(id,company_id,project_id,code,name,version,status,reference_date,area_m2,notes)
    values('${budget}','${company}','${project}','ORC','Base','R00','approved','2026-01-01',3000,'snapshot');
    insert into engineering_schedule_baselines(id,company_id,project_id,budget_id,code,name,version,start_date,work_on_saturday,status,notes)
    values('${baseline}','${company}','${project}','${budget}','LB','Linha Base','LB-00','2026-01-01',false,'approved','oficial');
  `);
  await db.exec(migration);
}

test("snapshots aprovados não podem ser reabertos nem reescritos", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await assert.rejects(() => db.query("update engineering_budgets set area_m2=3100 where id=$1", [budget]), /imutável/i);
    await assert.rejects(() => db.query("update engineering_budgets set status='draft' where id=$1", [budget]), /imutável/i);
    await db.query("update engineering_budgets set adjustment_enabled=true where id=$1", [budget]);
    assert.equal((await db.query("select adjustment_enabled from engineering_budgets where id=$1", [budget])).rows[0].adjustment_enabled, true);

    await assert.rejects(() => db.query("update engineering_schedule_baselines set start_date='2026-02-01' where id=$1", [baseline]), /imutável/i);
    await assert.rejects(() => db.query("update engineering_schedule_baselines set status='draft' where id=$1", [baseline]), /imutável/i);
    await db.query("update engineering_schedule_baselines set status='archived' where id=$1", [baseline]);
    assert.equal((await db.query("select status from engineering_schedule_baselines where id=$1", [baseline])).rows[0].status, "archived");
  } finally {
    await db.close();
  }
});