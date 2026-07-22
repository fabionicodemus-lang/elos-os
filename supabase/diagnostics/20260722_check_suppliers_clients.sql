-- Diagnóstico rápido — fornecedores e clientes da Bossa

select
  company.id,
  company.name,
  company.slug,
  (select count(*) from public.suppliers supplier where supplier.company_id = company.id) as suppliers_count,
  (select count(*) from public.clients client where client.company_id = company.id) as clients_count
from public.companies company
where company.slug in ('bossa', 'bossa-empreendimentos')
   or lower(company.name) = lower('Bossa Empreendimentos');

select
  role.key as role_key,
  role.name as role_name,
  permission.permission_key,
  permission.allowed
from public.roles role
left join public.role_permissions permission on permission.role_id = role.id
join public.companies company on company.id = role.company_id
where (company.slug in ('bossa', 'bossa-empreendimentos')
   or lower(company.name) = lower('Bossa Empreendimentos'))
  and role.key in ('owner', 'admin')
  and permission.permission_key in ('suppliers.view', 'suppliers.manage', 'clients.view', 'clients.manage')
order by role.key, permission.permission_key;
