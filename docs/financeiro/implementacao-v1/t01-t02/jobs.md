# T01 — Jobs: configuração, execução e efeito

| ID / rotina | Configuração encontrada | Execução comprovada | Efeito financeiro comprovado |
| --- | --- | --- | --- |
| J01 patch-koper-historical-suppliers | [.github/workflows/patch-koper-historical-suppliers.yml:1](../../../../.github/workflows/patch-koper-historical-suppliers.yml#L1) — push em main limitado ao próprio arquivo; checkout fix/koper-historical-suppliers; Python troca bloco, npm install/build, commit/push para branch | Não. GET de histórico na API GitHub retornou Forbidden. “No jobs were run” é relato do handoff, não log recuperado nesta sessão | Não. O job altera código; não executa patch de dados. Exige revisão da branch, deploy e antes/depois por título/fornecedor; build/push não comprovam saneamento |
| J02 cron financeiro 04:00 Brasília / koper-audit-runner | Cron não localizado nos workflows do checkout. Worker HTTP em services/koper-worker/src/index.ts; agendamento Railway externo não acessível. docs/integracoes/importacao-limpa.md relata desativação em 18/10; migration 20261018200000_block_old_flow_daily_sync.sql bloqueia INSERTs legados específicos | Não. Relato de 25/09 e desativação posterior não têm runId/log atual verificável | Não. Não reativar rotina nem usar zero exceções histórico como qualidade atual |
| J03 ondas SQL elos_import e patches de banco | Funções nas migrations 20261018* e trava legado; documentação interna relata execução e totais | DDL presente não comprova migration aplicada. Nenhuma execução feita nesta tarefa | Não. Runs/issues/backup_rows no banco não acessíveis; faltam ponte de IDs, totais por natureza e saldo antes/depois |

Comando de leitura executado (exit 1):

```sh
gh api 'repos/fabionicodemus-lang/elos-os/actions/workflows/patch-koper-historical-suppliers.yml/runs?per_page=3' --jq '{total_count,workflow_runs:[.workflow_runs[]|{id,head_sha,status,conclusion,event,run_started_at,html_url}]}'
```

Resposta: GET https://api.github.com/...: Forbidden. Isso é recusa de acesso à API, não demonstra token ausente, cron parado ou falha de job. Não foi solicitado novo segredo, acionado workflow, enviado comentário, feito deploy ou chamada ao Koper. Credenciais foram inspecionadas apenas por nome/presença, em evidencias/contexto.json.
