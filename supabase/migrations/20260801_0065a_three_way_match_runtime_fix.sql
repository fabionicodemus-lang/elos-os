-- Elos OS — ajuste de runtime da conferência Pedido × Recebimento × NF-e

begin;

create or replace function public.trigger_recompute_finance_three_way_match()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.recompute_finance_electronic_invoice_three_way_match(old.invoice_id);
    return old;
  end if;
  perform public.recompute_finance_electronic_invoice_three_way_match(new.invoice_id);
  return new;
end;
$$;

-- Se os vínculos principais forem alterados por uma rotina administrativa futura,
-- o resultado do match também é recalculado automaticamente.
create or replace function public.trigger_recompute_finance_three_way_header()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.recompute_finance_electronic_invoice_three_way_match(new.id);
  return new;
end;
$$;

drop trigger if exists finance_invoice_three_way_header_update on public.finance_electronic_invoices;
create trigger finance_invoice_three_way_header_update
after update of supplier_id,order_id,receipt_id
on public.finance_electronic_invoices
for each row execute function public.trigger_recompute_finance_three_way_header();

revoke all on function public.trigger_recompute_finance_three_way_match() from public,authenticated;
revoke all on function public.trigger_recompute_finance_three_way_header() from public,authenticated;

commit;
