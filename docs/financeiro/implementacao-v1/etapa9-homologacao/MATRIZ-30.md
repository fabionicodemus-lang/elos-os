# Matriz independente dos 30 casos

Expected estático da Etapa4, hash `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`. Valores monetários abaixo em **centavos BRL**. Entrada, premissas, passos e saídas completos em `evidencias/matriz-30.json`. Campo ausente não é zero; null observado significa falta de prova/resultado, inclusive quando o expected exige zero. Há13 casos com cobertura integral no perímetro técnico declarado:10 herdados e3 com banco/extrato independente novo. Outros7 têm todos os números de componente puro compatíveis, mas continuam entre os16 parciais. CT10 foi executado/reprovado. Sem homologação nominal.

| Caso | Classificação | Obtido e limite | Evidência |
|---|---|---|---|
| CT01 — Importação repetida e arquivos de cobertura parcial | Conforme técnico herdado — conferência independente pendente | Banco/importação: 3 repetições, recorte parcial, identidade, 30.000 abertos. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT02 — Nova versão do mesmo título e preservação do corte histórico | Parcialmente coberto | Histórico em função pura passa nos T/K exatos, e reimportação/revisão passam nos controles anteriores, separadamente. | componentes-adicionais.json; comparacao-componentes-adicionais.json |
| CT03 — Pagamento parcial e conciliação posterior sem novo caixa | Parcialmente coberto | Dois pagamentos e extrato fixo independente passam: aberto7.000→5.000; duas saídas somam5.000; conciliar/reimportar cria zero caixa. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT04 — Competência emissão vencimento caixa conciliação e limites de horizonte | Parcialmente coberto | Oráculo puro de competência/datas e limites30/90 passa. | reexecucao/casos-componentes.json; reexecucao/comparacao-componentes.json |
| CT05 — Adiantamento antes da execução e aplicação sem segundo abatimento | Parcialmente coberto | Crédito AP pago, aplicação e reversão passam no ledger existente. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT06 — Retenção contratual e tributo retido sem soma do documento pai | Parcialmente coberto | Componentes manuais85.000/5.000/10.000 e extratos fixos conservam100.000; aberto15.000→10.000→0. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT07 — Parciais juros e desconto com componentes separados | Conforme técnico herdado — conferência independente pendente | Sequência aprovada: 40.000 + 55.000 principal + 2.000 juros − 5.000 desconto; caixa 97.000, saldo 0. Exemplo 30/70 e tela AP passam. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT08 — Estorno de liquidação e devolução bancária são eventos distintos | Conforme técnico herdado — conferência independente pendente | Variantes A/B/C: R 57.000/62.000; devolução 57.000 somente com prova fictícia; sem devolução, 57.000 pendentes sem reescrever caixa. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT09 — Cancelamento documental e substituição de medição por nota | Parcialmente coberto | Cobertura nativa nota/parcela/medição elimina sobreposição em componentes. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT10 — Cancelamento econômico após pagamento e restituição parcial | Reprovado — restituição não representada | Cancelamento contratual não gera crédito de restituição; direito registrado0 versus10.000 esperado. Caminho de estorno com devolução6.000 preserva caixa líquido4.000 mas reabre AP10.000. V/H/C/Q/custo e direito remanescente sem prova própria ficam null. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT11 — Rateio monetário parcial e arredondamento conservativo | Parcialmente coberto | Oráculo puro60/40 e maior resto passa no centavo; saída1.800/1.200. Importação marca multi_project_requires_ledger. | componentes-adicionais.json; comparacao-componentes-adicionais.json |
| CT12 — Título sem obra preservado no total da entidade | Conforme técnico herdado — conferência independente pendente | Entidade/fonte/fornecedor/obrigação validados explicitamente; pagamento e conciliação de 2.000 sem obra. Entidade: custo dado/comprovado na fixture 10.000, aberto 8.000; obra A 6.000; sem obra: custo 4.000, aberto 2.000 e desembolso 2.000; apropriação original 60%. Sem padrão Flow. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT13 — Recebimento atrasado parcial e inadimplência da coorte | Conforme no cenário isolado — pendente aceite | Todos os campos passam com títulos/encargo/recebimentos reais no banco isolado e extrato fixo: aberto86.120, vencido6.120, recebido14.000, coorte30%. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT14 — Recebimento líquido com tarifa e permuta sem caixa fictício | Conforme no cenário isolado — pendente aceite | Tarifa: liquida10.000, banco9.800, tarifa200 e aberto0. Permuta separada: liquida100.000, caixa30.000 e bem70.000. Extratos fixos conferidos. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT15 — Transferência própria com tarifa e ponta em trânsito | Conforme técnico herdado — conferência independente pendente | Aberturas 50.000/10.000 comprovadas na fixture. Dia20: banco39.985 + trânsito20.000; dia21: banco59.985 e trânsito0. Tarifa15 é única saída externa. Pontas e tarifa vinculadas a extratos fictícios. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT16 — Mútuo entre entidades e eliminação apenas no consolidado autorizado | Conforme técnico herdado — conferência independente pendente | Mútuo documentado20.000: A/B fecham30.000 cada. Consolidado autorizado60.000; zero fluxo externo do mútuo; registros individuais preservados. Natureza/direitos no evento, sem presumir DFC contábil ou criar receita/custo. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT17 — Reprogramação de previsão sem reescrever execução ou vencimento | Conforme técnico herdado — conferência independente pendente | Versões persistidas e fontes congeladas. Original130.000/80.000/40.000; reprogramado80.000/−10.000/40.000; necessidade0→30.000. Vencimentos permanecem até acordo separado; variante de renegociação e posição anterior passam. Incorrido20.000 é fato fixo da fixture. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT18 — Cobertura da previsão ao contrato ao título e encargo futuro | Parcialmente coberto | Estados A–F passam no núcleo puro; P→C e vínculo nativo foram persistidos em controles separados. | reexecucao/casos-componentes.json; reexecucao/comparacao-componentes.json |
| CT19 — Aditivo aprovado e previsão de estouro sem residual artificial | Parcialmente coberto | Oráculo econômico puro: incorrido450.000; ETC800.000; EAC1.250.000; desvio25%; proposta não firme. | reexecucao/casos-componentes.json; reexecucao/comparacao-componentes.json |
| CT20 — Correção de período fechado com duas posições reproduzíveis | Parcialmente coberto | Bloqueios de período bancário e contra reimportação fechada passam. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT21 — Dados incompletos não se tornam zero ou total validado | Parcialmente coberto | Função pura preserva Q/EAC/desvio/cobertura null; não soma140.000+840.000 como total confiável. | reexecucao/casos-componentes.json; reexecucao/comparacao-componentes.json |
| CT22 — Adiantamento de cliente e entradas futuras sem abatimento global repetido | Parcialmente coberto | Banco20.000, crédito20.000→0, parcela aberta20.000 e zero caixa na aplicação; contraparte/contrato identificados. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT23 — Pagamento agrupado em vários títulos e múltiplas liquidações | Conforme no cenário isolado — pendente aceite | Refeito com entradas exatas A8.000/B12.000, alocações4.000/6.000 e4.000/2.000, e dois débitos fixos10.000/6.000. Todos os campos passam. | banco.json; registros.json; ponte.json; extratos-referencia.json |
| CT24 — Isolamento entre organizações e autorização entre empresas | Parcialmente coberto | Controles SQL de organizações, entidades, perfis e propostas IA foram repetidos. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT25 — Recorrência mensal substituída pelo título da mesma ocorrência | Conforme técnico herdado — conferência independente pendente | P3.000→R1.000+P2.000→P2.000 após pagamento conciliado. Ocorrência e vínculo imutáveis; reimportações documentadas preservam título e não recriam previsão ou caixa. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT26 — Paginação completa e falha no meio da extração | Conforme técnico herdado — conferência independente pendente | Paginação completa, falha intermediária e retry passam. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |
| CT27 — Estoque pago e consumo econômico sem nova previsão de caixa | Parcialmente coberto | Pagamento não é adotado como prova suficiente de execução econômica; componentes financeiros existentes reaproveitados. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT28 — Cobertura integrada com adiantamento retenção e escopo descoberto | Parcialmente coberto | Ledger de adiantamento e componentes R/C/P funcionam separadamente. | reexecucao/execucoes.json; ../../etapa8-fluxo/CENARIOS-30.md |
| CT29 — Disponibilidade restrições e financiamento contado uma vez | Parcialmente coberto | Oráculo puro completo passa: disponível100.000, finais40.000/−30.000 e necessidade50.000. | reexecucao/casos-componentes.json; reexecucao/comparacao-componentes.json |
| CT30 — Liquidação excedente identificada como crédito | Conforme técnico herdado — conferência independente pendente | 1.200 não liquida silenciosamente 1.000: excesso 200 exige classificação/evidência. Saldo 0, crédito 200, replay 0 mutações. | reexecucao/casos-obtidos.json; reexecucao/comparacao-integrais.json |

## CT01 — confronto campo a campo

Regra: §4, §14 item 1, I03, I22. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT01`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `canonical_title_count` | `2` | `2` |
| `I03_open_payables_cents` | `3000000` | `3000000` |
| `extra_obligations_from_retries` | `0` | `0` |
| `title_78_remains_open_cents` | `2000000` | `2000000` |
| `deletions_due_to_absence` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT02 — confronto campo a campo

Regra: §3, §4, §10, I03. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT02`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `canonical_title_count` | `1` | `1` |
| `original_snapshot_open_cents` | `1000000` | `1000000` |
| `revised_snapshot_open_cents` | `1200000` | `1200000` |
| `documented_bridge_cents` | `200000` | `200000` |
| `at_T_2026_10_21_K_2026_10_20_open_cents` | `1000000` | `1000000` |

Pendência / condição de aceite: Falta unir a reimportação real, autorização do acréscimo e consultas persistidas dos três cortes T/K da fixture numa cadeia documental reproduzível.

Código inspecionado: `supabase/migrations/20261021120000_financial_foundation_guards.sql: finance_payable_at; lib/finance-core/ledger-position.mjs: titlesAt; tests/koper-finance/run.mjs`.

## CT03 — confronto campo a campo

Regra: §5, §8.1, I02, I03. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT03`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `after_P1_open_cents` | `700000` | `700000` |
| `after_P2_open_cents` | `500000` | `500000` |
| `I02_gross_disbursed_cents` | `500000` | `500000` |
| `bank_debit_count` | `2` | `2` |
| `payment_count` | `2` | `2` |
| `cash_created_by_reconciliation_cents` | `0` | `0` |
| `I01_extra_cost_created_by_payments_cents` | `0` | `null` |

Pendência / condição de aceite: Falta evento econômico persistido anterior e leitura de I01 antes/depois. O campo de custo adicional é null; não presumir zero por ausência de evento na fixture.

Código inspecionado: `tests/financial-acceptance/database.mjs; lib/cost-vs-budget/server.ts; supabase/migrations/20261021160000_financial_settlement_ledger.sql`.

## CT04 — confronto campo a campo

Regra: §3, I01, I02, I06, I07. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT04`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `date_fixture.september_cost_cents` | `1000000` | `1000000` |
| `date_fixture.open_at_2026_10_21_cents` | `1000000` | `1000000` |
| `date_fixture.overdue_at_2026_10_21_cents` | `1000000` | `1000000` |
| `date_fixture.cash_at_2026_10_21_cents` | `0` | `0` |
| `date_fixture.bank_cash_on_2026_10_22_cents` | `1000000` | `1000000` |
| `date_fixture.new_cash_on_2026_10_24_cents` | `0` | `0` |
| `bucket_fixture.R_cents` | `2800000` | `2800000` |
| `bucket_fixture.overdue_cents` | `100000` | `100000` |
| `bucket_fixture.due_today_cents` | `200000` | `200000` |
| `bucket_fixture.next_30_days_cents` | `300000` | `300000` |
| `bucket_fixture.next_90_days_cents` | `1200000` | `1200000` |
| `bucket_fixture.beyond_90_days_cents` | `600000` | `600000` |
| `bucket_fixture.unknown_due_cents` | `700000` | `700000` |
| `bucket_fixture.immediate_need_through_30_days_cents` | `600000` | `600000` |

Pendência / condição de aceite: Falta encadear serviço aceito de setembro, emissão5/10, título/pagamento22 e confirmação24 em persistência/relatórios com relógio controlado; não confundir conciliação com novo caixa.

Código inspecionado: `tests/cashflow/engine.test.mjs; lib/finance-core/due.mjs; lib/finance-core/ledger-position.mjs`.

## CT05 — confronto campo a campo

Regra: §7.1, §8.2, §12.1, I05, I09, I10, I12, I13. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT05`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `states[0].stage` | `"A"` | `não observado` |
| `states[0].H_cents` | `0` | `não observado` |
| `states[0].R_cents` | `0` | `não observado` |
| `states[0].C_cents` | `10000000` | `não observado` |
| `states[0].Q_cents` | `10000000` | `não observado` |
| `states[0].cost_cents` | `0` | `não observado` |
| `states[0].ETC_cents` | `10000000` | `não observado` |
| `states[0].advance_available_cents` | `0` | `não observado` |
| `states[1].stage` | `"B"` | `não observado` |
| `states[1].H_cents` | `0` | `não observado` |
| `states[1].R_cents` | `2000000` | `não observado` |
| `states[1].C_cents` | `8000000` | `não observado` |
| `states[1].Q_cents` | `10000000` | `não observado` |
| `states[1].cost_cents` | `0` | `não observado` |
| `states[1].ETC_cents` | `10000000` | `não observado` |
| `states[1].advance_available_cents` | `0` | `não observado` |
| `states[2].stage` | `"C"` | `não observado` |
| `states[2].H_cents` | `2000000` | `não observado` |
| `states[2].R_cents` | `0` | `não observado` |
| `states[2].C_cents` | `8000000` | `não observado` |
| `states[2].Q_cents` | `8000000` | `não observado` |
| `states[2].cost_cents` | `0` | `não observado` |
| `states[2].ETC_cents` | `10000000` | `não observado` |
| `states[2].advance_available_cents` | `2000000` | `não observado` |
| `states[3].stage` | `"D"` | `não observado` |
| `states[3].H_cents` | `2000000` | `não observado` |
| `states[3].R_cents` | `2000000` | `não observado` |
| `states[3].C_cents` | `6000000` | `não observado` |
| `states[3].Q_cents` | `8000000` | `não observado` |
| `states[3].cost_cents` | `4000000` | `não observado` |
| `states[3].ETC_cents` | `6000000` | `não observado` |
| `states[3].advance_available_cents` | `0` | `não observado` |
| `states[4].stage` | `"E"` | `não observado` |
| `states[4].H_cents` | `4000000` | `não observado` |
| `states[4].R_cents` | `0` | `não observado` |
| `states[4].C_cents` | `6000000` | `não observado` |
| `states[4].Q_cents` | `6000000` | `não observado` |
| `states[4].cost_cents` | `4000000` | `não observado` |
| `states[4].ETC_cents` | `6000000` | `não observado` |
| `states[4].advance_available_cents` | `0` | `não observado` |
| `new_cash_on_application_cents` | `0` | `não observado` |

Pendência / condição de aceite: Faltam estados A–E com contrato/medição econômica aceita e ETC comprovado, vinculados ao mesmo escopo e extrato independente. Não obter custo da assinatura ou adiantamento.

Código inspecionado: `tests/finance-core/settlements.mjs: adiantamento_AP; lib/finance-core/coverage.mjs; lib/cost-vs-budget/server.ts`.

## CT06 — confronto campo a campo

Regra: §8.2, I03, I05, I08, I10, I12. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT06`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `initial_R_cents` | `10000000` | `10000000` |
| `initial_C_cents` | `0` | `null` |
| `initial_Q_cents` | `10000000` | `null` |
| `after_supplier_R_cents` | `1500000` | `1500000` |
| `after_supplier_retention_cents` | `1000000` | `1000000` |
| `after_tax_R_cents` | `1000000` | `1000000` |
| `after_tax_H_cents` | `9000000` | `9000000` |
| `final_R_cents` | `0` | `0` |
| `final_H_cents` | `10000000` | `10000000` |
| `total_cash_cents` | `10000000` | `10000000` |
| `cost_cents` | `10000000` | `null` |

Pendência / condição de aceite: Faltam pai econômico/documental único, geração nativa dos filhos/credores, cobertura C/Q, custo econômico e liberação condicionada da retenção. Campos C/Q/custo desconhecidos permanecem null.

Código inspecionado: `tests/financial-acceptance/database.mjs; supabase/migrations/20260803_0075_execution_contract_finance.sql: approve_execution_contract_measurement; app/financeiro/notas-manuais`.

## CT07 — confronto campo a campo

Regra: §5, §8.3, §12.3, I02, I03, I10. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT07`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `after_first_open_principal_cents` | `6000000` | `6000000` |
| `second_principal_cents` | `5500000` | `5500000` |
| `final_open_cents` | `0` | `0` |
| `H_principal_cents` | `9500000` | `9500000` |
| `N_discount_cents` | `500000` | `500000` |
| `interest_paid_cents` | `200000` | `200000` |
| `I02_cash_cents` | `9700000` | `9700000` |
| `C_cents` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT08 — confronto campo a campo

Regra: §8.3, §12.3, I02, I03. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT08`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `A.open_principal_cents` | `5500000` | `5500000` |
| `A.open_interest_cents` | `200000` | `200000` |
| `A.R_cents` | `5700000` | `5700000` |
| `A.gross_historical_outflow_cents` | `9700000` | `9700000` |
| `A.confirmed_refund_cents` | `5700000` | `5700000` |
| `A.net_outflow_cents` | `4000000` | `4000000` |
| `B.open_principal_cents` | `6000000` | `6000000` |
| `B.open_interest_cents` | `200000` | `200000` |
| `B.R_cents` | `6200000` | `6200000` |
| `B.net_outflow_cents` | `4000000` | `4000000` |
| `C.confirmed_refund_cents` | `0` | `0` |
| `C.gross_historical_outflow_cents` | `9700000` | `9700000` |
| `C.cash_awaiting_reallocation_cents` | `5700000` | `5700000` |
| `C.Q_complete` | `false` | `false` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT09 — confronto campo a campo

Regra: §7.2, §8.3, I01, I03, I04, I05. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT09`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `before_invoice_I03_cents` | `0` | `não observado` |
| `before_invoice_I04_cents` | `800000` | `não observado` |
| `final_I03_cents` | `800000` | `não observado` |
| `final_I04_cents` | `0` | `não observado` |
| `final_R_cents` | `800000` | `não observado` |
| `cost_cents` | `800000` | `não observado` |
| `cash_cents` | `0` | `não observado` |
| `active_financial_representations` | `1` | `não observado` |

Pendência / condição de aceite: Falta executar MED-01→NF-01→NF-02 com cancelamento exclusivamente documental, I04→I03, um único custo e representação ativa, mantendo todas as versões.

Código inspecionado: `lib/finance-core/coverage.mjs: nativeFinancialBindings; app/financeiro/notas-manuais/actions.ts; supabase/migrations/20260803_0075_execution_contract_finance.sql`.

## CT10 — confronto campo a campo

Regra: §7.1, §8.3, I02, I09, I10, I12. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT10`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `after_cancellation_V_cents` | `0` | `null` |
| `after_cancellation_H_imputable_to_current_price_cents` | `0` | `null` |
| `after_cancellation_C_cents` | `0` | `null` |
| `after_cancellation_R_cents` | `0` | `0` |
| `after_cancellation_Q_cents` | `0` | `null` |
| `refund_right_before_receipt_cents` | `1000000` | `0` |
| `refund_right_after_receipt_cents` | `400000` | `null` |
| `historical_gross_outflow_cents` | `1000000` | `1000000` |
| `confirmed_refund_cents` | `600000` | `600000` |
| `net_outflow_cents` | `400000` | `400000` |
| `cost_cents` | `0` | `null` |

Pendência / condição de aceite: Criar conversão documentada e autorizada do adiantamento em direito de restituição vinculado ao cancelamento econômico; retirar cobertura do preço cancelado, liquidar somente6.000 do direito e conservar4.000, sem reabrir AP nem apagar saída original. Não implementado nesta homologação.

Código inspecionado: `supabase/migrations/20260728_0038_execution_service_contracts.sql: change_execution_service_contract_status; supabase/migrations/20261021160000_financial_settlement_ledger.sql: reverse_finance_settlement`.

## CT11 — confronto campo a campo

Regra: §9, §12.5, I01, I02, I22. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT11`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `proportional_fixture.cost_A_cents` | `600000` | `600000` |
| `proportional_fixture.cost_B_cents` | `400000` | `400000` |
| `proportional_fixture.cash_A_cents` | `180000` | `180000` |
| `proportional_fixture.cash_B_cents` | `120000` | `120000` |
| `proportional_fixture.remaining_A_cents` | `420000` | `420000` |
| `proportional_fixture.remaining_B_cents` | `280000` | `280000` |
| `rounding_fixture.A_cents` | `3334` | `3334` |
| `rounding_fixture.B_cents` | `3334` | `3334` |
| `rounding_fixture.C_cents` | `3333` | `3333` |
| `rounding_fixture.sum_cents` | `10001` | `10001` |
| `rounding_fixture.unallocated_cents` | `0` | `0` |

Pendência / condição de aceite: Falta ledger persistido multiobra na mesma entidade, versão/aprovador, pagamento parcial e devolução por obra; não promover quarentena a rateio concluído. Consumidor puro não transporta project_id e exige conferir contexto completo.

Código inspecionado: `lib/forecast/cost-allocation.mjs; lib/forecast/server.ts; supabase/migrations/20261021140000_koper_financial_snapshots.sql`.

## CT12 — confronto campo a campo

Regra: §9, §11, I01, I02, I03, I22, D01. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT12`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `entity_cost_cents` | `1000000` | `1000000` |
| `obra_A_cost_cents` | `600000` | `600000` |
| `unclassified_cost_cents` | `400000` | `400000` |
| `entity_open_payables_cents` | `800000` | `800000` |
| `obra_A_open_payables_cents` | `600000` | `600000` |
| `unclassified_open_payables_cents` | `200000` | `200000` |
| `entity_disbursed_cents` | `200000` | `200000` |
| `unclassified_disbursed_cents` | `200000` | `200000` |
| `automatic_Flow_allocation_cents` | `0` | `0` |
| `appropriation_on_original_amounts_numerator_cents` | `600000` | `600000` |
| `appropriation_on_original_amounts_denominator_cents` | `1000000` | `1000000` |
| `appropriation_on_original_amounts_percent` | `"60.00"` | `"60.00"` |
| `obra_cost_complete` | `false` | `false` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT13 — confronto campo a campo

Regra: §8.5, I16, I17, I19. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT13`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `cohort_due_principal_cents` | `2000000` | `2000000` |
| `cohort_overdue_principal_cents` | `600000` | `600000` |
| `overdue_total_with_interest_cents` | `612000` | `612000` |
| `I16_total_open_cents` | `8612000` | `8612000` |
| `I17_received_cents` | `1400000` | `1400000` |
| `I19_cohort_principal_delinquency_percent` | `"30.00"` | `"30.00"` |

Pendência / condição de aceite: Lacuna numérica da fixture resolvida neste perímetro. Permanecem Auth/navegador, dados reais/documentos e aprovação nominal D09; não bloqueiam o resultado fictício registrado.

Código inspecionado: `tests/financial-acceptance/database.mjs: CT13; lib/finance-core/cohort.mjs; lib/finance-core/due.mjs`.

## CT14 — confronto campo a campo

Regra: §8.5, §12.4, I16, I17. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT14`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `fee_fixture.receivable_settled_cents` | `1000000` | `1000000` |
| `fee_fixture.open_cents` | `0` | `0` |
| `fee_fixture.I17_bank_receipt_cents` | `980000` | `980000` |
| `fee_fixture.identified_fee_cents` | `20000` | `20000` |
| `fee_fixture.artificial_overdue_cents` | `0` | `0` |
| `barter_fixture.receivable_settled_cents` | `10000000` | `10000000` |
| `barter_fixture.open_cents` | `0` | `0` |
| `barter_fixture.I17_cash_received_cents` | `3000000` | `3000000` |
| `barter_fixture.noncash_settlement_cents` | `7000000` | `7000000` |

Pendência / condição de aceite: Lacuna numérica das duas variantes resolvida no ledger isolado. Bem/documento são fictícios, não avaliação patrimonial real nem aceite do contador; canal operacional de anexos/avaliação continua fora deste teste.

Código inspecionado: `tests/financial-acceptance/database.mjs: CT14; supabase/migrations/20261021160000_financial_settlement_ledger.sql: settle_finance_titles`.

## CT15 — confronto campo a campo

Regra: §8.6, §12.7, I02, I17, I20. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT15`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `end_2026_10_20.A_bank_cents` | `2998500` | `2998500` |
| `end_2026_10_20.B_bank_cents` | `1000000` | `1000000` |
| `end_2026_10_20.sum_bank_balances_cents` | `3998500` | `3998500` |
| `end_2026_10_20.transfer_in_transit_cents` | `2000000` | `2000000` |
| `end_2026_10_20.available_bank_cash_cents` | `3998500` | `3998500` |
| `end_2026_10_20.external_outflow_cents` | `1500` | `1500` |
| `end_2026_10_21.A_bank_cents` | `2998500` | `2998500` |
| `end_2026_10_21.B_bank_cents` | `3000000` | `3000000` |
| `end_2026_10_21.sum_bank_balances_cents` | `5998500` | `5998500` |
| `end_2026_10_21.transfer_in_transit_cents` | `0` | `0` |
| `end_2026_10_21.external_outflow_cents` | `1500` | `1500` |
| `end_2026_10_21.external_receipt_cents` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT16 — confronto campo a campo

Regra: §4, §8.6, I20, I21, D13. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT16`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `A.cash_cents` | `3000000` | `3000000` |
| `A.loan_receivable_cents` | `2000000` | `2000000` |
| `A.loan_disbursement_cents` | `2000000` | `2000000` |
| `B.cash_cents` | `3000000` | `3000000` |
| `B.loan_liability_cents` | `2000000` | `2000000` |
| `B.financing_inflow_cents` | `2000000` | `2000000` |
| `consolidated.cash_cents` | `6000000` | `6000000` |
| `consolidated.external_flow_from_loan_cents` | `0` | `0` |
| `consolidated.eliminated_asset_cents` | `2000000` | `2000000` |
| `consolidated.eliminated_liability_cents` | `2000000` | `2000000` |
| `construction_cost_created_cents` | `0` | `0` |
| `sales_revenue_created_cents` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT17 — confronto campo a campo

Regra: §3, §7.2, §10, I06, I12, I14, I19, I21. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT17`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `Q_before_and_after_cents` | `12000000` | `12000000` |
| `ETC_before_and_after_cents` | `10000000` | `10000000` |
| `EAC_before_and_after_cents` | `12000000` | `12000000` |
| `incurred_cost_unchanged_cents` | `2000000` | `2000000` |
| `original_projected_closing_cash_cents.2026-10` | `13000000` | `13000000` |
| `original_projected_closing_cash_cents.2026-11` | `8000000` | `8000000` |
| `original_projected_closing_cash_cents.2026-12` | `4000000` | `4000000` |
| `reprogrammed_projected_closing_cash_cents.2026-10` | `8000000` | `8000000` |
| `reprogrammed_projected_closing_cash_cents.2026-11` | `-1000000` | `-1000000` |
| `reprogrammed_projected_closing_cash_cents.2026-12` | `4000000` | `4000000` |
| `original_peak_additional_funding_cents` | `0` | `0` |
| `reprogrammed_peak_additional_funding_cents` | `3000000` | `3000000` |
| `AP_overdue_at_2026_10_31_cents` | `2000000` | `2000000` |
| `AR_overdue_at_2026_10_31_cents` | `6000000` | `6000000` |
| `original_version_retained` | `true` | `true` |
| `separate_valid_renegotiation_variant.effective_event_date` | `"2026-10-28"` | `"2026-10-28"` |
| `separate_valid_renegotiation_variant.original_due` | `"2026-10-25"` | `"2026-10-25"` |
| `separate_valid_renegotiation_variant.new_due` | `"2026-11-15"` | `"2026-11-15"` |
| `separate_valid_renegotiation_variant.R_unchanged_cents` | `2000000` | `2000000` |
| `separate_valid_renegotiation_variant.overdue_before_event_at_2026_10_27_cents` | `2000000` | `2000000` |
| `separate_valid_renegotiation_variant.overdue_after_event_at_2026_10_31_cents` | `0` | `0` |
| `separate_valid_renegotiation_variant.Q_unchanged_cents` | `12000000` | `12000000` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT18 — confronto campo a campo

Regra: §7.1, §7.2, I05, I10, I11, I12. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT18`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `states[0].stage` | `"A"` | `"A"` |
| `states[0].R_cents` | `0` | `0` |
| `states[0].C_cents` | `0` | `0` |
| `states[0].P_cents` | `10000000` | `10000000` |
| `states[0].Q_cents` | `10000000` | `10000000` |
| `states[0].AF_cents` | `0` | `0` |
| `states[1].stage` | `"B"` | `"B"` |
| `states[1].R_cents` | `0` | `0` |
| `states[1].C_cents` | `6000000` | `6000000` |
| `states[1].P_cents` | `4000000` | `4000000` |
| `states[1].Q_cents` | `10000000` | `10000000` |
| `states[1].AF_cents` | `0` | `0` |
| `states[2].stage` | `"C"` | `"C"` |
| `states[2].R_cents` | `2000000` | `2000000` |
| `states[2].C_cents` | `4000000` | `4000000` |
| `states[2].P_cents` | `4000000` | `4000000` |
| `states[2].Q_cents` | `10000000` | `10000000` |
| `states[2].AF_cents` | `0` | `0` |
| `states[3].stage` | `"D"` | `"D"` |
| `states[3].R_cents` | `1500000` | `1500000` |
| `states[3].C_cents` | `4000000` | `4000000` |
| `states[3].P_cents` | `4000000` | `4000000` |
| `states[3].Q_cents` | `9500000` | `9500000` |
| `states[3].AF_cents` | `0` | `0` |
| `states[4].stage` | `"E"` | `"E"` |
| `states[4].R_cents` | `1500000` | `1500000` |
| `states[4].C_cents` | `4000000` | `4000000` |
| `states[4].P_cents` | `4000000` | `4000000` |
| `states[4].Q_cents` | `9500000` | `9500000` |
| `states[4].AF_cents` | `200000` | `200000` |
| `states[4].Q_scenario_cents` | `9700000` | `9700000` |
| `states[5].stage` | `"F"` | `"F"` |
| `states[5].R_cents` | `1700000` | `1700000` |
| `states[5].C_cents` | `4000000` | `4000000` |
| `states[5].P_cents` | `4000000` | `4000000` |
| `states[5].Q_cents` | `9700000` | `9700000` |
| `states[5].AF_cents` | `0` | `0` |
| `states[5].Q_scenario_cents` | `9700000` | `9700000` |

Pendência / condição de aceite: Falta cadeia única persistida de100.000 P→60.000 C+40.000 P→título20.000→pagamento5.000 e AF2.000 constituído em20/11, retirando o mesmo AF sem repetir encargo.

Código inspecionado: `tests/finance-core/components.test.mjs; tests/cashflow/database.mjs; supabase/migrations/20261022110000_cashflow_versions.sql`.

## CT19 — confronto campo a campo

Regra: §8.4, §12.6, I01, I13, I14, I15. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT19`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `firm_foundation_contract_cents` | `55000000` | `55000000` |
| `incurred_cost_cents` | `45000000` | `45000000` |
| `ETC_cents` | `80000000` | `80000000` |
| `EAC_cents` | `125000000` | `125000000` |
| `variance_to_current_budget_cents` | `25000000` | `25000000` |
| `variance_percent` | `"25.00"` | `"25.00"` |
| `firm_commitment_increment_from_unapproved_proposal_cents` | `0` | `0` |
| `scenario_EAC_if_risk_fully_added_cents` | `129000000` | `129000000` |

Pendência / condição de aceite: Falta rastrear aprovação/vigência do aditivo50.000 e reestimativa350.000 até orçamento original/vigente persistidos, conferindo cenário de risco40.000. Não afirmar Q sem histórico de pagamentos.

Código inspecionado: `lib/finance-core/coverage.mjs: economicEstimate; tests/finance-core/components.test.mjs; lib/forecast/server.ts`.

## CT20 — confronto campo a campo

Regra: §3, §10, I01, I02, D11. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT20`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `original_september_cost_cents` | `50000000` | `não observado` |
| `restated_september_cost_cents` | `53000000` | `não observado` |
| `bridge_cents` | `3000000` | `não observado` |
| `new_october_economic_cost_from_prior_error_cents` | `0` | `não observado` |
| `october_bank_outflow_cents` | `3000000` | `não observado` |
| `original_snapshot_mutations` | `0` | `não observado` |

Pendência / condição de aceite: Faltam fechamento econômico setembro500.000, retificação aprovada30.000 e consultas T30/09 em K original/reapresentado530.000, com ponte e banco outubro30.000. Versão de caixa não substitui fechamento econômico.

Código inspecionado: `supabase/migrations/20261021120000_financial_foundation_guards.sql; tests/financeiro/run.mjs; tests/koper-finance/run.mjs; lib/finance-core/ledger-position.mjs`.

## CT21 — confronto campo a campo

Regra: §7.2, §11, I12, I14, I15, I22. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT21`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `known_obligations_subtotal_cents` | `14000000` | `14000000` |
| `contract_amount_shown_separately_cents` | `84000000` | `84000000` |
| `Q_cents` | `null` | `null` |
| `EAC_cents` | `null` | `null` |
| `budget_variance_percent` | `null` | `null` |
| `external_coverage_percent` | `null` | `null` |
| `status` | `"incompleto"` | `"incompleto"` |

Pendência / condição de aceite: Falta obter composição idêntica de dashboard/exportação/IA no mesmo T/K e teste de exceção condicionada sem apagar lacunas; universo externo continua desconhecido.

Código inspecionado: `lib/finance-core/coverage.mjs: financialCoverage; lib/finance-core/cashflow-server.ts; lib/elos-ia/tools.ts; app/financeiro/relatorios/page.tsx`.

## CT22 — confronto campo a campo

Regra: §8.2, §8.5, I09, I16, I17, I18. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT22`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `cash_received_cents` | `2000000` | `2000000` |
| `advance_available_before_application_cents` | `2000000` | `2000000` |
| `advance_available_after_application_cents` | `0` | `0` |
| `open_receivable_cents` | `2000000` | `2000000` |
| `contract_future_not_issued_cents` | `6000000` | `null` |
| `I18_future_inflow_cents` | `8000000` | `null` |
| `cash_created_by_application_cents` | `0` | `0` |
| `automatic_revenue_cents` | `0` | `null` |

Pendência / condição de aceite: Falta mapa automático exclusivo de contrato100.000/parcela40.000/antecipação20.000 para futuro60.000 e I18=80.000, e prova de ausência de receita econômica automática. Esses três resultados continuam null.

Código inspecionado: `tests/financial-acceptance/database.mjs: CT22; lib/finance-core/cashflow.mjs: futureCashRows; supabase/migrations/20261021160000_financial_settlement_ledger.sql`.

## CT23 — confronto campo a campo

Regra: §4, §8.1, I02, I03. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT23`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `after_P1_A_open_cents` | `400000` | `400000` |
| `after_P1_B_open_cents` | `600000` | `600000` |
| `final_A_open_cents` | `0` | `0` |
| `final_B_open_cents` | `400000` | `400000` |
| `final_I03_cents` | `400000` | `400000` |
| `I02_cash_cents` | `1600000` | `1600000` |
| `unique_bank_debits` | `2` | `2` |
| `new_cash_from_reimport_cents` | `0` | `0` |

Pendência / condição de aceite: Fixture anterior usava A10.000/B10.000 e primeira alocação6.000/4.000, embora produzisse os mesmos saldos. Evidência anterior não comprovava as entradas exatas; corrigido no teste novo sem alterar operação/expected.

Código inspecionado: `tests/financial-acceptance/database.mjs: CT23; tests/finance-core/settlements.mjs: CT23_pagamento_agrupado`.

## CT24 — confronto campo a campo

Regra: §4, §11, §14 item 13, D02, D13. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT24`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `canonical_title_count_all_organizations` | `3` | `não observado` |
| `UA_visible_total_cents` | `100000` | `não observado` |
| `UB_visible_total_cents` | `900000` | `não observado` |
| `UG_A1_context_total_cents` | `100000` | `não observado` |
| `UG_A2_context_total_cents` | `300000` | `não observado` |
| `UG_A_authorized_consolidated_total_cents` | `400000` | `não observado` |
| `UG_B_context_total_cents` | `900000` | `não observado` |
| `foreign_rows_returned_to_UA` | `0` | `não observado` |
| `restricted_same_organization_rows_returned_to_UA` | `0` | `não observado` |
| `unauthorized_mutations_committed` | `0` | `não observado` |
| `UR_mutations_committed` | `0` | `não observado` |
| `foreign_data_occurrences_in_UA_exports_or_AI` | `0` | `não observado` |

Pendência / condição de aceite: Falta caso integral de três títulos nos contextos UA/UB/UR/UG, incluindo Auth real, detalhe, anexos/storage, exportações/IA, cache, jobs e trocas de contexto. Não extrapolar RLS SQL a todos os canais.

Código inspecionado: `tests/financeiro/run.mjs; tests/koper-finance/run.mjs; tests/finance-core/settlements.mjs; tests/cashflow/server.test.mjs; lib/elos-ia/tools.ts`.

## CT25 — confronto campo a campo

Regra: §8.4, §7.2, I03, I11, I12. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT25`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `initial_P_cents` | `300000` | `300000` |
| `after_title_R_cents` | `100000` | `100000` |
| `after_title_P_cents` | `200000` | `200000` |
| `after_title_Q_cents` | `300000` | `300000` |
| `after_payment_R_cents` | `0` | `0` |
| `after_payment_P_cents` | `200000` | `200000` |
| `after_payment_Q_cents` | `200000` | `200000` |
| `october_incurred_cost_cents` | `100000` | `100000` |
| `october_cash_cents` | `100000` | `100000` |
| `active_occurrence_count` | `3` | `3` |
| `duplicate_october_obligations` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT26 — confronto campo a campo

Regra: §2, §4, §11, I22, S2 §5. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT26`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `complete.unique_count` | `5` | `5` |
| `complete.total_cents` | `1500000` | `1500000` |
| `complete.external_coverage_percent` | `"100.00"` | `"100.00"` |
| `failed_page_2.known_unique_count` | `2` | `2` |
| `failed_page_2.known_subtotal_cents` | `300000` | `300000` |
| `failed_page_2.known_loaded_coverage_percent` | `"40.00"` | `"40.00"` |
| `failed_page_2.certified_total_cents` | `null` | `null` |
| `failed_page_2.complete` | `false` | `false` |
| `after_retry.unique_count` | `5` | `5` |
| `after_retry.total_cents` | `1500000` | `1500000` |
| `after_retry.duplicate_obligations` | `0` | `0` |
| `repeated_cursor_detected` | `true` | `true` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.

## CT27 — confronto campo a campo

Regra: §5, §7.1, I01, I10, I12, I13, I14. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT27`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `before_consumption.H_cents` | `2000000` | `não observado` |
| `before_consumption.R_cents` | `0` | `não observado` |
| `before_consumption.C_cents` | `0` | `não observado` |
| `before_consumption.P_cents` | `0` | `não observado` |
| `before_consumption.Q_cents` | `0` | `não observado` |
| `before_consumption.cost_cents` | `0` | `não observado` |
| `before_consumption.inventory_cents` | `2000000` | `não observado` |
| `before_consumption.ETC_cents` | `2000000` | `não observado` |
| `before_consumption.EAC_cents` | `2000000` | `não observado` |
| `after_consumption.cost_cents` | `800000` | `não observado` |
| `after_consumption.inventory_cents` | `1200000` | `não observado` |
| `after_consumption.ETC_cents` | `1200000` | `não observado` |
| `after_consumption.EAC_cents` | `2000000` | `não observado` |
| `after_consumption.Q_cents` | `0` | `não observado` |
| `after_consumption.new_cash_cents` | `0` | `não observado` |

Pendência / condição de aceite: Faltam recebimento/estoque pago20.000 e consumo8.000 persistidos, conferindo estoque12.000, ETC12.000, EAC20.000, Q0 e zero novo caixa sem somar NF/recebimento/consumo.

Código inspecionado: `lib/cost-vs-budget/server.ts; lib/finance-core/coverage.mjs; app/execucao`.

## CT28 — confronto campo a campo

Regra: §7.1, §12.2, I05, I08, I09, I10, I11, I12, I13, I14. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT28`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `supplier_open_cents` | `8000000` | `não observado` |
| `tax_open_cents` | `3000000` | `não observado` |
| `retention_open_cents` | `3000000` | `não observado` |
| `R_cents` | `14000000` | `não observado` |
| `H_cents` | `22000000` | `não observado` |
| `advance_available_cents` | `6000000` | `não observado` |
| `C_cents` | `84000000` | `não observado` |
| `P_cents` | `20000000` | `não observado` |
| `Q_cents` | `118000000` | `não observado` |
| `ETC_cents` | `110000000` | `não observado` |
| `EAC_cents` | `140000000` | `não observado` |

Pendência / condição de aceite: Falta cenário conjunto persistido: crédito120.000/aplicação60.000, pagamento100.000, filhos fornecedor/tributo/retenção, escopo P200.000 e custo300.000. Conferir Q1.180.000 e EAC1.400.000; nenhum total conjunto foi presumido.

Código inspecionado: `tests/finance-core/settlements.mjs; lib/finance-core/coverage.mjs; tests/financial-acceptance/database.mjs: CT06`.

## CT29 — confronto campo a campo

Regra: §12.7, I20, I21, D04. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT29`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `available_opening_cents` | `10000000` | `10000000` |
| `closing_month1_cents` | `4000000` | `4000000` |
| `closing_month2_cents` | `-3000000` | `-3000000` |
| `peak_additional_funding_cents` | `5000000` | `5000000` |
| `additional_amortization_duplicate_cents` | `0` | `0` |
| `unused_limit_in_available_cash_cents` | `0` | `0` |

Pendência / condição de aceite: Falta agenda persistida completa de financiamento com amortização20.000 já nos150.000, restrição documentada20.000 e limite70.000 não sacado, conferida no carregador/tela/IA no mesmo corte.

Código inspecionado: `tests/cashflow/engine.test.mjs; lib/finance-core/cashflow.mjs; lib/finance-core/cashflow-server.ts`.

## CT30 — confronto campo a campo

Regra: §5, §8.1, I02, I03, I09. Entrada e passos: [JSON](evidencias/matriz-30.json), objeto `CT30`.

| Campo | Esperado fixo | Obtido |
|---|---:|---:|
| `open_payable_cents` | `0` | `0` |
| `principal_settled_cents` | `100000` | `100000` |
| `refund_receivable_cents` | `20000` | `20000` |
| `confirmed_cash_outflow_cents` | `120000` | `120000` |
| `unexplained_negative_balance_cents` | `0` | `0` |
| `second_allocation_mutations` | `0` | `0` |

Pendência / condição de aceite: Revisar a evidência documental e o perímetro; controles herdados não certificam dados reais, custo econômico nem extrato independente.

Código inspecionado: `Ver fontes de execução em reexecucao/ e arquitetura Etapa8.`.
