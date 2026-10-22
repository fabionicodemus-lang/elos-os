# Matriz individual dos16 parciais — Etapa12

A: falha demonstrada; B: teste/evidência técnica incompleta; C: informação real; D: decisão financeira; E: limitação da fonte. Categorias são cumulativas. B não significa bug; C/D da implantação não anulam premissas fictícias já aprovadas. Os quatro selecionados independem de documentos reais ou novas decisões para seu perímetro de teste.

A prioridade combina risco financeiro, dupla contagem, dependências e possibilidade de prova independente. CT24 eCT21 continuam prioritários, mas a prova integral disponível deste lote é a dos quatro selecionados. Estimativas são dias úteis de engenharia, não prazo aprovado; excluem espera externa.

| Ordem | Caso | Classes | Lote | Esforço |
|---:|---|---|---|---|
|1|CT24 — Isolamento entre organizações e autorização entre empresas|B/C/D|Pendente|3–5 dias|
|2|CT18 — Cobertura da previsão ao contrato ao título e encargo futuro|A/B|Selecionado|1–2 dias|
|3|CT21 — Dados incompletos não se tornam zero ou total validado|B/D/E|Pendente|2–3 dias|
|4|CT29 — Disponibilidade restrições e financiamento contado uma vez|A/B|Selecionado|0,5–1 dia|
|5|CT02 — Nova versão do mesmo título e preservação do corte histórico|A/B|Selecionado|0,5–1 dia|
|6|CT03 — Pagamento parcial e conciliação posterior sem novo caixa|B|Selecionado|0,5–1 dia|
|7|CT06 — Retenção contratual e tributo retido sem soma do documento pai|B/C/D|Pendente|2–4 dias|
|8|CT28 — Cobertura integrada com adiantamento retenção e escopo descoberto|B/C|Pendente|2–3 dias apósCT05/06|
|9|CT09 — Cancelamento documental e substituição de medição por nota|B/C|Pendente|2–4 dias|
|10|CT22 — Adiantamento de cliente e entradas futuras sem abatimento global repetido|B/C/D|Pendente|2–3 dias|
|11|CT11 — Rateio monetário parcial e arredondamento conservativo|B/C/D/E|Pendente|3–5 dias|
|12|CT05 — Adiantamento antes da execução e aplicação sem segundo abatimento|B/C|Pendente|2–3 dias|
|13|CT27 — Estoque pago e consumo econômico sem nova previsão de caixa|B/C/D|Pendente|2–4 dias|
|14|CT04 — Competência emissão vencimento caixa conciliação e limites de horizonte|B/C|Pendente|1–2 dias|
|15|CT20 — Correção de período fechado com duas posições reproduzíveis|B/C/D|Pendente|3–5 dias|
|16|CT19 — Aditivo aprovado e previsão de estouro sem residual artificial|B/C/D|Pendente|2–3 dias|

## CT24 — Isolamento entre organizações e autorização entre empresas

**Problema anterior:** Falta caso integral de três títulos nos contextos UA/UB/UR/UG, incluindo Auth real, detalhe, anexos/storage, exportações/IA, cache, jobs e trocas de contexto. Não extrapolar RLS SQL a todos os canais.

**Causa / nível:** Controles SQL existem, mas não há execução integral dos três títulos UA/UB/UR/UG em Auth, storage, cache, jobs, IA e exportação.

**Regra:** §4, §11, §14 item 13, D02, D13. **Código:** `tests/financeiro/run.mjs; tests/koper-finance/run.mjs; lib/workspace.ts; lib/finance-core/cashflow-server.ts`.

**Dependências:** T05/T42; Auth isolado e pipeline de todos os canais. Matriz nominal vigente só é necessária à implantação real.

**Conclusão objetiva:** 1.000/9.000 porUA/UB; UG1.000/3.000/4.000/9.000 nos perímetros; zero linhas estrangeiras, mutações indevidas e vazamentos, inclusive Auth/storage.

**Seleção:** Não selecionado: lacuna técnica transversal e infraestrutura Auth/storage indisponível; o guard do carregador testado emCT29 não homologa CT24.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT18 — Cobertura da previsão ao contrato ao título e encargo futuro

**Problema anterior:** Falta cadeia única persistida de100.000 P→60.000 C+40.000 P→título20.000→pagamento5.000 e AF2.000 constituído em20/11, retirando o mesmo AF sem repetir encargo.

**Causa / nível:** Sem vínculo persistido AF→encargo, futureCashRows mantém ambos; R17.000+C40.000+P40.000+AF2.000=99.000 contra97.000 esperado. RPC de versão anterior não admitia acréscimo documentado de AF.

**Regra:** §7.1, §7.2, I05, I10, I11, I12. **Código:** `lib/finance-core/cashflow.mjs; cashflow-server.ts; supabase/migrations/20261022110000_cashflow_versions.sql; nova20261024100000`.

**Dependências:** T26/T30; reutiliza ledger, cenários imutáveis e cobertura já existentes; nenhuma decisão financeira adicional para a fixture.

**Conclusão objetiva:** Mesma cadeia A–F persistida; Q100.000→95.000→97.000; AF2.000→0; uma constituição sob replay/concorrência, versões preservadas e isolamento.

**Seleção:** Selecionado: dupla contagem demonstrada e regra explícita (§7.1/§7.2).

**Estado:** Cadeia fictícia persistida e comparação independente conforme; aceite pendente. Aceite financeiro pendente.

## CT21 — Dados incompletos não se tornam zero ou total validado

**Problema anterior:** Falta obter composição idêntica de dashboard/exportação/IA no mesmo T/K e teste de exceção condicionada sem apagar lacunas; universo externo continua desconhecido.

**Causa / nível:** Função pura conserva null, mas a composição completa dashboard/exportação/IA e eventual exceção condicionada não foi demonstrada. Universo desconhecido é limitação explícita, não erro a zerar.

**Regra:** §7.2, §11, I12, I14, I15, I22. **Código:** `lib/finance-core/coverage.mjs; app/financeiro/relatorios/page.tsx; lib/elos-ia/tools.ts`.

**Dependências:** T38/T40/T41 e mapa R/C/P. D12 precisa definir exceções reais; a fixture já exige null, sem decisão nova para este comportamento.

**Conclusão objetiva:** MesmoT/K: R140.000, contrato840.000 separado; Q/EAC/desvio/cobertura null e status incompleto nos três canais; exceções só com decisão expressa.

**Seleção:** Não selecionado: depende da integração dos canais e de política de exceção ainda não documentada. Nada é liberado por presumir tolerância.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT29 — Disponibilidade restrições e financiamento contado uma vez

**Problema anterior:** Falta agenda persistida completa de financiamento com amortização20.000 já nos150.000, restrição documentada20.000 e limite70.000 não sacado, conferida no carregador/tela/IA no mesmo corte.

**Causa / nível:** Agenda persistida/tela/IA ausentes da prova anterior. Nesta execução, RLS oculta registros, mas carregador aceitava entidade negada e respondia visão vazia; IA não aceitava o mesmo filtro de entidade da tela.

**Regra:** §12.7, I20, I21, D04. **Código:** `lib/finance-core/cashflow-server.ts; lib/elos-ia/tools.ts; tests/cashflow/engine.test.mjs`.

**Dependências:** T39; abertura/restrição/agenda fictícias explícitas da fixture. Contrato/limite reais só para homologação real.

**Conclusão objetiva:** Disponível100.000; finais40.000/−30.000; necessidade50.000; amortização20.000 uma vez e limite70.000 fora do disponível; mesmo perímetro no carregador/tela/IA.

**Seleção:** Selecionado: risco direto de insuficiência de caixa e prova independente viável com componentes existentes.

**Estado:** Corrente conforme; original anterior ao vínculo permanece parcial. Aceite financeiro pendente.

## CT02 — Nova versão do mesmo título e preservação do corte histórico

**Problema anterior:** Falta unir a reimportação real, autorização do acréscimo e consultas persistidas dos três cortes T/K da fixture numa cadeia documental reproduzível.

**Causa / nível:** Evidências anteriores separavam reimportação e corte puro. Baseline adicional demonstra fallback para versão atual antes da primeira versão conhecida e comparação lexical incorreta de timestamps equivalentes.

**Regra:** §3, §4, §10, I03. **Código:** `lib/finance-core/ledger-position.mjs; finance_payable_at; elos_import.apply_financial_batch`.

**Dependências:** T07/T08/T10; coletor/importador/revisões existentes e relógio de teste controlado; suporte documental do acréscimo já é premissa da fixture.

**Conclusão objetiva:** Um título10.000→12.000; ponte2.000; T21/K20 continua10.000; replay não cria versão; SQL e aplicação concordam nos três cortes e antes da criação.

**Seleção:** Selecionado: risco de reapresentação histórica incorreta, sem depender de dados reais.

**Estado:** Cadeia fictícia persistida e comparação independente conforme; aceite pendente. Aceite financeiro pendente.

## CT03 — Pagamento parcial e conciliação posterior sem novo caixa

**Problema anterior:** Falta evento econômico persistido anterior e leitura de I01 antes/depois. O campo de custo adicional é null; não presumir zero por ausência de evento na fixture.

**Causa / nível:** Banco/ledger já comprovavam parcial; faltava fato econômico persistido e leitura de I01 antes/depois. Nenhum defeito operacional de custo foi presumido.

**Regra:** §5, §8.1, I02, I03. **Código:** `lib/cost-vs-budget/server.ts; native-measurement-titles.ts; tests/financial-acceptance/database.mjs`.

**Dependências:** T18/T19; medição/itens aprovados nativos, carregador de custo e banco já existentes.

**Conclusão objetiva:** Aberto7.000→5.000; duas saídas total5.000; conciliar/reimportar cria0 caixa e0 custo adicional, medição/competência anteriores preservadas.

**Seleção:** Selecionado: separação custo/caixa e parciais podem ser comprovadas sem reconstruir módulo.

**Estado:** Cadeia fictícia persistida e comparação independente conforme; aceite pendente. Aceite financeiro pendente.

## CT06 — Retenção contratual e tributo retido sem soma do documento pai

**Problema anterior:** Faltam pai econômico/documental único, geração nativa dos filhos/credores, cobertura C/Q, custo econômico e liberação condicionada da retenção. Campos C/Q/custo desconhecidos permanecem null.

**Causa / nível:** Três filhos manuais conservam100.000, mas pai econômico, geração nativa, credores e condição de liberação não foram encadeados. Não há reprodução de erro nativo que justifique reescrevê-lo.

**Regra:** §8.2, I03, I05, I08, I10, I12. **Código:** `supabase/migrations/20260803_0075_execution_contract_finance.sql; app/financeiro/notas-manuais`.

**Dependências:** T16/T21/T26; testar approve_execution_contract_measurement/notas nativas. D08 real (cláusulas, credores, alíquotas) permanece pendente; percentuais da fixture são apenas didáticos.

**Conclusão objetiva:** R100.000→15.000→10.000→0; H90.000→100.000; custo100.000; C0/Q100.000 inicialmente; sem somar pai e filhos nem liberar retenção sem condição.

**Seleção:** Lote posterior: dependência estrutural para CT28; exige prova nativa de pai/filhos antes de corrigir.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT28 — Cobertura integrada com adiantamento retenção e escopo descoberto

**Problema anterior:** Falta cenário conjunto persistido: crédito120.000/aplicação60.000, pagamento100.000, filhos fornecedor/tributo/retenção, escopo P200.000 e custo300.000. Conferir Q1.180.000 e EAC1.400.000; nenhum total conjunto foi presumido.

**Causa / nível:** Adiantamento, retenções e cobertura existem isoladamente; o conjunto do mesmo contrato/escopo não foi executado.

**Regra:** §7.1, §12.2, I05, I08, I09, I10, I11, I12, I13, I14. **Código:** `tests/finance-core/settlements.mjs; lib/finance-core/coverage.mjs; tests/financial-acceptance/database.mjs`.

**Dependências:** CT05/CT06; T20/T21/T26/T28/T30. Documentos reais apenas para adoção operacional, não para a fixture.

**Conclusão objetiva:** R140.000; H220.000; crédito60.000; C840.000; P200.000; Q1.180.000; ETC1.100.000; EAC1.400.000 em cadeia única.

**Seleção:** Não selecionar antes das dependências de pai/filhos/adiantamento.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT09 — Cancelamento documental e substituição de medição por nota

**Problema anterior:** Falta executar MED-01→NF-01→NF-02 com cancelamento exclusivamente documental, I04→I03, um único custo e representação ativa, mantendo todas as versões.

**Causa / nível:** Vínculo de cobertura puro passa; não há execução persistida MED01→NF01→NF02 que conserve a obrigação e um único custo.

**Regra:** §7.2, §8.3, I01, I03, I04, I05. **Código:** `lib/finance-core/coverage.mjs: nativeFinancialBindings; app/financeiro/notas-manuais/actions.ts`.

**Dependências:** T16/T22/T24; obrigação provisória e substituição documental nativas, sem extinguir escopo por cancelar NF.

**Conclusão objetiva:** Antes: I03=0/I04=8.000; depois I03=8.000/I04=0; R8.000; custo8.000; caixa0; uma representação financeira ativa e histórico completo.

**Seleção:** Lote posterior: depende do encadeamento econômico/provisório, não de alterar regra.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT22 — Adiantamento de cliente e entradas futuras sem abatimento global repetido

**Problema anterior:** Falta mapa automático exclusivo de contrato100.000/parcela40.000/antecipação20.000 para futuro60.000 e I18=80.000, e prova de ausência de receita econômica automática. Esses três resultados continuam null.

**Causa / nível:** Crédito recebido20.000/aplicação passam. Falta cobertura persistida automática contrato/parcela/antecipação para I18 e prova de que recebimento não reconhece receita.

**Regra:** §8.2, §8.5, I09, I16, I17, I18. **Código:** `lib/finance-core/cashflow.mjs; tests/financial-acceptance/database.mjs: CT22`.

**Dependências:** T20/T33/T34; mapa contratualAR. D09 real (desempenho/distratos/permutas) não altera o exemplo aprovado sem desempenho.

**Conclusão objetiva:** Caixa20.000; crédito20.000→0; AR20.000; futuro não titulado60.000; I18=80.000; caixa novo0; receita automática0.

**Seleção:** Lote posterior com modelo contratual de recebíveis e evidência econômica explícita.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT11 — Rateio monetário parcial e arredondamento conservativo

**Problema anterior:** Falta ledger persistido multiobra na mesma entidade, versão/aprovador, pagamento parcial e devolução por obra; não promover quarentena a rateio concluído. Consumidor puro não transporta project_id e exige conferir contexto completo.

**Causa / nível:** Maior resto e60/40 passam em funções; não há ledger multiobra/versão/aprovador e devolução por obra. Texto de centros concatenados não é rateio monetário.

**Regra:** §9, §12.5, I01, I02, I22. **Código:** `lib/forecast/cost-allocation.mjs; supabase/migrations/20261021140000_koper_financial_snapshots.sql`.

**Dependências:** T17 e persistência multiobra na mesma entidade; D05 operacional. A regra60/40/maior resto da fixture já é explícita e não precisa nova decisão.

**Conclusão objetiva:** Custo6.000/4.000; caixa1.800/1.200; aberto4.200/2.800;100,01→33,34/33,34/33,33; conservar soma, versão, autoria e devolução por obra.

**Seleção:** Lote posterior: não promover quarentena nem fabricar valores por centro a partir da fonte limitada.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT05 — Adiantamento antes da execução e aplicação sem segundo abatimento

**Problema anterior:** Faltam estados A–E com contrato/medição econômica aceita e ETC comprovado, vinculados ao mesmo escopo e extrato independente. Não obter custo da assinatura ou adiantamento.

**Causa / nível:** Pagamento/aplicação/reversão do crédito passam separados; custo/ETC e estadosA–E do mesmo contrato/medição não foram persistidos.

**Regra:** §7.1, §8.2, §12.1, I05, I09, I10, I12, I13. **Código:** `tests/finance-core/settlements.mjs: adiantamento_AP; lib/finance-core/coverage.mjs; lib/cost-vs-budget/server.ts`.

**Dependências:** T20/T26 e evento econômico aceito; regra fictícia já distingue adiantamento de execução.

**Conclusão objetiva:** Q100.000/100.000/80.000/80.000/60.000; custo0/0/0/40.000/40.000; aplicação cria0 caixa; conservarH/R/C/crédito em cada estado.

**Seleção:** Lote posterior, antes deCT28; reaproveitar crédito do ledger e medição nativa.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT27 — Estoque pago e consumo econômico sem nova previsão de caixa

**Problema anterior:** Faltam recebimento/estoque pago20.000 e consumo8.000 persistidos, conferindo estoque12.000, ETC12.000, EAC20.000, Q0 e zero novo caixa sem somar NF/recebimento/consumo.

**Causa / nível:** Ainda não há execução integral recebimento20.000/pagamento/consumo8.000 conferindo estoque, custo, ETC eQ.

**Regra:** §5, §7.1, I01, I10, I12, I13, I14. **Código:** `lib/cost-vs-budget/server.ts; lib/finance-core/coverage.mjs; app/execucao`.

**Dependências:** T22/T28; almoxarifado/consumo e ligação com preço pago. D03 real por natureza, sem mudar consumo já aprovado para a fixture.

**Conclusão objetiva:** Antes: estoque/ETC/EAC20.000 e custo/Q0; depois custo8.000, estoque/ETC12.000, EAC20.000, Q0, novo caixa0.

**Seleção:** Lote posterior: dependência do percurso de estoque, sem inferir custo de pagamento/NF.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT04 — Competência emissão vencimento caixa conciliação e limites de horizonte

**Problema anterior:** Falta encadear serviço aceito de setembro, emissão5/10, título/pagamento22 e confirmação24 em persistência/relatórios com relógio controlado; não confundir conciliação com novo caixa.

**Causa / nível:** Resultados puros de datas/horizontes corretos; falta cadeia econômica/documental persistida e consultas históricas dos canais.

**Regra:** §3, I01, I02, I06, I07. **Código:** `lib/finance-core/due.mjs; ledger-position.mjs; tests/cashflow/engine.test.mjs`.

**Dependências:** T07/T30; reaproveitar aceite econômicoCT03 e correção temporalCT02, sem dizer que já cobrem CT04.

**Conclusão objetiva:** Custo setembro10.000; aberto/vencido em21/10=10.000; caixa21=0/22=10.000/novo24=0; faixasR28.000, vencido1.000, hoje2.000,30d3.000,90d12.000, além6.000, semdata7.000.

**Seleção:** Lote posterior: depende de amarrar competências, emissão e conferência com relógios próprios.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT20 — Correção de período fechado com duas posições reproduzíveis

**Problema anterior:** Faltam fechamento econômico setembro500.000, retificação aprovada30.000 e consultas T30/09 em K original/reapresentado530.000, com ponte e banco outubro30.000. Versão de caixa não substitui fechamento econômico.

**Causa / nível:** Bloqueio bancário/reimportação fechada não constitui fechamento econômico e retificação gerencial de setembro.

**Regra:** §3, §10, I01, I02, D11. **Código:** `supabase/migrations/20261021120000_financial_foundation_guards.sql; lib/finance-core/ledger-position.mjs`.

**Dependências:** T37 e versões econômicas. D11 operacional: responsável, materialidade, alçadas, vigência. A fixture já presume aprovação gerencial em16/10.

**Conclusão objetiva:** Original setembro500.000 preservado; reapresentado530.000; ponte30.000; custo novo outubro0; banco outubro30.000; mutações original0.

**Seleção:** Não criar política de escrituração nem aprovação fictícia para dados reais. Novo lote após desenho da retificação econômica.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.

## CT19 — Aditivo aprovado e previsão de estouro sem residual artificial

**Problema anterior:** Falta rastrear aprovação/vigência do aditivo50.000 e reestimativa350.000 até orçamento original/vigente persistidos, conferindo cenário de risco40.000. Não afirmar Q sem histórico de pagamentos.

**Causa / nível:** Aditivo e reestimativa passam no cálculo puro; falta trilha de aprovação/vigência/orçamento/risco na persistência.

**Regra:** §8.4, §12.6, I01, I13, I14, I15. **Código:** `lib/finance-core/coverage.mjs: economicEstimate; lib/forecast/server.ts`.

**Dependências:** T25/T27/T28; revisão orçamentária e aditivo aprovados. D10 real: validadeRev03/EAP/preços/responsável, sem usar orçamento como residual deETC.

**Conclusão objetiva:** Contrato550.000; incorrido450.000; ETC800.000; EAC1.250.000; desvio250.000/25%; proposta40.000 acrescenta0 ao firme e cenário1.290.000.

**Seleção:** Lote posterior de orçamento/contratos; não afirmarQ sem mapa financeiro.

**Estado:** Parcial — pendência técnica mantida. Aceite financeiro pendente.
