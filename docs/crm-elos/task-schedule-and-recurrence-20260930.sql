-- Elos CRM only (ivvfguxijohxyiykacnd); no changes to Elos OS database.
alter table public.tarefas
  add column recorrente boolean not null default false,
  add column dias_semana smallint[] not null default '{}',
  add column historico_recorrencia jsonb not null default '[]'::jsonb,
  add constraint tarefas_dias_semana_validos check (
    dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
    and (not recorrente or (data is not null and cardinality(dias_semana)>0))
  ),
  add constraint tarefas_historico_array check (jsonb_typeof(historico_recorrencia)='array');

create function public.concluir_tarefa_recorrente(p_id text, p_data date)
returns public.tarefas
language plpgsql security invoker set search_path = ''
as $$
declare
  tarefa public.tarefas;
  proxima date;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or not public.eh_autorizado() then
    raise exception 'Acesso não autorizado' using errcode='42501';
  end if;
  select * into tarefa from public.tarefas where id=p_id for update;
  if not found or tarefa.excluida or not tarefa.recorrente then
    raise exception 'Tarefa recorrente não encontrada';
  end if;
  -- Stale/double-click submissions never complete the next occurrence.
  if tarefa.data is distinct from p_data then return tarefa; end if;
  select min(d::date) into proxima
    from generate_series(greatest(tarefa.data,hoje)+1,
                         greatest(tarefa.data,hoje)+7,interval '1 day') d
    where extract(dow from d)::smallint = any(tarefa.dias_semana);
  update public.tarefas set
    data=proxima, feito=false, feito_em=null,
    historico_recorrencia=historico_recorrencia || jsonb_build_array(
      jsonb_build_object('data',tarefa.data,'concluidaEm',hoje,'concluidaPor',auth.uid()))
    where id=p_id returning * into tarefa;
  return tarefa;
end;
$$;
revoke all on function public.concluir_tarefa_recorrente(text,date) from public,anon;
grant execute on function public.concluir_tarefa_recorrente(text,date) to authenticated;

-- User-approved dates and weekly routines, starting 2026-10-01.
insert into public.tarefas (id,custom,fase,titulo,data,recorrente,dias_semana) values
('t01',false,'f1','Definir com o Fábio os preços do orçamento e do acompanhamento mensal','2026-10-01',false,'{}'::smallint[]),
('t03',false,'f1','Montar a apresentação da Elos para construtoras (PDF)','2026-10-05',false,'{}'::smallint[]),
('t04',false,'f1','Montar a apresentação da Elos para condomínios (PDF)','2026-10-06',false,'{}'::smallint[]),
('t05',false,'f1','Montar o caso Edifício Crystal com fotos de antes, durante e depois','2026-10-06',false,'{}'::smallint[]),
('t06',false,'f1','Criar modelo de proposta de orçamento executivo','2026-10-07',false,'{}'::smallint[]),
('t07',false,'f1','Criar modelo de proposta de execução para condomínio','2026-10-08',false,'{}'::smallint[]),
('t08',false,'f1','Separar no celular um exemplo de orçamento e um diário de obra para mostrar','2026-10-09',false,'{}'::smallint[]),
('t09',false,'f1','Ativar o WhatsApp comercial da Elos','2026-10-01',false,'{}'::smallint[]),
('t10',false,'f1','Fazer cartões de visita','2026-10-02',false,'{}'::smallint[]),
('t11',false,'f1','Criar ou atualizar o Instagram e o perfil do Google da Elos Engenharia','2026-10-02',false,'{}'::smallint[]),
('t11b',false,'f2','Conversar com os 10 donos de construtoras que conhecemos','2026-10-16',false,'{}'::smallint[]),
('t12',false,'f2','Descobrir quem decide nas 10 construtoras prioritárias','2026-10-13',false,'{}'::smallint[]),
('t13',false,'f2','Visitar as 5 administradoras prioritárias de Itapema','2026-10-15',false,'{}'::smallint[]),
('t14',false,'f2','Fazer o primeiro contato com 25 construtoras','2026-10-23',false,'{}'::smallint[]),
('t15',false,'f2','Fazer o primeiro contato com todas as administradoras e síndicos profissionais','2026-10-27',false,'{}'::smallint[]),
('t16',false,'f2','Pedir a cada administradora visitada a indicação de 2 síndicos com obra pendente','2026-10-16',false,'{}'::smallint[]),
('t17',false,'f2','Fotografar 20 placas de obra na região e cadastrar as construtoras que faltam','2026-10-20',false,'{}'::smallint[]),
('t18',false,'f2','Agendar 5 reuniões ou visitas técnicas','2026-10-30',false,'{}'::smallint[]),
('t19',false,'f3','Fazer 3 vistorias técnicas em condomínios','2026-11-06',false,'{}'::smallint[]),
('t20',false,'f3','Enviar 5 propostas','2026-11-13',false,'{}'::smallint[]),
('t21',false,'f3','Fechar parceria com a primeira administradora','2026-11-19',false,'{}'::smallint[]),
('t22',false,'f3','Publicar o caso Edifício Crystal no Instagram','2026-11-03',false,'{}'::smallint[]),
('t23',false,'f3','Mapear 20 empresas em novas cidades','2026-11-27',false,'{}'::smallint[]),
('t24',false,'f4','Fechar 3 contratos (pelo menos 1 construtora e 1 condomínio)','2026-12-11',false,'{}'::smallint[]),
('t25',false,'f4','Oferecer o Elos OS a todo cliente que fechar','2026-12-14',false,'{}'::smallint[]),
('t26',false,'f4','Colocar o primeiro cliente testando o Elos OS','2026-12-18',false,'{}'::smallint[]),
('t27',false,'f4','Fechar a segunda parceria com administradora','2026-12-22',false,'{}'::smallint[]),
('t28',false,'f4','Revisar os motivos das propostas perdidas e ajustar a abordagem','2026-12-23',false,'{}'::smallint[]),
('t29',false,'f4','Fazer a revisão dos 90 dias com o Fábio: metas x resultado','2026-12-30',false,'{}'::smallint[]),
('t30',false,'f5','Segunda: organizar a semana e mapear 10 novas empresas','2026-10-05',true,'{1}'::smallint[]),
('t31',false,'f5','Terça e quinta: rota de visitas (uma cidade por dia)','2026-10-01',true,'{2,4}'::smallint[]),
('t32',false,'f5','Quarta: follow-ups por WhatsApp e ligação, preparar propostas','2026-10-07',true,'{3}'::smallint[]),
('t33',false,'f5','Sexta: enviar propostas e revisar o funil com o Fábio','2026-10-02',true,'{5}'::smallint[]),
('t34',false,'f5','Sexta: conferir os registros de contatos da semana','2026-10-02',true,'{5}'::smallint[])
on conflict (id) do update set
 data=excluded.data, recorrente=excluded.recorrente, dias_semana=excluded.dias_semana,
 titulo=case when tarefas.id='t34' then excluded.titulo else tarefas.titulo end;
