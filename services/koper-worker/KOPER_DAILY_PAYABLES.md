# Sincronização diária dos títulos Koper → Elos OS (Bossa)

Executor Railway: `koper-audit-runner`, ambiente `production`, `node dist/sync-koper-payables-daily.js --write`, cron `0 7 * * *` (04h em Brasília, UTC−3). O comando também pode ser executado sem `--write` para produzir apenas o plano.

## Garantias

- Lê a lista completa do Koper e compara quantidade, IDs únicos e soma com o cabeçalho antes de qualquer gravação.
- Identifica títulos por `source_system=koper_flow` e `source_id=koper_bill:<billId>`; o UUID de inserção é estável. Reinícios não recriam títulos.
- Novo título exige obra e fornecedor comprovados pela NF-e já importada ou por mapeamento único de centro de custo baseado em resolução anterior com obra confirmada. Caso contrário, fica em `koper_staging_records` como `bill_daily_exception` e não entra em `payables`.
- Novos títulos entram em `À Apropriar` nas observações, sem rateio inventado. Pagamentos do Koper atualizam apenas títulos `open` no Elos OS; valor/vencimento divergente e estorno de pagamento exigem revisão.
- A coleta de detalhes novos é limitada a 250 por execução (variável `KOPER_DAILY_NEW_LIMIT`, máximo 500). Detalhes já coletados são reutilizados nos dias seguintes.
- Resultado e exceções aparecem nos logs `KOPER_DAILY_SYNC_PLAN`, `KOPER_DAILY_SYNC_RESULT` e `KOPER_DAILY_SYNC_FAILED`.

## Dependência operacional

Em 24/09/2026, o Koper retornou HTTP 400 em `/auth/v2/login` com “Credenciais inválidas”. É necessário atualizar `KOPER_USERNAME`/`KOPER_PASSWORD` no serviço Railway antes de uma execução bem-sucedida. O script encerra com erro antes de escrever se a autenticação falhar. Após corrigir o acesso, executar uma vez e conferir o resumo e as exceções; depois o cron mantém a rotina diária.
