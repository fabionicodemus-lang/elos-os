-- Elos OS — correção das permissões financeiras do menu
-- Garante que Fluxo de Caixa e Relatórios Financeiros apareçam para os perfis autorizados.

begin;

insert into public.permissions(key,module,action,description) values
  ('cashflow.view','finance','view_cashflow','Visualizar o fluxo de caixa realizado e projetado'),
  ('reports.view','finance','view_reports','Visualizar os relatórios e indicadores financeiros')
on conflict(key) do update set
  module=excluded.module,
  action=excluded.action,
  description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.key,true
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin','director','finance')
  and p.key in ('cashflow.view','reports.view')
on conflict(role_id,permission_key) do update set allowed=true;

commit;
