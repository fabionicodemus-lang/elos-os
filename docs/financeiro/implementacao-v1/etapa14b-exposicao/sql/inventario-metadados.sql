-- Somente metadados. Não chama as RPCs, auth.uid() ou helpers de negócio.
-- Executar apenas em conexão/projeto identificado e autorizado pelo operador.
-- psql -X -qAt -v ON_ERROR_STOP=1 -f inventario-metadados.sql > inventario.json
begin isolation level repeatable read read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
with targets(name) as (values
 ('refresh_execution_service_contract_value'),
 ('refresh_execution_service_contract_measurements'),
 ('refresh_execution_work_order_values')
), functions as (
 select p.*, n.nspname, l.lanname, r.rolname owner_name,
        r.rolsuper owner_superuser, r.rolbypassrls owner_bypassrls
 from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 join pg_catalog.pg_language l on l.oid=p.prolang
 join pg_catalog.pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname in (select name from targets)
), tables as (
 select c.*,n.nspname from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in (
  'execution_service_contracts','execution_service_contract_items',
  'execution_service_contract_amendments','execution_service_contract_stages',
  'execution_contract_measurements','execution_contract_measurement_items',
  'execution_work_orders','execution_work_order_items',
  'company_memberships','roles','role_permissions','permissions')
), helpers as (
 select p.*,n.nspname from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('is_company_member','has_company_permission'))
    or (n.nspname='auth' and p.proname='uid')
)
select pg_catalog.jsonb_build_object(
 'format_version',1,
 'captured_at',pg_catalog.clock_timestamp(),
 'environment','UNVERIFIED_REQUIRES_OPERATOR_ATTESTATION',
 'database',pg_catalog.current_database(),
 'session_user',session_user,'current_user',current_user,
 'server_version',pg_catalog.current_setting('server_version'),
 'transaction_read_only',pg_catalog.current_setting('transaction_read_only'),
 'transaction_isolation',pg_catalog.current_setting('transaction_isolation'),
 'requested_targets',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',t.name,'expected_signature','public.'||t.name||'(uuid)',
   'expected_signature_exists',pg_catalog.to_regprocedure('public.'||t.name||'(uuid)') is not null,
   'overloads_found',(select count(*) from functions f where f.proname=t.name))) from targets t),
 'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'oid',f.oid,'schema',f.nspname,'name',f.proname,
   'signature',f.oid::pg_catalog.regprocedure::text,
   'identity_arguments',pg_catalog.pg_get_function_identity_arguments(f.oid),
   'result',pg_catalog.pg_get_function_result(f.oid),'language',f.lanname,
   'security_definer',f.prosecdef,'owner',f.owner_name,
   'owner_superuser',f.owner_superuser,'owner_bypassrls',f.owner_bypassrls,
   'config',f.proconfig,'acl_raw',f.proacl::text,
   'definition',pg_catalog.pg_get_functiondef(f.oid),'body',f.prosrc,
   'acl_expanded',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'grantor',pg_catalog.pg_get_userbyid(a.grantor),
     'grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
     'privilege',a.privilege_type,'grantable',a.is_grantable))
     from pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a),
   'effective_roles',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'role',r.rolname,'execute',pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'),
     'schema_usage',pg_catalog.has_schema_privilege(r.oid,f.pronamespace,'USAGE'),
     'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,'inherit',r.rolinherit))
     from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator'))
 )) from functions f),'[]'::jsonb),
 'tables',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',t.relname,'kind',t.relkind,'owner',pg_catalog.pg_get_userbyid(t.relowner),
   'rls_enabled',t.relrowsecurity,'rls_forced',t.relforcerowsecurity,
   'policies',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'role_oids',p.polroles,
     'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),
     'with_check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)))
     from pg_catalog.pg_policy p where p.polrelid=t.oid)
 )) from tables t),'[]'::jsonb),
 'authorization_helpers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'signature',h.oid::pg_catalog.regprocedure::text,'security_definer',h.prosecdef,
   'owner',pg_catalog.pg_get_userbyid(h.proowner),'config',h.proconfig,
   'definition',pg_catalog.pg_get_functiondef(h.oid))) from helpers h),'[]'::jsonb),
 'role_memberships',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'member',m.rolname,'role',r.rolname,'admin_option',a.admin_option))
   from pg_catalog.pg_auth_members a
   join pg_catalog.pg_roles m on m.oid=a.member join pg_catalog.pg_roles r on r.oid=a.roleid
   where m.rolname in ('anon','authenticated','service_role','authenticator')
      or r.rolname in ('anon','authenticated','service_role','authenticator')),
 'api_settings_visible_in_session',pg_catalog.jsonb_build_object(
   'db_schemas',pg_catalog.current_setting('pgrst.db_schemas',true),
   'db_pre_request',pg_catalog.current_setting('pgrst.db_pre_request',true),
   'note','NULL não comprova ausência; configuração externa do gateway/PostgREST requer atestado.'),
 'api_role_database_settings',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'role',pg_catalog.pg_get_userbyid(s.setrole),'database_oid',s.setdatabase,'setting',v.setting))
   from pg_catalog.pg_db_role_setting s
   cross join lateral pg_catalog.unnest(s.setconfig) v(setting)
   where s.setrole in (select oid from pg_catalog.pg_roles where rolname in ('authenticator','anon','authenticated'))
     and pg_catalog.split_part(v.setting,'=',1) in ('pgrst.db_schemas','pgrst.db_extra_search_path','pgrst.db_pre_request')),
 'catalog_dependencies',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'caller',p.oid::pg_catalog.regprocedure::text,'target',f.oid::pg_catalog.regprocedure::text,'type',d.deptype))
   from pg_catalog.pg_depend d join functions f on f.oid=d.refobjid
   join pg_catalog.pg_proc p on p.oid=d.objid
   where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass),
 'textual_callers_heuristic',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'caller',p.oid::pg_catalog.regprocedure::text,'security_definer',p.prosecdef,
   'target_name',f.proname))
   from pg_catalog.pg_proc p join functions f on pg_catalog.strpos(p.prosrc,f.proname||'(')>0
   where p.oid<>f.oid),
 'limits','Dependências de PL/pgSQL/SQL dinâmico podem não constar em pg_depend. Busca textual é indício. Nenhuma RPC foi invocada; nenhum registro de negócio foi lido.'
);
rollback;
