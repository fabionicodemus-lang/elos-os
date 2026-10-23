-- Metadata only. May be run by an authorized DBA before/after deployment.
-- Never invokes a business RPC or reads a business row. Save output privately.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '15s';

select current_database() as database_name, current_user as metadata_reader,
       version() as database_version;

with expected(name) as (values
 ('refresh_execution_service_contract_value'),
 ('refresh_execution_service_contract_measurements'),
 ('refresh_execution_work_order_values'))
select e.name, p.oid is not null as present, p.oid::regprocedure as signature,
 pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
 p.proconfig, p.proacl,
 case when p.oid is not null then pg_catalog.pg_get_functiondef(p.oid) end as definition,
 case when p.oid is not null then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 pg_catalog.replace(pg_catalog.regexp_replace(p.prosrc,
 E'\n-- E14E_BEGIN[\\s\\S]*?-- E14E_END\n','','g'),E'\r\n',E'\n'),'UTF8')),'hex') end as financial_body_sha256,
 case when p.oid is not null then pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') end as anon_execute,
 case when p.oid is not null then pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_execute,
 case when p.oid is not null then pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') end as service_execute
from expected e left join pg_catalog.pg_proc p on
 p.oid=pg_catalog.to_regprocedure(pg_catalog.format('public.%I(uuid)',e.name))
order by e.name;

-- Expanded ACL includes implicit PUBLIC EXECUTE when proacl is null.
select p.oid::regprocedure as signature,
 case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
 a.privilege_type, a.is_grantable
from pg_catalog.pg_proc p cross join lateral
 pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
where p.pronamespace='public'::regnamespace and p.proname in
 ('refresh_execution_service_contract_value','refresh_execution_service_contract_measurements','refresh_execution_work_order_values')
order by 1,2,3;

-- Overloads and textual callers; PL/pgSQL/dynamic SQL cannot be exhaustively
-- reconstructed from pg_depend. Compare to the reviewed caller inventory.
select p.oid::regprocedure as signature, pg_catalog.pg_get_userbyid(p.proowner) as owner,
 p.prosecdef, p.proconfig, p.proacl, p.prosrc
from pg_catalog.pg_proc p
where p.proname in ('refresh_execution_service_contract_value',
 'refresh_execution_service_contract_measurements','refresh_execution_work_order_values')
 or p.prosrc ~* 'refresh_execution_(service_contract_value|service_contract_measurements|work_order_values)\s*\('
order by 1;

select p.oid::regprocedure as helper, pg_catalog.pg_get_userbyid(p.proowner) as owner,
 p.prosecdef,p.proconfig,p.proacl,pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p where p.oid in
 (pg_catalog.to_regprocedure('public.is_company_member(uuid)'),
 pg_catalog.to_regprocedure('public.has_company_permission(uuid,text)'),
 pg_catalog.to_regprocedure('auth.uid()'));

select r.rolname,r.rolsuper,r.rolinherit,r.rolbypassrls,r.rolcanlogin,
 pg_catalog.pg_has_role(r.oid,'service_role'::regrole,'MEMBER') as service_membership,
 pg_catalog.has_schema_privilege(r.oid,'public','CREATE') as public_create,
 pg_catalog.has_schema_privilege(r.oid,'auth','CREATE') as auth_create
from pg_catalog.pg_roles r where r.rolname in
 ('postgres','anon','authenticated','authenticator','service_role');
select pg_catalog.pg_get_userbyid(m.roleid) as granted_role,
 pg_catalog.pg_get_userbyid(m.member) as member from pg_catalog.pg_auth_members m
order by 1,2;

with wanted(name) as (values ('execution_service_contracts'),
 ('execution_service_contract_items'),('execution_service_contract_stages'),
 ('execution_service_contract_amendments'),('execution_contract_measurements'),
 ('execution_contract_measurement_items'),('execution_work_orders'),('execution_work_order_items'))
select w.name,c.relrowsecurity,c.relforcerowsecurity,
 pg_catalog.has_table_privilege('service_role',c.oid,'SELECT') as service_select,
 pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE') as service_update
from wanted w left join pg_catalog.pg_class c on
 c.oid=pg_catalog.to_regclass('public.'||w.name) order by w.name;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_catalog.pg_policies where schemaname='public' and tablename in
 ('company_memberships','company_roles','company_role_permissions',
 'execution_service_contracts','execution_contract_measurements','execution_work_orders');
select t.tgname,t.tgenabled,t.tgrelid::regclass as relation,
 pg_catalog.pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t where not t.tgisinternal
 and t.tgrelid in (pg_catalog.to_regclass('public.payables'),
 pg_catalog.to_regclass('public.execution_contract_measurements'));

-- Null means UNKNOWN from this SQL session; verify Data API configuration
-- independently in the authorized administration panel. No financial RPC probe.
select pg_catalog.current_setting('pgrst.db_schemas',true) as api_schemas_if_visible,
 pg_catalog.current_setting('pgrst.db_anon_role',true) as api_anon_role_if_visible;
rollback;
