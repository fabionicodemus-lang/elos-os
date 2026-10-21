# Reprodução e comandos

Executar na raiz do repositório, somente com Docker local descartável e dependências já instaladas:

```bash
git merge-base --is-ancestor 494c55c 95d659e
git merge-base --is-ancestor 95d659e HEAD
npm run test:finance-core
python3 docs/financeiro/implementacao-v1/etapa7-calculos/scripts/matriz.py
python3 docs/financeiro/implementacao-v1/etapa7-calculos/scripts/atualizar_quadro.py
python3 docs/financeiro/implementacao-v1/etapa7-calculos/scripts/verificar_entrega.py
git diff --check
```

`test:finance-core` registra todos os comandos/códigos de saída em `evidencias/execucoes.json`. `FINANCE7_EVIDENCE_DIR` permite destino temporário (usado na CI). O workflow existente foi estendido apenas para teste/artifacts; não contém deploy. Não foi disparada execução remota nesta entrega.

Ordem: funções puras e loader real de previsão; PostgreSQL/liquidações; renderização SSR da página AP real usando o registro parcial obtido no banco; mesmos controles anteriores com as migrações candidatas; adaptação de saídas e comparador independente; mesmas 81 regressões; TypeScript e lint dos consumidores alterados. Testes SSR usam transporte/identidade simulados e não substituem browser/Auth real.

O PostgreSQL 17 usa a imagem fixada no runtime da Etapa 5, `--network none`, sem portas publicadas e com dados fictícios. Todo contêiner é removido no `finally`. O backup/restauração reutiliza `.github/scripts/backup-database.sh` e `restore-test.sh`, com destino local vazio. Nenhum segredo/URL remoto foi necessário.

`prior-stages.mjs` conserva as asserções e expected dos runners anteriores. Injeta as migrações candidatas, resolve imports absolutos para execução em módulo `data:` e adapta **somente a sonda observacional CT07**: lê `finance_open_amount`, pois o antigo `status=open ? amount : 0` já não representa o saldo residual. Hashes dos runners originais/adaptados: `evidencias/adaptadores-anteriores.json`. A regressão Aurora ganhou só o mapeamento do import compartilhado no harness; nenhuma asserção/expected mudou.

Os casos positivos integrais CT01/07/08/23/26/30 são confrontados pelo comparador original `tests/financeiro/fixtures/comparar_resultados.py`; CT18/19/21 são comparados separadamente como componentes puros, sem promover o status de cobertura integral. A falha financeira CT12 é registrada em `liquidacoes.json` e na matriz mesmo que o controle técnico que a reproduz passe.

Os resultados iniciais históricos da Etapa 5 e o baseline da Etapa 6 permanecem intactos. Logs desta entrega ficam na pasta nova. Não há teste de dados reais, navegador, carga, transporte Koper remoto ou backup real nesta execução.

Depois da revisão final da medição com desconto, foram repetidos os 12 testes de componentes/carregadores, as mesmas 81 regressões, TypeScript e lint dos dois arquivos envolvidos; todos passaram. Essas repetições estão registradas em `execucoes.json`. Os campos `base_commit` dos runners herdados conservam rótulos históricos; o commit efetivo e os hashes de cada fonte estão em `verificacao-final.json`.
