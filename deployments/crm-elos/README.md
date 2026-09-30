# Elos CRM — deployment source

Branch de segurança para a alteração de tarefas de 30/09/2026.

## Mudanças
- data opcional em tarefas;
- tarefas com data aparecem no dashboard Hoje;
- agrupamento em atrasadas, hoje e próximos 7 dias;
- editar título, data e fase;
- excluir tarefas criadas manualmente;
- excluir tarefas-base por ocultação persistente;
- mantém conclusão/reabertura existente.

## Banco
A tabela `public.tarefas` no projeto Supabase `elos-crm` recebeu:
- `data date`;
- `excluida boolean not null default false`.

O arquivo `production-backup-2026-09-30.html` é o snapshot da produção antes da alteração.
