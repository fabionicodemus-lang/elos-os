# Etapa 8 — Fluxo de caixa, projeções e reprogramações

Entrega técnica em desenvolvimento/testes, em 22/10/2026. Branch `feat/financeiro-etapa8-fluxo`, base `5e18d7f`. Ancestralidade das Etapas 5 (`494c55c`), 6 (`95d659e`) e 7 (`3daa96e`, `5e18d7f`) conferida; registros históricos e resultados esperados preservados. Implementação no commit `6ec4f47`; hashes dos arquivos em [verificacao-final.json](evidencias/verificacao-final.json); documentação em commit posterior.

Produção e integração remota Koper permaneceram inalteradas por esta execução: nenhum comando de implantação, migração remota ou escrita real. Migrations candidatas aplicadas somente em PostgreSQL 17 descartável, Docker sem rede e sem portas publicadas. Isso descreve nossas ações; não equivale a uma auditoria remota de produção.

## Regras e materiais utilizados

Regras Financeiras v0.1 da Etapa 3, seções 3 e 5–12, em especial 8.6, 9 e 10. Arquivo acessível: `/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx`, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. Casos aprovados da Etapa 4: `tests/financeiro/fixtures/casos_financeiros.json`, SHA-256 `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`. Comparador original preservado. Cartões T29/34/35/36/39 e documentos das etapas anteriores consultados. A planilha deriva da cópia da Etapa 7; os aceites e esperados originais não foram preenchidos ou alterados.

D01–D14 permanecem com seus responsáveis/vigências e pendências anteriores. Datas, mínimos, restrições e permissões dos testes são fictícios e não configuram autorização operacional real. Não houve mudança normativa.

## Funcionalidades implementadas e reutilizadas

- Reutilizados ledger de liquidação, cálculos de posição/contrato, bancos, importador, conciliação, RLS, auditoria e infraestrutura de testes das Etapas 5–7. Tela e consultas de fluxo/diagnóstico da IA consomem o mesmo carregador e núcleo financeiro.
- Realizado por conta/titular: abertura documentada, movimentos registrados versus vínculos efetivos de extrato, continuidade dos períodos, pendências anteriores ao corte e trânsito. Caixa da conta compartilhada não é distribuído artificialmente entre obras.
- Transferência própria e mútuo documentado: débito/crédito em datas distintas, tarifa externa separada, idempotência, controle concorrente e inverso rastreável. Eliminação do consolidado exige ambas as pontas autorizadas; insuficiências entre titulares não são compensadas automaticamente.
- Projeções separadas em R (títulos), C (contratos ainda não titulados), P (previsão descoberta), recebíveis, receita estimada e financiamento/encargos tipados. Horizontes cumulativos 30/90 dias e conclusão, vencidos e necessidade diária de recursos. Receita estimada permanece separada da base de direitos existentes. Valores sem data/cobertura ficam explícitos e tornam a projeção parcial.
- Cobertura por ocorrência, título, contrato e escopo impede a mesma obrigação em R/C/P. Vínculos nativos reaproveitam nota/parcela/medição/contrato; não se inventam proporções para escopos sem mapa monetário.
- Original com fontes congeladas, versões anteriores imutáveis e nova previsão com autoria, motivo, data e vínculo ao cronograma físico. Alterar C/P futuros não muda realizado nem vencimento legal; P→C exige contrato válido e nova versão.
- Proteção contra exclusão/cancelamento direto dos movimentos canônicos novos; correções bancárias por eventos inversos. Nenhum saneamento do legado executado.

## CT12 — corrigido dentro da fronteira validada

A regra aprovada permite pagar obrigação válida da entidade enquanto a apropriação à obra está pendente. O novo caminho exige validação explícita de fonte, titular, fornecedor, documento, autorização e motivo; origem paga/ambígua não é liberada. Nenhuma obra fictícia é criada. Custo econômico só é reconhecido na fixture com prova/valor/competência fornecidos; não é presumido do principal financeiro.

Na fixture: custo comprovado da entidade R$10.000, sendo R$6.000 da obra e R$4.000 A Apropriar. Após pagamento e conciliação de R$2.000 sem obra, aberto total R$8.000, aberto sem obra R$2.000 e desembolso sem obra R$2.000; apropriação original 60%. A obra continua incompleta. CT12 passou no comparador independente; D01/revisão de legado e aceite nominal seguem pendentes.

## Exemplos calculados, sem alteração dos esperados

| Caso | Original / antes | Resultado / depois |
|---|---|---|
| CT15 transferência própria | Contas R$50.000 e R$10.000; transferência R$20.000; tarifa R$15 | Dia 20: bancos R$39.985 e trânsito R$20.000. Dia 21: bancos R$59.985, trânsito zero. Só tarifa é saída externa |
| CT16 mútuo entre entidades | A R$50.000; B R$10.000 | A/B R$30.000 cada; consolidado R$60.000; nenhum custo de obra ou receita criado |
| CT17 reprogramação | Fechamentos out/nov/dez: R$130.000 / R$80.000 / R$40.000 | R$80.000 / −R$10.000 / R$40.000. Necessidade adicional com mínimo R$20.000: zero → R$30.000 |
| CT25 recorrência | P R$3.000 | Após título: R R$1.000 + P R$2.000; após pagamento: P R$2.000. Duas reimportações não recriam obrigação/caixa |
| CT29 componente puro | Banco R$120.000 menos restrição R$20.000 | Disponível R$100.000; finais R$40.000 / −R$30.000; necessidade R$50.000. Limite não sacado R$70.000 não entra |

CT17 conserva Q R$120.000, ETC R$100.000, EAC R$120.000 e incorrido R$20.000 (fato dado da fixture). Reprogramar recebimento para dezembro não elimina vencido de outubro. Renegociação jurídica é evento separado, com posição anterior preservada.

## Testes e critérios de aceite técnico

| Verificação | Resultado | Evidência |
|---|---|---|
| Controles Etapa 5, incluindo backup/restauração isolados | 25/25 | `evidencias/anteriores/fundacao/banco-final.json` |
| Integração Etapa 6 | 24/24 | `evidencias/anteriores/integracao/integracao.json` |
| Ledger/CT07 Etapa 7 | 16/16 | `evidencias/anteriores/liquidacoes.json` |
| Componentes/SSR Etapa 7 | 12/12 + 1/1 | `evidencias/anteriores/componentes.log`, `render.log` |
| Núcleo de caixa / controles de banco Etapa 8 | 8/8 + 8/8 | `evidencias/componentes.log`, `banco.json` |
| Carregador real e renderização SSR | 4/4 | `evidencias/servidor-tela.log` |
| Regressão preservada | 81/81 | `evidencias/regressao-81.log` |
| Oráculos independentes | 11 integrais + 5 componentes | `evidencias/comparacao-integrais.json`, `comparacao-componentes.json` |
| TypeScript e ESLint das áreas alteradas | Saída 0; sem erros | `evidencias/execucoes.json`, logs correspondentes |

Concorrência: duas transferências de R$700 sobre R$1.000 aceitam uma e rejeitam outra, sem duplicar movimentos. Repetição, estorno, excesso de liquidação e permissões anteriores passaram novamente. CT07 continua corrigido (R$100.000 − R$30.000 = R$70.000, depois zero); não foi reimplementado.

Resultado individual em [CENARIOS-30.md](CENARIOS-30.md): **11 integrais no perímetro isolado, 18 parciais, zero reprovados nessa massa, 1 não executado (CT10)**. Anterior: 6 integrais, 17 parciais, 1 reprovado, 6 não executados. Cinco oráculos puros completos continuam classificados parciais no fluxo completo. Nenhum aceite financeiro nominal ou homologação documental integral emitido.

## Pendências e riscos

Prioridade financeira: CT10 (cancelamento econômico/restituição), retenções/tributos e multiobra integrais, estados históricos T/K fechados e confirmação documental de aberturas/extratos. CT13/22 (recebimentos/adiantamentos) e CT28 (combinação de coberturas) continuam parciais; não se declara o conjunto homologado.

Não foram acessados banco real, extratos reais completos, Koper remoto, jobs remotos, dados históricos do título16032 ou correspondências legadas de fornecedores. Não há certificação de completude de extrato, custo contábil real, nem de posição financeira real. Saldo vinculado a extrato na tela é uma base parcial até a conciliação independente. Legados sem trilha completa permanecem pendentes.

O banco isolado reutiliza a fixture existente e scaffolds mínimos de engenharia, explicitados em `tests/cashflow/setup.mjs`; não comprova equivalência integral ao esquema remoto. RLS foi exercitada com papéis SQL; SSR/carregador foram exercitados com transporte/autenticação simulados, sem teste de navegador/Auth real. Não houve restauração do backup real.

Abertura conserva a convenção existente (saldo antes dos movimentos da data de abertura), sujeita a D06/extrato. Original captura fontes atomicamente na RPC; a visão corrente usa leituras paginadas e não constitui fechamento transacional certificado. Vínculos de escopos divididos exigem mapa monetário explícito. Fechamento por obra não inventa abertura bancária. Necessidade consolidada de vários titulares é nula e exibida por entidade. Lock conservador por empresa exige avaliação de carga futura. `cashflow.manage` foi declarado sem concessões automáticas; matriz real depende de aprovação.

## Próximo lote / Etapa 9

**A Etapa 9 pode começar em ambiente isolado para conciliação independente.** Não há liberação para produção nem encerramento financeiro da Etapa 8. Próximo lote: obter extratos/aberturas/documentos autorizados e responsáveis D01–D14; fixar recortes T/K, conferir origem→título→liquidação→extrato e cobertura R/C/P por entidade/obra; executar CT10 e completar os casos parciais, priorizando retenções, multiobra e recebimentos. Submeter aceites a responsáveis identificados, sem preencher em nome deles.

[Arquitetura e arquivos](ARQUITETURA.md) · [Comandos](COMANDOS.md) · [Acompanhamento e aceites](ACOMPANHAMENTO.md) · [Planilha atualizada](Elos_OS_Quadro_Etapa8_Fluxo.xlsx)
