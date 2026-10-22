# Arquitetura e localização dos cálculos

Caminhos relativos à raiz do repositório. Nenhuma segunda regra de saldo foi criada na página/IA.

| Componente / arquivo | Funções / estruturas | Fontes, definição e reutilização |
|---|---|---|
| `lib/finance-core/cashflow.mjs` e `.d.mts` | `realizedCashflow`, `futureCashRows`, `projectCashflow`, `snapshotCashProjection` | Contas/aberturas, movimentos, vínculos ativos de extrato, transferências, títulos, eventos e planos. Centavos inteiros; desconhecido permanece nulo; posição e saldo contratual reaproveitados do núcleo anterior |
| `lib/finance-core/ledger-position.mjs` e `.d.mts` | Reconstrução de títulos por T e K | Ledger, encargos, caixa e auditoria das versões-base. Principal, juros/desconto/baixas e dinheiro separados; não usa flag atual de pago para presumir histórico |
| `lib/finance-core/coverage.mjs` e `.d.mts` | `nativeFinancialBindings` | Nota/parcela/medição/contrato por FKs exatas; mesma função em `lib/forecast/server.ts`. Documento substitutivo não duplica compromisso |
| `lib/finance-core/cashflow-server.ts` | `loadCashflow` | Leituras RLS paginadas, escopo de titular/obra, versões e pendências. Falha de consulta interrompe carregamento, não retorna zero. Conjunto corrente não equivale a snapshot de fechamento |
| `app/financeiro/fluxo-de-caixa/page.tsx` e `actions.ts` | Tela e ações autenticadas | Usa AppShell e núcleo. Filtros/corte, original versus atual, 30/90/conclusão, déficits por entidade, validação de abertura, versões, cronograma, cobertura, transferências e inversos |
| `lib/elos-ia/tools.ts` | `runFluxoDeCaixa` e parte de caixa do diagnóstico | Mesmo `loadCashflow` da tela. Outros indicadores preservam suas definições anteriores e não recebem selo de conciliação |
| `app/financeiro/contas-a-pagar/page.tsx` e `actions.ts` | Validação documental da obrigação sem obra | Fonte em quarentena distinta do saldo operacional validado; sem falso rateio ou custo presumido |
| `supabase/migrations/20261022100000_entity_obligations.sql` | `finance_obligation_validations`, `validate_unassigned_obligation`, `list_unassigned_obligations` | Titular explícito para título sem obra, validação imutável, RLS/entidade, auditoria e vínculo de origem. Sem backfill; reaproveita liquidação anterior |
| `supabase/migrations/20261022110000_cashflow_versions.sql` | `finance_cash_openings`, `finance_cash_scenarios`, `finance_cash_scenario_rows`, `finance_cash_coverage_links` | Abertura/restrições comprovadas, versões/snapshot/linhagem, ocorrência e agenda financeira. `validate_cash_opening`, `save_cash_scenario`, `link_cash_coverage`, `reprogram_cash_schedule`, `convert_cash_scope_to_contract` |
| `supabase/migrations/20261022120000_cash_transfers.sql` | Extensão `finance_bank_transfers`; `record_cash_transfer`, `complete_cash_transfer`, `reverse_cash_transfer` | Reaproveita contas/movimentos/extrato, separa tarifa e trânsito, locks/idempotência/fundos/período. Movimentos canônicos preservados; inverso exige fato documentado |
| `tests/cashflow/` | Runner, núcleo, banco, loader/SSR, comparador e adaptador de etapas anteriores | Docker local sem rede. Originais e esperados não alterados. `setup.mjs` documenta scaffolds de engenharia usados somente em teste |
| `package.json`, `.github/workflows/finance-foundation.yml` | `test:cashflow` e gate candidato | Executam infraestrutura existente e novos controles; workflow configurado não constitui prova de execução remota |

## Datas e saldos

Emissão não é competência, vencimento não é pagamento, e data de conciliação não cria uma segunda saída. Realizado usa data efetiva da movimentação; confirmado exige vínculo de extrato e sua data. Abertura documentada antecede os movimentos de sua data, conforme convenção existente. Saldo final de um período vira inicial do seguinte na mesma base; trânsito permanece identificado. Sem abertura/restrição documentadas ou com pendências de extrato não se certifica disponibilidade.

R/AR são posição remanescente calculada pelo núcleo; C é compromisso ainda não representado por título; P é previsão descoberta explícita, nunca diferença artificial do orçamento. Cobertura consome a mesma ocorrência mesmo após pagamento/reimportação. Adiantamento aplicado não desconta duas vezes. Falta de mapa para divisão de contrato/título é pendência ou rejeição, sem alocação proporcional implícita.

Projeção separa direitos existentes e receita comercial estimada. Mínimo, restrições, datas e agenda de conclusão dependem de informação explícita. Conta compartilhada pertence ao titular; obra não recebe fração fictícia da abertura. Transferência própria não é saída/entrada externa; mútuo conserva as posições individuais e só é eliminado no consolidado autorizado. Recursos positivos de um titular não cobrem automaticamente déficit de outro.

## Histórico e integridade

Cenários originais e versões são append-only, com autoria/motivo/data/fontes. Pai corrente, comandos idempotentes e locks controlam reprogramações concorrentes. Cronograma altera apenas datas C/P futuras, com atividade e defasagem explícitas. Alteração de vencimento exige evento financeiro separado. Novo pagamento sem obra exige validação e titular consistente com a conta. Valores econômicos ausentes não são inventados. Legado não foi reescrito.
