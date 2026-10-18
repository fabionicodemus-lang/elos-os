-- Importação de orçamento: promoção compatível com o gatilho que cria a composição do item.
--
-- O gatilho initialize_engineering_budget_item_composition_after_insert já cria uma composição
-- (cópia do serviço do catálogo) ao inserir cada item. A promoção inseria outra e falhava com
-- chave duplicada em engineering_budget_item_compositions(budget_item_id). Agora a promoção
-- reaproveita a composição criada, desativa os itens copiados do catálogo e grava os da planilha.

do $do$
declare f text := pg_get_functiondef('public.promote_engineering_budget_import'::regproc); g text;
begin
  if position('on conflict (budget_item_id)' in f) > 0 then return; end if;

  g := replace(f, $a$    ) returning id into v_composition_id;
$a$, $b$    )
    on conflict (budget_item_id) do update set
      source_service_id = excluded.source_service_id,
      source_composition_id = null,
      is_customized = true,
      notes = excluded.notes,
      status = 'active',
      updated_at = now()
    returning id into v_composition_id;

    -- O gatilho do item já copia a composição do serviço do catálogo; a da planilha substitui essa cópia.
    update public.engineering_budget_item_composition_items
    set status = 'inactive', updated_at = now()
    where composition_id = v_composition_id and price_source <> 'imported';
$b$);
  if g = f then raise exception 'promote_engineering_budget_import: trecho da composição não encontrado'; end if;
  f := g;

  g := replace(f, $a$        unit_price = case
          when engineering_budget_item_composition_items.coefficient + excluded.coefficient > 0 then$a$,
  $b$        unit_price = case
          when engineering_budget_item_composition_items.status <> 'active' then excluded.unit_price
          when engineering_budget_item_composition_items.coefficient + excluded.coefficient > 0 then$b$);
  if g = f then raise exception 'promote_engineering_budget_import: trecho do preço não encontrado'; end if;
  f := g;

  g := replace(f, $a$        coefficient = engineering_budget_item_composition_items.coefficient + excluded.coefficient,
        price_source = 'imported',$a$, $b$        coefficient = case when engineering_budget_item_composition_items.status <> 'active' then excluded.coefficient
                           else engineering_budget_item_composition_items.coefficient + excluded.coefficient end,
        status = 'active',
        price_source = 'imported',$b$);
  if g = f then raise exception 'promote_engineering_budget_import: trecho do coeficiente não encontrado'; end if;

  execute g;
end $do$;
