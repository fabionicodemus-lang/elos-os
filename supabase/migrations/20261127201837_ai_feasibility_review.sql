begin;
-- Extend the action registry without replacing other action implementations.
do $$ declare c record; definition text; begin
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.ai_action_proposals'::regclass and contype='c' and pg_get_constraintdef(oid) like '%action_type%' loop
  execute format('alter table public.ai_action_proposals drop constraint %I',c.conname);
  execute format('alter table public.ai_action_proposals add constraint %I check ((%s) or action_type=''commercial_feasibility_import'')',c.conname,substring(c.def from 8 for length(c.def)-8));
 end loop;
 definition:=pg_get_functiondef('public.ai_action_required_permission(text)'::regprocedure);
 if position('select case p_action_type' in definition)=0 then raise exception 'Registro de ações mudou; revisar integração.'; end if;
 execute replace(definition,'select case p_action_type','select case p_action_type when ''commercial_feasibility_import'' then ''commercial.incorporation.manage''');
end $$;
create table public.commercial_feasibility_imports (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),
 study_id uuid not null unique references public.commercial_feasibility_studies(id),proposal_id uuid not null unique references public.ai_action_proposals(id),
 source_file text,extracted_payload jsonb not null,reviewed_payload jsonb not null,applied_fields jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index feasibility_imports_scope_idx on public.commercial_feasibility_imports(company_id,project_id,created_at desc);
alter table public.commercial_feasibility_imports enable row level security;
revoke all on public.commercial_feasibility_imports from public,anon,authenticated,service_role;
grant select on public.commercial_feasibility_imports to authenticated;
create policy feasibility_imports_read on public.commercial_feasibility_imports for select to authenticated using(public.has_company_permission(company_id,'commercial.incorporation.view') or public.has_company_permission(company_id,'commercial.incorporation.manage'));

create function public.ai_feasibility_proposal_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.action_type='commercial_feasibility_import' then
  if new.project_id is null or not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id) then raise exception 'Empreendimento inválido para o estudo.'; end if;
  if tg_op='INSERT' and (new.status<>'pending_review' or new.result is not null or new.reviewed_by is not null or new.executed_by is not null) then raise exception 'O estudo precisa começar aguardando revisão.'; end if;
 end if;return new;
end $$;
create trigger ai_feasibility_proposal_guard before insert or update on public.ai_action_proposals for each row execute function public.ai_feasibility_proposal_guard();

create function public.ai_confirm_feasibility_import(p_company uuid,p_proposal uuid,p_reviewed jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal public.ai_action_proposals; study_id uuid; r jsonb; fields jsonb; k text; cols text; vals text; v_result jsonb; payment_count integer; unit_count integer:=0; area_count integer:=0;
 allowed text[]:=ARRAY['tax_regime','project_type','name','code','city','state','construction_start_date','construction_duration_months','apartment_cost_m2','design_cost_m2','land_cash_amount','iptu_amount','onerous_grant_amount','other_land_amount','commission_pct','tax_rate_pct','marketing_amount','central_office_amount','financial_cost_amount','contingency_pct','preconstruction_months','sales_start_offset_months','sales_velocity_units_month','entry_pct','during_construction_pct','keys_pct','post_keys_pct','post_keys_months','discount_rate_annual_pct','vgv_cub_index_name','vgv_cub_reference_month','vgv_cub_base_value','cost_cub_index_name','cost_cub_reference_month','cost_cub_base_value','notes'];
begin
 if auth.uid() is null or not public.has_company_permission(p_company,'ai.assistant.use') or not public.has_company_permission(p_company,'commercial.incorporation.manage') then raise exception 'Sem permissão para confirmar estudo.'; end if;
 select * into proposal from public.ai_action_proposals where id=p_proposal and company_id=p_company and action_type='commercial_feasibility_import' for update;
 if proposal.id is null then raise exception 'Preparação não encontrada.'; end if;
 if proposal.status='executed' then return proposal.result; end if;
 if proposal.status<>'pending_review' or proposal.expires_at<=now() then raise exception 'Preparação expirada ou já encerrada.'; end if;
 perform 1 from public.projects where id=proposal.project_id and company_id=p_company for share;
 if not found then raise exception 'Empreendimento inválido.'; end if;
 if p_reviewed is null or jsonb_typeof(p_reviewed)<>'object' or octet_length(p_reviewed::text)>250000 or jsonb_typeof(p_reviewed->'study') is distinct from 'object' then raise exception 'Dados de revisão inválidos.'; end if;
 fields:=jsonb_strip_nulls(p_reviewed->'study');
 if nullif(trim(fields->>'name'),'') is null then raise exception 'Informe o nome do estudo.'; end if;
 for k in select jsonb_object_keys(fields) loop
  if not k=any(allowed) then raise exception 'Campo não permitido na importação: %',k; end if;
 end loop;
 -- Never infer a missing payment percentage or an incomplete CUB base.
 select count(*) into payment_count from unnest(array['entry_pct','during_construction_pct','keys_pct','post_keys_pct']) x where fields ? x;
 if payment_count between 1 and 3 then fields:=fields-array['entry_pct','during_construction_pct','keys_pct','post_keys_pct']; end if;
 if not (fields ?& array['vgv_cub_index_name','vgv_cub_reference_month','vgv_cub_base_value']) then fields:=fields-array['vgv_cub_index_name','vgv_cub_reference_month','vgv_cub_base_value']; end if;
 if not (fields ?& array['cost_cub_index_name','cost_cub_reference_month','cost_cub_base_value']) then fields:=fields-array['cost_cub_index_name','cost_cub_reference_month','cost_cub_base_value']; end if;
 select string_agg(format('%I',key),',' order by key),string_agg(format('s.%I',key),',' order by key) into cols,vals from jsonb_each(fields);
 -- Only allowlisted columns are mapped; defaults are simulator assumptions, retained in the review record as missing.
 execute format('insert into public.commercial_feasibility_studies(company_id,created_by,%s) select $1,$2,%s from jsonb_populate_record(null::public.commercial_feasibility_studies,$3) s returning id',cols,vals) into study_id using p_company,auth.uid(),fields;
 if jsonb_typeof(p_reviewed->'unit_types') is distinct from 'array' or jsonb_typeof(p_reviewed->'construction_areas') is distinct from 'array' then raise exception 'Revise as listas de tipologias e áreas.'; end if;
 if jsonb_array_length(p_reviewed->'unit_types')>150 or jsonb_array_length(p_reviewed->'construction_areas')>150 then raise exception 'Limite de 150 linhas por grupo.'; end if;
 for r in select value from jsonb_array_elements(p_reviewed->'unit_types') loop
  if nullif(trim(r->>'name'),'') is not null and r->>'quantity' is not null and r->>'private_area_m2' is not null and r->>'sale_price_m2' is not null and r->>'barter_units' is not null then
   insert into public.commercial_feasibility_unit_types(company_id,study_id,name,quantity,private_area_m2,sale_price_m2,barter_units,sort_order,notes,created_by)
   values(p_company,study_id,r->>'name',(r->>'quantity')::integer,(r->>'private_area_m2')::numeric,(r->>'sale_price_m2')::numeric,(r->>'barter_units')::integer,unit_count,r->>'source',auth.uid());unit_count:=unit_count+1;
  end if;
 end loop;
 for r in select value from jsonb_array_elements(p_reviewed->'construction_areas') loop
  if nullif(trim(r->>'name'),'') is not null and r->>'area_m2' is not null and r->>'cost_m2' is not null then
   insert into public.commercial_feasibility_construction_areas(company_id,study_id,name,area_m2,cost_m2,sort_order,notes,created_by)
   values(p_company,study_id,r->>'name',(r->>'area_m2')::numeric,(r->>'cost_m2')::numeric,area_count,r->>'source',auth.uid());area_count:=area_count+1;
  end if;
 end loop;
 insert into public.commercial_feasibility_imports(company_id,project_id,study_id,proposal_id,source_file,extracted_payload,reviewed_payload,applied_fields,created_by)
 values(p_company,proposal.project_id,study_id,proposal.id,proposal.preview->>'sourceFile',proposal.payload,p_reviewed,to_jsonb(array(select jsonb_object_keys(fields))),auth.uid());
 v_result:=jsonb_build_object('study_id',study_id,'project_id',proposal.project_id,'status','draft','unit_types',unit_count,'construction_areas',area_count,'href','/comercial/incorporacao/viabilidade/'||study_id);
 update public.ai_action_proposals set status='executed',reviewed_by=auth.uid(),reviewed_at=now(),executed_by=auth.uid(),executed_at=now(),result=v_result,updated_at=now() where id=proposal.id;
 return v_result;
end $$;
-- Imported studies belong to an existing project; confirmation never creates another project or replaces its approved baseline.
create function public.guard_imported_feasibility_study() returns trigger language plpgsql security definer set search_path='' as $$
declare origin public.commercial_feasibility_imports;
begin
 select * into origin from public.commercial_feasibility_imports where study_id=old.id;
 if found and (new.company_id<>origin.company_id or new.converted_project_id is distinct from old.converted_project_id or new.status='converted') then raise exception 'Este estudo foi importado para um empreendimento existente. A importação não aprova nem substitui o baseline.'; end if;return new;
end $$;
create trigger guard_imported_feasibility_study before update on public.commercial_feasibility_studies for each row execute function public.guard_imported_feasibility_study();
revoke all on function public.ai_feasibility_proposal_guard(),public.guard_imported_feasibility_study(),public.ai_confirm_feasibility_import(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_confirm_feasibility_import(uuid,uuid,jsonb) to authenticated;
commit;
