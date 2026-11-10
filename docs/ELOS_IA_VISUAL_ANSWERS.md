# Respostas visuais da Elos IA

A conversa apresenta a conclusão primeiro, seguida por gráficos construídos com os resultados das consultas e uma explicação curta. A referência visual é o vídeo de apresentação do Elos OS: papel claro, verde profundo, verde suave, dourado e terracota para alertas. Os valores ilustrativos do vídeo não fazem parte da implementação.

## Perguntas e fontes

| Pergunta | Apresentação | Fonte e regra |
| --- | --- | --- |
| Quanto ainda falta pagar? | Composição horizontal do custo | Motor oficial de previsão: pago, contas em aberto, contratos a faturar e a comprometer. Restante = custo final projetado − pago. |
| Vou atrasar a obra? | Curva de avanço planejado e realizado, datas e desvio | Mesmo motor de pesos físicos do dashboard e do resumo do cronograma. O ponto de hoje compara o previsto e o realizado na mesma data. O término é o cadastrado/reprogramado, sem extrapolação inventada do ritmo. |
| Como fica o caixa nos próximos seis meses? | Barras de entradas e saídas com linha do saldo acumulado | Contas a pagar/receber e, quando disponível e autorizado, previsão da Engenharia. Inclui o mês atual e os cinco seguintes. O saldo acumula o histórico anterior à janela; não é saldo bancário conciliado. |
| Quanto vou lucrar? | Formação do resultado: receita, componentes de custo e lucro | Mesmo motor do Resultado do empreendimento, incluindo obra, comissões, tributos, demais custos e distratos. Exige baseline aprovado e cobertura suficiente das fontes. |
| Vale a pena esta proposta de unidade? | Comparação de preços nominais e, quando calculável, valor presente | Unidade, proposta/parcelas e tabela oficial autorizadas; aceita condições explicitamente informadas. Não presume taxa, calendário ou custo unitário. |

As ferramentas comerciais estão disponíveis nas personas Diretoria e Financeiro, respeitando as permissões das respectivas fontes. A persona Clientes permanece restrita ao andamento físico.

## Integridade dos dados

- Os gráficos são gerados por `lib/elos-ia/visuals.mjs`, a partir de resultados autorizados das ferramentas. O texto do modelo nunca é convertido em série numérica.
- `server.ts` captura os resultados da pergunta atual, preserva a ordem das chamadas paralelas e exclui consultas negadas, com erro ou recusadas pelo limite global de dados da rodada. O corte de texto de uma consulta para o contexto do modelo não altera seu resultado completo no servidor.
- O servidor envia apenas a estrutura permitida do gráfico. O cliente valida novamente a resposta e os dados recuperados do histórico.
- Composições de custo e resultado precisam reconciliar os totais. Números ausentes, infinitos ou incompatíveis não viram zeros nem gráficos parciais.
- Cada cartão identifica obra, fonte, data de referência, horário da consulta, premissas e avisos aplicáveis. Filtros que restringem apenas listas de serviços/atividades não são apresentados como filtros dos totais da obra.
- A resposta contém no máximo três gráficos. Séries maiores que 72 pontos não são silenciosamente cortadas para parecer completas.
- O mesmo tipo de gráfico pode aparecer para períodos ou taxas diferentes. Repetições da mesma consulta usam a última observação da pergunta.

### Lucro

A consulta reutiliza `calculateDevelopmentResult`, `loadProjectForecast` e `loadDevelopmentCosts`. Não subtrai apenas o orçamento de obra do VGV. Sem base econômica aprovada, componentes de custo e referência para as taxas, retorna a informação que falta em vez de publicar uma margem artificial. As estimativas já existentes no motor, como estoque referenciado pelo ticket médio do baseline, conservam seus avisos.

O gráfico apresenta a formação do resultado econômico projetado. Não inventa uma atribuição em pontos percentuais para atraso, desconto comercial ou custo quando as fontes não calculam esses efeitos.

### Propostas

O valor presente exige taxa de desconto explícita, sua base anual/mensal, data-base e cronograma completo que feche o valor nominal. A taxa mensal efetiva é convertida por capitalização composta. O desconto considera dias corridos/365, declarado nas premissas. As parcelas preservam o dia do primeiro vencimento, ajustando ao último dia do mês quando necessário.

Correção monetária ou juros contratuais sem projeção suficiente, parcelas passadas sem conciliação e condições incompletas mantêm o VP indisponível. O preço de tabela sem calendário permanece nominal; um preço à vista oficial é uma alternativa separada. Data-base ausente permanece ausente. Sem custo unitário oficial completo, a margem da unidade não é calculada.

## Conversa e acessibilidade

- Os cartões se adaptam ao painel lateral e à tela completa, sem biblioteca gráfica adicional.
- Legendas, valores principais e avisos estão sempre visíveis. Cada gráfico possui uma tabela expansível com os valores exatos, acessível por teclado.
- Eixos incluem zero e acomodam saldo/prejuízo negativo. Os gráficos de caixa utilizam a mesma escala monetária para barras e linha. O cronograma usa distância real entre datas.
- A identidade do histórico inclui empresa, usuário e obra. Abrir a tela completa preserva a conversa e os gráficos concluídos, sem manter duas instâncias escrevendo no mesmo histórico.
- Durante uma consulta, os controles do painel para fechar/expandir aguardam sua conclusão, evitando perder a resposta em andamento.
- Conversas antigas sem estrutura gráfica continuam sendo renderizadas em texto. Não há geração retroativa de séries a partir de respostas antigas.

## Verificação

O workflow Elos IA executa os testes de laço de ferramentas, resumos, gráficos e ferramentas comerciais, além de TypeScript, lint e build. Os testes novos verificam reconciliação, perdas, engenharia no caixa, recortes distintos, ausência de medições, validação do cache, VP incompleto, calendário, capitalização, escopo e permissões antes das consultas.

Comandos principais:

```sh
npm test
npx tsc --noEmit
npx eslint app/elos-ia app/api/elos-ia lib/elos-ia components/global-elos-ia-drawer.tsx components/project-switcher.tsx
npm run build
```

O roteiro funcional começa em Bossa Empreendimentos / Flow Aptos, com as cinco perguntas acima. Conferir painel lateral, expansão mantendo a conversa, tabela dos valores, versão móvel e resposta sem base suficiente. A comparação com o vídeo é visual; os números de aceite vêm das consultas do sistema.

## Dependência de segurança

A preparação do build identificou advisories na versão Next.js 16.4.0. Esta alteração alinha `next` e `eslint-config-next` em 16.4.6, mantendo a mesma série e sem executar atualização geral das dependências. Referência do fornecedor: [atualização de segurança de outubro de 2026](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
