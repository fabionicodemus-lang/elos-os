# Reexecução T01/T02

Working directory: /workspace/elos-os. Node 22.23.3 e dependências previamente preparados no onboarding; Python 3.12 com openpyxl/python-docx. Não execute install, migration, servidor, worker, sincronizador, workflow ou exportação autenticada nesta verificação. Não há necessidade de credenciais para os comandos abaixo.

```sh
git status --short
git branch --show-current
git rev-parse HEAD
export PATH="/workspace/.elos-tools/node_modules/node/bin:$PATH"
node --test --test-reporter=spec lib/forecast/engine.test.mjs lib/forecast/snapshot-comparison.test.mjs lib/elos-ia/summaries.test.mjs app/engenharia/contratos/contract-calculations.test.mjs lib/banking/ofx.test.mjs tests/banking/bank-operations.test.mjs lib/elos-ia/finance-safe-write-db.test.mjs tests/homologation/aurora-regressions.test.mjs tests/commercial/development-costs.test.mjs tests/commercial/development-result.test.mjs
node docs/financeiro/implementacao-v1/t01-t02/scripts/sondas.mjs
python docs/financeiro/implementacao-v1/t01-t02/scripts/conferir_fontes.py --package /workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1 --sources /workspace/financial-source-base/Base_Conferencia_Elos_OS
sha256sum docs/financeiro/implementacao-v1/t01-t02/referencias/Elos_OS_Regras_Financeiras_v0_1.docx
```

Resultados da sessão: suíte exit 0 (74/74), sondas exit 0 (9 observações reproduzidas), fontes exit 0 (53 hashes do manifesto sem divergência). Acesso de logs GitHub exit 1/Forbidden está descrito em jobs.md. Validação documental adicional: `python docs/financeiro/implementacao-v1/t01-t02/scripts/verificar_entrega.py`. Não é aceite de CTs. O commit base e nomes/presença de variáveis estão em evidencias/contexto.json. Nenhum segredo foi impresso.

As extrações locais foram feitas por zipfile, validando que cada caminho permanece abaixo do destino. DOCX lido com python-docx; PDF do plano extraído com pypdf; XLSX lido com openpyxl. Originais em /workspace/attachments não foram editados. Fontes S3 com dados pessoais ficam fora do Git; o relatório contém apenas agregados/hashes. A cópia do quadro é derivada e não substitui o original.
