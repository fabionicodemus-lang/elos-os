# Execução reproduzível

Diretório `/workspace/elos-os`. Infraestrutura reutilizada: Node 22, dependências do lockfile, Python 3, Docker e GnuPG. Nenhuma chamada Koper/Supabase externo é necessária.

```bash
export PATH="/workspace/.elos-tools/node_modules/node/bin:$PATH"
npm run test:koper-finance
```

Saída zero exige cinco testes de componentes, 24 controles PostgreSQL de integração, comparação independente CT01/CT26 e os mesmos 25 controles da fundação com a migration nova instalada (incluindo backup/restauração). `KOPER_EVIDENCE_DIR` permite escrever em pasta temporária nova; o diretório da Etapa 5 não é sobrescrito. A configuração CI usa diretório novo por execução; execução remota não foi comprovada.

Regressão adicional executada: mesmos 81 testes da Etapa 5, sem alterar expected ou asserções:

```bash
node --test --test-reporter=spec lib/forecast/engine.test.mjs lib/forecast/snapshot-comparison.test.mjs lib/elos-ia/summaries.test.mjs app/engenharia/contratos/contract-calculations.test.mjs lib/banking/ofx.test.mjs tests/banking/bank-operations.test.mjs lib/elos-ia/finance-safe-write-db.test.mjs tests/homologation/aurora-regressions.test.mjs tests/commercial/development-costs.test.mjs tests/commercial/development-result.test.mjs tests/financeiro/money.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint lib/koper-finance/collection.mjs lib/forecast/server.ts lib/forecast/cost-allocation.mjs tests/koper-finance/*.mjs
```

Comparador de todos os casos (retorna **1**, pois há cenários não executados nesta rodada):

```bash
python3 tests/financeiro/fixtures/comparar_resultados.py docs/financeiro/implementacao-v1/etapa6-koper/evidencias/casos-obtidos.json --report /tmp/elos-todos-casos-etapa6.json
```

A comparação selecionada CT01/CT26 retorna **0**, dois cenários compatíveis no perímetro de banco/importação. Os demais 28 não recebem execução integral nesta rodada; execuções parciais anteriores permanecem nas evidências da Etapa 5. CT07 segue comprovadamente falho na execução parcial da fundação. Um gate técnico verde não é homologação financeira dos 30 casos.

Controles de backup restauraram **46 tabelas do recorte ampliado**, conferindo contagens, valores, histórico e RLS verificados pela suíte original; dump corrompido, destino existente e dump inválido foram recusados. Este ensaio não inclui arquivo produtivo nem toda a infraestrutura Supabase.

Não executar os scripts `write-*`/`promote-*` do worker nem as ondas históricas como parte desta suíte. A reprodução usa apenas containers identificados de teste, sem rede e removidos ao final. Não há comando de migração, saneamento ou deploy real nesta entrega.
