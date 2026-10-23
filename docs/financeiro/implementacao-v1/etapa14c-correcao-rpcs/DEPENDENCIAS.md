# Chamadores e impacto da retirada de EXECUTE

Inventário: `evidencias/chamadores.json`,16 funções SQL nas últimas definições locais por assinatura:14 diretas e2 transitivas. A busca foi feita em `supabase/migrations`, `app`, `lib`, `services` e `.github`. Não foram encontradas chamadas TypeScript diretas às três funções de refresh. DDL/SQL dinâmico fora do repositório e objetos exclusivos do banco não podem ser certificados por essa busca.

| Chamador atual | Fonte | Capacidade existente / contexto | Dependência |
|---|---|---|---|
| `save_execution_service_contract` |0038, linha203|`execution.contracts.manage`|Valor contratual.|
| `activate_execution_service_contract` |0038, linha256|`execution.contracts.approve`|Valor contratual.|
| `add_execution_service_contract_amendment` |0038, linha289|`execution.contracts.amend`|Valor contratual.|
| `generate_execution_service_contract_from_competition` |0067, linha375|`execution.contract_procurement.contract`|Valor contratual.|
| `add_execution_service_contract_amendment_with_items` |0072, linha5|`execution.contracts.amend`|Valor contratual.|
| `approve_execution_contract_measurement` |0092, linha20|`execution.measurements.approve`|Medições; versão0092 substitui0039/0075.|
| `send_execution_contract_measurement_to_finance` |0039, linha343|`execution.measurements.finance`|Medições.|
| `reverse_execution_contract_measurement` |0075, linha59|`execution.measurements.reverse`|Medições.|
| `sync_contract_measurement_from_payable` |0075, linha106|Trigger, não é uma operação livre de usuário.|Medições após liquidação de título.|
| `save_execution_work_order` |0040, linha246|`execution.work_orders.manage`|Totais deOS.|
| `update_execution_work_order_progress` |0040, linha358|`execution.work_orders.progress`|Totais deOS.|
| `accept_execution_work_order` |0040, linha383|`execution.work_orders.accept`|Totais deOS.|
| `elos_import.wave3a_contracts` |20261018130000, linha13|Rotina privada; PUBLIC/anon/authenticated revogados.|Valor/medições, por serviço ou sessão técnica autorizada.|
| `elos_import.wave4_other_payables` |20261018150000, linha13|Rotina privada; mesmos papéis semEXECUTE.|Medições, por contexto técnico. Não executada nesta etapa.|
| `save_execution_work_order_with_financial_plan` |0063, linha262|Delega à função de salvar com sua autorização.|Transitivo:save→totaisOS.|
| `accept_execution_work_order_with_financial` |0063, linha332|Delega ao aceite com sua autorização.|Transitivo:accept→totaisOS.|

Prefixos completos dos caminhos constam do JSON. `0038` significa `supabase/migrations/20260728_0038_execution_service_contracts.sql`; demais arquivos estão identificados por função no inventário, sem presumir presença implantada.

Entradas do servidor:

- `app/execucao/contratos-servicos/actions.ts`: salvar, ativar, aditar; cada action usa `requireCompanyPermission` e RPC operacional. O cálculo não é feito no cliente.
- `app/execucao/contratacoes-servicos/actions.ts`: geração contratual/etapas por RPC de concorrência.
- `app/execucao/medicoes-contratos/actions.ts` e `app/engenharia/contratos/actions.ts`: aprovação, envio ao financeiro e estorno por RPCs operacionais.
- `app/execucao/ordens-servico/actions.ts`: salvar, progresso e aceite, incluindo os wrappers com planejamento financeiro.

## Trigger de pagamentos

`sync_contract_measurement_from_payable_trigger` foi criado na0039 como AFTER INSERT/UPDATE OF status,paid_amount,paid_at de `public.payables`. O corpo vigente é o0075 e chama o refresh de medições quando um título `elos_os`/`measurement:UUID` chega a `paid`.

A entrada nativa `pay_finance_payable` (0048) exige `payables.manage`, empresa/obra do título e conta compatível. A versão centralizada posterior/`settle_finance_titles` também exige gestão de AP. Essas entradas, atualizações autorizadas por RLS e o contexto de serviço podem disparar o trigger. RH/cancelamentos e importadores têm outros DML sobre AP, mas não são autorização para alterar medições de qualquer empresa; o helper agora revalida a empresa do contrato alvo.

O teste executa uma liquidação real fictícia por `settle_finance_titles`, com o trigger literal0075, e obtém18.000 pagos/2.000 retidos. Isso demonstra a preservação do encadeamento testado; não certifica todos os jobs operacionais ou o módulo produtivo integral. As rotinas privadas de importação não foram executadas nem importaram Koper.

## Por que não basta revogar anon

PUBLIC também conferiaEXECUTE. Retirar anon isoladamente preservaria o acesso herdado. Deixar authenticated diretamente autorizado continuaria ampliando a superfície de mutação; as funções de refresh não são chamadas diretamente pelas actions encontradas.

Revogar authenticated sem conferir chamadores também seria insuficiente: o cálculo interno ocorre sob o proprietário dos wrappers SECURITY DEFINER. A migração mantém esse acesso técnico e exige identidade/empresa/permissão do usuário original no helper. Proprietário inesperado, associação dos papéis de API ao proprietário/serviço, assinatura extra ou corpo desconhecido provocam aborto para revisão.

A candidata da14 usava permissões de leitura/gestão de contrato também para medições. Um aprovador mínimo de medição falhou nesse guard, conforme teste antes/depois. A14C usa a capacidade da operação existente e não amplia perfis para contornar o problema.

## Cobertura e pendências

Executados nativamente por HTTP: ativar contrato, aprovar medição, atualizar progresso deOS. Executados por RPC SQL/trigger: liquidação centralizada e trigger nativo, com contexto de usuário. Os11 conjuntos mínimos de capacidades dos helpers são exercitados separadamente em SQL com papéis fictícios. Os outros wrappers foram lidos, mas seus fluxos integrais não foram todos executados neste DDL parcial.

Antes de produção, coletar definições/proprietários/ACL dos chamadores implantados e comparar com esse inventário. A análise textual, inclusive no preflight da migração, não cobre SQL dinâmico nem configurações externas. Se houver chamador legítimo com outro proprietário, revisar o caso em staging; não conceder EXECUTE genericamente a usuários para contornar a falha.
