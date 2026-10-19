-- Trava de segurança: a rotina diária antiga do Flow (que gravava títulos "koper_flow" e fornecedores
-- automáticos) foi substituída pela importação limpa. Mesmo que ela volte a rodar por engano, o banco
-- recusa as gravações dela na Flow Aptos. Os títulos antigos já existentes continuam editáveis pelo app.

create or replace function elos_import.block_old_flow_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'payables' then
    if new.source_system = 'koper_flow' and new.project_id = 'fd40811c-9aa3-4c3c-9121-95f19863e70a'::uuid then
      raise exception 'Rotina antiga do Flow desligada: título recusado (a Flow Aptos é atualizada pela importação limpa).';
    end if;
  elsif tg_table_name = 'suppliers' then
    if new.source_system = 'koper' and new.notes = 'Cadastro vinculado à importação de contas a pagar do Koper' then
      raise exception 'Rotina antiga do Flow desligada: fornecedor automático recusado.';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger block_old_flow_sync_ins before insert on public.payables
  for each row execute function elos_import.block_old_flow_sync();

create or replace trigger block_old_flow_sync_ins before insert on public.suppliers
  for each row execute function elos_import.block_old_flow_sync();
