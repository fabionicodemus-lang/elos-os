# Implantação e reversão — somente preparação

**Não há autorização de escrita produtiva nesta tarefa.** A publicação de uma branch para revisão não autoriza deploy, merge na main, workflow operacional, migração ou chamada de teste a funções produtivas.

## Antes da autorização

1. Conferir o HTML recebido e o vínculo auditado: projeto `uqxflulrjdnhzrhptyla`, produção Vercel `elos-os`, origem/main `460147e`. Não confundir nome `elos-os-dev` com ambiente descartável. Reconfirmar o vínculo atual em painel autorizado, pois o relatório é um snapshot datado.
2. Coletar novamente metadados pelo [`inventario-metadados.sql` da14B](../etapa14b-exposicao/sql/inventario-metadados.sql), sem invocar as RPCs. GuardarDDL, assinaturas, configurações, ACLs, owners, helpers e hash do snapshot em local restrito. Complementar com `sql/chamadores-metadados.sql` deste lote.
3. Verificar configuração efetiva da Data API no painel: enabled, schemas expostos, extra search path, autenticação/papéis e hooks. O relatório tem `pgrst.db_schemas=NULL` em uma sessão; isso não identifica a configuração externa. Não executar um POST de prova em produção.
4. Comparar hashes e precondições da candidata com a captura atual; preservar formulações financeiras. A nova migração aceita os corpos nativos auditados ou os guards da14, mas rejeita drift. Rever qualquer overload, caller/proprietário distinto ou associação privilegiada.
5. ReproduzirDDL/configuração compatível em staging isolado, com massa fictícia. Os quatro encadeamentos nativos testados e as11 capacidades mínimas estão documentados; validar adicionalmente os fluxos de geração/aditivos/envio/estorno/aceite e identidades técnicas reais, sem usar registros de clientes.
6. Revisores de segurança/DBA aprovam o diff, a autorização efetiva e o contexto dos jobs. Operação confirma janela, impacto e responsável. Responsável autorizado pela produção concede autorização explícita da migração. O executor não assina aceite financeiro em seu nome.

## Aplicação futura controlada

- Aplicar **somente** `supabase/migrations/20261025120000_financial_refresh_internal_authorization.sql`, pelo operador autorizado. Ela incorpora a proteção das três funções sobre a versão auditada; não é necessário aplicar as migrações antigas da14 antes.
- **Não executar `supabase db push`, a fila inteira ou migrações de cronograma/importação/backfill.** A branch preserva trabalhos financeiros anteriores ainda não integrados na main. A correção de segurança pode ser revisada/aplicada separadamente; publicar a branch não autoriza implantar o restante.
- O arquivo é uma transação única; usa lock_timeout2s/statement_timeout30s, valida hashes e assinaturas, insere somente guards e altera ACL. Não contém DML sobre tabelas financeiras, alterações de fórmulas, migrações de dados ou reimportação.
- Se uma precondição falhar, abortar e investigar; não remover o teste de hash para “fazer passar”. Se o ambiente divergir do snapshot, refazer a revisão.
- Não executar chamadas financeiras produtivas para provar a negação. Testes com UUIDs fictícios nessas funções também não estão autorizados.

## Verificações imediatamente após implantação autorizada

1. Recoletar os mesmos metadados: três assinaturas esperadas, guards completos, SECURITY DEFINER/proprietário/search_path coerentes, helpers aprovados e hashes financeiros iguais ao snapshot depois de retirar somente o guard. Metadados são suficientes para conferir aplicação do patch, não para declarar homologação de valores reais.
2. Confirmar `has_function_privilege(anon, ..., EXECUTE)=false` e o mesmo para authenticated em todas as três funções; PUBLIC semEXECUTE; sem grants customizados ou herança alternativa. Proprietário/service_role mantêm o acesso técnico previsto.
3. Conferir owners/grants das entradas operacionais e configuração Data API; se o gateway exigir atualização de cache, tratar como operação adicional aprovada. Consultar configurações/OpenAPI autorizado, sem executar a função.
4. Conferir resultado da aplicação e ausência de rollback/erros de catálogo. Monitoramento operacional sem registros financeiros/segredos, conforme procedimento aprovado; não interpretar ausência de erro como prova de correto efeito financeiro.
5. Registrar operador, UTC/Brasília, commit/hash aplicado, projeto, snapshot antes/depois, aceite técnico e pendências. Não declarar que o financeiro está homologado globalmente.

## Impactos operacionais

- Chamadas diretas a refresh, inclusive de administrador de empresa autenticado, passam a ser negadas. As actions encontradas usam entradas operacionais; integração externa que invoque refresh diretamente terá de ser identificada antes da aplicação.
- Perfis somente de leitura perdem recálculo manual direto; não perdem leituras normais por causa desta migração. Não foi ampliado privilégio de Engenharia ou de Financeiro.
- Callers SECURITY INVOKER desconhecidos ou com proprietário diferente podem exigir adaptação localizada. O preflight aborta quando encontra outro owner; SQL dinâmico depende de conferência adicional.
- Sessão direta do proprietário e service_role são contextos administrativos já privilegiados. Seu uso deve permanecer no servidor e em operação autorizada; o patch não certifica gestão de chaves, worker, filas ou escopo de todos os jobs.
- A remoção de grants comCASCADE também retira concessões dependentes. O snapshot deACL deve ser revisado; conceder novamente a usuários finais para contornar interrupção é vedado neste plano.

## Reversão e contenção

- Antes do COMMIT, qualquer erro reverte as três funções/ACLs na mesma transação. Não há dados financeiros migrados para desfazer. O teste de alvo ausente confirma ausência de alteração parcial.
- Depois do COMMIT, conservar a fronteira de segurança. Preferir correção adiante revisada ou rollback do aplicativo que preserve os guards/ACLs, se compatível.
- Se surgir incompatibilidade grave, suspender o fluxo afetado e manter EXECUTE fechado aos papéis de usuário. Preservar os corpos e snapshots para diagnóstico. Não remover o guard nem restaurar PUBLIC/anon/authenticated para recuperar funcionamento.
- Restauração seletiva deDDL só pode ocorrer em nova transação revisada, sob autorização de segurança/DBA, preservando ACL fechada e guard equivalente comprovado. O snapshot **não** é um script automático de reabertura da vulnerabilidade. Repetir metadados e testes isolados antes de retomar.
- Serviço confiável/proprietário continuam disponíveis para manutenção administrativa autorizada. Não utilizar esse contexto para operações de usuário ou para mascarar falha de autorização.

## Riscos residuais e decisões

Permanecem: configuração efetiva Data API; objetos/chamadores exclusivos do banco e SQL dinâmico; cobertura integral dos outros wrappers; worker/credenciais e jobs operacionais; demais buckets/anexos, fiscal/XLSX, interface integral, compartilhamento/TTL/revogação de URLs assinadas e demais canais da14. O patch não certifica esses canais.

**Decisão recomendada:** revisão técnica prioritária desta correção e aprovação específica após preflight/staging. **Bloquear aplicação sem autorização explícita e manter bloqueio da certificação global do financeiro.** Nenhuma regra financeira nova ou decisão de negócio é necessária para exigir autorização por empresa; diferenças entre perfis reais devem ser validadas pelo responsável nominal, sem inventar grants.
