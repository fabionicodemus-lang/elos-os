# Testes executados — Etapa13

Não somar as suítes como testes únicos: há sobreposição de componentes e reexecuções. Todos os dados são fictícios.

| Verificação | Resultado | Evidência |
|---|---|---|
|Etapa5, incluindo backup/restauração|25/25|`evidencias/regressao-etapa12/reexecucao/anteriores/fundacao/banco-final.json`|
|Etapa6 — integração|24/24|`evidencias/regressao-etapa12/reexecucao/anteriores/integracao/integracao.json`|
|Etapa7 — liquidações|16/16|`evidencias/regressao-etapa12/reexecucao/anteriores/liquidacoes.json`|
|Etapa8 — caixa|8/8|`evidencias/regressao-etapa12/reexecucao/etapa8/banco.json`|
|Etapa9 — observações, não novas homologações|7/7|`evidencias/regressao-etapa12/reexecucao/etapa9/banco.json`|
|Etapa10 — restituições|9/9|`evidencias/regressao-etapa12/reexecucao/etapa10/banco.json`|
|Etapa12 — cadeias persistidas|4/4|`evidencias/regressao-etapa12/banco.json`|
|Após guard de obra: Etapa12 persistida|4/4|`evidencias/pos-revisao-obra/banco.json`|
|Após guard de obra: Etapa8 persistida|8/8|`evidencias/pos-revisao-obra/reexecucao/etapa8/banco.json`|
|Novos testes de núcleo e canais|8/8|`evidencias/testes-etapa13.log`|
|Regressões solicitadas|81/81|`evidencias/regressao-etapa12/regressao-81.log`|
|Testes gerais|142/142|`evidencias/regressao-etapa12/npm-test.log`|
|Componentes anteriores|29/29|`evidencias/regressao-etapa12/componentes-anteriores.log`|
|Etapa12 — SSR/IA/ações|10/10|`evidencias/regressao-etapa12/servidor-tela-acoes.log`|
|Após guard de obra: componentes/SSR/IA/ações|39/39|`evidencias/regressao-apos-guard-obra.log`|
|Etapa13 — SQL/RLS e carregadores|2/2 cadeias observadas|`evidencias/banco.json`|
|Comparação com esperados originais CT21/CT24|2/2, sem divergência numérica|`evidencias/comparacao-2.json`|
|Comparação CT10 com esperado original|1/1, conforme|`evidencias/regressao-etapa12/reexecucao/etapa10/comparacao-ct10.json`|
|TypeScript e ESLint|saída0|`evidencias/verificacao-final-codigo.json`|

Backup/restauração: arquivo criptografado, snapshot61 tabelas, restauração local verificada, recusa de arquivo corrompido/destino existente e erro de pg_restore cobertos. Não é teste de restauração de produção.
Etapa9 possui7 observações executadas; não significa sete novos cenários aprovados. CT10 usa o adaptador preservado da Etapa10.
O harness foi reforçado após a primeira execução: contagem canônica consultada, auditoria antes/depois das negações e leituraUR. Após o ajuste final de cobertura entre obras, foram repetidos8 testes novos,39 componentes/ações e as cadeias persistidas deEtapas12 e8, com esperados intactos.
Não houve teste remoto Koper, login/Auth/PostgREST real, browser ou storage ponta a ponta. As lacunas continuam explícitas nos dois cenários parciais.
