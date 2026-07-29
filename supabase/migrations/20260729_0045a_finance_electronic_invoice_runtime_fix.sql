-- Elos OS — Notas Eletrônicas 0045a
-- Corrige conflitos entre nomes de variáveis PL/pgSQL e colunas das tabelas.

begin;

do $fix$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.save_finance_electronic_invoice(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb)'::regprocedure
  ) into function_definition;

  function_definition := replace(function_definition, 'access_key text;', 'v_access_key text;');
  function_definition := replace(function_definition, 'access_key:=regexp_replace', 'v_access_key:=regexp_replace');
  function_definition := replace(function_definition, 'if length(access_key)<>44', 'if length(v_access_key)<>44');
  function_definition := replace(
    function_definition,
    'from public.finance_electronic_invoices where access_key=access_key',
    'from public.finance_electronic_invoices existing_invoice where existing_invoice.access_key=v_access_key'
  );
  function_definition := replace(
    function_definition,
    'access_key,p_payload->>''model''',
    'v_access_key,p_payload->>''model'''
  );
  function_definition := replace(
    function_definition,
    'receipt_row.invoice_access_key,access_key);',
    'receipt_row.invoice_access_key,v_access_key);'
  );
  function_definition := replace(
    function_definition,
    'jsonb_build_object(''access_key'',access_key,',
    'jsonb_build_object(''access_key'',v_access_key,'
  );

  if function_definition not like '%v_access_key%' then
    raise exception 'Não foi possível aplicar a correção da chave de acesso.';
  end if;

  execute function_definition;
end
$fix$;

do $fix$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.approve_finance_electronic_invoice(uuid,uuid,uuid,text)'::regprocedure
  ) into function_definition;

  function_definition := replace(function_definition, 'payable_id uuid;', 'v_payable_id uuid;');
  function_definition := replace(function_definition, 'returning id into payable_id;', 'returning id into v_payable_id;');
  function_definition := replace(function_definition, 'set payable_id=payable_id,', 'set payable_id=v_payable_id,');

  if function_definition not like '%v_payable_id%' then
    raise exception 'Não foi possível aplicar a correção do vínculo financeiro.';
  end if;

  execute function_definition;
end
$fix$;

grant execute on function public.save_finance_electronic_invoice(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.approve_finance_electronic_invoice(uuid,uuid,uuid,text) to authenticated;

commit;
