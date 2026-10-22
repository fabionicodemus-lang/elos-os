# Casos, oráculos e resultados — Etapa11

Valores em centavos inteiros nos arquivos automatizados; as contas abaixo usam BRL. Oráculos fixos e independentes da aplicação. Não foram alterados `casos_financeiros.json`, as regras v0.1 ou a matriz de30 casos.

## Executados sobre documentos e método offline

| Caso | Entrada / regra | Esperado independente | Obtido / evidência |
|---|---|---|---|
| E11-01 |“149.589,33”,0,01, valor ausente e0,001; §5 precisão |14.958.933c;1c;null; rejeitar subcentavo |Conforme |
| E11-02 |R$500 + desconhecido; depoisR$500 +0; §11 |Subtotal conhecido500, totalnull,1 ausente; depois total500 |Conforme |
| E11-03 |MesmoID, PDF70.000 eXLSX100.000 |Diferença30.000; registro classificado divergente |Conforme |
| E11-04 |PDF sóID1 eXLSX sóID2, mesmo valor1.000 |1 registro apenas em cada fonte; sem compensar ausências |Conforme |
| E11-05 |PDF repeteID1/parcela1;XLSX tem uma linha |Duplicidade explícita; não parear/arbitrar valor |Conforme |
| E11-06 |MesmoID, um valor desconhecido |Valor/diferença/caixa confirmado desconhecidos |Conforme |
| E11-07 |ID13701,7.500 sem pagamento; rodapé com22/07/2026 |Valor750.000c; pagamento continua ausente |Conforme; rodapé não vira evento |
| E11-08 |PDF faltando página2; bloco com dois valores monetários |Ambos impedem análise automática/certificação |Conforme |
| E11-09 |Documento“-” vs“KOPER1” |Referência sintética; não comprova vínculo fiscal/empresa |Conforme |
| E11-10 |Originais F011/F007; oráculo fixo do cabeçalho e soma conferida independentemente |3.261 linhas cada;165 páginas;13.710.826,32 nas duas somas;13.561.236,99 no cabeçalho;149.589,33 residual |Conforme, **residual continua sem causa** |
| E11-11 |Poppler vsPyMuPDF e comparação individual |3.261 pares iguais em valor/datas;2.537 referências iguais e724 substitutos; diferença econômica alocada porID permanecenull |Conforme; não homologa valores bancários |
| E11-12 |Hipótese simples:13.710.826,32 −13.325,34 +1.325,28 |13.698.826,26; residual137.589,27 contra cabeçalho; não fecha |Conforme; hipótese não é correção |

[Código dos testes](scripts/test_reconciliacao.py) · [Log12/12](evidencias/testes-diagnostico.log). A soma histórica foi repetida por dois motores de extração, em centavos decimais; não foi calculada pelo Elos nem substituída por `SUMIF`/CSV derivado.

## Cenários financeiros para decidir a causa após obter os componentes

Estes são **casos fictícios propostos, sem alterar os30 aprovados**. Não foram aplicados a dados reais nem executados como novos cenários transacionais nesta etapa. Servem como oráculos fixos para a futura reprodução; não autorizam presumir que ocorram no F007.

| Caso | Entradas documentadas exigidas | Esperado independente e justificativa |
|---|---|---|
| V01 — conceitos bruto/líquido |Principal100.000, juros constituídos2.000, desconto definitivo5.000; pagamentos40.000 principal e57.000 (55.000 principal+2.000 juros), todos no corte |Nominal100.000; principal liquidado95.000; caixa97.000; aberto0. `100.000+2.000−5.000−40.000−57.000=0`. Diferença nominal/caixa3.000 legítima **se** os documentos sustentarem essa composição (§5, exemplo12.2). Não tentar igualar nominal e caixa |
| V02 — parcial |Título100.000, primeiro pagamento30.000, sem encargos/descontos, extrato identificado |Nominal100.000; caixa30.000; aberto70.000, parcial. Segundo pagamento70.000: caixa acumulado100.000, aberto0. Data de pagamento isolada não prova quitação (CT07 preservado) |
| V03 — cancelamento |Título20.000 sem pagamento; evento documenta extinção integral válida emT2, snapshot conhecidoK2 |EmT1 antes do evento: aberto20.000. EmT2: ativo aberto0; nominal/histórico20.000 preservados; caixa0. Não excluir apenas por ausência numa listagem; não inventar cancelamento de IDs reais |
| V04 — agrupamento |Pai100.000 representa exatamente os mesmos filhos60.000+40.000, relações comprovadas |Compromisso representado uma vez100.000; somar pai+filhos daria200.000 incorretamente. Sem vínculo documental: resultado consolidado desconhecido, não eliminar pai por nome/valor |
| V05 — datas |Obrigação1.000 reconhecida30/06, paga02/07, conciliada04/07; extrato usa movimento02/07 |Corte30/06: obrigação1.000, caixa pago0; corte02/07: obrigação0, saída registrada1.000, conciliação ainda pendente; depois da conferência, caixa confirmado1.000 com movimento02/07. Não deslocar competência nem caixa para04/07 |
| V06 — componente desconhecido |Nominal100.000; desconto/juros/eventos de baixa ausentes |Somente nominal100.000 conhecido; caixa e saldo validado permanecemnull. Nenhum desconto/ajuste de fechamento presumido |

## Regressões existentes reaproveitadas

- `node --test tests/koper-finance/collection.test.mjs tests/financeiro/money.test.mjs tests/finance-core/components.test.mjs tests/cashflow/engine.test.mjs`: **28/28**, sem rede/banco. Inclui falha de página, universo/total divergente, baixa parcial, desconhecidos, rateio/A Apropriar, núcleo de saldo, retenção/adiantamento, eventos e caixa. [Log](evidencias/regressao-financeira.log).
- Comando de regressão de `tests/supplier-refunds/validate.mjs`, exclusivamente a lista de testes que produz `regressao-81.log`: **81/81**. Usa os módulos preservados de forecast, IA, contratos, OFX, banco, Aurora, custos e dinheiro; PGlite em memória com dados fictícios quando aplicável. [Log](evidencias/regressao-81.log).
- `npm test`: **142/142** na suíte geral atual, sem alterações de código ou fixtures e sem conexão financeira externa. Não é a mesma lista dos81. [Log](evidencias/npm-test-142.log).
- Controles transacionais25/24 e homologação integral dos30: **não reexecutados** nesta auditoria documental; evidências históricas e classificações preservadas, sem reivindicar um novo aceite.

## Reprodução

Na raiz do repositório, com Python3, `openpyxl`, `PyMuPDF` e Poppler já disponíveis:

```sh
python docs/financeiro/implementacao-v1/etapa11-reconciliacao/scripts/reconciliar.py
python docs/financeiro/implementacao-v1/etapa11-reconciliacao/scripts/test_reconciliacao.py
python docs/financeiro/implementacao-v1/etapa11-reconciliacao/scripts/quadro.py
node --test tests/koper-finance/collection.test.mjs tests/financeiro/money.test.mjs tests/finance-core/components.test.mjs tests/cashflow/engine.test.mjs
node --test --test-reporter=spec lib/forecast/engine.test.mjs lib/forecast/snapshot-comparison.test.mjs lib/elos-ia/summaries.test.mjs app/engenharia/contratos/contract-calculations.test.mjs lib/banking/ofx.test.mjs tests/banking/bank-operations.test.mjs lib/elos-ia/finance-safe-write-db.test.mjs tests/homologation/aurora-regressions.test.mjs tests/commercial/development-costs.test.mjs tests/commercial/development-result.test.mjs tests/financeiro/money.test.mjs
npm test
python docs/financeiro/implementacao-v1/etapa11-reconciliacao/scripts/verificar.py
```

O reconciliador aceita `--base CAMINHO --out CAMINHO`; os originais são apenas lidos. IDs/parcelas duplicados, campos ambíguos ou paginação incompleta interrompem a extração. A comparação genérica registra duplicidades e valores desconhecidos explicitamente. Os caminhos externos dos originais não são distribuídos pelo Git; usar o ZIP da base conferido pelos hashes para reproduzir em outra máquina.
