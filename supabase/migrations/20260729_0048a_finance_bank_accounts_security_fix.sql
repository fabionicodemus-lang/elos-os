-- Elos OS — Contas Bancárias · reforço de segurança e permissões de baixa

begin;

-- Todo papel que pode registrar pagamento ou recebimento precisa visualizar as contas disponíveis.
insert into public.role_permissions(role_id,permission_key,allowed)
select distinct rp.role_id,'finance.bank_accounts.view',true
from public.role_permissions rp
where rp.allowed=true and rp.permission_key in('payables.manage','receivables.manage')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

-- Engenharia e consulta podem visualizar saldos; comercial visualiza as contas usadas nas baixas de clientes.
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'finance.bank_accounts.view',true from public.roles r
where r.key in('engineering','viewer','commercial')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

create or replace function public.finance_bank_account_balance(p_account_id uuid,p_until_date date default null)
returns numeric
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_account public.finance_bank_accounts%rowtype;
  v_movements numeric:=0;
begin
  select * into v_account from public.finance_bank_accounts where id=p_account_id;
  if v_account.id is null then return null; end if;
  if not (
    public.has_company_permission(v_account.company_id,'finance.bank_accounts.view') or
    public.has_company_permission(v_account.company_id,'finance.bank_accounts.manage') or
    public.has_company_permission(v_account.company_id,'finance.bank_accounts.reconcile')
  ) then raise exception 'Sem permissão para consultar o saldo desta conta.'; end if;

  if p_until_date is not null and p_until_date<v_account.opening_balance_date then return 0; end if;

  select coalesce(sum(
    case when direction='credit' then amount when direction='debit' then -amount else 0 end
  ),0)
  into v_movements
  from public.finance_bank_transactions
  where bank_account_id=v_account.id
    and status in('posted','reconciled')
    and (p_until_date is null or transaction_date<=p_until_date);

  return round(v_account.opening_balance+v_movements,2);
end;
$$;

grant execute on function public.finance_bank_account_balance(uuid,date) to authenticated;

commit;
