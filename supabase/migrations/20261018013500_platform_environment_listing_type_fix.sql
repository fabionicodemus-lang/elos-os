-- Elos OS | Correção da listagem global de ambientes
-- A criação de ambientes pela migration 0061 funciona, mas a listagem usa
-- RETURNS TABLE(... owner_email text ...) e a coluna auth.users.email pode
-- ser character varying. Em plpgsql RETURN QUERY requer os tipos exatos.
-- Esta migration é idempotente e não modifica empresas, acessos ou obras.

begin;

create or replace function public.platform_list_environments()
returns table(
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
set search_path = public, auth
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Área restrita à administração da plataforma.';
  end if;

  return query
  select
    company.id,
    company.name::text,
    company.slug::text,
    company.status::text,
    coalesce((
      select users.email::text
      from public.company_memberships membership
      join public.roles role on role.id = membership.role_id
      join auth.users users on users.id = membership.user_id
      where membership.company_id = company.id
        and membership.status = 'active'
        and role.key = 'owner'
      order by membership.created_at asc
      limit 1
    ), ''::text),
    (select count(*) from public.projects project
     where project.company_id = company.id and project.status <> 'archived'),
    (select count(*) from public.company_memberships membership
     where membership.company_id = company.id and membership.status = 'active'),
    company.created_at
  from public.companies company
  order by company.created_at desc;
end;
$$;

revoke all on function public.platform_list_environments() from public, anon;
grant execute on function public.platform_list_environments() to authenticated;

commit;
