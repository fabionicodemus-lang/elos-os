-- Corrige a listagem global: auth.users.email e varchar, mas o retorno exige text.
-- A substituicao preserva a assinatura e as empresas ja cadastradas.
begin;

create or replace function public.platform_list_environments()
returns table (
  company_id uuid,
  company_name text,
  company_slug text,
  company_status text,
  owner_email text,
  project_count bigint,
  member_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;

  return query
  select c.id,
    c.name,
    c.slug,
    c.status,
    coalesce((
      select u.email::text
      from public.company_memberships m
      join public.roles r on r.id = m.role_id
      join auth.users u on u.id = m.user_id
      where m.company_id = c.id
        and m.status = 'active'
        and r.key = 'owner'
      order by m.created_at asc
      limit 1
    ), ''::text),
    (select count(*) from public.projects p
      where p.company_id = c.id and p.status <> 'archived'),
    (select count(*) from public.company_memberships m
      where m.company_id = c.id and m.status = 'active'),
    c.created_at
  from public.companies c
  order by c.created_at desc;
end;
$$;

revoke all on function public.platform_list_environments() from public, anon, authenticated;
grant execute on function public.platform_list_environments() to authenticated;

commit;
