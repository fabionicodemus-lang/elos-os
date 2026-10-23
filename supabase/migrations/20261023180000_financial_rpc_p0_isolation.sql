-- P0: standalone security patch. Apply this file only, after explicit approval.
-- No financial formula, business row, caller function or policy is changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $patch$
declare
 t record; f record; r record; a record; h record;
 body text; clean text; guarded text; guard text; definition text;
begin
 for h in select * from (values
  ('public.is_company_member(uuid)','b512f5d8ee30a167d0556d4b1177a385dc581efe5b4cb453c6442313345649d9'),
  ('public.has_company_permission(uuid,text)','786b7ab62d0c304f4136cbc21c84b802340b8426ebe7c25f5bbd8604e2a223b1')
 ) x(signature,sha) loop
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(h.signature)
   and p.prosecdef and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=h.sha) then
   raise exception 'Authorization helper differs; review metadata: %',h.signature;
  end if;
 end loop;
 if pg_catalog.to_regprocedure('auth.uid()') is null then raise exception 'auth.uid() missing';end if;
 -- INVOKER does not manufacture table privileges for a technical principal.
 -- Require the existing service privileges rather than silently broadening them.
 for h in select * from (values
  ('execution_service_contracts',true),('execution_service_contract_items',true),
  ('execution_service_contract_stages',true),('execution_service_contract_amendments',false),
  ('execution_contract_measurements',false),('execution_contract_measurement_items',false),
  ('execution_work_orders',true),('execution_work_order_items',false)
 ) x(table_name,needs_update) loop
  if not pg_catalog.has_table_privilege('service_role','public.'||h.table_name,'SELECT')
   or (h.needs_update and not pg_catalog.has_table_privilege('service_role','public.'||h.table_name,'UPDATE')) then
   raise exception 'Existing technical table privileges insufficient: %',h.table_name;
  end if;
 end loop;
 for t in select * from (values
  ('refresh_execution_service_contract_value','p_contract_id','execution_service_contracts','numeric',
   'b9308b74b59777ccec415f77d6e64660059f9f1c1c7a3d883bed384ed7e6fba2',
   array['execution.contracts.manage','execution.contracts.approve','execution.contracts.amend','execution.contract_procurement.contract']),
  ('refresh_execution_service_contract_measurements','p_contract_id','execution_service_contracts','void',
   '7afadaf2098ce851353fd772b6e3e9375336edfbd1ecdad9011acfdcbc6a2eb5',
   array['execution.measurements.approve','execution.measurements.finance','execution.measurements.reverse','payables.manage']),
  ('refresh_execution_work_order_values','p_work_order_id','execution_work_orders','void',
   'cf5b6eb2ffc93f2d2c8f974d6ea60e469e56c0c90cc9c0bc90ef56175f5085c8',
   array['execution.work_orders.manage','execution.work_orders.progress','execution.work_orders.accept'])
 ) x(name,argument,scope_table,result_type,sha,permissions) loop
  select p.*,n.nspname,l.lanname,pg_catalog.pg_get_userbyid(p.proowner) owner_name into f
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   join pg_catalog.pg_language l on l.oid=p.prolang
   where p.oid=pg_catalog.to_regprocedure(pg_catalog.format('public.%I(uuid)',t.name));
  if not found or f.prokind<>'f' or f.lanname<>'plpgsql' or f.pronargs<>1
   or f.proargnames[1] is distinct from t.argument
   or pg_catalog.pg_get_function_result(f.oid)<>t.result_type
   or f.owner_name in('anon','authenticated','authenticator','service_role')
   or not(f.proconfig=array['search_path=public']::text[]
       or f.proconfig=array['search_path=pg_catalog, pg_temp']::text[]) then
   raise exception 'Unexpected signature/owner/settings: %',t.name;
  end if;
  if (select count(*) from pg_catalog.pg_proc p where p.pronamespace=f.pronamespace and p.proname=t.name)<>1 then
   raise exception 'Unexpected overload: %',t.name;
  end if;
  for r in select * from pg_catalog.pg_roles where rolname in('anon','authenticated','authenticator') loop
   if r.rolsuper or r.rolbypassrls or pg_catalog.pg_has_role(r.oid,f.proowner,'MEMBER')
    or (r.rolname<>'authenticator' and pg_catalog.pg_has_role(r.oid,'service_role'::regrole,'MEMBER'))
    or (r.rolname<>'authenticator' and (pg_catalog.has_schema_privilege(r.oid,'public','CREATE') or pg_catalog.has_schema_privilege(r.oid,'auth','CREATE'))) then
    raise exception 'Unsafe API role/schema authority: %',r.rolname;
   end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc p where p.oid<>f.oid
   and p.prosrc ~* (t.name||'\s*\(') and p.proowner not in(f.proowner,'service_role'::regrole::oid)) then
   raise exception 'Different caller owner; review before revocation: %',t.name;
  end if;
  body:=f.prosrc;
  clean:=pg_catalog.regexp_replace(body,E'\n-- E14E_BEGIN[\\s\\S]*?-- E14E_END\n','','g');
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(clean,E'\r\n',E'\n'),'UTF8')),'hex')<>t.sha then
   raise exception 'Unknown financial body; no overwrite: %',t.name;
  end if;
  -- SECURITY INVOKER keeps current_user as the actual SQL execution identity.
  -- Neither JWT role strings nor the mutable GUC "role" grant a bypass.
  -- A definer caller has the owner's current_user, but its session_user is
  -- authenticator, so end-user authorization below still applies.
  guard:=pg_catalog.format(E'\n-- E14E_BEGIN\n'
   || E'  declare _e14e_uid uuid; _e14e_claims jsonb; _e14e_legacy text;\n'
   || E'  begin\n'
   || E'    if not (current_user::text=''service_role''\n'
   || E'      or (session_user::text=%L and current_user::text=%L)) then\n'
   || E'      begin\n'
   || E'        _e14e_uid:=auth.uid();\n'
   || E'        _e14e_claims:=nullif(pg_catalog.current_setting(''request.jwt.claims'',true),'''')::jsonb;\n'
   || E'        _e14e_legacy:=nullif(pg_catalog.current_setting(''request.jwt.claim.sub'',true),'''');\n'
   || E'        if _e14e_uid is null\n'
   || E'          or (_e14e_claims->>''sub'' is not null and (_e14e_claims->>''sub'')::uuid is distinct from _e14e_uid)\n'
   || E'          or (_e14e_legacy is not null and _e14e_legacy::uuid is distinct from _e14e_uid) then\n'
   || E'          raise exception using errcode=''42501'',message=''Registro indisponível ou sem autorização.'';\n'
   || E'        end if;\n'
   || E'      exception when invalid_text_representation then\n'
   || E'        raise exception using errcode=''42501'',message=''Registro indisponível ou sem autorização.'';\n'
   || E'      end;\n'
   || E'      if not exists(select 1 from public.%I scope_record where scope_record.id=%I\n'
   || E'        and public.is_company_member(scope_record.company_id)\n'
   || E'        and exists(select 1 from pg_catalog.unnest(%L::text[]) required(permission)\n'
   || E'          where public.has_company_permission(scope_record.company_id,required.permission))) then\n'
   || E'        raise exception using errcode=''42501'',message=''Registro indisponível ou sem autorização.'';\n'
   || E'      end if;\n'
   || E'    end if;\n'
   || E'  end;\n'
   || E'-- E14E_END\n',f.owner_name,f.owner_name,t.scope_table,t.argument,t.permissions::text);
  guarded:=pg_catalog.regexp_replace(clean,E'(?i)\\mbegin\\M',E'\\&'||guard);
  if guarded=clean then raise exception 'Native BEGIN absent: %',t.name;end if;
  definition:=pg_catalog.replace(pg_catalog.pg_get_functiondef(f.oid),body,guarded);
  execute definition;
  execute pg_catalog.format('alter function public.%I(uuid) security invoker',t.name);
  execute pg_catalog.format('alter function public.%I(uuid) set search_path=pg_catalog,pg_temp',t.name);
  for a in select distinct x.grantee from pg_catalog.pg_proc p,
   lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
   where p.oid=f.oid and x.grantee not in(f.proowner,'service_role'::regrole::oid) loop
   execute pg_catalog.format('revoke all on function public.%I(uuid) from %s cascade',t.name,
    case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) end);
  end loop;
  execute pg_catalog.format('grant execute on function public.%I(uuid) to %I,service_role',t.name,f.owner_name);
 end loop;
end $patch$;
commit;
