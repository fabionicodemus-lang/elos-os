import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const original = read('20260729_0042_procurement_purchase_orders.sql');
const table = original.slice(original.indexOf('create table if not exists public.procurement_purchase_order_items ('), original.indexOf('create table if not exists public.procurement_purchase_order_documents (')).replace(/ references public\.\w+\(id\) on delete \w+/g, '');
const hardening = read('20260730_0060_homologation_purchase_to_pay_hardening.sql');
const approve = hardening.slice(hardening.indexOf('create or replace function public.approve_procurement_material_receipt('), hardening.indexOf('-- Títulos criados'));
const fix = read('20261018233354_brisa_receipt_replacement_quantities.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${id(1)}'::uuid $$;
    create function public.has_company_permission(uuid,text) returns boolean language sql as $$ select true $$;
    create table public.procurement_purchase_orders(id uuid primary key, company_id uuid, project_id uuid, status text);
    create table public.procurement_material_receipts(id uuid primary key, company_id uuid, project_id uuid, order_id uuid, status text, approved_by uuid, approved_at timestamptz, approval_notes text, updated_by uuid, updated_at timestamptz);
    create table public.procurement_material_receipt_items(id uuid primary key, receipt_id uuid, order_item_id uuid, delivered_quantity numeric, accepted_quantity numeric, rejected_quantity numeric, sort_order int, condition text, rejection_reason text);
    create table public.procurement_material_receipt_discrepancies(company_id uuid, project_id uuid, receipt_id uuid, receipt_item_id uuid, discrepancy_type text, description text, severity text, status text, due_date date, created_by uuid);
    create table public.procurement_material_receipt_audit(company_id uuid, project_id uuid, receipt_id uuid, action text, previous_status text, new_status text, reason text, details jsonb, changed_by uuid);
    create function public.refresh_procurement_purchase_order(uuid) returns void language plpgsql as $$ begin return; end $$;
  `);
  await db.exec(table);
  await db.exec(approve);
  await db.exec(`insert into public.procurement_purchase_orders values ('${id(2)}','${id(3)}','${id(4)}','confirmed');
    insert into public.procurement_purchase_order_items(id,company_id,project_id,order_id,quotation_id,quotation_item_id,award_id,offer_item_id,request_id,request_item_id,input_id,request_number,input_code,input_name,unit_snapshot,cost_center_code,cost_center_name,ordered_quantity,unit_price,delivered_unit_cost,total_amount)
    values ('${id(5)}','${id(3)}','${id(4)}','${id(2)}','${id(6)}','${id(7)}','${id(8)}','${id(9)}','${id(10)}','${id(11)}','${id(12)}','SM-2','ARG','Argamassa','kg','ALV','Alvenaria',5000,0.9,0.93,4650);`);
  return db;
}
async function receipt(db, n, delivered, accepted, rejected) {
  await db.exec(`insert into public.procurement_material_receipts(id,company_id,project_id,order_id,status) values('${id(n)}','${id(3)}','${id(4)}','${id(2)}','submitted');
    insert into public.procurement_material_receipt_items values('${id(n+100)}','${id(n)}','${id(5)}',${delivered},${accepted},${rejected},0,'damaged','Teste de avaria');`);
}
const approval = n => `select public.approve_procurement_material_receipt('${id(3)}','${id(4)}','${id(n)}','Homologação')`;

test('replacement is approved after rejection without increasing the accepted order limit', async () => {
  const db = await setup();
  try {
    await receipt(db, 20, 3000, 2950, 50);
    await db.exec(approval(20));
    await receipt(db, 21, 2050, 2050, 0);
    await assert.rejects(db.exec(approval(21)), /procurement_purchase_order_item_values_check/);
    assert.equal((await db.query(`select status from public.procurement_material_receipts where id='${id(21)}'`)).rows[0].status, 'submitted');
    await db.exec(fix);
    await db.exec(fix); // deployment script may reapply this migration
    await db.exec(approval(21));
    assert.deepEqual((await db.query('select received_quantity::float8 received, accepted_quantity::float8 accepted, rejected_quantity::float8 rejected from public.procurement_purchase_order_items')).rows, [{received:5050, accepted:5000, rejected:50}]);
    assert.equal((await db.query('select count(*)::int count from public.procurement_material_receipt_discrepancies')).rows[0].count, 1);
    await assert.rejects(db.exec(approval(21)), /não disponível/);
    await receipt(db, 22, 1, 1, 0);
    await assert.rejects(db.exec(approval(22)), /ultrapassa o saldo atual/);
  } finally { await db.close(); }
});

test('net delivery cap preserves cancellation, negative value and classification guards', async () => {
  const db = await setup();
  try {
    await db.exec(fix);
    await db.exec('update public.procurement_purchase_order_items set received_quantity=3000, accepted_quantity=2950, rejected_quantity=50, cancelled_quantity=2050');
    await assert.rejects(db.exec('update public.procurement_purchase_order_items set cancelled_quantity=2051'), /procurement_purchase_order_item_values_check/);
    await assert.rejects(db.exec('update public.procurement_purchase_order_items set cancelled_quantity=0, received_quantity=5051, accepted_quantity=5001'), /procurement_purchase_order_item_values_check/);
    await assert.rejects(db.exec('update public.procurement_purchase_order_items set accepted_quantity=2951'), /procurement_purchase_order_item_values_check/);
    await assert.rejects(db.exec('update public.procurement_purchase_order_items set rejected_quantity=-1'), /procurement_purchase_order_item_values_check/);
    await assert.rejects(db.exec('update public.procurement_purchase_order_items set unit_price=-1'), /procurement_purchase_order_item_values_check/);
  } finally { await db.close(); }
});
