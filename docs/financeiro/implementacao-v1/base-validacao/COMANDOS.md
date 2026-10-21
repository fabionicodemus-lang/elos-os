# Reproduzir a entrega

Diretório: `/workspace/elos-os`. Testado com Node 22.23.3, npm 11.9.0, Python 3.12, Docker e GnuPG. O lockfile e as dependências existentes foram preservados. Em outra máquina limpa, preparar as dependências pelo `npm ci` habitual; neste trabalho não houve atualização de pacotes.

```bash
export PATH="/workspace/.elos-tools/node_modules/node/bin:$PATH"
docker pull postgres@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939
npm run test:finance
```

Esse comando roda sete testes monetários, três testes do comparador e 25 controles no PostgreSQL, incluindo backup/restauração. Saída zero certifica **somente esses controles de fundação**; não é gate de homologação financeira dos 30 casos.

```bash
node tests/financeiro/run.mjs --baseline
```

Baseline: não instala a extensão nova, usa banco descartável independente e retorna **1**, pois reproduz 13 falhas/lacunas entre 20 controles. A 0048 já tem a correção de sintaxe de upsert para a montagem. Não usar baseline como gate de sucesso em CI. Para repetir o estado exato anterior de dinheiro, consultar o commit base e o log inicial preservado; executar os testes monetários no candidato já deve passar.

```bash
python3 tests/financeiro/fixtures/comparar_resultados.py docs/financeiro/implementacao-v1/base-validacao/evidencias/casos-iniciais.json --report /tmp/comparacao-financeira.json
```

O comparador retorna **1**: três casos parciais e 27 não executados não equivalem a 30 casos aprovados. Os expected são os originais; nenhuma saída produtiva foi usada para reescrevê-los. A rodada final do runner gera sua própria comparação, sem reutilizar um relatório antigo.

Regressão executada, 81/81:

```bash
node --test --test-reporter=spec lib/forecast/engine.test.mjs lib/forecast/snapshot-comparison.test.mjs lib/elos-ia/summaries.test.mjs app/engenharia/contratos/contract-calculations.test.mjs lib/banking/ofx.test.mjs tests/banking/bank-operations.test.mjs lib/elos-ia/finance-safe-write-db.test.mjs tests/homologation/aurora-regressions.test.mjs tests/commercial/development-costs.test.mjs tests/commercial/development-result.test.mjs tests/financeiro/money.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint lib/money.mjs lib/financial-installments.ts lib/cost-vs-budget/native-allocation.mjs tests/financeiro/runtime.mjs tests/financeiro/run.mjs tests/financeiro/money.test.mjs
```

TypeScript e ESLint retornaram zero. Não foi feito build de UI nem ensaio E2E. O workflow `finance-foundation.yml` configura estes controles sem segredos e grava artefatos em diretório temporário novo do runner, evitando upload de evidência antiga do checkout. Configuração de workflow não é execução remota comprovada.
