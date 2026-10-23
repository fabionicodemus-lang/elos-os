-- PLANO SOMENTE. Não executado em produção.
-- Usar apenas com autorização explícita, inventário revisado e ausência de
-- concessões alternativas/inheridas que mantenham EXECUTE para usuários finais.
-- Contenção fecha também operações legítimas interativas; avaliar impacto.
-- Não restaura o corpo vulnerável nem remove os guards existentes.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
revoke execute on function public.refresh_execution_service_contract_value(uuid) from public,anon,authenticated;
revoke execute on function public.refresh_execution_service_contract_measurements(uuid) from public,anon,authenticated;
revoke execute on function public.refresh_execution_work_order_values(uuid) from public,anon,authenticated;
commit;
