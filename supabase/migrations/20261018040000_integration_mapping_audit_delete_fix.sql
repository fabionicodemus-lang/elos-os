-- Correção: ao apagar um vínculo do Mapa de Integrações, a auditoria tentava apontar para o id
-- já removido e a exclusão falhava por chave estrangeira. A auditoria de exclusão passa a guardar
-- o conteúdo em old_data, com mapping_id nulo.

create or replace function public.integration_mapping_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.integration_mapping_audit (mapping_id, company_id, action, old_data, new_data, changed_by)
    values (new.id, new.company_id, 'insert', null, to_jsonb(new), coalesce(auth.uid(), new.confirmed_by, new.created_by));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.integration_mapping_audit (mapping_id, company_id, action, old_data, new_data, changed_by)
    values (new.id, new.company_id, 'update', to_jsonb(old), to_jsonb(new), coalesce(auth.uid(), new.confirmed_by, new.created_by));
    return new;
  else
    insert into public.integration_mapping_audit (mapping_id, company_id, action, old_data, new_data, changed_by)
    values (null, old.company_id, 'delete', to_jsonb(old), null, auth.uid());
    return old;
  end if;
end;
$function$;
