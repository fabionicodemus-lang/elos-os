# Ambiente, código e estruturas

Execução em `/workspace/elos-os`, branch `feat/financeiro-etapa6-koper`, base `494c55c`. Node 22.23.3, PostgreSQL 17.11, Python 3, Docker e GnuPG já disponíveis. Reutilizado `tests/financeiro/runtime.mjs`: imagem por digest, `network=none`, sem portas, dados em tmpfs, contêiner removido no finally. Apenas massa fictícia; Auth por claim local, sem servidor Auth real.

## Fontes consultadas

Pacote extraído `/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1`: LEIA_PRIMEIRO, cartões completos T09–T17 (instruções comuns e escopos), regra DOCX v0.1, manifesto, parâmetros, diagnóstico e casos originais já inventariados em T01/T02. Os anexos/plano/quadro e catálogo/handoff permanecem rastreáveis no inventário anterior; não há nova posição real nesses documentos. Decisões operacionais D01–D14 não foram preenchidas com premissas de teste.

Código: AGENTS.md, guia Next de testes, importação limpa e migrations das ondas 2e/4/6; namespace/de-para e staging existentes; worker, hash e inventário de transporte; `lib/forecast/server.ts`, consumidores de rateio e scripts de diagnóstico anteriores. O transporte financeiro legado completo e o agendador externo não constam como integração executável comprovada neste checkout. Nenhum segredo foi consultado para conectar a serviços.

## Alterações

| Arquivo/estrutura | Uso |
|---|---|
| `lib/koper-finance/collection.mjs` | Coleta paginada com callback de leitura, limite/retry, cursores, hashes dos bytes originais, subtotal/cobertura; `normalizeBill` traduz o formato espelhado conhecido sem inventar obra/fornecedor/baixa. Binding não pode trocar identidade ou valor bruto. |
| `20261021140000_koper_financial_snapshots.sql` | Entrada privada `elos_import.apply_financial_batch`; reusa runs/issues, map_get/map_put, staging, payables, finance_title_audit e guardas da Etapa 5. |
| `elos_import.financial_batches` | Comando/manifesto/original/hashes/relatório por tentativa; finalização única; rejeita alteração/exclusão do original. |
| `elos_import.financial_objects` | Fotografia corrente por organização/enterprise/ID/parcela; snapshot observado separado do aplicado, vínculos, versão, pendências. Não é uma segunda carteira para somar aos payables. |
| `elos_import.financial_revisions` | Antes/depois do snapshot, alocações explícitas, origem/run, versão, autor, motivo e registro; atualização/exclusão recusadas. |
| `koper_staging_records` | Projeção existente, novo entity `finance.ap.snapshot`; identidade JSON, hash do JSONB da interpretação, versão de mapeamento 2, target e estado. Bytes originais/hashes SHA-256 ficam no lote selado. O hash JSONB não é apresentado como hash do arquivo nem como hash normalizado do worker. |
| `payable_cost_allocations` | Projeção monetária atual, somente linhas próprias `source_system='koper_finance'`; resíduos explícitos em A Apropriar. Antes/depois preservados nas revisões; linhas locais não são substituídas. |
| `lib/forecast/cost-allocation.mjs` e `server.ts` | Consumo com denominador do título, pendência explícita/implícita, centavos e resíduo determinístico da Etapa 5. |
| `tests/koper-finance/*` | Testes de componentes, pipeline PostgreSQL, falhas/concorrência, comparador e adaptador das mesmas asserções da fundação. |
| workflow `finance-foundation.yml` / package.json | Comando `test:koper-finance` e CI isolado adicional. Não executado remotamente. Sem alteração de agendamento ou backup produtivo. |
| `20261021_koper_financial_preflight.sql` | Consulta SELECT de estrutura/RLS para futura inspeção autorizada. Não executada em servidor externo. |

## Contrato e limites da integração candidata

`apply_financial_batch(company,command,batch)` exige `service_role` ou operador SQL controlado e ator delegado com `payables.manage`, escopo de escrita em todas as entidades da organização e de-para confirmado `enterprise→company`. Não há grant de execução a anon/authenticated nem rota pública nova. Credenciais, delegação real e rotina produtiva ainda precisam de integração/aceite; não enviar service_role ao cliente.

O batch informa `enterprise_id`, `currency=BRL`, `monetary_basis=principal`, `period_start/end`, `cutoff`, `extracted_at`, `filters`, `reason`, `pages`, `manifest` e `records`. Páginas guardam bytes em texto, SHA-256 e cursores. O operador privado fornece apenas payloads sanitizados, sem headers/cookies/credenciais, conforme o worker existente. Registros conhecidos usam ID externo, parcela ou identidade do próprio bill, principal/baixa declarada em centavos, status e vencimento; vínculos explícitos e suporte documental vêm da preparação revisada. Ausência de valor não vira zero. `source_id` e chaves compostas usam arrays JSON para evitar colisão por separadores; colisões do normalizador legado são rejeitadas para revisão.

Período/corte/filtros são o recorte **declarado da fonte**, não um filtro inferido de vencimento. A migração não descobre nem valida qual corte produtivo D02 está aprovado; comparar fotografias de escopos diferentes exige revisão. O banco confere hashes, cadeia de cursores, contagem distinta e totais informados. A correspondência semântica entre extração e bindings continua dependente do adaptador revisado; a entrada privada não interpreta um HAR arbitrário.

A suíte instala migrations financeiras reais, a fundação/de-para e staging reais, porém `payable_cost_allocations` e `engineering_services` têm scaffolds declarados em `tests/koper-finance/setup.mjs`; não representam introspecção de produção. Para `integration_mappings`, carrega o trecho real de DDL/auditoria antes dos backfills legados (sem backfill). O clone completo da cadeia de migrations, anexos e E2E não foi certificado.

Mudanças ficam candidatas, sem aplicação real. A preparação técnica não deve ser confundida com promoção irrestrita de todos os snapshots: eventos de baixa/estorno, agrupamentos, escopo alterado, componentes, vínculos locais e períodos fechados continuam exigindo tratamento apropriado. O recorte bloqueia fechamento bancário conhecido; fechamento econômico completo depende de T37/D11.
