-- Match the native receivable permissions for financial values and manual writes.
-- Index metadata/history remain readable under the native index permissions.
-- Existing reviewed policies and the index-write trigger are unchanged.
begin;

drop policy if exists receivable_correction_policies_read on public.receivable_correction_policies;
create policy receivable_correction_policies_read on public.receivable_correction_policies
for select to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_company_permission(company_id, 'receivables.view')
    or public.has_company_permission(company_id, 'receivables.manage')
  )
);

drop policy if exists receivable_correction_events_read on public.receivable_correction_events;
create policy receivable_correction_events_read on public.receivable_correction_events
for select to authenticated
using (
  public.is_company_member(company_id)
  and (
    public.has_company_permission(company_id, 'receivables.view')
    or public.has_company_permission(company_id, 'receivables.manage')
  )
);

create or replace function finance_correction_private.refresh_authorized(
  p_company uuid, p_index uuid, p_limit integer
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform finance_correction_private.assert_permission(p_company, false);
  if not coalesce(public.has_company_permission(p_company, 'receivables.manage'), false) then
    raise exception 'Sem permissão para atualizar os recebíveis desta empresa.';
  end if;
  if p_index is not null and not exists (
    select 1 from public.correction_indices where id=p_index and company_id=p_company
  ) then
    raise exception 'Índice fora da empresa.';
  end if;
  return finance_correction_private.refresh_batch(p_company, p_index, p_limit);
end;
$$;

create or replace function finance_correction_private.overview(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; target date:=finance_correction_private.current_month();
begin
  perform finance_correction_private.assert_permission(p_company, false);
  if not (
    coalesce(public.has_company_permission(p_company, 'receivables.view'), false)
    or coalesce(public.has_company_permission(p_company, 'receivables.manage'), false)
  ) then
    raise exception 'Sem permissão para consultar os recebíveis desta empresa.';
  end if;
  select jsonb_build_object(
    'reference_month', target,
    'total', count(*),
    'active', count(*) filter(where p.state='active'),
    'blocked', count(*) filter(where p.state in('blocked','review_required')),
    'history_preserved', count(*) filter(where p.state='suspended'),
    'pending', count(*) filter(where p.enabled and (
      p.last_checked_month<target or p.last_checked_generation<coalesce(q.generation,0)
    )),
    'scheduler_configured', false
  ) into result
  from public.receivable_correction_policies p
  left join public.receivable_correction_queue q
    on q.company_id=p.company_id and q.correction_index_id=p.correction_index_id
  where p.company_id=p_company;
  return result;
end;
$$;

revoke all on function finance_correction_private.refresh_authorized(uuid,uuid,integer)
  from public,anon,authenticated;
revoke all on function finance_correction_private.overview(uuid)
  from public,anon,authenticated;
grant execute on function finance_correction_private.refresh_authorized(uuid,uuid,integer)
  to authenticated;
grant execute on function finance_correction_private.overview(uuid)
  to authenticated;

commit;
