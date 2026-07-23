-- Elos OS - Correcao da classificacao dos planos do Koper
-- Regras definidas para o Flow:
-- 1) valores iguais repetidos mes a mes = monthly
-- 2) valores iguais repetidos anualmente = reinforcement
-- 3) pagamentos iniciais fora dessas series = entry
-- 4) parcela grande em novembro/2027 = keys
-- 5) vencimentos posteriores a novembro/2027 = post_keys
--
-- Este arquivo NAO altera valores, vencimentos, pagamentos ou saldos.
-- Ele corrige tipo, descricao, numeracao e identificacao do CUB das parcelas importadas.

begin;

create temporary table temp_koper_category_fix (
  source_id text primary key,
  category text not null
) on commit drop;

insert into temp_koper_category_fix (source_id, category) values
('koper_receivable_main_p100_r10', 'monthly'),
('koper_receivable_main_p100_r6', 'monthly'),
('koper_receivable_main_p103_r11', 'monthly'),
('koper_receivable_main_p104_r1', 'monthly'),
('koper_receivable_main_p108_r7', 'monthly'),
('koper_receivable_main_p11_r5', 'monthly'),
('koper_receivable_main_p12_r7', 'monthly'),
('koper_receivable_main_p13_r10', 'monthly'),
('koper_receivable_main_p15_r1', 'monthly'),
('koper_receivable_main_p15_r5', 'reinforcement'),
('koper_receivable_main_p152_r6', 'monthly'),
('koper_receivable_main_p157_r7', 'monthly'),
('koper_receivable_main_p16_r3', 'monthly'),
('koper_receivable_main_p16_r6', 'monthly'),
('koper_receivable_main_p163_r4', 'monthly'),
('koper_receivable_main_p167_r8', 'monthly'),
('koper_receivable_main_p169_r8', 'monthly'),
('koper_receivable_main_p177_r6', 'monthly'),
('koper_receivable_main_p183_r1', 'monthly'),
('koper_receivable_main_p190_r6', 'reinforcement'),
('koper_receivable_main_p20_r4', 'monthly'),
('koper_receivable_main_p22_r10', 'monthly'),
('koper_receivable_main_p238_r4', 'reinforcement'),
('koper_receivable_main_p32_r10', 'monthly'),
('koper_receivable_main_p36_r7', 'monthly'),
('koper_receivable_main_p65_r6', 'reinforcement'),
('koper_receivable_main_p98_r6', 'monthly'),
('koper_receivable_partial_p10_r2', 'monthly'),
('koper_receivable_partial_p10_r4', 'monthly'),
('koper_receivable_partial_p10_r5', 'monthly'),
('koper_receivable_partial_p10_r7', 'monthly'),
('koper_receivable_partial_p10_r8', 'monthly'),
('koper_receivable_partial_p11_r2', 'monthly'),
('koper_receivable_partial_p11_r4', 'monthly'),
('koper_receivable_partial_p11_r5', 'monthly'),
('koper_receivable_partial_p11_r7', 'monthly'),
('koper_receivable_partial_p11_r8', 'monthly'),
('koper_receivable_partial_p12_r2', 'monthly'),
('koper_receivable_partial_p12_r4', 'monthly'),
('koper_receivable_partial_p12_r5', 'monthly'),
('koper_receivable_partial_p12_r7', 'monthly'),
('koper_receivable_partial_p12_r8', 'monthly'),
('koper_receivable_partial_p13_r2', 'monthly'),
('koper_receivable_partial_p13_r4', 'monthly'),
('koper_receivable_partial_p13_r5', 'monthly'),
('koper_receivable_partial_p13_r7', 'monthly'),
('koper_receivable_partial_p13_r8', 'monthly'),
('koper_receivable_partial_p14_r2', 'monthly'),
('koper_receivable_partial_p14_r4', 'monthly'),
('koper_receivable_partial_p14_r5', 'monthly'),
('koper_receivable_partial_p14_r7', 'monthly'),
('koper_receivable_partial_p14_r8', 'monthly'),
('koper_receivable_partial_p15_r2', 'monthly'),
('koper_receivable_partial_p15_r4', 'monthly'),
('koper_receivable_partial_p15_r5', 'monthly'),
('koper_receivable_partial_p15_r7', 'monthly'),
('koper_receivable_partial_p15_r8', 'monthly'),
('koper_receivable_partial_p16_r3', 'monthly'),
('koper_receivable_partial_p17_r7', 'monthly'),
('koper_receivable_partial_p2_r2', 'monthly'),
('koper_receivable_partial_p2_r3', 'monthly'),
('koper_receivable_partial_p2_r4', 'monthly'),
('koper_receivable_partial_p2_r5', 'monthly'),
('koper_receivable_partial_p2_r6', 'monthly'),
('koper_receivable_partial_p2_r7', 'monthly'),
('koper_receivable_partial_p2_r8', 'monthly'),
('koper_receivable_partial_p3_r1', 'monthly'),
('koper_receivable_partial_p3_r3', 'monthly'),
('koper_receivable_partial_p3_r4', 'monthly'),
('koper_receivable_partial_p3_r6', 'monthly'),
('koper_receivable_partial_p3_r7', 'monthly'),
('koper_receivable_partial_p4_r1', 'monthly'),
('koper_receivable_partial_p4_r2', 'monthly'),
('koper_receivable_partial_p4_r3', 'monthly'),
('koper_receivable_partial_p4_r4', 'monthly'),
('koper_receivable_partial_p4_r5', 'monthly'),
('koper_receivable_partial_p4_r6', 'monthly'),
('koper_receivable_partial_p4_r7', 'monthly'),
('koper_receivable_partial_p4_r8', 'monthly'),
('koper_receivable_partial_p5_r1', 'monthly'),
('koper_receivable_partial_p5_r2', 'monthly'),
('koper_receivable_partial_p5_r3', 'monthly'),
('koper_receivable_partial_p5_r4', 'monthly'),
('koper_receivable_partial_p5_r5', 'monthly'),
('koper_receivable_partial_p5_r6', 'monthly'),
('koper_receivable_partial_p5_r7', 'monthly'),
('koper_receivable_partial_p5_r8', 'monthly'),
('koper_receivable_partial_p6_r1', 'monthly'),
('koper_receivable_partial_p6_r2', 'monthly'),
('koper_receivable_partial_p6_r3', 'monthly'),
('koper_receivable_partial_p6_r4', 'monthly'),
('koper_receivable_partial_p6_r5', 'monthly'),
('koper_receivable_partial_p6_r6', 'monthly'),
('koper_receivable_partial_p6_r7', 'monthly'),
('koper_receivable_partial_p6_r8', 'monthly'),
('koper_receivable_partial_p7_r1', 'monthly'),
('koper_receivable_partial_p7_r2', 'monthly'),
('koper_receivable_partial_p7_r3', 'monthly'),
('koper_receivable_partial_p7_r4', 'monthly'),
('koper_receivable_partial_p7_r5', 'monthly'),
('koper_receivable_partial_p7_r6', 'monthly'),
('koper_receivable_partial_p7_r7', 'monthly'),
('koper_receivable_partial_p7_r8', 'monthly');

update public.receivables receivable
set category = fix.category,
    description = case fix.category
      when 'entry' then 'Entrada'
      when 'monthly' then 'Parcela mensal'
      when 'reinforcement' then 'Reforco anual'
      when 'keys' then 'Parcela nas chaves'
      when 'post_keys' then 'Parcela pos-chaves'
      else receivable.description
    end ||
    case
      when coalesce(receivable.source_record_kind, '') like '%residual_add%'
        then ' - saldo residual de pagamento parcial'
      else ''
    end,
    updated_at = now()
from temp_koper_category_fix fix
where receivable.source_system = 'koper_flow_receivables'
  and receivable.source_id = fix.source_id;

-- Nos relatorios do Koper, o acrescimo contratual apareceu em "Indices"
-- e, em alguns contratos, em "Juros parc.". Para o plano da venda,
-- ambos passam a indicar que a parcela possui correcao contratual CUB-SC,
-- sem apagar os valores originais de cada coluna.
update public.receivables
set adjustment_index = 'CUB-SC',
    updated_at = now()
where source_system = 'koper_flow_receivables'
  and (
    coalesce(correction_amount, 0) <> 0
    or coalesce(installment_interest_amount, 0) <> 0
  );

-- Renumera cada grupo dentro da venda depois da correcao.
with numbered as (
  select
    id,
    row_number() over (
      partition by sale_id, category
      order by due_date, source_id, id
    )::integer as new_sequence_number,
    count(*) over (
      partition by sale_id, category
    )::integer as new_sequence_total
  from public.receivables
  where source_system = 'koper_flow_receivables'
)
update public.receivables receivable
set sequence_number = numbered.new_sequence_number,
    sequence_total = numbered.new_sequence_total,
    updated_at = now()
from numbered
where receivable.id = numbered.id;

commit;

-- Conferencia geral por categoria.
select
  category,
  count(*) as titulos,
  round(sum(amount), 2) as amortizacao_nominal
from public.receivables
where source_system = 'koper_flow_receivables'
group by category
order by category;

-- Conferencia especifica da unidade 801.
select
  receivable.category,
  receivable.description,
  receivable.sequence_number,
  receivable.sequence_total,
  receivable.due_date,
  receivable.amount,
  receivable.adjustment_index,
  receivable.installment_interest_amount,
  receivable.correction_amount,
  receivable.adjusted_amount,
  receivable.status
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
where receivable.source_system = 'koper_flow_receivables'
  and unit.code = '801'
order by receivable.due_date, receivable.source_id;
