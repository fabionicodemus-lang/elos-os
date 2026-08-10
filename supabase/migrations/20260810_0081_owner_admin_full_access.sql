-- Elos OS — Proprietário e Administrador com acesso total e permanente
-- Os papéis owner e admin são superadministradores da empresa e não dependem
-- de uma matriz estática de permissões.

begin;

create or replace function public.has_company_permission(
  target_company_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships membership
    join public.roles role
      on role.id = membership.role_id
     and role.company_id = membership.company_id
    where membership.company_id = target_company_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and role.status = 'active'
      and (
        role.key in ('owner', 'admin')
        or exists (
          select 1
          from public.role_permissions role_permission
          where role_permission.role_id = membership.role_id
            and role_permission.permission_key = target_permission
            and role_permission.allowed = true
        )
      )
  );
$$;

-- Corrige imediatamente todos os Proprietários e Administradores existentes.
insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.key, true
from public.roles role
cross join public.permissions permission
where role.key in ('owner', 'admin')
  and role.status = 'active'
on conflict (role_id, permission_key) do update
set allowed = true;

-- Toda permissão nova é concedida automaticamente aos dois papéis privilegiados.
create or replace function public.grant_new_permission_to_company_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_key, allowed)
  select role.id, new.key, true
  from public.roles role
  where role.key in ('owner', 'admin')
    and role.status = 'active'
  on conflict (role_id, permission_key) do update
  set allowed = true;

  return new;
end;
$$;

-- Mantém compatibilidade com o trigger criado na 0080.
drop trigger if exists grant_new_permission_to_company_owners_trigger
  on public.permissions;
create trigger grant_new_permission_to_company_owners_trigger
after insert on public.permissions
for each row execute function public.grant_new_permission_to_company_owners();

-- Owner e admin não podem ter permissões removidas ou desativadas na matriz.
create or replace function public.enforce_owner_role_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
  target_role_key text;
begin
  target_role_id := case when tg_op = 'DELETE' then old.role_id else new.role_id end;

  select role.key
  into target_role_key
  from public.roles role
  where role.id = target_role_id;

  if target_role_key in ('owner', 'admin') then
    if tg_op = 'DELETE' then
      return null;
    end if;

    new.allowed := true;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_owner_role_permission_trigger
  on public.role_permissions;
create trigger enforce_owner_role_permission_trigger
before insert or update or delete on public.role_permissions
for each row execute function public.enforce_owner_role_permission();

grant execute on function public.has_company_permission(uuid, text) to authenticated;

commit;
