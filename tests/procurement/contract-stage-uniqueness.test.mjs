import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../../supabase/migrations/20261018165125_brisa_contract_stage_uniqueness.sql',import.meta.url),'utf8');
test('stage migration removes actual generated legacy name but retains both duplicate guards',async()=>{
  const db = new PGlite();
  try {
    await db.exec(`create table execution_contract_measurement_items(measurement_id int,contract_item_id int,contract_stage_id int,unique(measurement_id,contract_item_id));`);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`insert into execution_contract_measurement_items values (1,10,100),(1,10,101),(2,10,null);`);
    await assert.rejects(db.exec(`insert into execution_contract_measurement_items values (1,10,100)`),/duplicate key/);
    await assert.rejects(db.exec(`insert into execution_contract_measurement_items values (2,10,null)`),/duplicate key/);
    assert.equal((await db.query(`select count(*)::int count from execution_contract_measurement_items`)).rows[0].count,3);
  } finally {await db.close();}
});
