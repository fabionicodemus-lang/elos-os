# Etapa12 — Primeiro lote dos16 cenários parciais

**Os quatro casos executados passam no comparador numérico independente. CT02, CT03 e CT18 têm cadeias fictícias conformes no recorte demonstrado; CT29 permanece parcial pela referência original, embora seu corrente esteja conforme.** Foram classificados individualmente os16 casos. Os12 não selecionados conservam suas pendências; são13 parciais na matriz atualizada, incluindo CT29. **Não há aceite financeiro nominal nem homologação integral do financeiro.**

Branch `feat/financeiro-etapa12-parciais`, base `65fe2cc` da Etapa11; implementação no commit `f37d21e`. As Etapas5–11 são ancestrais, incluindo CT10 corrigido. Código/dados de produção, Koper remoto, regras, expected e arquivos das etapas anteriores permaneceram inalterados. Nenhuma implantação ou migração em produção foi executada. **A investigação F011×F007 não foi reaberta nem alterada.** Sua pendência continua exatamente sob a evidência histórica da Etapa11.

[Matriz individual dos16](MATRIZ-16.md) · [CSV para revisão](evidencias/matriz-16.csv) · [Matriz dos30 atualizada](evidencias/matriz-30.json) · [Quadro XLSX](Elos_OS_Quadro_Etapa12_Parciais.xlsx).

## Seleção e nível das evidências

A matriz separa A implementação comprovadamente falha; B teste/evidência técnica incompleta; C informação financeira real; D decisão financeira; E limitação de fonte. As categorias podem coexistir. C/D de uma implantação real não foram usadas para bloquear testes cujas premissas fictícias já estavam aprovadas. B não foi tratado como bug automático.

CT24 continua primeiro em risco de acesso, mas sua conclusão exige Auth/storage/jobs/cache e todos os canais. CT21 continua prioritário pela publicação de totais incompletos; faltam canais integrados e política de exceção D12. O lote escolhido combina risco de dupla contagem, insuficiência de caixa, posição histórica e custo/caixa com dependências técnicas disponíveis e prova independente viável. Cada caso não selecionado possui causa/limitação, regra, dependências, esforço estimado e conclusão objetiva na matriz; não foi abandonado nem implementado neste lote.

| Caso | Antes | Trabalho do lote | Evidência independente / limite |
|---|---|---|---|
| CT02 |Reimportação e cortes testados separadamente; leitura pré-criação e fusos incorretos |Importação/revisão autorizada fictícia/replay, audit imutável e três consultas SQL/aplicação encadeados; correção temporal localizada |Expected original fixo; autorização documental fictícia separada; leitura SQL confronta a função da aplicação. Não certifica revisões retroativas fora destes cortes ou Auth real |
| CT03 |Pagamento/banco já corretos; I01 adicional desconhecido |Reutilizada medição/itens aprovados, título e carregador real de custo antes/entre/depois dos pagamentos e conciliação |Aceite econômico anterior fictício de10.000 explicitamente persistido; extratos−3.000/−2.000 fixados pelos inputs. **Nenhuma correção de cálculo de custo foi necessária** |
| CT18 |AF e encargo sem vínculo canônico podiam somar99.000 em vez de97.000; revisão de AF faltava |Vínculo documentado, constituição atômica/idempotente, deduplicação por linhagem, nova versão só paraAF adicional, interface e carregador central |Estados A–F persistidos; expected daEtapa4 intacto; replay/concorrência/versões/obras/empresas negativos. Não houve vinculação de legado por semelhança |
| CT29 |Oráculo puro correto; agenda/tela/IA não encadeadas |Agenda/restrição/amortização persistidas; carregador/tela/IA no mesmo perímetro; rejeição explícita de entidade negada |Expected original intacto. RLS já ocultava registros; o erro era responder visão vazia no lugar de negar o contexto. Não foi provado vazamento. Original anterior ao vínculo permanece parcial, conforme abaixo |

## Causas comprovadas e menor correção

**CT02 — `titlesAt`.** O histórico era filtrado por K antes de verificar se havia versões; sem versão conhecida, usava o título atual. Na extensão fictícia anterior à criação, retornava1 título em vez de0. A comparação lexical também interpretava `21:00Z` e `18:00-03:00` como instantes distintos, podendo usar12.000 quando a versão conhecida era10.000. A função agora distingue ausência de histórico de ausência de versão conhecida e compara instantes com `Date.parse`. `finance_payable_at`, importador, identidade e estrutura do audit foram reutilizados. O baseline lê o commit original `65fe2cc`, sem editar fontes antigas.

**CT18 — vínculo financeiro ausente.** A composição do título após o encargo tem R17.000, C40.000 eP40.000. O fluxo mantinha tambémAF2.000: total99.000, contra97.000 aprovado. A função pura `exclusiveFutureAdjustments` já atendia ao conceito, mas não havia vínculo persistido consumido pelo carregador. A RPC de versões também bloqueava acréscimo deAF, exigindo uma revisão própria ainda ausente. A candidata adiciona:

- `finance_cash_adjustment_realizations`, append-only, com empresa, entidade, obra, previsão/versão/escopo, encargo/título, centavos, vigência, comando, autoria, motivo e evidência;
- `realize_cash_adjustment`, que reutiliza `add_finance_title_interest` e constitui encargo+vínculo na mesma transação. Exige valor integral exato e mesmo perímetro. Locks e unicidade por raiz/escopo impedem repetir a constituição em descendentes;
- mudança restrita em `save_cash_scenario`: `adjustment` permite acrescentar apenasAF documentado ligado a títuloAP, preservando todas as linhas e valores anteriores. Não permite revisar silenciosamente P/C, excluir linhas ou alterar realizado;
- captura dos vínculos nos novos snapshots, sem backfill dos antigos; `futureCashRows` consome apenas vínculos explícitos efetivos no corte e na linhagem selecionada. Se o encargo não estiver na posição, ocorre erro explícito, sem esconderAF;
- ações e formulários no fluxo existente para registrarAF em nova versão e constituí-lo. Não há segunda fórmula de saldo ou de projeção.

**CT29 — autorização e perímetro.** Um teste negativo mostrou que o carregador aceitava uma entidade visível no cadastro, mas sem autorização financeira; o RLS retornava vazios. Agora `loadCashflow` verifica a permissão existente `finance_entity_scope` e a compatibilidade obra/entidade antes de calcular. A ferramenta de caixa da IA aceita `entidade_id` e retorna projeções por entidade, reutilizando o carregador. Nenhuma permissão de empresa/perfil foi ampliada e nenhuma regra financeira foi redefinida.

[Baseline e causas](evidencias/baseline.json) · [Reprodução anterior à guarda da entidade](evidencias/antes-guarda-entidade/banco.json). A primeira tentativa de harness, preservada em `tentativa-inicial/`, falhou por transporte privado do importador e parsing do adaptador SQL; esses erros de teste foram corrigidos e não foram classificados como defeitos financeiros. A iteração deSSR em `tentativa-inicial/servidor-tela-ia.log` também conserva o erro de asserção de formatação monetária; a evidência final é `servidor-tela-acoes.log`, com10/10 conformes.

## Esperado versus obtido

Os valores abaixo são BRL; arquivos de comparação usam centavos inteiros. Expected foi lido da fixture aprovada, não produzido por funções do Elos. Os quatro casos passaram integralmente no **contrato numérico**, o que não equivale ao aceite financeiro de seus dados reais.

| Caso / medida | Esperado | Obtido |
|---|---:|---:|
| CT02 título canônico |1 |1 |
| CT02 posição original / revisada |10.000 /12.000 |10.000 /12.000 |
| CT02 ponte autorizada |2.000 |2.000 |
| CT02 T21/10 com K20/10 |10.000 |10.000 |
| CT03 saldo após pagar3.000 e depois2.000 |7.000 /5.000 |7.000 /5.000 |
| CT03 desembolso confirmado |5.000, duas saídas |5.000, duas saídas |
| CT03 caixa novo por conciliar / custo novo por pagar |0 /0 |0 /0 |
| CT03 custo conhecido antes/entre/depois, complemento fictício documentado |10.000 /10.000 /10.000 |10.000 /10.000 /10.000 |
| CT29 banco inicial − restrição |120.000 −20.000 =100.000 |100.000 disponíveis |
| CT29 finais dos meses1/2 |40.000 /−30.000 |40.000 /−30.000 |
| CT29 necessidade frente ao mínimo20.000 |50.000 |50.000 |
| CT29 amortização duplicada / limite não sacado no caixa |0 /0 |0 /0 |

| CT18 estado | R | C | P | Q semAF | AF | Q do cenário | Obtido |
|---|---:|---:|---:|---:|---:|---:|---|
| A |0 |0 |100.000 |100.000 |0 |100.000 |Conforme |
| B |0 |60.000 |40.000 |100.000 |0 |100.000 |Conforme |
| C |20.000 |40.000 |40.000 |100.000 |0 |100.000 |Conforme |
| D |15.000 |40.000 |40.000 |95.000 |0 |95.000 |Conforme |
| E |15.000 |40.000 |40.000 |95.000 |2.000 |97.000 |Conforme |
| F |17.000 |40.000 |40.000 |97.000 |0 |97.000 |Conforme |

EmCT29, a agenda mostra entradas60.000/80.000 e saídas120.000/150.000. No mês2, P130.000+AP20.000 substituem a linha financeira já coberta; não se adicionam outros20.000. Os70.000 não sacados permanecem no documento fictício de financiamento e fora do disponível.

**Limite da referência original CT29:** o snapshot original foi capturado antes do vínculo entre título e amortização e conserva a sobreposição ainda não conciliada (−50.000 na referência original, versus−30.000 no corrente vinculado). Não foi reescrito nem declarado validado. A conformidade numérica acima se refere ao corrente depois do vínculo documentado; a tela identifica a referência original como parcial e preserva seu valor conhecido. Aprovar o original e a cronologia de cobertura exige revisão específica, não simples igualdade dos expected. Esse limite permanece na matriz, sem impedir a prova do cálculo corrente.

[Comparação campo a campo,4/4](evidencias/comparacao-4.json) · [50 campos no quadro](evidencias/verificacao-quadro.json) · [Documentos, banco, audit e versões](evidencias/registros.json) · [Views produzidas pelos carregadores reais](evidencias/views.json) · [TelaCT18](evidencias/tela-ct18.html) · [TelaCT29](evidencias/tela-ct29.html) · [RespostaIACT29](evidencias/ia-ct29.json).

## Arquivos e arquitetura reaproveitada

| Localização | Mudança / reaproveitamento |
|---|---|
| `lib/finance-core/ledger-position.mjs` |Correção da existência emK e fusos; demais componentes de liquidação preservados |
| `lib/finance-core/cashflow.mjs` e `.d.mts` |SubstituiçãoAF→encargo por vínculo exato; mesma fórmula de fluxo e snapshot |
| `lib/finance-core/cashflow-server.ts` |Leitura paginada dos vínculos, linhagem/perímetro, guarda existente de autorização e candidatos da interface |
| `supabase/migrations/20261024100000_cash_adjustment_realizations.sql` |Candidata aditiva, tabela/RLS/RPC/trigger de snapshot e extensão restrita da RPC de versão; **aplicada somente nos bancos descartáveis** |
| `app/financeiro/fluxo-de-caixa/actions.ts` e `page.tsx` |Ações e formulários no AppShell/tema existentes. Empresa e valores constituídos vêm do servidor; título/obra são conferidos também na RPC |
| `lib/elos-ia/tools.ts` |Filtro opcional de entidade e abertura da composição por titular, sem novo cálculo |
| `tests/finance-partials/` e `package.json` |Baseline fixado na base, adaptador SQL, scaffolds explícitos, quatro cadeias, ações/SSR/IA e comando `test:finance-partials` |

Importador Koper, ledger operacional de pagamentos, conciliação, núcleo de cobertura e carregador de custo foram reutilizados. Nenhuma correção do CT03 foi feita porque seu comportamento existente passou na prova ampliada. CT10 e os outros26 estados/evidências da matriz anterior foram preservados.

## Testes e ambiente

PostgreSQL17, imagem fixada no digest existente, Docker local `--network none`, sem portas publicadas, banco e dados fictícios descartáveis. Containers removidos. O runtime não oferece credenciais financeiras remotas configuradas. Para alguns cadastros de engenharia ausentes no scaffold financeiro, foram criadas tabelas mínimas de teste explicitadas em `tests/finance-partials/setup.mjs`; não se declara paridade com o esquema remoto integral.

As aberturas auxiliares de1.000.000 emCT03/CT18 permitem executar a massa e não integram seus oráculos de fluxo/custo; não certificam saldo real ou saldo bancário próprio de obra. CT29 usa a abertura120.000 e restrição20.000 explicitamente previstas em sua fixture.

CT02 controla somente o default de `recorded_at` antes dos inserts no banco de teste; não edita audit já gravado nem desativa triggers/RLS. O renderer do CT18 usa relógio local do teste para20/11, data fictícia aprovada, sem alterar o relógio/guarda da aplicação. O importador privado é exercitado pelo transporte de worker já usado naEtapa6, com autoria e permissões internas; leituras/RPCs operacionais usam papel `authenticated` eRLS. Isso não substitui Auth/PostgREST/navegador reais.

| Verificação final | Resultado |
|---|---:|
| Quatro cadeias novas PostgreSQL / comparador original |4/4 e4/4 |
| Novos testes de ações, carregador/SSR e ferramenta realIA |10/10 |
| FundaçãoEtapa5, incluindo backup/restauração descartáveis |25/25 |
| IntegraçãoEtapa6 |24/24 |
| LedgerEtapa7, incluindoCT07, excesso, estorno e concorrência |16/16 |
| BancoEtapa8 |8/8 |
| SondasEtapa9 |7/7 observações; não são novos aceites dos casos ainda parciais |
| CT10Etapa10 e variantes |9/9; comparadorCT10 conforme |
| Componentes/SSR anteriores reaproveitados |29/29 |
| Regressão anterior / suíte geral |81/81 e142/142 |
| TypeScript eESLint nos arquivos alterados |saída0 |

Executado **`npm run test:finance-partials`**, saída0, com14 comandos registrados em [execucoes.json](evidencias/execucoes.json). O script preserva assertions/inputs/expected dos testes anteriores e instala a candidata depois de seus pré-requisitos; adaptadores e hashes estão em `evidencias/reexecucao/`. Apresentação/ações, TypeScript e lint foram repetidos na versão final, incluindo identificação da referência parcial e transporte monetário decimal exato nas novas ações. Os comparadores são os originais daEtapa4. Testes PGlite das suítes anteriores usam memória e massa fictícia. O backup/restauração comprovado é somente o descartável; não substitui restauração real antes de migração futura.

## Aceites, limites e documentos necessários

[Solicitações objetivas ao financeiro](PENDENCIAS-FINANCEIRO.md) relacionam cada documento/decisão aos casos afetados. Não foram inventados responsáveis, vigências, taxas, tolerâncias, índices ou políticas de exceção. Não foi registrada aprovação financeira em nome de ninguém.

O quadro parte da cópia daEtapa11 e acrescenta a classificação dos16 e50 resultados dos quatro selecionados. Somente valores obtidos/evidências/executor/data técnica e notas relacionadas foram atualizados; expected, fórmulas, dependências, estados das tarefas, outros26 casos e todos os aceites permanecem intactos. T45 segue bloqueada. As tarefas dos quatro recortes podem ser submetidas à revisão técnica e financeira **do perímetro fictício explicitado**, sem conclusão integral de T07/T18/T26/T30/T39/T41/T44 ou liberação real.

Limites restantes:13 cenários ainda parciais (12 não selecionados eCT29); Auth/browser/storage/cache/jobs completos deCT24; canais/exceções deCT21; dados reais e conciliação documental; parâmetro/responsável vigente; originalCT29 anterior ao vínculo; equivalência do esquema remoto. Encargos legados sem vínculo, constituição parcial deAF, créditosAR e reversões de encargos não são solucionados por inferência ou alteração de documentos antigos. A nova RPC restringe-se à constituição integralAP documentada do caso aprovado; isso não define uma proibição contábil para os demais fatos.

Esta entrega encerra o lote. Não inicia o próximo grupo, não altera aEtapa11 e não concede homologação financeira completa.
