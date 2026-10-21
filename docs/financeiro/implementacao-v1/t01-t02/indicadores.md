# A — Localização dos indicadores normativos

Nomes atuais não significam equivalência ao indicador v0.1. Consultar os caminhos do [inventário](inventario.md).

| Indicador | Implementação/fonte encontrada | Limite frente à norma |
| --- | --- | --- |
| I01 | loadCostVsBudget: consumo de estoque, medições e notas diretas | D03/T/K não certificados |
| I02 | payables.paid_amount no fluxo; movimentos e reconciliation_links no banco | Baixa não comprova desembolso conciliado |
| I03 | payables_summary.open_amount / summarizePayables | Sem saldo por componentes e eventos parciais completos |
| I04 | Medições approved sem payable no loader de contratos | Camada contábil provisória não certificada |
| I05 | Motor junta títulos abertos e compromissos | R normativo exclusivo ainda não certificado |
| I06 | due_date < hoje em telas, RPC e IA | Fusos/corte e saldo histórico precisam D02 |
| I07 | IA next7/next30 inclui hoje; dashboard horizonte 9m | Separação hoje/30/90 normativa não demonstrada |
| I08 | retainedBalance + campos das medições | Liberação, titular/tributo e saldo separado não certificados |
| I09 | advance_deduction_amount | Campo de dedução não é prova de saldo/aplicação do adiantamento |
| I10 | loadProjectForecast: contrato − medição + residual aprovado | P07: vínculo por nota sem medição não consumido |
| I11 | engine: max(0, orçamento−pago−comprometido) | É resíduo orçamentário, não reestimativa independente aprovada |
| I12 | Fluxo: títulos abertos + engineeringProjected | Não publicar Q completo sem mapa financeiro/AF/D04 |
| I13 | Saldo futuro distribuído por cronograma/modo fixo/parcelas | Mapa econômico ETC independente não certificado |
| I14 | engine.projectedCost e calculateDevelopmentResult | Base mistura dimensões atuais; não é aceite de EAC normativo |
| I15 | engine.deviation e dashboard CPI | Orçamento depende D10; dashboard denomina custo com pagamentos |
| I16 | receivables_summary.open_amount / summarizeReceivables | P09: parcial encerra título |
| I17 | paid_amount no fluxo; transações credit no banco | Tarifa líquida/permuta e confirmação não certificadas |
| I18 | Carteira receivables aberta e vendas no resultado | Cobertura contratual futura sem parcela não certificada |
| I19 | Relatórios/IA: vencido ÷ carteira aberta | Diverge do denominador de principal exigível da mesma coorte |
| I20 | finance_bank_account_balance: opening_balance + movimentos | Disponibilidade/restrições e extrato completo não verificados |
| I21 | Dashboard/fluxo/summaries acumulam títulos; resultado caixa=recebido−pago | Não inclui disponibilidade inicial/caixa mínimo aprovado integralmente |
| I22 | Staging hashes/processing_status; warnings/errors do forecast | Sem contrato comum por indicador; P03 e limites de 10 mil |
