-- Etapa14: same tenant boundary for work-order financial totals, no formula change.
begin;
do $migration$
declare f regprocedure:=to_regprocedure('public.refresh_execution_work_order_values(uuid)'); original text; guarded text;
 guard text:=E'\n-- E14_WORK_ORDER_GUARD_BEGIN\n'
 || E'  if coalesce(current_setting(''role'',true),'''') <> ''service_role'' and (\n'
 || E'    auth.uid() is null or not exists(\n'
 || E'      select 1 from public.execution_work_orders scope_order\n'
 || E'      where scope_order.id=p_work_order_id\n'
 || E'        and public.is_company_member(scope_order.company_id)\n'
 || E'        and (public.has_company_permission(scope_order.company_id,''execution.work_orders.view'')\n'
 || E'          or public.has_company_permission(scope_order.company_id,''execution.work_orders.manage'')\n'
 || E'          or public.has_company_permission(scope_order.company_id,''execution.work_orders.release'')\n'
 || E'          or public.has_company_permission(scope_order.company_id,''execution.work_orders.progress'')\n'
 || E'          or public.has_company_permission(scope_order.company_id,''execution.work_orders.accept''))\n'
 || E'    )) then\n'
 || E'    raise exception using errcode=''42501'',message=''Ordem indisponível ou sem autorização.'';\n'
 || E'  end if;\n'
 || E'-- E14_WORK_ORDER_GUARD_END\n';
begin
 if f is null or not exists(select 1 from pg_proc where oid=f and prosecdef and proargnames[1]='p_work_order_id') then raise exception 'Função financeira nativa de OS ausente ou inesperada; revisar pré-requisitos.';end if;
 original:=pg_get_functiondef(f);
 if position('-- E14_WORK_ORDER_GUARD_BEGIN' in original)=0 then
  guarded:=regexp_replace(original,E'(?i)\\mbegin\\M',E'\\&'||guard);
  if guarded=original then raise exception 'Corpo nativo de OS não reconhecido.';end if;
  execute guarded;
 end if;
 revoke all on function public.refresh_execution_work_order_values(uuid) from public,anon;
 grant execute on function public.refresh_execution_work_order_values(uuid) to authenticated,service_role;
end $migration$;
commit;
