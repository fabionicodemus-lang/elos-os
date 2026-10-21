# Casos aprovados e cobertura desta rodada

As 30 definições foram copiadas byte a byte do pacote v1.0, carregadas em `validation.cases` e conferidas por hash. A norma permanece v0.1, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. Os demais arquivos do pacote continuam na entrega anterior/entrada original; o manifesto copiado conserva as referências, sem sugerir que todos foram copiados para fixtures.

| Caso | Cenário | Execução / resultado |
| --- | --- | --- |
| CT01 | Importação repetida e arquivos de cobertura parcial | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT02 | Nova versão do mesmo título e preservação do corte histórico | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT03 | Pagamento parcial e conciliação posterior sem novo caixa | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT04 | Competência emissão vencimento caixa conciliação e limites de horizonte | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT05 | Adiantamento antes da execução e aplicação sem segundo abatimento | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT06 | Retenção contratual e tributo retido sem soma do documento pai | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT07 | Parciais juros e desconto com componentes separados | Parcial: primeiro pagamento executado na RPC real. Esperado aberto 6.000.000 centavos, obtido 0; falha confirmada. Restante depende de componentes/T18. |
| CT08 | Estorno de liquidação e devolução bancária são eventos distintos | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT09 | Cancelamento documental e substituição de medição por nota | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT10 | Cancelamento econômico após pagamento e restituição parcial | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT11 | Rateio monetário parcial e arredondamento conservativo | Parcial: rateio/resíduo determinístico e 60/40 passam nos componentes; ciclo de saldos/liquidação por obra não certificado. |
| CT12 | Título sem obra preservado no total da entidade | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT13 | Recebimento atrasado parcial e inadimplência da coorte | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT14 | Recebimento líquido com tarifa e permuta sem caixa fictício | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT15 | Transferência própria com tarifa e ponta em trânsito | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT16 | Mútuo entre entidades e eliminação apenas no consolidado autorizado | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT17 | Reprogramação de previsão sem reescrever execução ou vencimento | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT18 | Cobertura da previsão ao contrato ao título e encargo futuro | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT19 | Aditivo aprovado e previsão de estouro sem residual artificial | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT20 | Correção de período fechado com duas posições reproduzíveis | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT21 | Dados incompletos não se tornam zero ou total validado | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT22 | Adiantamento de cliente e entradas futuras sem abatimento global repetido | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT23 | Pagamento agrupado em vários títulos e múltiplas liquidações | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT24 | Isolamento entre organizações e autorização entre empresas | Parcial: testes de organização/perfil/entidade/RPC no PostgreSQL passam; superfícies HTTP/cache/export/IA/Storage real não executadas. |
| CT25 | Recorrência mensal substituída pelo título da mesma ocorrência | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT26 | Paginação completa e falha no meio da extração | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT27 | Estoque pago e consumo econômico sem nova previsão de caixa | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT28 | Cobertura integrada com adiantamento retenção e escopo descoberto | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT29 | Disponibilidade restrições e financiamento contado uma vez | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |
| CT30 | Liquidação excedente identificada como crédito | Não executado. Definição/expected carregados; eventos do caso dependem do adaptador/cartão correspondente. |

O comparador original trata `parcial` como não executado integralmente: 0/30 certificados, código 1. Isso é intencional e distinto do controle positivo da infraestrutura. O runner só calcula `actual` a partir de operações/fontes de teste; expected não é recalculado pelo algoritmo produtivo. O teste do comparador envia uma saída propositalmente errada em um centavo e verifica sua rejeição.

Evidências: `evidencias/casos-iniciais.json`, `comparacao-casos.json`, `fundacao-final.log` e os dois relatórios de banco. Os testes unitários de rateio não equivalem a executar toda CT11, e RLS não equivale a E2E de CT24.
