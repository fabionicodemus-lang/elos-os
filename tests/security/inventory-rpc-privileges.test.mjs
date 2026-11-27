import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("inventory grant hardening preserves the trusted internal call chain", async () => {
  const db = new PGlite();
  try {
    // Isolate the changed ACL behavior from inventory accounting. Dummy bodies
    // never touch business rows; the wrapper exercises PostgreSQL definer rights.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create function public.apply_procurement_inventory_balance(uuid,uuid,uuid,uuid,text,date,numeric,numeric)
      returns uuid language sql security definer as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create function public.post_procurement_inventory_movement(uuid,uuid,text,date,uuid,uuid,uuid,numeric,numeric,text,date,uuid,text,text,uuid,text,text)
      returns uuid language sql security definer set search_path='' as $$
        select public.apply_procurement_inventory_balance(null,null,null,null,null,null,null,null)
      $$;
      grant usage on schema public to anon,authenticated,service_role;`);
    const migration = readFileSync(new URL("../../supabase/migrations/20261127113342_restrict_inventory_internal_rpc.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration); // safe to reapply
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query(`select proname,has_function_privilege($1,oid,'execute') allowed from pg_proc where proname in ('apply_procurement_inventory_balance','post_procurement_inventory_movement')`, [role]);
      assert.equal(rows.find(r => r.proname === "apply_procurement_inventory_balance").allowed, false);
      assert.equal(rows.find(r => r.proname === "post_procurement_inventory_movement").allowed, role !== "anon");
    }
    await db.exec("set role authenticated");
    const { rows } = await db.query("select public.post_procurement_inventory_movement(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null) id");
    assert.equal(rows[0].id, "00000000-0000-4000-8000-000000000001");
  } finally { await db.close(); }
});
