import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../../supabase/migrations/20261018220251_brisa_order_refresh_totals.sql',import.meta.url),'utf8');
const refresh=migration.slice(migration.indexOf('create or replace function public.refresh_procurement_purchase_order('),migration.indexOf('create or replace function public.issue_procurement_purchase_order('));
test('order totals survive receipt refresh; only accepted material advances delivery',async()=>{
 const db=new PGlite();try{
 await db.exec(`
 create table procurement_purchase_orders(id uuid primary key,status text,subtotal_amount numeric default 0,freight_amount numeric default 0,tax_amount numeric default 0,other_cost_amount numeric default 0,discount_amount numeric default 0,total_amount numeric default 0,received_amount numeric default 0,invoiced_amount numeric default 0,updated_at timestamptz);
 create table procurement_purchase_order_items(order_id uuid,ordered_quantity numeric,cancelled_quantity numeric default 0,received_quantity numeric default 0,accepted_quantity numeric default 0,unit_price numeric,discount_percent numeric default 0,tax_percent numeric default 0,freight_amount numeric default 0,other_cost_amount numeric default 0,delivered_unit_cost numeric,total_amount numeric);
 create table procurement_material_receipts(order_id uuid,status text,invoice_amount numeric);
 insert into procurement_purchase_orders(id,status) values('11111111-1111-4111-8111-111111111111','draft');
 insert into procurement_purchase_order_items(order_id,ordered_quantity,unit_price,freight_amount,delivered_unit_cost,total_amount) values('11111111-1111-4111-8111-111111111111',5000,0.9,150,0.93,4650);
 `);await db.exec(refresh);
 await db.exec(`select refresh_procurement_purchase_order('11111111-1111-4111-8111-111111111111')`);
 assert.deepEqual((await db.query(`select status,subtotal_amount::float8 subtotal,freight_amount::float8 freight,total_amount::float8 total from procurement_purchase_orders`)).rows,[{status:'draft',subtotal:4500,freight:150,total:4650}]);
 await db.exec(`update procurement_purchase_orders set status='issued'; update procurement_purchase_order_items set received_quantity=3000,accepted_quantity=2950; insert into procurement_material_receipts values('11111111-1111-4111-8111-111111111111','approved',2790); select refresh_procurement_purchase_order('11111111-1111-4111-8111-111111111111')`);
 assert.deepEqual((await db.query(`select status,total_amount::float8 total,received_amount::float8 received,invoiced_amount::float8 invoiced from procurement_purchase_orders`)).rows,[{status:'partially_received',total:4650,received:2743.5,invoiced:2790}]);
 await db.exec(`update procurement_purchase_order_items set received_quantity=5050,accepted_quantity=5000; select refresh_procurement_purchase_order('11111111-1111-4111-8111-111111111111')`);
 assert.equal((await db.query(`select status from procurement_purchase_orders`)).rows[0].status,'received');
 }finally{await db.close();}
});
