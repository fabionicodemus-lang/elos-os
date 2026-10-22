# Reprodução e evidências

Raiz do repositório: `/workspace/elos-os`. Base da correção: `6354e59`. Usados relatório técnico, CT10, matriz dos30 e quadro da Etapa9, cartões pertinentes e regras v0.1 §§7.1/8.3, com os limites de acesso já documentados.

Regra normativa: `/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx`, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. Casos aprovados: `tests/financeiro/fixtures/casos_financeiros.json`, SHA-256 `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`. Ambos preservados, assim como manifesto e comparador original.

```sh
npm run test:supplier-refunds
python3 docs/financeiro/implementacao-v1/etapa10-ct10/scripts/quadro.py
python3 docs/financeiro/implementacao-v1/etapa10-ct10/scripts/verificar.py
```

A rodada integral efetivamente executada foi `node tests/supplier-refunds/validate.mjs`, equivalente ao primeiro comando. Logs por passo e argumentos completos em `evidencias/execucoes.json`; saídas0. A remoção de uma opção manual de categoria derivada na UI foi seguida por rechecagem SSR/TypeScript/lint, em `evidencias/rechecagem.json`.

Reprodução anterior à instalação da migration candidata:

```sh
FINANCE9_EVIDENCE_DIR=docs/financeiro/implementacao-v1/etapa10-ct10/evidencias/baseline node tests/financial-acceptance/database.mjs
python3 tests/financeiro/fixtures/comparar_resultados.py docs/financeiro/implementacao-v1/etapa10-ct10/evidencias/baseline/casos-obtidos-novos.json --only CT10 --report docs/financeiro/implementacao-v1/etapa10-ct10/evidencias/baseline/comparacao-ct10.json
```

O segundo comando retorna1 na base anterior e reprova o CT10; o comparador da candidata retorna0. O harness antigo capturava a falha com sucesso de observação, não aceite financeiro.

Os adaptadores `prior-stages.mjs`/`replay-previous.mjs` mantêm entradas/assertions dos controles anteriores e instalam a candidata depois de cada bootstrap. Apenas a antiga sonda CT10, que tentava a rota defeituosa, passa a exigir sua recusa. Expected financeiro não alterado. Hashes e descrição das transformações constam nos JSON `adaptador-*.json`. Nenhum runner ou evidência histórico foi sobrescrito.

Requer imagem PostgreSQL17 fixada pelo digest do runtime existente, Docker local, Node/dependências instaladas e Python3/openpyxl. O banco usa `--network none`, sem portas publicadas e com cleanup. Scaffolds e cadastros administrativos existem apenas no teste, explicitados em `tests/supplier-refunds/setup.mjs`. No ambiente desta execução, Docker28.4.0 foi conferido pelo socket local. Status do runtime: sem credenciais/identidades/variáveis remotas configuradas, política de rede com estado desconhecido; nenhum acesso financeiro remoto foi feito.

TypeScript, SSR e testes não iniciam servidor com Supabase real. CI foi configurado, sem push/execução remota. Não executar essa migration ou esses scripts em produção. O teste de backup/restauração repetido cobre apenas a massa fictícia. O quadro deriva da cópia da Etapa9 e não preenche aceites; caches de fórmulas não são recalculados pelo openpyxl.
