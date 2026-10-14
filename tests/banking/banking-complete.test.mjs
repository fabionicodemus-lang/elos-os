import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const core = readFileSync(new URL("../../supabase/migrations/20261014031500_banking_settlements_and_provider_core.sql", import.meta.url), "utf8");
const summaries = readFileSync(new URL("../../supabase/migrations/20261014033000_banking_partial_summary_and_charge_state.sql", import.meta.url), "utf8");
const cards = readFileSync(new URL("../../supabase/migrations/20261014034500_banking_card_lifecycle.sql", import.meta.url), "utf8");
const security = readFileSync(new URL("../../supabase/migrations/20261014040000_banking_rpc_security_fix.sql", import.meta.url), "utf8");

const uid = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const entity = "33333333-3333-4333-8333-333333333333";
const project = "44444444-4444-4444-8444-444444444444";
const account = "55555555-5555-4555-8555-555555555555";
const receivable = "66666666-6666-4666-8666-666666666666";
const webhookReceivable = "77777777-7777-4777-8777-777777777777";
const payable = "88888888-8888-4888-8888-888888888888";
const card = "99999999-9999-4999-8999-999999999999";
const client = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function bootstrap(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema finance_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;

    create table public.companies(id uuid primary key);
    create table public.legal_entities(id uuid primary key,company_id uuid);
    create table public.projects(id uuid primary key,company_id uuid not null,legal_entity_id uuid,status text default 'active');
    create table public.clients(id uuid primary key,company_id uuid not null,name text,tax_id text,email text,phone text);
    create table public.sales(id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid,total_amount numeric,status text default 'active');

    create table public.finance_bank_accounts(
      id uuid primary key,company_id uuid not null,legal_entity_id uuid,label text not null,status text default 'active',
      opening_balance numeric default 0,allow_negative boolean default true,closed_through date
    );
    create table public.receivables(
      id uuid primary key,company_id uuid not null,project_id uuid not null,sale_id uuid,client_id uuid,status text not null default 'open',
      description text,amount numeric not null,adjusted_amount numeric,due_date date not null,paid_amount numeric,paid_at date,
      paid_account_name text,bank_account_id uuid,bank_transaction_id uuid,updated_at timestamptz default now()
    );
    create table public.payables(
      id uuid primary key,company_id uuid not null,project_id uuid not null,status text not null default 'open',document text,
      amount numeric not null,due_date date not null,paid_amount numeric,paid_at date,paid_account_name text,
      bank_account_id uuid,bank_transaction_id uuid,updated_at timestamptz default now()
    );
    create table public.finance_bank_transactions(
      id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid,legal_entity_id uuid,bank_account_id uuid not null,
      transaction_date date not null,competence_date date,direction text not null,transaction_type text not null,description text not null,
      document text,counterparty text,amount numeric not null,status text default 'posted',payable_id uuid,receivable_id uuid,
      source_system text,source_id text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create unique index finance_bank_transactions_payable_unique_idx on public.finance_bank_transactions(payable_id) where payable_id is not null and status<>'cancelled';
    create unique index finance_bank_transactions_receivable_unique_idx on public.finance_bank_transactions(receivable_id) where receivable_id is not null and status<>'cancelled';

    create table public.finance_bank_instruments(
      id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid,bank_account_id uuid not null,
      kind text not null,label text not null,last_four text,amount numeric,due_date date,status text not null default 'active',
      transaction_id uuid,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table public.finance_collection_drafts(
      id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid,bank_account_id uuid not null,receivable_id uuid not null,
      amount numeric not null,due_date date not null,fine_percent numeric default 0,monthly_interest_percent numeric default 0,
      instructions text,status text not null default 'draft' check(status in ('draft','cancelled')),created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now()
    );

    create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$
      select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid
    $$;
    create function public.finance_bank_account_balance(p_account_id uuid,p_until_date date default null) returns numeric language sql stable as $$
      select coalesce((select opening_balance from public.finance_bank_accounts where id=p_account_id),0)
        + coalesce((select sum(case when direction='credit' then amount else -amount end) from public.finance_bank_transactions
                    where bank_account_id=p_account_id and status<>'cancelled' and (p_until_date is null or transaction_date<=p_until_date)),0)
    $$;

    grant usage on schema public,auth to authenticated,service_role;
    grant select on public.finance_bank_accounts,public.receivables,public.payables,public.projects,public.sales,public.clients,public.finance_bank_instruments,public.finance_collection_drafts,public.finance_bank_transactions to authenticated;
  `);
  await db.exec(core);
  await db.exec(summaries);
  await db.exec(cards);
  await db.exec(security);
  await db.exec(`
    insert into auth.users values('${uid}');
    insert into public.companies values('${company}');
    insert into public.legal_entities values('${entity}','${company}');
    insert into public.projects values('${project}','${company}','${entity}','active');
    insert into public.clients values('${client}','${company}','Cliente','12345678901','cliente@example.com','47999999999');
    insert into public.finance_bank_accounts(id,company_id,legal_entity_id,label,status,opening_balance,allow_negative) values('${account}','${company}','${entity}','Conta principal','active',10000,true);
    insert into public.receivables(id,company_id,project_id,client_id,status,description,amount,adjusted_amount,due_date) values
      ('${receivable}','${company}','${project}','${client}','open','Parcela 1',100,100,'2026-11-10'),
      ('${webhookReceivable}','${company}','${project}','${client}','open','Parcela webhook',100,100,'2026-11-15');
    insert into public.payables(id,company_id,project_id,status,document,amount,due_date) values('${payable}','${company}','${project}','open','NF 1',200,'2026-11-20');
    insert into public.finance_bank_instruments(id,company_id,bank_account_id,kind,label,last_four,status,created_by) values('${card}','${company}','${account}','card','Cartão gestor','1234','active','${uid}');
    select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false);
    set role authenticated;
  `);
}

test("banking completo: baixa parcial, webhook idempotente e cartão", async (t) => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    await t.test("contas a receber e pagar aceitam múltiplas baixas parciais", async () => {
      await db.query("select receive_finance_receivable($1,$2,$3,$4,'2026-11-01',40)",[company,project,receivable,account]);
      let row=(await db.query("select status,paid_amount from receivables where id=$1",[receivable])).rows[0];
      assert.equal(row.status,"open"); assert.equal(Number(row.paid_amount),40);
      let summary=(await db.query("select receivables_summary($1,$2,null) s",[company,project])).rows[0].s;
      assert.equal(Number(summary.open_amount),160); // 60 desta + 100 da parcela do webhook
      assert.equal(Number(summary.paid_amount),40);
      await db.query("select receive_finance_receivable($1,$2,$3,$4,'2026-11-02',60)",[company,project,receivable,account]);
      row=(await db.query("select status,paid_amount from receivables where id=$1",[receivable])).rows[0];
      assert.equal(row.status,"paid"); assert.equal(Number(row.paid_amount),100);
      assert.equal((await db.query("select count(*)::int n from finance_receivable_settlements where receivable_id=$1",[receivable])).rows[0].n,2);
      await assert.rejects(db.query("select receive_finance_receivable($1,$2,$3,$4,'2026-11-03',1)",[company,project,receivable,account]),/excede/);

      await db.query("select pay_finance_payable($1,$2,$3,$4,'2026-11-01',50)",[company,project,payable,account]);
      await db.query("select pay_finance_payable($1,$2,$3,$4,'2026-11-02',150)",[company,project,payable,account]);
      const p=(await db.query("select status,paid_amount from payables where id=$1",[payable])).rows[0];
      assert.equal(p.status,"paid"); assert.equal(Number(p.paid_amount),200);
      assert.equal((await db.query("select count(*)::int n from finance_payable_settlements where payable_id=$1",[payable])).rows[0].n,2);
    });

    await t.test("webhook recebido liquida bruto, lança líquido e tarifa uma única vez", async () => {
      const connection=(await db.query("select bank_save_connection($1,null,'asaas','Teste','sandbox','teste',null,'active') id",[account])).rows[0].id;
      await db.exec("reset role");
      const draft=(await db.query("insert into finance_collection_drafts(company_id,project_id,bank_account_id,receivable_id,amount,due_date,created_by) values($1,$2,$3,$4,100,'2026-11-15',$5) returning id",[company,project,account,webhookReceivable,uid])).rows[0].id;
      await db.exec("set role authenticated");
      await db.query("select bank_register_provider_charge($1,$2,'pay_1','elos:draft','pix',null,null,'000201...',null,'{}')",[connection,draft]);
      await db.exec("reset role; set role service_role");
      assert.equal((await db.query("select bank_apply_provider_event($1,'evt_confirmed','PAYMENT_CONFIRMED','pay_1','confirmed',100,98,'2026-11-15','{}') r",[connection])).rows[0].r,"processed");
      assert.equal((await db.query("select bank_apply_provider_event($1,'evt_received','PAYMENT_RECEIVED','pay_1','received',100,98,'2026-11-15','{}') r",[connection])).rows[0].r,"processed");
      assert.equal((await db.query("select bank_apply_provider_event($1,'evt_received','PAYMENT_RECEIVED','pay_1','received',100,98,'2026-11-15','{}') r",[connection])).rows[0].r,"duplicate");
      await db.exec("reset role; set role authenticated");
      assert.equal((await db.query("select count(*)::int n from finance_receivable_settlements where receivable_id=$1",[webhookReceivable])).rows[0].n,1);
      const settlement=(await db.query("select gross_amount,net_amount,fee_amount from finance_receivable_settlements where receivable_id=$1",[webhookReceivable])).rows[0];
      assert.equal(Number(settlement.gross_amount),100); assert.equal(Number(settlement.net_amount),98); assert.equal(Number(settlement.fee_amount),2);
      assert.equal((await db.query("select count(*)::int n from finance_bank_transactions where receivable_id=$1",[webhookReceivable])).rows[0].n,1);
      assert.equal((await db.query("select count(*)::int n from finance_bank_transactions where transaction_type='fee'")).rows[0].n,1);
    });

    await t.test("cartão parcela, fecha e aceita pagamento parcial até quitar", async () => {
      await db.query("select bank_save_card_settings($1,5000,20,27)",[card]);
      const group=(await db.query("select bank_post_card_purchase($1,$2,'2026-10-10','Notebook',300,3,'compra-1') g",[card,project])).rows[0].g;
      assert.ok(group);
      assert.equal((await db.query("select count(*)::int n from finance_card_transactions where purchase_group=$1",[group])).rows[0].n,3);
      assert.deepEqual((await db.query("select amount::numeric n from finance_card_transactions where purchase_group=$1 order by installment_number",[group])).rows.map(r=>Number(r.n)),[100,100,100]);
      const duplicate=(await db.query("select bank_post_card_purchase($1,$2,'2026-10-10','Notebook',300,3,'compra-1') g",[card,project])).rows[0].g;
      assert.equal(duplicate,group);
      assert.equal((await db.query("select count(*)::int n from finance_card_transactions where purchase_group=$1",[group])).rows[0].n,3);
      const cycle=(await db.query("select id from finance_card_cycles where instrument_id=$1 order by reference_month limit 1",[card])).rows[0].id;
      await db.query("select bank_close_card_cycle($1)",[cycle]);
      await db.query("select bank_pay_card_cycle($1,$2,'2026-10-27',40)",[cycle,account]);
      let c=(await db.query("select status,remaining_amount from finance_card_cycle_balances where id=$1",[cycle])).rows[0];
      assert.equal(c.status,"closed"); assert.equal(Number(c.remaining_amount),60);
      await db.query("select bank_pay_card_cycle($1,$2,'2026-10-27',60)",[cycle,account]);
      c=(await db.query("select status,remaining_amount from finance_card_cycle_balances where id=$1",[cycle])).rows[0];
      assert.equal(c.status,"paid"); assert.equal(Number(c.remaining_amount),0);
      await assert.rejects(db.query("select bank_cancel_card_purchase($1,'Tentativa após fechamento')",[group]),/fatura fechada/);
    });
  } finally {
    await db.close();
  }
});
