-- Elos OS — Sistema · Permissões · endurecimento de segurança
-- Toda mutação passa pelas funções transacionais da migration 0056.

begin;

revoke insert,update,delete on public.roles from authenticated;
revoke insert,update,delete on public.role_permissions from authenticated;

commit;
