import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const base = readFileSync(
  new URL(
    "../../supabase/migrations/20260729_0048_finance_bank_accounts.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261013223527_finance_bank_operations.sql",
    import.meta.url,
  ),
  "utf8",
);
const uid = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const account = "44444444-4444-4444-8444-444444444444";
const second = "55555555-5555-4555-8555-555555555555";
const tx = "66666666-6666-4666-8666-666666666666";

test("migration and banking invariants in PostgreSQL", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table companies(id uuid primary key);
 create table legal_entities(id uuid primary key);
 create table projects(id uuid primary key,company_id uuid,legal_entity_id uuid,status text);
 create table payables(id uuid primary key);
 create table receivables(id uuid primary key,company_id uuid,project_id uuid,status text,amount numeric,adjusted_amount numeric,due_date date);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$
 select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid and current_setting('test.denied',true) is distinct from target_permission$$;
 grant usage on schema public,auth,storage to authenticated;
 `);
    for (const name of [
      "finance_bank_accounts",
      "finance_bank_transfers",
      "finance_bank_transactions",
    ]) {
      const statement = base.match(
        new RegExp(
          `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
        ),
      )?.[0];
      assert.ok(statement, name);
      await db.exec(statement);
    }
    for (const name of [
      "finance_bank_account_balance",
      "post_finance_bank_transaction",
    ]) {
      const statement = base.match(
        new RegExp(
          `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
        ),
      )?.[0];
      assert.ok(statement, name);
      await db.exec(statement);
    }
    await db.exec(migration);
    await db.exec(`insert into auth.users values('${uid}');insert into companies values('${company}'),('${other}');
 select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false);
 insert into finance_bank_accounts(id,company_id,label,bank_name,bank_code,account_number,account_digit,opening_balance,allow_negative) values
 ('${account}','${company}','Conta A','Banco','001','1234','5',1000,true),('${second}','${other}','Conta B','Banco','001','9876','5',0,true);
 alter table finance_bank_accounts enable row level security;alter table finance_bank_transactions enable row level security;
 create policy accounts_read on finance_bank_accounts for select to authenticated using(has_company_permission(company_id,'finance.bank_accounts.view'));
 create policy transactions_read on finance_bank_transactions for select to authenticated using(has_company_permission(company_id,'finance.bank_accounts.view'));
 grant select on finance_bank_accounts,finance_bank_transactions to authenticated;
 insert into finance_bank_transactions(id,company_id,bank_account_id,transaction_date,direction,transaction_type,description,amount) values('${tx}','${company}','${account}','2026-01-10','debit','payment','Fornecedor',100);
 set role authenticated;`);
    const entries = [
      {
        fit_id: "FIT-1",
        transaction_date: "2026-01-10",
        amount: -110,
        description: "Fornecedor e tarifa",
      },
    ];
    let hash = 0;
    const importEntries = (
      rows = entries,
      acc = account,
      number = "12345",
      bank = "001",
      h = (++hash).toString(16).padStart(64, "0"),
    ) =>
      db.query("select bank_import_ofx($1,$2,$3,$4,$5,$6::jsonb) result", [
        acc,
        "extrato.ofx",
        h,
        bank,
        number,
        JSON.stringify(rows),
      ]);
    let entry, link;
    await t.test(
      "import and file/FITID deduplication are idempotent",
      async () => {
        const result = await importEntries();
        assert.equal(result.rows[0].result.inserted, 1);
        assert.equal(
          (
            await importEntries(
              entries,
              account,
              "12345",
              "001",
              "1".padStart(64, "0"),
            )
          ).rows[0].result.duplicate_file,
          true,
        );
        assert.equal((await importEntries()).rows[0].result.inserted, 0);
        entry = (await db.query("select id from finance_statement_entries"))
          .rows[0].id;
      },
    );
    await t.test(
      "invalid bank/account and divergent FITID fail atomically",
      async () => {
        await assert.rejects(
          importEntries(entries, account, "000"),
          /conta do OFX/,
        );
        await assert.rejects(
          importEntries(entries, account, "12345", "999"),
          /Banco do OFX/,
        );
        await assert.rejects(
          importEntries([
            { ...entries[0], fit_id: "new" },
            { ...entries[0], amount: -999 },
          ]),
          /divergentes/,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from finance_statement_entries",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "company isolation and denied permissions apply inside RPCs",
      async () => {
        await assert.rejects(
          importEntries(entries, second, "98765"),
          /sem permissão/,
        );
        await db.query(
          "select set_config('test.denied','finance.bank_accounts.manage',false)",
        );
        await assert.rejects(importEntries(), /sem permissão/);
        await db.query("select set_config('test.denied','',false)");
        assert.equal(
          (await db.query("select count(*)::int n from finance_bank_accounts"))
            .rows[0].n,
          1,
        );
        await assert.rejects(
          db.query("insert into finance_statement_entries default values"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "partial links, overshoot, NaN and legacy status bypass",
      async () => {
        link = (
          await db.query("select bank_link_entry($1,$2,60) id", [entry, tx])
        ).rows[0].id;
        assert.equal(
          (await db.query("select status from finance_bank_transactions"))
            .rows[0].status,
          "posted",
        );
        await assert.rejects(
          db.query("select bank_link_entry($1,$2,41)", [entry, tx]),
          /excede/,
        );
        await assert.rejects(
          db.query("select bank_link_entry($1,$2,'NaN'::numeric)", [entry, tx]),
          /inválido/,
        );
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "update finance_bank_transactions set status='reconciled',reconciliation_date=current_date where id=$1",
            [tx],
          ),
          /parcial/,
        );
        await db.exec("set role authenticated");
      },
    );
    await t.test("reversal requires reason and retains evidence", async () => {
      await assert.rejects(
        db.query("select bank_reverse_link($1,null)", [link]),
        /motivo/,
      );
      await db.query("select bank_reverse_link($1,'Conferência corrigida')", [
        link,
      ]);
      assert.ok(
        (
          await db.query(
            "select reversed_at from finance_reconciliation_links where id=$1",
            [link],
          )
        ).rows[0].reversed_at,
      );
      await db.query("select bank_link_entry($1,$2,100)", [entry, tx]);
    });
    await t.test(
      "closing rejects unmatched amounts; explicit difference posts and links atomically",
      async () => {
        await assert.rejects(
          db.query(
            "select bank_save_settings($1,'Operação','2026-01-31','Fechamento janeiro')",
            [account],
          ),
          /sem conciliação/,
        );
        await db.query(
          "select bank_post_difference($1,'fee','Tarifa identificada no extrato')",
          [entry],
        );
        const rows = (
          await db.query(
            "select running_balance from finance_bank_ledger order by transaction_date desc,created_at desc,id desc",
          )
        ).rows;
        assert.equal(Number(rows[0].running_balance), 890);
        await assert.rejects(
          db.query("select bank_post_difference($1,'fee','Tarifa duplicada')", [
            entry,
          ]),
          /já conciliado/,
        );
        await db.query(
          "select bank_save_settings($1,'Operação','2026-01-31','Fechamento janeiro')",
          [account],
        );
      },
    );
    await t.test(
      "closed period blocks backdated imports, ledger updates and opening balance changes",
      async () => {
        await assert.rejects(
          importEntries([{ ...entries[0], fit_id: "FIT-2" }]),
          /Reabra/,
        );
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "update finance_bank_transactions set description='alterado' where id=$1",
            [tx],
          ),
          /encerrado/,
        );
        await assert.rejects(
          db.query(
            "update finance_bank_accounts set opening_balance=2000 where id=$1",
            [account],
          ),
          /saldo inicial/,
        );
        await db.exec("set role authenticated");
      },
    );
    await t.test(
      "reopening audited and cheque settlement is single use",
      async () => {
        await db.query(
          "select bank_save_settings($1,'Operação',null,'Reabertura para conferência')",
          [account],
        );
        const id = (
          await db.query(
            "select bank_save_instrument($1,'cheque','Cheque 10',null,20,'2026-02-01') id",
            [account],
          )
        ).rows[0].id;
        await db.query(
          "select bank_change_instrument($1,false,'2026-02-01','Compensação confirmada')",
          [id],
        );
        await assert.rejects(
          db.query(
            "select bank_change_instrument($1,false,'2026-02-01','Compensação repetida')",
            [id],
          ),
          /indisponível/,
        );
        assert.ok(
          (
            await db.query(
              "select count(*)::int n from finance_bank_audit where event='settings'",
            )
          ).rows[0].n >= 2,
        );
      },
    );

    await t.test(
      "collection draft uses corrected value and can be cancelled without receiving funds",
      async () => {
        const rid = "77777777-7777-4777-8777-777777777777";
        await db.exec("reset role");
        await db.query(
          "insert into receivables(id,company_id,status,amount,adjusted_amount,due_date) values($1,$2,'open',100,110,'2026-03-01')",
          [rid, company],
        );
        await db.exec("set role authenticated");
        const id = (
          await db.query(
            "select bank_draft_collection($1,$2,2,1,'Instrução interna') id",
            [account, rid],
          )
        ).rows[0].id;
        assert.equal(
          Number(
            (
              await db.query(
                "select amount from finance_collection_drafts where id=$1",
                [id],
              )
            ).rows[0].amount,
          ),
          110,
        );
        await assert.rejects(
          db.query("select bank_draft_collection($1,$2,2,1,'Duplicado')", [
            account,
            rid,
          ]),
          /unique/,
        );
        await db.query("select bank_cancel_collection($1,'Dados em revisão')", [
          id,
        ]);
        assert.equal(
          (
            await db.query(
              "select status from finance_collection_drafts where id=$1",
              [id],
            )
          ).rows[0].status,
          "cancelled",
        );
        await db.query(
          "select bank_draft_collection($1,$2,2,1,'Nova preparação')",
          [account, rid],
        );
      },
    );
    await t.test(
      "PDF metadata requires an uploaded object in the selected account",
      async () => {
        const path = company + "/" + account + "/test.pdf";
        await assert.rejects(
          db.query(
            "select bank_save_document($1,null,'teste.pdf',$2,'statement')",
            [account, path],
          ),
          /não enviado/,
        );
        await db.exec("reset role");
        await db.query(
          "insert into storage.objects(bucket_id,name) values('bank-documents',$1)",
          [path],
        );
        await db.exec("set role authenticated");
        await db.query(
          "select bank_save_document($1,$2,'teste.pdf',$3,'receipt')",
          [account, tx, path],
        );
        assert.equal(
          (await db.query("select count(*)::int n from finance_bank_documents"))
            .rows[0].n,
          1,
        );
        await assert.rejects(
          db.query(
            "select bank_save_document($1,null,'teste.pdf',$2,'statement')",
            [account, other + "/" + account + "/test.pdf"],
          ),
          /inválido/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
