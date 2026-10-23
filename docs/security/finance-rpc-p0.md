# Etapa 14E — correção P0 das três RPCs

Candidata para auditoria independente e implantação controlada, **ainda sem autorização de produção**. Nenhum acesso a produção, dado financeiro real ou Koper foi realizado. Nenhuma homologação financeira foi concedida.

Base: `origin/main` em `460147e74be9b67c9cff2613b710a9cf0c264274`. Branch: `security/finance-rpc-p0-14e`. A branch 14C e sua história financeira não foram integradas. O commit desta entrega identifica a revisão dos arquivos; os hashes da execução estão em `finance-rpc-p0-results.json`.

## Causa raiz e lacunas da 14C

Na estrutura nativa, as três funções eram `SECURITY DEFINER`, com execução pública implícita/expressa e sem autorização própria. A reprodução local executou cada uma como `session_user=authenticator`, `current_user=anon`, em transações revertidas. Isso comprova a falha da estrutura nativa, não constitui acesso a produção.

A 14C (`47be2b9`, evidências `af637da`) restringia ACL e acrescentava autorização, porém:

- Mantinha as três funções como definer e usava `current_setting('role')` para exceções privilegiadas; isso exige raciocínio adicional sobre contexto mutável e chamadores. A nova versão usa identidades SQL efetivas e separa sessão proprietária de chamadas de usuários via definer.
- Não rejeitava conflito entre o sujeito JWT JSON e o sujeito legado lido por `auth.uid()`. Uma sonda SQL controlada reproduziu a aceitação da decisão antiga com sujeitos divergentes; a nova decisão nega. Não foi demonstrado endpoint público que permita alterar essas configurações, nem exploração da 14C via API.
- Seus testes dependiam de estrutura parcial e do mecanismo experimental de liquidação; não comprovavam `pay_finance_payable → trigger nativo → helper` na estrutura de `main`.
- A branch anterior carregava mudanças financeiras não apropriadas para um PR P0 isolado, inclusive correção histórica de backfill. Nenhuma delas foi transportada.

## Alterações e limites de autorização

Apenas uma migração de segurança: `supabase/migrations/20261023180000_financial_rpc_p0_isolation.sql`. As três assinaturas UUID e fórmulas são preservadas. O hash de cada corpo financeiro, normalizando apenas CRLF, é comparado antes e depois.

As três helpers passam a `SECURITY INVOKER`, com `search_path=pg_catalog,pg_temp`, objetos de negócio e autorizadores qualificados. Removem-se EXECUTE de PUBLIC, anon, authenticated e grants personalizados; permanecem apenas proprietário e service_role. Mesmo o administrador da empresa deve usar os serviços de negócio, sem acesso direto às helpers.

Chamadores nativos definer continuam com os privilégios do proprietário, mas a helper valida usuário, associação ativa, empresa do registro e ao menos uma capacidade pertinente quando a sessão é do gateway. Exceções técnicas exigem `current_user=service_role` ou sessão **e** identidade efetiva iguais ao proprietário nativo. Strings JWT de papel não criam exceções. Conflitos de sujeito são rejeitados. RLS e fórmulas não são alteradas.

Pré-condições abortam a transação se houver fórmula/autorizador desconhecido, sobrecarga inesperada, proprietário divergente em chamador identificado, herança privilegiada, capacidade de criação insegura dos usuários finais ou privilégios técnicos insuficientes. A migração não concede privilégios adicionais em tabelas. Reaplicação aceita apenas o corpo nativo conhecido ou esta própria correção; uma implantação da 14C exige comparação e revisão explícita, não remoção manual dos bloqueios.

## Chamadores identificados e evidência

Pesquisa textual em `app`, `lib`, `services` e migrações, mais inspeção das definições nativas. Não há chamada direta das três helpers em frontend/backend TypeScript. Os componentes usam RPCs operacionais que fazem a chamada interna. Texto SQL/dynamic SQL externo não é um inventário exaustivo.

| Helper | Chamadores nativos efetivos | Evidência positiva |
|---|---|---|
| contract_value | `save_execution_service_contract`, `activate_execution_service_contract`, `add_execution_service_contract_amendment` (0038), `generate_execution_service_contract_from_competition` (0067), `add_execution_service_contract_amendment_with_items` (0072) | criação/edição de rascunho 30.000; ativação 30.000; geração 100.000; ambos os aditivos 110.000 |
| contract_measurements | `approve_execution_contract_measurement` (0092), `send_execution_contract_measurement_to_finance`, `reverse_execution_contract_measurement`, `sync_execution_contract_measurement_paid_from_payable` (0075) | aprovação com perfil mínimo; envio 40.000 medidos/36.000 faturados; estorno 0/0; pagamento com atualização derivada |
| work_order_values | `save_execution_work_order`, `update_execution_work_order_progress`, `accept_execution_work_order` (0040) | autorização 10.000; progresso 8.000; aceite 8.000 |
| indiretos | `pay_finance_payable` (0048a) → trigger `payables` (0075); `save_execution_work_order_with_financial_plan` (0071); `accept_execution_work_order_with_financial` (0075) | API HTTP real para pagamento; wrappers nativos SQL com identidades de usuário reais |

Os perfis mínimos de aprovação de medição e progresso de OS funcionam sem acrescentar leitura de contratos. Os papéis administrativos existentes não foram ampliados. As duas rotinas privadas de importação `elos_import.wave3a_contracts` (20261018130000) e `elos_import.wave4_other_payables` (20261018150000) foram identificadas por leitura, **não executadas**. A identidade técnica da helper foi testada; isso não certifica o job completo ou seus dados. Antes de implantar, revisar os proprietários e contextos desses chamadores nos metadados efetivamente instalados.

## Ambiente descartável e resultados

Executado em 2026-10-23. PostgreSQL 17 e PostgREST reais, imagens fixadas por digest nos testes. Nenhuma porta publicada no host; rede Docker interna; dados inteiramente fictícios de Horizonte e Atlântico; recursos removidos ao final. Banco com proprietário `postgres` **sem superusuário**, BYPASSRLS como no contexto nativo; conexões de usuários entram realmente como `authenticator`, não como administrador que simula SET ROLE.

A estrutura de negócio veio de 36 migrações nativas explicitamente enumeradas em `tests/security/finance-rpc-runtime.mjs`: tabelas, constraints, RLS, funções e triggers. Após esse bootstrap, foi aplicada **exclusivamente** a nova migração de segurança, conferidos grants/definições e reaplicada a mesma migração.

Limites do bootstrap: `auth`/`storage` são pré-requisitos mínimos da plataforma e os grants técnicos padrão são declarados antes do DDL de negócio; GoTrue não está em execução. JWTs fictícios são assinados localmente e verificados pelo PostgREST real. O backfill exclusivamente de dados da 0048 é omitido, pois seu `ON CONFLICT` original não corresponde ao índice parcial em instalação vazia. DDL, funções e grants da 0048 são preservados, e o arquivo original não é alterado. Isso não demonstra replay integral da fila de migrações ou comportamento do backfill histórico.

**46/46 controles específicos passaram; 153/153 testes de `main` passaram; ESLint dos três arquivos passou, sem avisos.** O SQL de metadados foi executado separadamente contra o banco nativo corrigido, com sucesso. Os 46 resultados individuais, identidades, registros fictícios, respostas HTTP e comparações estão em `finance-rpc-p0-results.json`.

| Controle | Esperado independente | Obtido |
|---|---|---|
| chamada direta das 3 helpers, anon/empresa alheia/visualizador/admin da própria empresa | negar; zero mudança | 12 respostas 401/403; estado preservado |
| definer intermediário com usuário alheio ou sem capacidade | negar para cada helper | 42501; estado preservado |
| associação suspensa ou papel inativo | negar pagamento | negado em ambos |
| JWT adulterado sem reassinatura | negar | 401 no PostgREST |
| troca de papel/sessão e sombreamento por objetos temporários | não obter privilégio | tentativas rejeitadas |
| pagamento nativo de medição 20.000 com retenção 2.000 | saída 18.000, retenção 2.000, um movimento; saldo de 100.000 para 82.000 | mesmos valores; auditoria com usuário financeiro e novo status |
| payable da empresa A apontando indevidamente para medição B | negar e reverter toda a transação | 403; banco, título, medição e auditoria sem atualização parcial |
| duas solicitações simultâneas para a mesma baixa | um sucesso, uma recusa, somente 18.000 de movimento | HTTP 200/400; um movimento de 18.000 |
| identidade técnica legítima | executar sem inventar usuário | service_role HTTP e proprietário SQL aprovados |
| fórmula divergente, privilégio técnico ausente, herança privilegiada ou sobrecarga | abortar sem mudança parcial | aprovado |
| reaplicação e guard adulterado mantendo marcadores | estado seguro; reparar o guard | aprovado |

Reprodução (somente destino descartável, o runner não aceita URL remota):

```sh
env -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  DOCKER_HOST=unix:///var/run/docker.sock node tests/security/finance-rpc-native.mjs
npm test
./node_modules/.bin/eslint --max-warnings 0 tests/security/*.mjs
```

O runner grava `/tmp/elos-rpc-p0-evidence/results.json`. Não foi executado build de aplicação, pois não há alteração de aplicação; os checks remotos do PR permanecem necessários. Os antigos controles financeiros experimentais e os 30 cenários não são reclassificados por esta entrega. O teste de pagamento integral não certifica a semântica de pagamentos parciais no `main`.

## Arquivos exatos da entrega

1. `supabase/migrations/20261023180000_financial_rpc_p0_isolation.sql`
2. `tests/security/finance-rpc-runtime.mjs`
3. `tests/security/finance-rpc-fixture.mjs`
4. `tests/security/finance-rpc-native.mjs`
5. `docs/security/finance-rpc-p0.md`
6. `docs/security/finance-rpc-p0-metadata.sql`
7. `docs/security/finance-rpc-p0-results.json`

Nenhum arquivo existente de negócio, tela, importação, backfill ou workflow foi alterado. Não há merge da branch financeira anterior. PR destinado a `main`, sem merge automático e com título de segurança, nunca `[RUN] Supabase ...`, pois o repositório possui workflows operacionais associados a esses títulos. O push desta branch não corresponde aos gatilhos de implantação por push encontrados; revisar os checks do PR sem acionar workflows de implantação.

## Implantação controlada — SOMENTE após aprovação explícita

1. Auditor independente revisa o diff exato, os hashes, os 46 casos e o inventário de chamadores. Responsáveis técnico e de operação aprovam janela, contenção e acompanhamento. O aceite técnico não substitui autorização de produção.
2. DBA autorizado confirma projeto `uqxflulrjdnhzrhptyla`, banco/versão e gateway: sessões de usuário devem entrar como `authenticator`, nunca como proprietário. Validar `auth.uid()` e as fontes JWT; nenhum endpoint acessível ao usuário pode reescrever ambas as fontes de identidade. Esta propriedade de toda a API não foi certificada pelo teste das três helpers.
3. Executar **apenas** `docs/security/finance-rpc-p0-metadata.sql` com acesso de metadados somente leitura. Arquivar resultados em local restrito. Conferir definições, proprietários, ACL efetiva, herança, autorizações e privilégios técnicos. Inventariar chamadores e jobs implantados, inclusive SQL dinâmico não visível no repositório. Não consultar linhas financeiras nem executar helpers em produção para testar exposição.
4. Salvar antes da alteração as definições/ACL/configurações em registro privado de mudança. Confirmar backup/PITR operacional da plataforma com o operador; esta entrega não testou restauração de produção. Não é necessária migração de dados para este patch.
5. Reproduzir o patch no staging representativo dos metadados efetivamente implantados, repetir os testes e obter aprovação. Qualquer diferença bloqueia a liberação; não remover os bloqueios de hash/grants para forçar aplicação.
6. Conferir SHA-256 da migração: `6e73049104a95bf905c8774d1bb604af362850d86091efd021b61e7aa43dd8d6`. Com credencial DBA fornecida pelo mecanismo autorizado, executar **esse único arquivo** em cliente SQL com parada no primeiro erro. Não usar `supabase db push`, não aplicar a fila pendente, não criar PR/título que execute workflows de produção. A migração contém BEGIN/COMMIT e timeouts; falha de pré-condição/lock causa rollback.
7. Imediatamente após COMMIT, repetir o SQL de metadados. Confirmar as três assinaturas, INVOKER, caminho fixo, hashes financeiros idênticos, ausência de PUBLIC/anon/authenticated e grants somente ao proprietário/service_role. Confirmar configuração/exposição da Data API no painel; ausência de setting SQL significa desconhecido, não segurança. Não executar a RPC vulnerável em produção.
8. Monitorar erros 42501/timeouts nos fluxos normais autorizados de pagamento, contrato, medição e OS, pelo canal operacional aprovado, preservando confidencialidade. Conferir a configuração de recarga do cache de schema do PostgREST; se precisar ação administrativa, realizá-la sob a mesma autorização. Não simular transações financeiras reais para smoke test. Staging mantém os testes funcionais negativos/positivos.

## Reversão segura e impactos

Antes do COMMIT, qualquer falha reverte a transação inteira; não há reparo de linhas financeiras. Cancelar a tentativa se não adquirir locks em 2 segundos. Não repetir indefinidamente em horário de movimento.

Após COMMIT, **não restaurar automaticamente a implementação vulnerável nem EXECUTE público**. Se um chamador legítimo não inventariado falhar, conter temporariamente esse fluxo no canal administrativo autorizado, manter as ACL restritas e os guards e preparar correção adicional específica em staging. Recuperar a definição prévia serve para comparação, não para restaurar exposição. Uma reversão que reintroduza o P0 requer decisão expressa de risco e nova autorização; não há script automático para isso nesta entrega. Não restaurar banco inteiro por uma alteração exclusivamente de metadados.

Impacto intencional: consumidores que chamavam helpers diretamente como authenticated deixam de funcionar e devem usar o serviço operacional autorizado. Jobs com proprietário inesperado ou sem privilégio técnico bloqueiam o preflight. Novos grants explícitos ou alterações futuras destas funções exigem nova revisão; a migração é uma proteção da versão analisada, não monitoramento contínuo.

## Risco residual e recomendação

**LIBERAR para auditoria final independente. BLOQUEAR implantação automática.** A evidência local cobre estrutura de negócio nativa e os chamadores operacionais listados, além de API PostgREST real. Permanecem condições antes de produção: confronto de metadados implantados, identidade do gateway, revisão de jobs privados/chamadores externos, avaliação independente, checks do PR e autorização de mudança. Chaves service_role e proprietário continuam privilegiados por desenho e precisam proteção operacional. A segurança integral de Auth, buckets, anexos, URLs, exportações, workers e demais RPCs não foi certificada aqui.

Situação do acompanhamento 14E: correção e testes técnicos concluídos; auditoria independente, avaliação de produção e aceite de implantação pendentes. Dados de produção e Koper permaneceram inalterados.
