-- Elos OS - detalhamento legado do contas a receber do Koper

alter table public.receivables
  add column if not exists installment_interest_amount numeric(16,2) not null default 0,
  add column if not exists correction_amount numeric(16,2) not null default 0,
  add column if not exists late_fee_amount numeric(16,2) not null default 0,
  add column if not exists other_accrual_amount numeric(16,2) not null default 0,
  add column if not exists discount_amount numeric(16,2) not null default 0,
  add column if not exists adjusted_amount numeric(16,2),
  add column if not exists source_page integer,
  add column if not exists source_record_kind text;

update public.receivables
set adjusted_amount = amount
where adjusted_amount is null;

alter table public.receivables
  alter column adjusted_amount set default 0,
  alter column adjusted_amount set not null;

comment on column public.receivables.amount is 'Valor nominal da parcela. Na importacao Koper corresponde a Amortizacao.';
comment on column public.receivables.correction_amount is 'Valor monetario do reajuste. Na importacao Koper corresponde a coluna Indices.';
comment on column public.receivables.adjusted_amount is 'Valor atualizado da parcela antes de multas, outros acrescimos e descontos.';
comment on column public.receivables.installment_interest_amount is 'Juros de parcelamento informados na origem.';
comment on column public.receivables.late_fee_amount is 'Juros e multa por atraso informados na origem.';
comment on column public.receivables.other_accrual_amount is 'Outros acrescimos informados na origem.';
comment on column public.receivables.discount_amount is 'Desconto concedido na origem.';

create index if not exists receivables_source_page_idx
  on public.receivables(company_id, source_system, source_page);
