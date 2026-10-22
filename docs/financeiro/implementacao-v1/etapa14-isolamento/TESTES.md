# Resultados de validação

| Verificação | Resultado | Evidência |
|---|---|---|
|Auth/HTTP/SQL-worker/Storage/IA/Next/Chromium|342/342|`evidencias/resultado.json`; `tentativas.json` e `.csv`|
|Permissões esperadas versus observadas, comparação independente|64/64|`evidencias/matriz-permissoes.json`|
|Guards, ACL, idempotência, membro suspenso, perfil inativo, serviço confiável|8/8|`evidencias/guards.json`|
|OS: falha, fórmula, negação estrangeira/anon e operação própria|4/4|`evidencias/ordens-servico.json`|
|Etapa5, incluindo backup/restauração|25/25|`regressao-etapa13/regressao-etapa12/reexecucao/anteriores/fundacao/banco-final.json`|
|Etapa6, integração isolada|24/24|`regressao-etapa13/regressao-etapa12/reexecucao/anteriores/integracao/integracao.json`|
|Etapa7, liquidações|16/16|`regressao-etapa13/regressao-etapa12/reexecucao/anteriores/liquidacoes.json`|
|Etapa8, caixa|8/8|`regressao-etapa13/regressao-etapa12/reexecucao/etapa8/banco.json`|
|Etapa9, observações preservadas|7/7, não7 novas homologações|`regressao-etapa13/regressao-etapa12/reexecucao/etapa9/banco.json`|
|Etapa10, restituições|9/9 e comparador CT10 conforme|`regressao-etapa13/regressao-etapa12/reexecucao/etapa10/`|
|Etapa12, cadeias persistidas / canais|4/4 e10/10|`regressao-etapa13/regressao-etapa12/banco.json`; `servidor-tela-acoes.log`|
|Etapa13, banco / núcleo e canais / comparador|2/2,8/8,2/2|`regressao-etapa13/banco.json`; `testes-etapa13.log`; `comparacao-2.json`|
|Regressões solicitadas|81/81|`regressao-etapa13/regressao-etapa12/regressao-81.log`|
|Testes gerais|142/142|`regressao-etapa13/regressao-etapa12/npm-test.log`|
|TypeScript / ESLint sem warnings|saída0|`evidencias/typescript.log`; `eslint.log`|

Os caminhos da coluna de regressões são relativos a `evidencias/`. Não somar as suítes como testes únicos: há reexecuções e sobreposição de componentes.

As regressões financeiras reutilizam os fixtures/assertivas anteriores. Seus scaffolds não contêm todos os módulos nativos de Engenharia: os novos guards são exercitados nos testes específicos, com corpos nativos literais e provas de preservação de fórmulas. Não se declara que o bootstrap anterior virou um schema integral.

O resultado342 só se tornou final após `completed=true`, zero falhas e ausência de erro fatal. Tentativas iniciais foram conservadas separadamente: configuração de schema/Auth/Storage, campos ausentes no scaffold, tipagem/alias do build temporário e instabilidade de `next dev`. Também foram corrigidas premissas do harness: RPC void retorna204; a negação própria legada de revisão retorna400/P0001/“Sem permissão.”, que foi preservada; membros suspensos usam o estado real `suspended`; a saída do psql inclui linhas de controle, que não são valores monetários. **Nenhum esperado financeiro aprovado foi alterado.**

O build final compila rotas financeiras originais em produção local e não substitui autorização, dados ou cálculos por mocks. O dispatcher da IA é executado sem provedor externo e com fontes HTTP reais; ferramentas não exercitadas são isoladas. V03 possui provaSQL, explicitamente separada de HTTP/Auth.

Os arquivos `formulas-preservadas.json` e `ordens-servico.json` confrontam o corpo anterior com o posterior removendo somente o guard. `integridade-financeira.json` conserva AP7.000/80.000, AR3.000/40.000 e quatro eventos/movimentos. Nenhum dado real foi consultado para compor a massa.
