# Etapa 9 — Homologação financeira independente

**Resultado: homologação completa não concedida.** CT10 foi executado e reprovado; a conservação do dinheiro passa, mas o direito de restituição não é representado corretamente. CT13 e CT14 tiveram suas lacunas numéricas resolvidas no perímetro isolado. Os outros16 dos18 parciais continuam com pendências específicas. Nenhum aceite financeiro foi registrado.

Branch `test/financeiro-etapa9-homologacao`, derivada de `feat/financeiro-etapa8-fluxo` em `c72ec54`; ancestrais `6ec4f47`, `5e18d7f`, `3daa96e`, `95d659e` e `494c55c` conferidos. Commit de testes `a7a2b13`. **Nenhum módulo operacional, migration, expected ou registro de auditoria anterior foi alterado.** As mudanças são sondas de teste, documentos, evidências e uma cópia atualizada do quadro.

## Matriz e resultado dos casos

| Perímetro da evidência | Casos / resultado |
|---|---|
| Conformes no cenário isolado com extrato novo independente | CT13, CT14 e CT23 |
| Conformidade técnica herdada, sem promover a conciliação independente | CT01, CT07, CT08, CT12, CT15, CT16, CT17, CT25, CT26 e CT30 |
| Parciais | CT02, CT03, CT04, CT05, CT06, CT09, CT11, CT18, CT19, CT20, CT21, CT22, CT24, CT27, CT28 e CT29 |
| Reprovado | CT10 |

São **13 casos com cobertura integral no perímetro técnico declarado,16 parciais e1 reprovado**. O comparador numérico passa20/30 porque outros7 casos parciais têm todos os números de função pura corretos (CT02/04/11/18/19/21/29). Isso não comprova sua persistência, documentos ou canais. Quatro saídas têm diferenças/falta de prova (CT03/06/10/22); seis não têm adaptador integral executado (CT05/09/20/24/27/28), embora possuam controles parciais. Essa distinção não apaga resultados anteriores nem transforma falta de teste em bug comprovado.

[Matriz dos30, esperado/obtido campo a campo](MATRIZ-30.md) e [JSON com entrada, premissas, passos, regra e resultados](evidencias/matriz-30.json). [Investigação individual dos18 parciais](PARCIAIS-18.md). Expected lido exclusivamente da fixture aprovada da Etapa4, conferida contra seu manifesto; nunca recalculado pelo Elos. CT23 foi refeito com títulos8.000/12.000 e alocações4.000/6.000, corrigindo a evidência anterior que usava entradas diferentes e chegava aos mesmos saldos.

## CT10 e divergências prioritárias

Após adiantamento10.000 e cancelamento do escopo, a RPC contratual altera status/auditoria, mas não converte o crédito em direito de restituição10.000. Testar a alternativa de estorno com devolução6.000 conserva saída bruta10.000, devolução6.000 e líquido4.000, porém reabre AP10.000. O direito remanescente4.000 não tem representação validada. Não se substituiu esse desconhecido por zero, nem o estorno por um cancelamento econômico fictício.

[Execução e correção mínima proposta do CT10](CT10.md). Não foi implementada uma nova regra durante a homologação: a próxima correção deve reaproveitar ledger/bancos/auditoria e criar evento vinculado de conversão/liquidação do direito, preservando a saída original e impedindo reabertura indevida do AP. [Divergências por indicador/documento, impacto, causa e ação](DIVERGENCIAS.md).

Também foi reproduzida nos originais a diferença histórica **R$149.589,33** entre F011 (R$13.710.826,32) e F007/PDF20 (R$13.561.236,99), ambos com3.261 registros. A causa continua não demonstrada; nenhum ajuste foi criado para eliminá-la. O relato dos26 títulos/R$209.126,91 e do16032 permanece sem confronto operacional atual.

## Ponte e independência das fontes

[Ponte por fonte/empresa/obra/corte](PONTE-FINANCEIRA.md), [documentos e eventos](evidencias/ponte.json) e [extratos fictícios de referência](evidencias/extratos-referencia.json). São9 posições, em21/10 e22/10 conforme o evento, com contas/obras separadas; diferenças banco/ledger zeradas no perímetro enumerado. Cada documento guarda seus IDs de título, evento, movimento e escopo. O banco é confrontado com entradas fixadas pela fixture, não com extrato gerado dos movimentos do Elos.

O saldo auxiliar1.000.000 por conta sustenta a execução, não integra os expected nem comprova abertura externa. Por isso o saldo confirmado permanece null. Nenhuma ponte econômica ou posição real foi certificada. Em CT10, a ponte aritmética fecha e o tratamento econômico continua reprovado.

Os27 originais históricos foram acessados e seus hashes conferidos; F011–F016 foram reabertos sem somar fotografias da mesma população. [Identidade declarada, cortes e limitações por fonte](evidencias/fontes-historicas.json). Fonte sem titular/corte validado não recebe identidade presumida pelo nome da obra. Baixa ERP permanece declaração; extrato/contratos completos e snapshot atual pareado estão ausentes.

## Ambiente e testes

PostgreSQL17 com imagem fixada por digest, Docker local28.4.0, `--network none`, sem portas publicadas; containers removidos. Infraestrutura existente reaproveitada. A fixture usa scaffolds parciais explicitados em `tests/cashflow/setup.mjs`; CT10 adiciona apenas suporte ao cancelamento contratual original. Não comprova equivalência integral com o esquema remoto. Papéis SQL e carregador/SSR não substituem Auth/navegador reais.

| Verificação repetida | Resultado |
|---|---|
| Fundação Etapa5, incluindo backup/restauração isolados |25/25 |
| Integração Etapa6 |24/24 |
| Ledger Etapa7, inclusive CT07/parciais/excesso/estorno/concorrência |16/16 |
| Componentes e SSR Etapa7 |12/12 +1/1 |
| Componentes/banco/carregador-SSR Etapa8 |8/8 +8/8 +4/4 |
| Regressões anteriores |81/81 |
| Novas sondas de banco Etapa9 |7 executadas com sucesso de observação; não são7 aceites financeiros |
| Comparador independente novo | CT13/14/23 passam; CT03/06/10/22 mantêm diferenças ou desconhecidos |
| Componentes adicionais CT02/11 |2/2, sem promover persistência integral |
| TypeScript e lint operacional repetidos; lint dos novos testes | saída0 |

`node tests/financial-acceptance/validate.mjs --reuse-stage8` terminou com **código1**, intencionalmente reportando homologação incompleta/reprovada no comparador; as execuções técnicas terminaram sem erro. A opção reutilizou a reexecução integral feita nesta mesma branch, registrada em `evidencias/reexecucao/execucoes.json`, sem afirmar nova execução. Comandos/logs completos em [COMANDOS.md](COMANDOS.md) e [execucoes.json](evidencias/execucoes.json). O verificador final confere hashes, expected, planilha, ancestrais e preservação das fontes/artefatos anteriores.

## Quadro, aceites e condições para confiabilidade

[Quadro atualizado](Elos_OS_Quadro_Etapa9_Homologacao.xlsx), com nova aba `Etapa9_Confronto`, resultados novos de CT13/14/23 e pendências T24/T33/T44/T45. Valores esperados, fórmulas, dependências e campos de aceite preservados. Nenhuma tarefa foi marcada concluída por existir relatório. Caches de fórmulas não foram recalculados pelo openpyxl.

**Prontos para submissão ao responsável:** recortes isolados de recebimentos/encargos/coorte CT13 (T32/T34), tarifa/permuta CT14 (T32/T33) e liquidações agrupadas exatas CT23 (T18/T19/T32). São recortes, não aceite integral dessas tarefas: T32 ainda inclui CT03, e T33 depende de CT10/21/22. Demais capacidades aprovadas tecnicamente permanecem reutilizáveis. Nenhuma nova tarefa financeira integral foi certificada; ponte real/assinatura e aceites globais continuam pendentes.

Antes de considerar o financeiro confiável: corrigir/testar CT10; completar os16 parciais; obter abertura/extratos contínuos, contratos/itens/aditivos/execução e snapshots pareados T/K; resolver ou manter explicitamente a divergência histórica; validar dimensões de rateio, retenções, cortes históricos e todos os canais de acesso. Nome, data, vigência e alcance real de D01–D14/aceites não foram inventados. A referência normativa é preservada conforme a autorização do usuário; o documento original ainda ressalva a aprovação nominal dos parâmetros operacionais.

O runtime não apresenta credenciais/identidades/variáveis remotas configuradas e não foi usado para consultas reais ao Koper/Supabase. **Produção e Koper permaneceram inalterados por esta execução; não houve migração, saneamento, deploy ou publicação remota.** Isso descreve as ações desta entrega, não uma auditoria de mudanças feitas por terceiros. O próximo lote deve ser a correção localizada da restituição e os testes/documentos prioritários, sem liberar produção ou avançar automaticamente para implantação.
