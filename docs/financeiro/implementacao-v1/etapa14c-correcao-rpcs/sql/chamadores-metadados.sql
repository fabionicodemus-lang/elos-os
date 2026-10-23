-- Complemento somente de metadados ao coletor da14B. Não invoca funções alvo.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
with target(name) as (values
 ('refresh_execution_service_contract_value'),
 ('refresh_execution_service_contract_measurements'),
 ('refresh_execution_work_order_values'))
select jsonb_build_object('captured_at',clock_timestamp(),
 'database',current_database(),'role',current_user,
 'callers',coalesce((select jsonb_agg(jsonb_build_object(
  'target',t.name,'caller',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
  'definition',pg_get_functiondef(p.oid)))
  from pg_proc p cross join target t
  where p.prokind in('f','p') and p.proname<>t.name
    and p.prosrc ~* (t.name||'\s*\(')),'[]'::jsonb),
 'payable_trigger',coalesce((select jsonb_agg(jsonb_build_object(
  'trigger',g.tgname,'definition',pg_get_triggerdef(g.oid),
  'function',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'function_definition',pg_get_functiondef(p.oid)))
  from pg_trigger g join pg_proc p on p.oid=g.tgfoid
  join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not g.tgisinternal and n.nspname='public' and c.relname='payables'
   and p.proname='sync_contract_measurement_from_payable'),'[]'::jsonb),
 'limits','Busca textual é heurística; conferir também chamadores transitivos, SQL dinâmico e objetos externos. Nenhum dado financeiro consultado.');
rollback;
