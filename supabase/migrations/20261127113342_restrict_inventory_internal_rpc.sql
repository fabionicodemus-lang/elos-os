-- Internal inventory mutations must only run through the permission-checked
-- SECURITY DEFINER entry points. Do not change business data or the ledger.
begin;

revoke all on function public.apply_procurement_inventory_balance(uuid,uuid,uuid,uuid,text,date,numeric,numeric)
  from public, anon, authenticated, service_role;

-- This entry point also supports trusted backfills. Preserve authenticated and
-- service execution explicitly while removing anonymous/default exposure.
revoke all on function public.post_procurement_inventory_movement(uuid,uuid,text,date,uuid,uuid,uuid,numeric,numeric,text,date,uuid,text,text,uuid,text,text)
  from public, anon;
grant execute on function public.post_procurement_inventory_movement(uuid,uuid,text,date,uuid,uuid,uuid,numeric,numeric,text,date,uuid,text,text,uuid,text,text)
  to authenticated, service_role;

commit;
