# Etapa14B — Verificação de exposição

**AS VULNERABILIDADES ESTÃO IMPLANTADAS EM PRODUÇÃO? NÃO FOI POSSÍVEL COMPROVAR.**

Não foi possível inspecionar o banco implantado. As três vulnerabilidades estão comprovadas na reprodução isolada da Etapa14; suas correções estão na candidata. Isso não demonstra que a versão vulnerável ou a corrigida esteja em produção. A exposição produtiva fica **NÃO VERIFICADA**, sem inferir segurança ou exploração.

## Base e acessos efetivamente verificados

- Repositório `fabionicodemus-lang/elos-os`, base limpa `test/financeiro-etapa14-isolamento`, commit `10ae3f7`, incluindo a correção `39d858c`. Branch desta entrega: `audit/financeiro-etapa14b-exposicao`.
- Relatório, canais, permissões, quadro e evidências da Etapa14 acessados localmente. Regras v0.1 preservadas, SHA256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`; esperados originais também preservados.
- Runtime consultado nesta etapa: observações atuais, sem capabilities, secrets, variáveis de implantação ou identidades de saída; manifesto de identidade v1 sem conexões. Sem ferramentas de Supabase/banco/implantação disponíveis no catálogo. [acessos-runtime.json](evidencias/acessos-runtime.json), [acessos-locais.json](evidencias/acessos-locais.json).
- Sem `psql`, Supabase CLI ou Vercel CLI no host; sem `.vercel/project.json`, `supabase/.temp/project-ref` ou arquivos `.env`/`.env.local`/`.env.production`. O template `.env.example` contém placeholders. Nenhum arquivo de segredo foi aberto para descobrir credenciais.
- Política inicial: HTTP restrito; nenhum domínio/faixa TCP de usuário; VPN não configurada. O runtime informa estado de enforcement `unknown`, portanto não se declarou prontidão de rede. **Não houve tentativa remota nem erro de acesso observado**: faltam identidade/conexão e identificação autorizada da implantação. Não foi tentado contornar a política.
- Os runbooks locais `ops/run-supabase-0066.md`, `ops/20260729-run-supabase-0052.md` e `ops/supabase-0055.md` referem outras migrações. Não identificam o banco atualmente implantado nem comprovam estas correções.

## Comparação das funções

| Falha / assinatura esperada | Versão vulnerável reproduzida | Correção candidata presente | Banco implantado |
|---|---|---|---|
| V01 `public.refresh_execution_service_contract_value(p_contract_id uuid) → numeric` | SECURITY DEFINER; `search_path=public`; sem autenticação/empresa/permissão; EXECUTE padrão de PUBLIC. Financeiro estrangeiro e anônimo obtêm 100.000 do contratoB e recalculam 90.000→100.000. | Guard com `auth.uid()`, associação ativa, permissões contratuais existentes; nega PUBLIC/anon; mantém authenticated e serviço confiável. Fórmula intacta. | Existência, definição, assinatura efetiva, ACL e alcance HTTP **NÃO VERIFICADOS**. |
| V02 `public.refresh_execution_service_contract_measurements(p_contract_id uuid) → void` | SECURITY DEFINER, PUBLIC EXECUTE, sem fronteira. EngenhariaA recalcula contratoB: medido 0→20.000; retido 0→2.000, apesar de SELECT/RLS negar a linha. | Mesmo guard contratual/ACL. Agregações intactas. | **NÃO VERIFICADO**. |
| V03 `public.refresh_execution_work_order_values(p_work_order_id uuid) → void` | SECURITY DEFINER, PUBLIC EXECUTE, sem fronteira. SQL com papel/claims deA altera OSB: 0→20.000/8.000/7.000/6.000, mesmo invisível por RLS. | Guard por empresa/permissões de OS; mesma ACL. Fórmula intacta. | **NÃO VERIFICADO**; módulo OS completo também não certificado por HTTP. |

Localizações literais das versões nativas:

- V01: `supabase/migrations/20260728_0038_execution_service_contracts.sql`, função `refresh_execution_service_contract_value`.
- V02: `supabase/migrations/20260801_0067_service_contract_procurement.sql`, função `refresh_execution_service_contract_measurements` (substitui a versão0039).
- V03: `supabase/migrations/20260729_0040_execution_work_orders.sql`, função `refresh_execution_work_order_values`.
- Correções: `supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql` e `20261025110000_work_order_financial_tenant_guard.sql`, ambas já presentes no commit `39d858c`. **Nenhuma nova regra, fórmula ou migração de aplicação foi criada nesta etapa.** Datas/nomes de migrações não são evidência de aplicação.

Referências de reprodução anterior: [V01/V02 antes](../etapa14-isolamento/evidencias/vulnerabilidades-antes.json), [V03 antes/depois](../etapa14-isolamento/evidencias/ordens-servico.json), [342 tentativas HTTP/Storage/UI/IA](../etapa14-isolamento/evidencias/tentativas.json). As 342 verificações são **herdadas**, não reexecutadas na14B.

## Risco e grau de comprovação

| Falha | Ambiente comprovado / certeza | Caminho potencial se a versão estiver implantada | Impacto potencial / prioridade | Exposição em produção |
|---|---|---|---|---|
| V01 | Isolado, função nativa; HTTP/Auth e anônimo; alta certeza local. | `/rest/v1/rpc/refresh_execution_service_contract_value`, se schema public exposto, gateway acessível e papel anônimo com EXECUTE/USAGE. | Leitura de valor privado e alteração de total contratual entre empresas, sem sessão. **Crítica para triagem**, condicionada à implantação/acesso. | **NÃO VERIFICADA**; nenhuma conclusão de exploração. |
| V02 | Isolado, HTTP/Auth de Engenharia estrangeira; alta certeza local. | RPC REST equivalente com sessão de outra empresa e grants compatíveis. PUBLIC também existia localmente; este lote não certifica o caminho anônimo completo paraV02. | Alteração de medições/retenções e totais contratuais entre empresas. **Alta**. | **NÃO VERIFICADA**. |
| V03 | Isolado, SQL authenticated/claims; alta certeza nesse nível. | RPC via gateway se exposta; caminho SQL demonstrado localmente. HTTP/Auth integral não demonstrado paraOS. | Alteração de valores autorizados/executados/aceitos/medidos de outra empresa. **Alta**. | **NÃO VERIFICADA**. |

RLS não substitui autorização dentro de uma função SECURITY DEFINER. O proprietário pode superar as políticas conforme propriedade, FORCE RLS, superuser e BYPASSRLS. É necessário verificar esses metadados e os helpers implantados. Não basta encontrar o nome da função, um comentário de guard, uma migração no Git ou um deploy com sucesso.

## Coleta preparada, não executada remotamente

[sql/inventario-metadados.sql](sql/inventario-metadados.sql) consulta somente catálogos PostgreSQL, em transação `READ ONLY / REPEATABLE READ`, com timeout e ROLLBACK. Não chama as RPCs nem `auth.uid()`/helpers de negócio. Inclui assinaturas ausentes/overloads, corpo/DDL, proprietário, modo, `search_path`, ACL padrão/efetiva, privilégios básicos, RLS/políticas, helpers, dependências e configurações não secretas de API visíveis. A busca de callers em PL/pgSQL é heurística, explicitamente incompleta.

O operador autorizado deve atestar projeto, ambiente, endpoint, horário UTC, papel usado e proveniência do snapshot. Não preencher uma conexão por suposição nem usar service_role do navegador. Exemplo para conexão **já configurada** pelo operador:

```sh
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/financeiro/implementacao-v1/etapa14b-exposicao/sql/inventario-metadados.sql > inventario-implantado.json
python docs/financeiro/implementacao-v1/etapa14b-exposicao/scripts/comparar.py inventario-implantado.json --reference docs/financeiro/implementacao-v1/etapa14b-exposicao/evidencias/isolado-depois.json --output comparacao-implantada.json
```

O comparador é offline e informa diferenças; **não emite certificação de produção**. Mesmo com corpo/ACL básica iguais, revisar helpers, proprietários, grants adicionais/herdados, schema exposto, configuração externa e eventuais pre-request hooks. NULL de configuração de sessão não prova ausência no gateway. Retorno HTTP por si só também não comprova corpo/guard.

## Testes executados e acompanhamento

| Comando / evidência nova | Resultado | Alcance |
|---|---|---|
| `node tests/finance-exposure/metadata.mjs` / [testes-metadados.json](evidencias/testes-metadados.json) | 7/7 | Coletor funciona sem permissão de ler linhas; captura PUBLIC padrão/RLS; preservação dos3 corpos; idempotência; comparador; contenção; overload/ausência explícitos. |
| `node tests/finance-isolation/guards.mjs` / [guards.json](evidencias/guards.json) | 8/8 | Autorização contratual SQL: ACL, reexecução, operações próprias, membership/perfil desativados, ausência de sujeito e serviço confiável. |
| `node tests/finance-isolation/work-orders.mjs` / [ordens-servico.json](evidencias/ordens-servico.json) | 4/4 | Falha estrangeira reproduzida antes; negação depois; anon negado; OS própria conserva20.000/8.000/7.000/6.000 e fórmula. SQL, sem certificar HTTP/Auth integral. |
| Regressão financeira existente / [regressao-81.log](evidencias/regressao-81.log) | 81/81 | Monetário, contratos, bancos, IA e projeções nos testes existentes. |
| `npm test` / [npm-test.log](evidencias/npm-test.log) | 142/142 | Suíte padrão do repositório; há sobreposição com a regressão81. |
| `npx eslint --max-warnings 0 tests/finance-exposure` | Sem erros | Harness novo. |

PostgreSQL fixado por digest, bancos descartáveis `--network none`, sem portas publicadas; recursos removidos. Snapshots `isolado-*.json` são **exclusivamente fictícios**. O teste de metadados usa duas tabelas sentinelas/helpers inertes para provar coleta e preservação; o comportamento funcional dos guards é exercitado separadamente pelos testes reutilizados. Não se reivindica equivalência integral com o schema remoto.

Os controles25/24 e demais cadeias das Etapas5–13 permanecem como evidência herdada da14, sem reexecução integral nesta etapa documental/de metadados. Os30 cenários não foram reclassificados: **13 parciais,7 conformes por teste independente anterior,10 por evidência técnica herdada e0 aceites formais**. CT24 continua parcial. O quadro derivado acrescenta exposição, plano e pendências sem concluir tarefas ou assinar aceite.

## Condições para prosseguir

[REMEDIACAO.md](REMEDIACAO.md) detalha implantação/reversão condicionais; [CANAIS-PENDENTES.md](CANAIS-PENDENTES.md) preserva canais não certificados. A verificação produtiva depende de **acesso autorizado a metadados ou snapshot atestado**, identificação da implantação e configuração de exposição do gateway. Aplicação em produção exige nova autorização explícita; não está incluída nesta entrega.

**Nenhuma consulta a registros financeiros reais, chamada de RPC produtiva, alteração de produção, deploy ou acesso remoto ao Koper ocorreu.** Recomendação: manter bloqueio da certificação global. Ausência de evidência de exploração não elimina risco. A etapa termina aqui.
