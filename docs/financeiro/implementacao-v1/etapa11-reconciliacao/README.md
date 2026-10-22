# Etapa 11 — Reconciliação F011 × F007

**A divergência foi localizada, mas a causa financeira não pode ser concluída com as fontes disponíveis.** Os 3.261 IDs/parcelas têm os mesmos valores, vencimentos e datas de pagamento informadas nas duas fontes. A soma das linhas do próprio PDF F007 é **R$ 13.710.826,32**, igual à F011. Os **R$ 149.589,33** estão entre as linhas e o resumo do PDF, integralmente na comparação com o campo **“Valor pago”**. Nenhum registro divergente de valor foi encontrado para compor esse residual.

Isso comprova a localização documental da diferença; **não comprova erro da fórmula do Koper, pagamento faltante, desconto, duplicidade ou qual total financeiro está correto**. A ponte econômica por componente continua aberta. Não houve correção, migração, conexão financeira remota, escrita no Koper ou alteração de produção.

Branch `audit/financeiro-etapa11-f011-f007`, base `9c5d016` da Etapa10. Todos os commits informados das Etapas5–8, a Etapa9 (`6354e59`) e a correção CT10 (`282436d`) são ancestrais da base. Somente documentos, evidências e ferramentas offline desta pasta foram adicionados. O [manifesto](evidencias/manifesto-entrega.json) registra ambiente, hashes, comandos e preservação.

## 1. Fontes acessadas e limites

| Fonte | Localização e origem | Empresa / obra | Período, corte e extração |
|---|---|---|---|
| F007 | `Base_Conferencia_Elos_OS/01_originais/obrigacoes/F007/Contas a pagar (20).pdf`, 165 páginas; relatório **Contas a Pagar**, gerado por KOPER | A imagem contém logotipo **Bossa / Flow Aptos**. O catálogo dizia “não identificado” porque essa identidade não aparece no texto extraído. Logotipo não comprova CNPJ responsável nem filtro jurídico/obra de cada registro | Checkbox **DATA VENCIMENTO** marcado; **DATA PAGAMENTO** desmarcado. Faixa01/10/2020–22/07/2026. Rodapés22/07/2026 10:00:47, sem fuso explícito. Metadata PDF: criação22/07/2026 13:00:46 UTC. O término da faixa e a emissão do relatório não estabelecem T contábil ou competência |
| F011 | `01_originais/obrigacoes/F011/Koper_Contas_a_Pagar_Flow_Apropriacoes_Comissoes_Mao_de_Obra_e_OS.xlsx`; aba `Titulos_Koper`, cabeçalhoA4:W4, linhas5–3265 | A1 declara **Flow Aptos / Bossa**; CNPJ/entidade legal ausentes. Centros da colunaL e serviços daT não comprovam titular jurídico | Vencimentos observados15/11/2023–22/07/2026; pagamentos informados08/11/2023–20/07/2026. Corte e extração não declarados. Catálogo: entrada19/08/2026, modificação20/08/2026 UTC. Metadados internos do XLSX:22/10/2026; não usá-los como data da extração |

A raiz local é `/workspace/financial-source-base/Base_Conferencia_Elos_OS`. Ambos os originais foram reabertos em leitura, conferidos com o catálogo e com os bytes no ZIP anexado. Hashes:

- F007: `005ab0a4acc825b38b97feea92950c779d9cb44c2cde6eb524820868b16f072b`.
- F011: `141d3fb0b3931e050e3865c6d69948d1d999111a5991166b9490a8ad0a3fb686`.
- Regras v0.1: `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`, DOCX em `/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/` e referência preservada em `t01-t02/referencias/`. Esta é a versão normativa solicitada, sem alterações.

Também foram consultados: catálogo CSV e texto, controles de linhas, texto preservado F007, ZIP da base; relatório/ponte/divergências/matriz de30 da Etapa9; relatório, matriz e quadro da Etapa10; regras v0.1 e cartão T11 do pacote; handoff Koper e inventário anteriores; mapa de API, coletor e testes existentes do repositório. Os CSVs derivados e controles históricos não foram usados como substitutos da leitura dos originais.

A base acessível é documental local. O runtime não oferece capacidades/credenciais financeiras configuradas; a política de rede foi observada como `restricted`, aplicação `unknown`. Não se tentou usar produção, navegador autenticado, banco compartilhado ou Koper remoto. A indisponibilidade principal é **o snapshot transacional histórico e a consulta que gerou o PDF**, não uma falha de execução dos módulos atuais.

## 2. Relatórios, consultas e critérios efetivamente encontrados

F007 mostra contas **Todas**, centro de custo **Todos**, pesquisa **“-”**, filtro por vencimento e3.261 registros. A coluna `Valor.` não se define como principal, bruto ou líquido. Não mostra eventos individuais, componentes por título, status de cancelamento/estorno ou valor de cada pagamento. Uma data na coluna Pagamento não comprova quitação integral nem movimento bancário conciliado. Os critérios internos de exclusão de cancelados, recorrências, agrupamentos e parciais não constam no PDF.

F011 preserva os mesmos valores exibidos, IDs e datas, com enriquecimento de fornecedor/centros. `Resumo_Centros!C5` contém o subtotal estruturado; as fórmulas `SUMIF` dos resumos usam `Titulos_Koper!E5:E3265`. A pequena representação binária interna deC5 (`13710826.320000025`) não muda o total em centavos nem explica149.589,33. `Leitura!B3/B12:B15` descreve os vínculos Compras/NFe/OS e centros concatenados. O transformador original não foi encontrado; o comportamento dos campos foi confrontado nos arquivos, sem inferir a regra a partir do nome das colunas.

Nas3.255 linhas `Pago`, a colunaI (`Valor Pago`) é exatamente igual àE (`Valor`) e há uma única dataH. Nas6 `Aberto`, I está ausente, não zero. Não há emissão, competência, conciliação, cancelamento, estorno nem decomposição de parciais. Não é possível reconstruir esses eventos a partir desta planilha.

O [mapa da API](../../../../services/koper-worker/docs/koper-api-map.md) documenta `GET /financial/v1/bills_to_pay`, filtros `allBills`, `initialDate`, `finalDate`, `limit`, `offset`, `orderby`, `typeDate`, totais `billsAmount/totalPaid/totalNotPaid/totalDiscount/totalInterest` e campos `billValue/paymentValue/discountValue/interestValue/lateFeeValue/otherAccruals`, pais/agrupamentos e recorrência. Há também rota de eventos por ID. **Essa documentação não prova quais requisições ou fórmulas produziram F007 em julho.** Código SQL/HTML do relatório Koper, respostas brutas históricas e manifesto da transformação F011 não estão disponíveis.

O [coletor da Etapa6](../../../../lib/koper-finance/collection.mjs) já separa principal e baixa declarada, conserva valores desconhecidos e impede certificação diante de total/paginação divergentes. Não foi demonstrado defeito nele por esta investigação. [Núcleo financeiro](../../../../lib/finance-core/titles.mjs), [posição por eventos/corte](../../../../lib/finance-core/ledger-position.mjs) e [caixa](../../../../lib/finance-core/cashflow.mjs) foram preservados. Estes arquivos não geraram os artefatos históricos F007/F011.

## 3. Confronto por registro

[Planilha de reconciliação](evidencias/Reconciliacao_F011_F007.xlsx) · [CSV](evidencias/reconciliacao-por-registro.csv) · [JSON com null explícito](evidencias/registros.json) · [Controle das165 páginas](evidencias/controle-paginas.csv).

Cada linha contém ID, parcela, documento de cada fonte, página/linha de texto/hash do bloco PDF, aba/linha XLSX, valores em **centavos inteiros**, vencimentos, pagamento informado e classificação. Vazio em CSV/XLSX significa desconhecido; JSON conserva `null`. Não foram publicados nomes de fornecedores nem identificadores bancários.

| Verificação no par de arquivos | Resultado |
|---|---:|
| IDs únicos / chaves ID+parcela em cada fonte |3.261 /3.261 |
| Somente F011 / somente F007 |0 /0 |
| Mesma chave com valor diferente |0 |
| Duplicidades de chave ou ID dentro de cada fonte |0 |
| Vencimento diferente / pagamento informado diferente |0 /0 |
| Referência documental igual, normalizados apenas espaços |2.537 |
| F011 usa `KOPER <ID>` onde F007 apresenta `-` |724; R$2.582.164,72 em valores exibidos |
| Total de causa financeira alocada documentalmente a IDs |Nenhuma; o residual não foi distribuído |

Essas724 referências são substitutos de documento ausente; não são724 novas notas, contratos ou erros financeiros comprovados. Exemplo: ID67, parcela1/1, R$200,21; PDFp1 mostra documento“-”, F011linha16 usa“KOPER67”. A planilha identifica cada ocorrência. Vínculos com fornecedor, contrato, NFe, entidade e obra não podem ser homologados só pela identidade de ID neste par. A chave de produção continua exigindo organização/origem/tipo/ID e parcela quando aplicável (§4).

Dois métodos independentes concordaram em todas as linhas: Poppler (`pdftotext -layout`) por blocos e PyMuPDF por coordenadas das colunas. Os165 rodapés são sequenciais e os3.261 registros foram extraídos integralmente; isso comprova cobertura **deste PDF**, não da carteira completa da empresa. O texto reextraído é byte a byte igual ao TXT preservado. O [cabeçalho renderizado](evidencias/F007-cabecalho.png) foi inspecionado visualmente. Não foi detectada divergência de período entre as linhas pareadas; divergência jurídica/de obra não é verificável sem identidades de origem.

## 4. Ponte matemática sem ajustes

| Composição observada | Linhas F007 / F011 | Cabeçalho F007 | Diferença |
|---|---:|---:|---:|
|3.255 linhas com data de pagamento; F011 as rotula Pago |R$13.687.213,70 |“Valor pago”: R$13.537.624,37 |**R$149.589,33** |
|6 linhas sem data de pagamento; F011 as rotula Aberto |R$23.612,62 |“Valor não pago”: R$23.612,62 |R$0,00 |
|Total |**R$13.710.826,32** |**R$13.561.236,99** |**R$149.589,33** |

`F011 − cabeçalho F007 = (F011 − linhas F007) + (linhas F007 − cabeçalho F007)`

`149.589,33 = 0,00 + [(13.687.213,70 − 13.537.624,37) + (23.612,62 − 23.612,62)]`.

Todos os termos são observados nas fontes; não há lançamento de ajuste. A equação **localiza** a diferença no resumo pago. **Não a explica por evento/componente financeiro.** Residual econômico ainda sem causa/alocação: **R$149.589,33**; resultado financeiro correto: **desconhecido**.

As seis linhas sem pagamento são:13701/1 de3, R$7.500,00, p164/XLSX3255;14981/5 de5, R$9.664,22, p165/3261;15374/1 de4, R$3.118,40, p165/3262;15377/1 de1, R$3.030,41, p165/3263;15378/1 de1, R$100,00, p165/3264;15379/1 de1, R$199,59, p165/3265. A primeira contém `PREVISAO JFM26`: a coincidência do subtotal não certifica a natureza jurídica das obrigações.

O cabeçalho informa descontosR$13.325,34 e juros/multaR$1.325,28. **Se** todos pertencessem às mesmas linhas e `Valor.` fosse principal, a hipótese simples bruto/líquido seria `13.710.826,32 − 13.325,34 + 1.325,28 = 13.698.826,26`, ainda **R$137.589,27** acima do cabeçalho. Portanto, esses dois totais não explicam sozinhos149.589,33. Não foram alocados aos títulos nem reconhecidos como causa parcial comprovada. Recorrentes consolidadasR$1.704.347,23 não foram somadas ou excluídas: a relação com as linhas não está documentada.

Por centro declarado em F011:1.630 linhas “Flow Aptos” somamR$6.307.935,75;162 “Flow Aptos - Bossa”, R$661.179,31;1.469 “Não identificado no relatório de fluxo”, R$6.741.711,26. TotalR$13.710.826,32, sem redistribuir os não identificados. F007 não traz o centro por linha; não há ponte jurídica/obra homologada nem corte bancário comum.

## 5. Causa raiz: nível de comprovação e indicadores

| Achado / hipótese | Nível de comprovação | Consequência e menor ação |
|---|---|---|
| F011 soma os valores exibidos corretamente e os reproduz do PDF |Comprovado documentalmente; sem erro de conversão monetária neste par |Reaproveitar linhas, IDs, referências e controle de páginas; nenhuma correção do valor nominal demonstrada |
| Resumo F007 difere de suas próprias linhas no grupo com pagamento informado |Comprovado aritmeticamente; sem causa financeira ou fórmula conhecida |Manter exceção e obter componentes/consulta históricos; não substituir automaticamente o cabeçalho pela soma |
| Cabeçalho pode medir baixa líquida, e a colunaValor, valor nominal |Diferença conceitual possível e legítima **se documentada**; não comprovada neste caso |Confrontar `billValue`, `paymentValue`, descontos, encargos e eventos no mesmoT/K |
| Parciais, compensações, estornos, recorrências/pais ou filtros internos explicariam o residual |Hipóteses, sem alocação por ID |Exigir registros/vínculos antes de propor correção. Não selecionar subconjunto cuja soma coincida por acaso |
| Erro de fórmula/agregação do Koper ou de classificação no destino |Não demonstrado |Não alterar Elos, Koper ou banco; primeiro reproduzir com payload histórico e indicador definido |
| Referências sintéticas/ausência de empresa, obra, eventos e corte |Limitação comprovada da evidência |Preservar pendências explícitas; não transformar desconhecido em zero, NF ou obra padrão |

Pelas regras v0.1 (§§2–6/11, I01/I02/I03/I22), principal nominal, obrigação aberta, custo, baixa ERP e caixa confirmado são medidas distintas. O total da colunaValor não é automaticamente I03; inclui linhas declaradas pagas e PREVIS. “Valor pago” não é automaticamente I02 sem extrato/conciliação. Nenhuma das fontes comprova I01, pois competência/execução não constam. **Não há base para declarar que F011 ou F007 representa o indicador correto nem para publicar um novo saldo financeiro.** O único resultado certo reconstruído é a soma dos valores **exibidos**, R$13.710.826,32.

Não foram comprovados erros de implementação que autorizem correção nesta etapa. Diferenças conceituais permanecem hipóteses para este conjunto, não explicações aceitas. Tampouco houve prova de duplicidade, vinculação indevida, título extra ou diferença de datas capaz de gerar o montante no par examinado. O caso16032 e os26 extras/R$209.126,91 de outro diagnóstico não foram usados como explicação.

## 6. Dados exatos que faltam e proposta condicionada

1. **Snapshot histórico Koper que gerou F007**, em22/07/2026 10:00:47, com requisições completas, parâmetros `typeDate/allBills/initialDate/finalDate`, empresa/entidade/obra, paginação, filtros implícitos e versão do relatório. Uma consulta atual não reproduz automaticamente esse K histórico.
2. Para cada um dos3.261 IDs/parcelas: `billToPayId/billId/fatherBillId/joinBillId`, `billValue/paymentValue`, desconto, juros, multa, outros componentes, `isPaid/splitted/hasRecurrence`, cancelamentos/estornos/eventos e seus vínculos/datas. Também os agregados brutos e a **fórmula/consulta/HTML original** que alimentou o cabeçalho. Isso permite decidir se ele totaliza outro conceito, universo ou contém erro.
3. **Transformador/manifesto F011 original**, fontes deStatus/ValorPago, datas de extração e regras dos vínculos. O XLSX acessível comprova valores armazenados, não a execução histórica da transformação.
4. Se a intenção for validar caixa: extratos integrais, titularidade, movimentos, abertura e alocações/compensações; se for custo: execução/competência; se for obrigação aberta: documentos válidos e todos os eventos no corte. Esses documentos não são substituíveis pelo resumo Pago.
5. Snapshot do destino Elos no mesmoT/K e vínculos externos para apurar eventual impacto no sistema; responsável financeiro e aceite nominal do conceito e da ponte.

**Proposta mínima neste momento:** nenhuma correção de cálculo ou dados. Solicitar/exportar essas evidências em leitura, idealmente mascaradas, sem modificar Koper/produção; completar a coluna de componentes por ID e o residual. Se a diferença for conceitual, explicitar definição e composição na apresentação, preservando ambas as medidas. Se for erro de agregação, corrigir somente a consulta/componente demonstrado e testar o mesmo snapshot contra oráculos fixos. Se for transformação indevida de baixa, separar nominal/baixa/eventos no adaptador correspondente, sem apagar a fonte. Qualquer implementação depende da prova e da aprovação posterior solicitada pelo usuário.

## 7. Testes, quadro e aceite

[Casos e resultados esperados independentes](CASOS-DE-TESTE.md). Executados localmente: **12/12** testes do diagnóstico, **28/28** testes existentes de coleta/dinheiro/componentes/caixa, **81/81** regressões do comando preservado da Etapa10 e **142/142** da suíte geral `npm test`. Logs em `evidencias/`. As regressões que usam banco criam PGlite em memória com massa fictícia, sem conexão financeira externa. Nenhum teste calcula expected pelo algoritmo Elos; os oráculos documentais são constantes dos originais, e os testes existentes conservam seus oráculos. Os12 testes verificam o método e as limitações da reconciliação, não homologam o saldo real.

Não houve nova execução dos25 controlesDB da Etapa5,24 daEtapa6 ou dos30 cenários integrais: não houve mudança de aplicação/esquema, e esses conjuntos exigem os scaffolds isolados próprios. Seus arquivos, evidências e estados anteriores permanecem intactos; os81 testes e28 verificações puras foram executados novamente, sem conexão externa. CT10 corrigido naEtapa10 continua preservado, sem reclassificar os demais casos.

[Quadro atualizado](Elos_OS_Quadro_Etapa11_Reconciliacao.xlsx): acrescentada abaEtapa11 e somente8 células de evidências/notas em T11/T38/T44/T45. Estados, dependências, fórmulas, expected,30 casos e aceites anteriores foram preservados ([verificação](evidencias/verificacao-quadro.json)). T11 continua **Em validação**, T44 **Em andamento**, T45 **Bloqueada**. A inspeção documental está pronta para revisão; a causa financeira e a homologação do indicador **não estão prontas para aceite conclusivo**. Não foi registrado aceite em nome do financeiro.

Critérios cumpridos: fontes/hashes preservados; reconstrução exaustiva de valores exibidos; confronto por ID/parcela/datas/documentos; ponte aritmética rastreável; hipóteses separadas de fatos; testes e quadro. Critérios pendentes: composição causal dos149.589,33, titularidade/corte comum, indicador correto, impacto no destino e aceite financeiro. A entrega encerra aqui para análise/aprovação; não autoriza nem inicia correções ou outra etapa.
