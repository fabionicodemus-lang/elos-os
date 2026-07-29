-- Elos OS — Propostas comerciais: validações transacionais da aprovação

begin;

create or replace function public.commercial_set_proposal_status(
  p_company_id uuid,
  p_proposal_id uuid,
  p_status text,
  p_reservation_until date default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.commercial_proposals%rowtype;
  v_sale_exists boolean;
  v_planned numeric(16,2);
begin
  if p_status not in ('draft','sent','negotiation','approved','rejected','expired','cancelled') then
    raise exception 'Situação da proposta inválida.';
  end if;

  if p_status = 'approved' then
    if not public.has_company_permission(p_company_id, 'commercial.proposals.approve') then
      raise exception 'Você não possui permissão para aprovar propostas.';
    end if;
  elsif not public.has_company_permission(p_company_id, 'commercial.proposals.manage') then
    raise exception 'Você não possui permissão para alterar propostas.';
  end if;

  select * into v_proposal
  from public.commercial_proposals
  where id = p_proposal_id and company_id = p_company_id
  for update;

  if not found then raise exception 'Proposta não encontrada.'; end if;
  if v_proposal.status = 'converted' then raise exception 'Uma proposta convertida não pode ser alterada.'; end if;

  select exists(
    select 1 from public.sales
    where unit_id = v_proposal.unit_id and status = 'active'
  ) into v_sale_exists;

  if p_status = 'approved' then
    if v_sale_exists then raise exception 'A unidade já possui uma venda ativa.'; end if;
    if v_proposal.valid_until < current_date then raise exception 'A proposta está vencida. Crie uma nova versão antes de aprovar.'; end if;
    if p_reservation_until is null or p_reservation_until < current_date then
      raise exception 'Informe uma data futura para a reserva da unidade.';
    end if;
    if p_reservation_until > v_proposal.valid_until then
      raise exception 'A reserva não pode ultrapassar a validade da proposta.';
    end if;

    select coalesce(sum(total_amount), 0) into v_planned
    from public.commercial_proposal_payment_items
    where proposal_id = v_proposal.id;

    if v_planned <= 0 then
      raise exception 'Cadastre as condições de pagamento antes da aprovação.';
    end if;
    if abs(v_planned - v_proposal.proposed_amount) > 0.01 then
      raise exception 'O plano financeiro (%) não fecha com o valor da proposta (%).', v_planned, v_proposal.proposed_amount;
    end if;

    if exists(
      select 1 from public.commercial_proposals
      where unit_id = v_proposal.unit_id and status = 'approved' and id <> v_proposal.id
    ) then
      raise exception 'A unidade já está reservada por outra proposta aprovada.';
    end if;

    update public.units
      set status = 'reserved', updated_at = now()
    where id = v_proposal.unit_id and company_id = p_company_id and status <> 'sold';
  elsif v_proposal.status = 'approved' and not v_sale_exists then
    update public.units
      set status = 'available', updated_at = now()
    where id = v_proposal.unit_id and company_id = p_company_id and status = 'reserved';
  end if;

  update public.commercial_proposals
  set status = p_status,
      reservation_until = case when p_status = 'approved' then p_reservation_until else null end,
      updated_by = p_user_id,
      updated_at = now()
  where id = v_proposal.id;
end;
$$;

grant execute on function public.commercial_set_proposal_status(uuid, uuid, text, date, uuid) to authenticated;

commit;
