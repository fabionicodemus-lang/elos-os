-- Etapa14: authorization only. Preserve the installed calculation bodies.
-- Candidate migration, never executed against production by this task.
begin;
do $migration$
declare function_name text; function_oid regprocedure; definition text; guarded text;
 guard text := E'\n-- E14_TENANT_GUARD_BEGIN\n'
 || E'  if coalesce(current_setting(''role'',true),'''') <> ''service_role'' and (\n'
 || E'    auth.uid() is null or not exists(\n'
 || E'      select 1 from public.execution_service_contracts scope_contract\n'
 || E'      where scope_contract.id=p_contract_id\n'
 || E'        and public.is_company_member(scope_contract.company_id)\n'
 || E'        and (public.has_company_permission(scope_contract.company_id,''execution.contracts.view'')\n'
 || E'          or public.has_company_permission(scope_contract.company_id,''execution.contracts.manage'')\n'
 || E'          or public.has_company_permission(scope_contract.company_id,''execution.contracts.approve'')\n'
 || E'          or public.has_company_permission(scope_contract.company_id,''execution.contracts.amend''))\n'
 || E'    )) then\n'
 || E'    raise exception using errcode=''42501'',message=''Contrato indisponível ou sem autorização.'';\n'
 || E'  end if;\n'
 || E'-- E14_TENANT_GUARD_END\n';
begin
 foreach function_name in array array['refresh_execution_service_contract_value','refresh_execution_service_contract_measurements'] loop
  function_oid:=to_regprocedure(format('public.%I(uuid)',function_name));
  if function_oid is null then raise exception 'Função nativa obrigatória ausente: %',function_name;end if;
  if not exists(select 1 from pg_proc where oid=function_oid and prosecdef and proargnames[1]='p_contract_id') then
   raise exception 'Assinatura inesperada; revisar antes de aplicar: %',function_name;
  end if;
  definition:=pg_get_functiondef(function_oid);
  if position('-- E14_TENANT_GUARD_BEGIN' in definition)=0 then
   -- These native PL/pgSQL functions have one initial BEGIN following declarations.
   -- Insert only the guard, retaining every financial statement and return value.
   guarded:=regexp_replace(definition,E'(?i)\\mbegin\\M',E'\\&'||guard);
   if guarded=definition then raise exception 'Corpo nativo não reconhecido: %',function_name;end if;
   execute guarded;
  end if;
  execute format('revoke all on function public.%I(uuid) from public,anon',function_name);
  execute format('grant execute on function public.%I(uuid) to authenticated,service_role',function_name);
 end loop;
end $migration$;
commit;
