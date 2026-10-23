-- Etapa14C. Candidate only: no production execution authorized by this task.
-- Safe to apply directly to the known native bodies OR the Etapa14 candidate.
-- Do not run the entire pending migration queue to apply this security patch.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $migration$
declare
 target record;
 function_oid regprocedure;
 installed record;
 original_body text;
 financial_body text;
 guarded_body text;
 guard text;
 definition text;
 acl record;
 api_role record;
 helper record;
begin
 -- The guards rely on these existing helpers' active membership/role semantics.
 -- Unknown deployed implementations must be reviewed, never silently replaced.
 for helper in select * from (values
  ('public.is_company_member(uuid)','b512f5d8ee30a167d0556d4b1177a385dc581efe5b4cb453c6442313345649d9'),
  ('public.has_company_permission(uuid,text)','786b7ab62d0c304f4136cbc21c84b802340b8426ebe7c25f5bbd8604e2a223b1')
 ) as h(signature,body_sha256) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(helper.signature)
   and prosecdef and encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=helper.body_sha256) then
   raise exception 'Autorizador ausente ou divergente; revisão obrigatória: %',helper.signature;
  end if;
 end loop;
 if to_regprocedure('auth.uid()') is null or not exists(select 1 from pg_roles where rolname='service_role') then
  raise exception 'Contexto de autenticação/serviço ausente; revisar implantação.';
 end if;
 for target in select * from (values
  ('refresh_execution_service_contract_value','p_contract_id','execution_service_contracts','numeric',
   'b9308b74b59777ccec415f77d6e64660059f9f1c1c7a3d883bed384ed7e6fba2',
   array['execution.contracts.manage','execution.contracts.approve','execution.contracts.amend','execution.contract_procurement.contract']),
  ('refresh_execution_service_contract_measurements','p_contract_id','execution_service_contracts','void',
   '7afadaf2098ce851353fd772b6e3e9375336edfbd1ecdad9011acfdcbc6a2eb5',
   array['execution.measurements.approve','execution.measurements.finance','execution.measurements.reverse','payables.manage']),
  ('refresh_execution_work_order_values','p_work_order_id','execution_work_orders','void',
   'cf5b6eb2ffc93f2d2c8f974d6ea60e469e56c0c90cc9c0bc90ef56175f5085c8',
   array['execution.work_orders.manage','execution.work_orders.progress','execution.work_orders.accept'])
 ) as t(name,argument,scope_table,result_type,body_sha256,permissions) loop
  function_oid:=to_regprocedure(format('public.%I(uuid)',target.name));
  select p.*,l.lanname,r.rolname owner_name into installed
   from pg_proc p join pg_language l on l.oid=p.prolang join pg_roles r on r.oid=p.proowner
   where p.oid=function_oid;
  if not found or installed.prokind<>'f' or not installed.prosecdef
   or installed.lanname<>'plpgsql' or installed.pronargs<>1
   or installed.proargnames[1] is distinct from target.argument
   or pg_get_function_result(function_oid)<>target.result_type
   or installed.proconfig is distinct from array['search_path=public']::text[]
   or installed.owner_name in ('anon','authenticated','authenticator') then
   raise exception 'Assinatura, proprietário ou configuração inesperados: %',target.name;
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=target.name)<>1 then
   raise exception 'Sobrecarga inesperada; revisar todas as assinaturas de %.',target.name;
  end if;
  -- Disallow indirect inheritance of a privileged role by API end-user roles.
  for api_role in select oid,rolname from pg_roles where rolname in ('anon','authenticated') loop
   if pg_has_role(api_role.oid,installed.proowner,'MEMBER')
    or pg_has_role(api_role.oid,'service_role'::regrole,'MEMBER') then
    raise exception 'Herança privilegiada inesperada: %; revisar antes de aplicar.',api_role.rolname;
   end if;
  end loop;
  -- Revocation must not accidentally break a legitimate definer with another owner.
  -- PL/pgSQL dependencies are not fully represented in pg_depend: also inspect text.
  if exists(select 1 from pg_proc p where p.oid<>function_oid
    and p.prosrc ~* (target.name||'\s*\(')
    and p.proowner not in(installed.proowner,'service_role'::regrole::oid)) then
   raise exception 'Chamador com proprietário distinto; revisar grants de %.',target.name;
  end if;
  original_body:=installed.prosrc;
  financial_body:=regexp_replace(original_body,
   E'\n-- E14_(TENANT|WORK_ORDER)_GUARD_BEGIN[\\s\\S]*?-- E14_(TENANT|WORK_ORDER)_GUARD_END\n','','g');
  financial_body:=regexp_replace(financial_body,
   E'\n-- E14C_AUTHORIZATION_BEGIN[\\s\\S]*?-- E14C_AUTHORIZATION_END\n','','g');
  if encode(sha256(convert_to(replace(financial_body,E'\r\n',E'\n'),'UTF8')),'hex')<>target.body_sha256 then
   raise exception 'Corpo financeiro divergente; nenhuma fórmula será sobrescrita: %',target.name;
  end if;
  -- current_user here is the definer. Only a direct owner session or a verified
  -- service_role context can run without an end-user identity. Never use a
  -- caller-set flag, trigger depth, or client-supplied company as a bypass.
  guard:=format(E'\n-- E14C_AUTHORIZATION_BEGIN\n'
   || E'  if not (coalesce(current_setting(''role'',true),'''')=''service_role''\n'
   || E'    or (coalesce(current_setting(''role'',true),''none'')=''none'' and session_user=current_user)) then\n'
   || E'    if auth.uid() is null or not exists(\n'
   || E'      select 1 from public.%I scope_record where scope_record.id=%I\n'
   || E'        and public.is_company_member(scope_record.company_id)\n'
   || E'        and exists(select 1 from unnest(%L::text[]) required(permission)\n'
   || E'          where public.has_company_permission(scope_record.company_id,required.permission))\n'
   || E'    ) then\n'
   || E'      raise exception using errcode=''42501'',message=''Registro indisponível ou sem autorização.'';\n'
   || E'    end if;\n'
   || E'  end if;\n'
   || E'-- E14C_AUTHORIZATION_END\n',target.scope_table,target.argument,target.permissions::text);
  guarded_body:=regexp_replace(financial_body,E'(?i)\\mbegin\\M',E'\\&'||guard);
  if guarded_body=financial_body then raise exception 'BEGIN nativo ausente: %',target.name;end if;
  definition:=replace(pg_get_functiondef(function_oid),original_body,guarded_body);
  execute definition;
  -- Internal helpers: public/anonymous/authenticated and custom grants removed.
  -- The native SECURITY DEFINER callers retain their owner's execution rights.
  for acl in select distinct a.grantee from pg_proc p,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=function_oid and a.grantee not in(installed.proowner,'service_role'::regrole::oid) loop
   execute format('revoke all on function public.%I(uuid) from %s cascade',target.name,
    case when acl.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end);
  end loop;
  execute format('grant execute on function public.%I(uuid) to %I,service_role',target.name,installed.owner_name);
 end loop;
end $migration$;
commit;
