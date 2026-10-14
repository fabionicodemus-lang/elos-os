-- Elos OS — Banking: escritas passam por RPCs privilegiados com autorização interna
-- As tabelas permanecem read-only para authenticated; o usuário não recebe INSERT/UPDATE direto.
begin;

alter function public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric) security definer;
alter function public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric) set search_path to '';

alter function public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) security definer;
alter function public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) set search_path to '';

alter function public.bank_save_connection(uuid,uuid,text,text,text,text,text,text) security definer;
alter function public.bank_save_connection(uuid,uuid,text,text,text,text,text,text) set search_path to '';

alter function public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) security definer;
alter function public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) set search_path to '';

alter function public.bank_save_card_settings(uuid,numeric,integer,integer) security definer;
alter function public.bank_save_card_settings(uuid,numeric,integer,integer) set search_path to '';

alter function public.bank_post_card_purchase(uuid,uuid,date,text,numeric,integer,text) security definer;
alter function public.bank_post_card_purchase(uuid,uuid,date,text,numeric,integer,text) set search_path to '';

alter function public.bank_cancel_card_purchase(uuid,text) security definer;
alter function public.bank_cancel_card_purchase(uuid,text) set search_path to '';

alter function public.bank_close_card_cycle(uuid) security definer;
alter function public.bank_close_card_cycle(uuid) set search_path to '';

alter function public.bank_pay_card_cycle(uuid,uuid,date,numeric) security definer;
alter function public.bank_pay_card_cycle(uuid,uuid,date,numeric) set search_path to '';

-- Mantém o princípio de privilégio mínimo: só os RPCs públicos acima podem escrever.
revoke insert,update,delete,truncate,references,trigger on public.finance_bank_connections from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_collection_charges from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_receivable_settlements from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_payable_settlements from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_bank_webhook_events from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_cnab_files from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_card_cycles from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_card_transactions from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.finance_card_cycle_settlements from authenticated;

commit;
