import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../../supabase/migrations/20261018164938_brisa_quotation_refresh_aliases.sql', import.meta.url), 'utf8');
test('quotation refresh resolves item costs with same-named offer column and clears withdrawn offers', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table procurement_material_quotations(id uuid primary key,invited_suppliers_count int,responses_count int,total_awarded_amount numeric,updated_at timestamptz);
      create table procurement_material_quotation_items(id uuid primary key,quotation_id uuid,best_delivered_unit_cost numeric,best_total_cost numeric,updated_at timestamptz);
      create table procurement_material_quotation_offers(id uuid primary key,status text,total_delivered_cost numeric);
      create table procurement_material_quotation_offer_items(quotation_item_id uuid,offer_id uuid,quotation_id uuid,meets_specification boolean,delivered_unit_cost numeric,total_delivered_cost numeric);
      create table procurement_material_quotation_suppliers(quotation_id uuid,status text);
      create table procurement_material_quotation_awards(quotation_id uuid,awarded_total_cost numeric);
      insert into procurement_material_quotations(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
      insert into procurement_material_quotation_items values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',null,null,null),('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',99,990,null);
      insert into procurement_material_quotation_offers values ('55555555-5555-4555-8555-555555555555','received',9000),('66666666-6666-4666-8666-666666666666','received',8000);
      insert into procurement_material_quotation_offer_items values ('33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',true,9,90),('33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',true,8,80);
      insert into procurement_material_quotation_suppliers values ('11111111-1111-4111-8111-111111111111','responded');
      insert into procurement_material_quotation_awards values ('11111111-1111-4111-8111-111111111111',80);
    `);
    await db.exec(migration);
    await db.exec(`select refresh_procurement_material_quotation('11111111-1111-4111-8111-111111111111')`);
    const { rows } = await db.query(`select best_delivered_unit_cost::float8 unit,best_total_cost::float8 total from procurement_material_quotation_items order by id`);
    assert.deepEqual(rows, [{ unit: 8, total: 80 }, { unit: 99, total: 990 }]);
    assert.deepEqual((await db.query(`select invited_suppliers_count,responses_count,total_awarded_amount::float8 total from procurement_material_quotations where id='11111111-1111-4111-8111-111111111111'`)).rows,[{invited_suppliers_count:1,responses_count:1,total:80}]);
    await db.exec(`update procurement_material_quotation_offers set status='withdrawn'; select refresh_procurement_material_quotation('11111111-1111-4111-8111-111111111111')`);
    assert.equal((await db.query(`select best_total_cost from procurement_material_quotation_items where id='33333333-3333-4333-8333-333333333333'`)).rows[0].best_total_cost,null);
  } finally { await db.close(); }
});
