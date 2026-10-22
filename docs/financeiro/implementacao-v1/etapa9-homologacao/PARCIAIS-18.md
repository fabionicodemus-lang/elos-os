# Investigação dos 18 casos parciais da Etapa8

Investigados individualmente. CT13 e CT14 agora têm todos os resultados numéricos da fixture comprovados no ledger/SQL com extrato independente; os outros16 permanecem parciais. Não há aceite financeiro.

## CT02 — Nova versão do mesmo título e preservação do corte histórico

**Obtido:** Histórico em função pura passa nos T/K exatos, e reimportação/revisão passam nos controles anteriores, separadamente.

**Falta para o aceite integral:** Falta unir a reimportação real, autorização do acréscimo e consultas persistidas dos três cortes T/K da fixture numa cadeia documental reproduzível.

**Localização:** `supabase/migrations/20261021120000_financial_foundation_guards.sql: finance_payable_at; lib/finance-core/ledger-position.mjs: titlesAt; tests/koper-finance/run.mjs`. Tarefas: T03, T04, T07, T08, T10, T13, T37, T43, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT03 — Pagamento parcial e conciliação posterior sem novo caixa

**Obtido:** Dois pagamentos e extrato fixo independente passam: aberto7.000→5.000; duas saídas somam5.000; conciliar/reimportar cria zero caixa.

**Falta para o aceite integral:** Falta evento econômico persistido anterior e leitura de I01 antes/depois. O campo de custo adicional é null; não presumir zero por ausência de evento na fixture.

**Localização:** `tests/financial-acceptance/database.mjs; lib/cost-vs-budget/server.ts; supabase/migrations/20261021160000_financial_settlement_ledger.sql`. Tarefas: T03, T12, T18, T19, T32, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT04 — Competência emissão vencimento caixa conciliação e limites de horizonte

**Obtido:** Oráculo puro de competência/datas e limites30/90 passa.

**Falta para o aceite integral:** Falta encadear serviço aceito de setembro, emissão5/10, título/pagamento22 e confirmação24 em persistência/relatórios com relógio controlado; não confundir conciliação com novo caixa.

**Localização:** `tests/cashflow/engine.test.mjs; lib/finance-core/due.mjs; lib/finance-core/ledger-position.mjs`. Tarefas: T02, T03, T07, T30, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT05 — Adiantamento antes da execução e aplicação sem segundo abatimento

**Obtido:** Crédito AP pago, aplicação e reversão passam no ledger existente.

**Falta para o aceite integral:** Faltam estados A–E com contrato/medição econômica aceita e ETC comprovado, vinculados ao mesmo escopo e extrato independente. Não obter custo da assinatura ou adiantamento.

**Localização:** `tests/finance-core/settlements.mjs: adiantamento_AP; lib/finance-core/coverage.mjs; lib/cost-vs-budget/server.ts`. Tarefas: T03, T20, T26, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT06 — Retenção contratual e tributo retido sem soma do documento pai

**Obtido:** Componentes manuais85.000/5.000/10.000 e extratos fixos conservam100.000; aberto15.000→10.000→0.

**Falta para o aceite integral:** Faltam pai econômico/documental único, geração nativa dos filhos/credores, cobertura C/Q, custo econômico e liberação condicionada da retenção. Campos C/Q/custo desconhecidos permanecem null.

**Localização:** `tests/financial-acceptance/database.mjs; supabase/migrations/20260803_0075_execution_contract_finance.sql: approve_execution_contract_measurement; app/financeiro/notas-manuais`. Tarefas: T03, T16, T21, T26, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT09 — Cancelamento documental e substituição de medição por nota

**Obtido:** Cobertura nativa nota/parcela/medição elimina sobreposição em componentes.

**Falta para o aceite integral:** Falta executar MED-01→NF-01→NF-02 com cancelamento exclusivamente documental, I04→I03, um único custo e representação ativa, mantendo todas as versões.

**Localização:** `lib/finance-core/coverage.mjs: nativeFinancialBindings; app/financeiro/notas-manuais/actions.ts; supabase/migrations/20260803_0075_execution_contract_finance.sql`. Tarefas: T03, T16, T22, T24, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT11 — Rateio monetário parcial e arredondamento conservativo

**Obtido:** Oráculo puro60/40 e maior resto passa no centavo; saída1.800/1.200. Importação marca multi_project_requires_ledger.

**Falta para o aceite integral:** Falta ledger persistido multiobra na mesma entidade, versão/aprovador, pagamento parcial e devolução por obra; não promover quarentena a rateio concluído. Consumidor puro não transporta project_id e exige conferir contexto completo.

**Localização:** `lib/forecast/cost-allocation.mjs; lib/forecast/server.ts; supabase/migrations/20261021140000_koper_financial_snapshots.sql`. Tarefas: T02, T03, T06, T17, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT13 — Recebimento atrasado parcial e inadimplência da coorte

**Obtido:** Todos os campos passam com títulos/encargo/recebimentos reais no banco isolado e extrato fixo: aberto86.120, vencido6.120, recebido14.000, coorte30%.

**Falta para o aceite integral:** Lacuna numérica da fixture resolvida neste perímetro. Permanecem Auth/navegador, dados reais/documentos e aprovação nominal D09; não bloqueiam o resultado fictício registrado.

**Localização:** `tests/financial-acceptance/database.mjs: CT13; lib/finance-core/cohort.mjs; lib/finance-core/due.mjs`. Tarefas: T03, T31, T32, T34, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT14 — Recebimento líquido com tarifa e permuta sem caixa fictício

**Obtido:** Tarifa: liquida10.000, banco9.800, tarifa200 e aberto0. Permuta separada: liquida100.000, caixa30.000 e bem70.000. Extratos fixos conferidos.

**Falta para o aceite integral:** Lacuna numérica das duas variantes resolvida no ledger isolado. Bem/documento são fictícios, não avaliação patrimonial real nem aceite do contador; canal operacional de anexos/avaliação continua fora deste teste.

**Localização:** `tests/financial-acceptance/database.mjs: CT14; supabase/migrations/20261021160000_financial_settlement_ledger.sql: settle_finance_titles`. Tarefas: T03, T19, T32, T33, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT18 — Cobertura da previsão ao contrato ao título e encargo futuro

**Obtido:** Estados A–F passam no núcleo puro; P→C e vínculo nativo foram persistidos em controles separados.

**Falta para o aceite integral:** Falta cadeia única persistida de100.000 P→60.000 C+40.000 P→título20.000→pagamento5.000 e AF2.000 constituído em20/11, retirando o mesmo AF sem repetir encargo.

**Localização:** `tests/finance-core/components.test.mjs; tests/cashflow/database.mjs; supabase/migrations/20261022110000_cashflow_versions.sql`. Tarefas: T03, T25, T26, T28, T30, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT19 — Aditivo aprovado e previsão de estouro sem residual artificial

**Obtido:** Oráculo econômico puro: incorrido450.000; ETC800.000; EAC1.250.000; desvio25%; proposta não firme.

**Falta para o aceite integral:** Falta rastrear aprovação/vigência do aditivo50.000 e reestimativa350.000 até orçamento original/vigente persistidos, conferindo cenário de risco40.000. Não afirmar Q sem histórico de pagamentos.

**Localização:** `lib/finance-core/coverage.mjs: economicEstimate; tests/finance-core/components.test.mjs; lib/forecast/server.ts`. Tarefas: T03, T25, T27, T28, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT20 — Correção de período fechado com duas posições reproduzíveis

**Obtido:** Bloqueios de período bancário e contra reimportação fechada passam.

**Falta para o aceite integral:** Faltam fechamento econômico setembro500.000, retificação aprovada30.000 e consultas T30/09 em K original/reapresentado530.000, com ponte e banco outubro30.000. Versão de caixa não substitui fechamento econômico.

**Localização:** `supabase/migrations/20261021120000_financial_foundation_guards.sql; tests/financeiro/run.mjs; tests/koper-finance/run.mjs; lib/finance-core/ledger-position.mjs`. Tarefas: T02, T03, T07, T08, T37, T43, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT21 — Dados incompletos não se tornam zero ou total validado

**Obtido:** Função pura preserva Q/EAC/desvio/cobertura null; não soma140.000+840.000 como total confiável.

**Falta para o aceite integral:** Falta obter composição idêntica de dashboard/exportação/IA no mesmo T/K e teste de exceção condicionada sem apagar lacunas; universo externo continua desconhecido.

**Localização:** `lib/finance-core/coverage.mjs: financialCoverage; lib/finance-core/cashflow-server.ts; lib/elos-ia/tools.ts; app/financeiro/relatorios/page.tsx`. Tarefas: T01, T03, T09, T11, T12, T15, T27, T30, T33, T38, T40, T41, T44, T45. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT22 — Adiantamento de cliente e entradas futuras sem abatimento global repetido

**Obtido:** Banco20.000, crédito20.000→0, parcela aberta20.000 e zero caixa na aplicação; contraparte/contrato identificados.

**Falta para o aceite integral:** Falta mapa automático exclusivo de contrato100.000/parcela40.000/antecipação20.000 para futuro60.000 e I18=80.000, e prova de ausência de receita econômica automática. Esses três resultados continuam null.

**Localização:** `tests/financial-acceptance/database.mjs: CT22; lib/finance-core/cashflow.mjs: futureCashRows; supabase/migrations/20261021160000_financial_settlement_ledger.sql`. Tarefas: T03, T20, T33, T34, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT24 — Isolamento entre organizações e autorização entre empresas

**Obtido:** Controles SQL de organizações, entidades, perfis e propostas IA foram repetidos.

**Falta para o aceite integral:** Falta caso integral de três títulos nos contextos UA/UB/UR/UG, incluindo Auth real, detalhe, anexos/storage, exportações/IA, cache, jobs e trocas de contexto. Não extrapolar RLS SQL a todos os canais.

**Localização:** `tests/financeiro/run.mjs; tests/koper-finance/run.mjs; tests/finance-core/settlements.mjs; tests/cashflow/server.test.mjs; lib/elos-ia/tools.ts`. Tarefas: T01, T03, T04, T05, T10, T14, T16, T31, T36, T40, T41, T42, T43, T44, T45. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT27 — Estoque pago e consumo econômico sem nova previsão de caixa

**Obtido:** Pagamento não é adotado como prova suficiente de execução econômica; componentes financeiros existentes reaproveitados.

**Falta para o aceite integral:** Faltam recebimento/estoque pago20.000 e consumo8.000 persistidos, conferindo estoque12.000, ETC12.000, EAC20.000, Q0 e zero novo caixa sem somar NF/recebimento/consumo.

**Localização:** `lib/cost-vs-budget/server.ts; lib/finance-core/coverage.mjs; app/execucao`. Tarefas: T03, T22, T28, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT28 — Cobertura integrada com adiantamento retenção e escopo descoberto

**Obtido:** Ledger de adiantamento e componentes R/C/P funcionam separadamente.

**Falta para o aceite integral:** Falta cenário conjunto persistido: crédito120.000/aplicação60.000, pagamento100.000, filhos fornecedor/tributo/retenção, escopo P200.000 e custo300.000. Conferir Q1.180.000 e EAC1.400.000; nenhum total conjunto foi presumido.

**Localização:** `tests/finance-core/settlements.mjs; lib/finance-core/coverage.mjs; tests/financial-acceptance/database.mjs: CT06`. Tarefas: T03, T20, T21, T26, T28, T30, T40, T41, T44, T45. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.

## CT29 — Disponibilidade restrições e financiamento contado uma vez

**Obtido:** Oráculo puro completo passa: disponível100.000, finais40.000/−30.000 e necessidade50.000.

**Falta para o aceite integral:** Falta agenda persistida completa de financiamento com amortização20.000 já nos150.000, restrição documentada20.000 e limite70.000 não sacado, conferida no carregador/tela/IA no mesmo corte.

**Localização:** `tests/cashflow/engine.test.mjs; lib/finance-core/cashflow.mjs; lib/finance-core/cashflow-server.ts`. Tarefas: T03, T39, T44. Responsável futuro: financeiro/tecnologia; engenharia para execução/rateios/previsões e contador para reconhecimento/tributos. Nome/data/vigência não informados.
