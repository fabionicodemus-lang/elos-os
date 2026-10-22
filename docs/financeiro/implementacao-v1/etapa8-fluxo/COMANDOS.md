# Reprodução e comandos executados

Na raiz do repositório, com Node/dependências, Python3/openpyxl e imagem local PostgreSQL17/Docker disponíveis:

```sh
npm run test:cashflow
python3 docs/financeiro/implementacao-v1/etapa8-fluxo/scripts/matriz.py
python3 docs/financeiro/implementacao-v1/etapa8-fluxo/scripts/atualizar_quadro.py
python3 docs/financeiro/implementacao-v1/etapa8-fluxo/scripts/verificar_entrega.py
```

O primeiro comando é o runner integral `tests/cashflow/validate.mjs`. [execucoes.json](evidencias/execucoes.json) registra os argumentos reais de cada comando, saída e log; todos terminaram com código0. Inclui núcleo, banco, carregador/SSR, etapas anteriores com `--backup`, comparador original integral/componente, regressão81, `tsc --noEmit` e ESLint nas áreas alteradas. Testes complementares após limpeza de variável não utilizada estão em `rechecagem-final.json`.

Containers são descartáveis, sem rede, sem portas publicadas, com remoção no encerramento. Não apontar esses scripts para banco real. Backup/restauração e ensaio de corrupção testam exclusivamente a massa fictícia, não o procedimento operacional real de produção. As migrations candidatas não foram aplicadas remotamente.

O verificador confere ancestrais, hashes normativos/fixtures, preservação dos artefatos anteriores, contagens, planilha e remoção de containers. Metadados antigos dos runners foram preservados; o commit/hash da candidata está em `verificacao-final.json`, não no rótulo histórico de cada runner. A planilha solicita recálculo ao abrir, mas os caches de fórmulas não foram recalculados pelo openpyxl.
