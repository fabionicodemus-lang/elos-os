import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261117220600_financial_delinquency_management.sql", import.meta.url),
  "utf8",
);

const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherCompany = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const project1 = "11111111-1111-4111-8111-111111111111";
const project2 = "22222222-2222-4222-8222-222222222222";
const otherProject = "33333333-3333-4333-8333-333333333333";
const client1 = "44444444-4444-4444-8444-444444444444";
const client2 = "55555555-5555-4555-8555-555555555555";
const client3 = "66666666-6666-4666-8666-666666666666";
const otherClient = "77777777-7777-4777-8777-777777777777";
const sale1 = "88888888-8888-4888-8888-888888888888";
const sale2 = "99999999-9999-4999-8999-999999999999";
const sale3 = "aaaaaaaa-1111-4111-8111-111111111111";
const otherSale = "bbbbbbbb-1111-4111-8111-111111111111";
const unit1 = "cccccccc-1111-4111-8111-111111111111";
const unit2 = "dddddddd-1111-4111-8111-111111111111";
const unit3 = "eeeeeeee-1111-4111-8111-111111111111";
const otherUnit = "ffffffff-1111-4111-8111-111111111111";
const user = "12345678-1234-4234-8234-123456789abc";

async function bootstrap(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    create function public.has_company_permission(target_company_id uuid, target_permission text)
    returns boolean language sql stable as $$
      select auth.uid() is not null
        and target_company_id = nullif(current_setting('test.company', true), '')::uuid
        and target_permission = 'receivables.view'
        and coalesce(current_setting('test.permission', true), 'yes') <> 'no'
    $$;
    create table public.projects(id uuid primary key, company_id uuid not null, name text, code text);
    create table public.clients(id uuid primary key, company_id uuid not null, name text, tax_id text);
    create table public.sales(id uuid primary key, company_id uuid not null, number text);
    create table public.units(id uuid primary key, company_id uuid not null, code text);
    create table public.receivables(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      project_id uuid not null, client_id uuid not null, sale_id uuid not null,
      unit_id uuid not null, category text not null default 'monthly',
      description text not null, sequence_number integer not null default 1,
      sequence_total integer not null default 1, due_date date not null,
      amount numeric(16,2) not null, adjusted_amount numeric(16,2),
      paid_amount numeric(16,2), status text not null default 'open'
    );
    grant usage on schema auth, public to authenticated;
    grant select on public.projects, public.clients, public.sales, public.units, public.receivables to authenticated;
    grant execute on function public.has_company_permission(uuid, text), auth.uid() to authenticated;
    alter table public.projects enable row level security;
    alter table public.clients enable row level security;
    alter table public.sales enable row level security;
    alter table public.units enable row level security;
    alter table public.receivables enable row level security;
    create policy project_read on public.projects for select to authenticated
      using (public.has_company_permission(company_id, 'receivables.view'));
    create policy client_read on public.clients for select to authenticated
      using (public.has_company_permission(company_id, 'receivables.view'));
    create policy sale_read on public.sales for select to authenticated
      using (public.has_company_permission(company_id, 'receivables.view'));
    create policy unit_read on public.units for select to authenticated
      using (public.has_company_permission(company_id, 'receivables.view'));
    create policy receivable_read on public.receivables for select to authenticated
      using (public.has_company_permission(company_id, 'receivables.view'));

    insert into public.projects values
      ('${project1}','${company}','Flow','FLOW'),
      ('${project2}','${company}','Alma','ALMA'),
      ('${otherProject}','${otherCompany}','Outra obra','OUTRA');
    insert into public.clients values
      ('${client1}','${company}','Cliente Um','123.456.789-01'),
      ('${client2}','${company}','Cliente Dois','987.654.321-00'),
      ('${client3}','${company}','Cliente Sem Atraso','111.222.333-44'),
      ('${otherClient}','${otherCompany}','Cliente Externo','999.999.999-99');
    insert into public.sales values
      ('${sale1}','${company}','V-001'),
      ('${sale2}','${company}','V-002'),
      ('${sale3}','${company}','V-003'),
      ('${otherSale}','${otherCompany}','V-OUTRA');
    insert into public.units values
      ('${unit1}','${company}','101'),
      ('${unit2}','${company}','201'),
      ('${unit3}','${company}','301'),
      ('${otherUnit}','${otherCompany}','999');
    insert into public.receivables(company_id,project_id,client_id,sale_id,unit_id,description,due_date,amount,adjusted_amount,paid_amount,status) values
      ('${company}','${project1}','${client1}','${sale1}','${unit1}','Parcial vencida',(now() at time zone 'America/Sao_Paulo')::date - 10,100,100,40,'open'),
      ('${company}','${project1}','${client1}','${sale1}','${unit1}','Futura',(now() at time zone 'America/Sao_Paulo')::date + 10,200,200,0,'open'),
      ('${company}','${project2}','${client1}','${sale2}','${unit2}','Vencida corrigida',(now() at time zone 'America/Sao_Paulo')::date - 40,300,330,30,'open'),
      ('${company}','${project1}','${client2}','${sale3}','${unit3}','Vencida antiga',(now() at time zone 'America/Sao_Paulo')::date - 95,70,70,0,'open'),
      ('${company}','${project1}','${client2}','${sale3}','${unit3}','Futura 2',(now() at time zone 'America/Sao_Paulo')::date + 15,150,150,0,'open'),
      ('${company}','${project2}','${client3}','${sale2}','${unit2}','Somente futura',(now() at time zone 'America/Sao_Paulo')::date + 30,400,400,0,'open'),
      ('${company}','${project1}','${client1}','${sale1}','${unit1}','Cancelada',(now() at time zone 'America/Sao_Paulo')::date - 5,500,500,0,'cancelled'),
      ('${company}','${project1}','${client1}','${sale1}','${unit1}','Recebida',(now() at time zone 'America/Sao_Paulo')::date - 5,500,500,500,'paid'),
      ('${company}','${project1}','${client1}','${sale1}','${unit1}','Saldo zerado',(now() at time zone 'America/Sao_Paulo')::date - 5,100,100,100,'open'),
      ('${otherCompany}','${otherProject}','${otherClient}','${otherSale}','${otherUnit}','Outra construtora',(now() at time zone 'America/Sao_Paulo')::date - 20,9000,9000,0,'open');
  `);
  await db.exec(migration);
  await db.exec(`
    select set_config('test.uid', '${user}', false), set_config('test.company', '${company}', false);
    set role authenticated;
  `);
}

async function overview(db, projectId = null, search = null, limit = 25, offset = 0) {
  const result = await db.query(
    "select public.finance_delinquency_overview($1,$2,$3,$4,$5) report",
    [company, projectId, search, limit, offset],
  );
  return result.rows[0].report;
}

test("gestão de inadimplências respeita saldo, obra, cliente, paginação e RLS", async (t) => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await t.test("consolidado da construtora desconta pagos parciais e exclui cancelados", async () => {
      const report = await overview(db);
      assert.equal(Number(report.overdue_amount), 430);
      assert.equal(Number(report.open_amount), 1180);
      assert.equal(Number(report.overdue_installments), 3);
      assert.equal(Number(report.open_installments), 6);
      assert.equal(Number(report.debtor_count), 2);
      assert.equal(Number(report.aging_1_30), 60);
      assert.equal(Number(report.aging_31_60), 300);
      assert.equal(Number(report.aging_61_90), 0);
      assert.equal(Number(report.aging_91_plus), 70);
      assert.deepEqual(report.debtors.map((row) => row.client_name), ["Cliente Um", "Cliente Dois"]);
      assert.equal(Number(report.debtors[0].overdue_amount), 360);
      assert.equal(Number(report.debtors[0].open_amount), 560);
    });

    await t.test("filtro de obra muda o consolidado sem misturar empreendimentos", async () => {
      const report = await overview(db, project1);
      assert.equal(Number(report.overdue_amount), 130);
      assert.equal(Number(report.open_amount), 480);
      assert.equal(Number(report.debtor_count), 2);
      assert.equal(Number(report.debtors[0].overdue_amount), 70);
    });

    await t.test("parcelas legadas sem valor corrigido utilizam o nominal", async () => {
      await db.exec("reset role");
      await db.query("update public.receivables set adjusted_amount = 0 where description = 'Somente futura'");
      await db.exec("set role authenticated");
      const report = await overview(db);
      assert.equal(Number(report.open_amount), 1180);
      const { rows } = await db.query(
        "select public.finance_delinquency_installments($1,$2,$3,$4,$5) report",
        [company, client3, null, 40, 0],
      );
      assert.equal(Number(rows[0].report.installments[0].adjusted_amount), 400);
    });

    await t.test("busca e paginação preservam os totais do escopo", async () => {
      const searched = await overview(db, null, "12345678901");
      assert.equal(Number(searched.matched_debtor_count), 1);
      assert.equal(searched.debtors[0].client_id, client1);
      assert.equal(Number(searched.overdue_amount), 430);
      const page2 = await overview(db, null, null, 1, 1);
      assert.equal(page2.debtors.length, 1);
      assert.equal(page2.debtors[0].client_id, client2);
    });

    await t.test("detalhe traz vencidas primeiro e também parcelas futuras", async () => {
      const { rows } = await db.query(
        "select public.finance_delinquency_installments($1,$2,$3,$4,$5) report",
        [company, client1, null, 40, 0],
      );
      const report = rows[0].report;
      assert.equal(Number(report.overdue_amount), 360);
      assert.equal(Number(report.open_amount), 560);
      assert.equal(Number(report.overdue_installments), 2);
      assert.equal(Number(report.open_installments), 3);
      assert.deepEqual(report.installments.map((row) => row.description), ["Vencida corrigida", "Parcial vencida", "Futura"]);
      assert.deepEqual(report.installments.map((row) => Number(row.balance)), [300, 60, 200]);
      assert.deepEqual(report.installments.map((row) => row.is_overdue), [true, true, false]);
    });

    await t.test("detalhe filtra obra e pagina títulos", async () => {
      const { rows } = await db.query(
        "select public.finance_delinquency_installments($1,$2,$3,$4,$5) report",
        [company, client1, project1, 1, 1],
      );
      assert.equal(Number(rows[0].report.open_amount), 260);
      assert.equal(Number(rows[0].report.overdue_amount), 60);
      assert.equal(rows[0].report.installments[0].description, "Futura");
    });

    await t.test("não permite consultar a empresa de outro usuário", async () => {
      await assert.rejects(
        db.query("select public.finance_delinquency_overview($1)", [otherCompany]),
        /Sem permissão/,
      );
      const { rows } = await db.query("select count(*)::int n from public.receivables where company_id=$1", [otherCompany]);
      assert.equal(rows[0].n, 0);
      const projectReport = await overview(db, otherProject);
      assert.equal(Number(projectReport.overdue_amount), 0);
      assert.equal(projectReport.debtors.length, 0);
    });

    await t.test("nega a função diretamente ao papel anônimo", async () => {
      await db.exec("set role anon");
      await assert.rejects(
        db.query("select public.finance_delinquency_overview($1)", [company]),
        /permission denied/,
      );
      await db.exec("set role authenticated");
    });

    await t.test("nega acesso quando a permissão é revogada", async () => {
      await db.query("select set_config('test.permission', 'no', false)");
      await assert.rejects(
        db.query("select public.finance_delinquency_overview($1)", [company]),
        /Sem permissão/,
      );
      await assert.rejects(
        db.query("select public.finance_delinquency_installments($1,$2)", [company, client1]),
        /Sem permissão/,
      );
    });
  } finally {
    await db.close();
  }
});
