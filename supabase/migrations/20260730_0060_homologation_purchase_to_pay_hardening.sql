-- Elos OS — Homologação · Compra até Pagamento
-- Protege a aprovação concorrente de recebimentos e impede o cancelamento isolado
-- de títulos gerados por NF-e, preservando a consistência entre Suprimentos e Financeiro.

begin;

create or replace function public.approve_procurement_material_receipt(
  p_company_id uuid,
  p_project_id uuid,
  p_receipt_id uuid,
  p_notes text
) returns text
language plpgsql
security definer
set search_path=public as $$
declare
  v_receipt public.procurement_material_receipts%rowtype;
  v_order public.procurement_purchase_orders%rowtype;
  v_receipt_item record;
  v_order_item public.procurement_purchase_order_items%rowtype;
  v_available numeric;
begin
  if not public.has_company_permission(p_company_id,'procurement.receipts.approve') then
    raise exception 'Sem permissão para aprovar recebimentos.';
  end if;

  select * into v_receipt
  from public.procurement_material_receipts
  where id=p_receipt_id
    and company_id=p_company_id
    and project_id=p_project_id
  for update;

  if v_receipt.id is null or v_receipt.status<>'submitted' then
    raise exception 'Recebimento não disponível para aprovação.';
  end if;

  -- Serializa todas as aprovações do mesmo pedido. Dois recebimentos elaborados
  -- com o mesmo saldo não podem ser aprovados simultaneamente.
  perform pg_advisory_xact_lock(hashtext(v_receipt.order_id::text || ':material-receipt-approval'));

  select * into v_order
  from public.procurement_purchase_orders
  where id=v_receipt.order_id
    and company_id=p_company_id
    and project_id=p_project_id
  for update;

  if v_order.id is null then
    raise exception 'Pedido de compra não encontrado.';
  end if;
  if v_order.status in ('cancelled','closed') then
    raise exception 'O pedido está encerrado ou cancelado e não aceita novos recebimentos.';
  end if;

  for v_receipt_item in
    select *
    from public.procurement_material_receipt_items
    where receipt_id=v_receipt.id
    order by sort_order,id
  loop
    select * into v_order_item
    from public.procurement_purchase_order_items
    where id=v_receipt_item.order_item_id
      and order_id=v_receipt.order_id
      and company_id=p_company_id
      and project_id=p_project_id
    for update;

    if v_order_item.id is null then
      raise exception 'Um dos itens do recebimento não pertence mais ao pedido.';
    end if;

    v_available := greatest(
      v_order_item.ordered_quantity
      - v_order_item.cancelled_quantity
      - v_order_item.accepted_quantity,
      0
    );

    if v_receipt_item.accepted_quantity > v_available + 0.000001 then
      raise exception 'O aceite de % ultrapassa o saldo atual do pedido. Disponível: % %.',
        v_order_item.input_code,
        trim(to_char(v_available,'FM999999999990.######')),
        v_order_item.unit_snapshot;
    end if;

    update public.procurement_purchase_order_items
    set received_quantity=received_quantity+v_receipt_item.delivered_quantity,
        accepted_quantity=accepted_quantity+v_receipt_item.accepted_quantity,
        rejected_quantity=rejected_quantity+v_receipt_item.rejected_quantity,
        updated_at=now()
    where id=v_order_item.id;

    if v_receipt_item.rejected_quantity>0 then
      insert into public.procurement_material_receipt_discrepancies(
        company_id,project_id,receipt_id,receipt_item_id,discrepancy_type,
        description,severity,status,due_date,created_by
      ) values(
        p_company_id,p_project_id,v_receipt.id,v_receipt_item.id,
        case
          when v_receipt_item.condition='damaged' then 'damage'
          when v_receipt_item.condition='wrong_specification' then 'specification'
          else 'quantity'
        end,
        coalesce(v_receipt_item.rejection_reason,'Material rejeitado'),
        'high','open',current_date+3,auth.uid()
      );
    end if;
  end loop;

  update public.procurement_material_receipts
  set status='approved',
      approved_by=auth.uid(),
      approved_at=now(),
      approval_notes=nullif(trim(coalesce(p_notes,'')),''),
      updated_by=auth.uid(),
      updated_at=now()
  where id=v_receipt.id;

  perform public.refresh_procurement_purchase_order(v_receipt.order_id);

  insert into public.procurement_material_receipt_audit(
    company_id,project_id,receipt_id,action,previous_status,new_status,reason,details,changed_by
  ) values(
    p_company_id,p_project_id,v_receipt.id,'approved','submitted','approved',
    nullif(trim(coalesce(p_notes,'')),''),
    jsonb_build_object('order_id',v_receipt.order_id,'balance_revalidated',true),
    auth.uid()
  );

  return 'approved';
end;
$$;

-- Títulos criados por uma NF-e aprovada não podem ser cancelados isoladamente.
-- A baixa/correção precisa acontecer pelo documento fiscal de origem, para que
-- nota, parcelas, pedido e recebimento permaneçam consistentes.
create or replace function public.protect_nfe_generated_payable()
returns trigger
language plpgsql
set search_path=public as $$
begin
  if old.status is distinct from 'cancelled'
     and new.status='cancelled'
     and coalesce(new.source_id,'') like 'nfe:%'
     and coalesce(current_setting('elos.allow_nfe_payable_cancel',true),'')<>'1' then
    raise exception 'Este título foi gerado por uma NF-e aprovada. Trate o documento fiscal de origem antes de cancelar a parcela.';
  end if;
  return new;
end;
$$;

drop trigger if exists payables_protect_nfe_generated_title on public.payables;
create trigger payables_protect_nfe_generated_title
before update of status on public.payables
for each row execute function public.protect_nfe_generated_payable();

grant execute on function public.approve_procurement_material_receipt(uuid,uuid,uuid,text) to authenticated;

commit;
