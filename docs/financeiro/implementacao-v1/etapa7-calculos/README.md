# Etapa 7 — liquidações e cálculos financeiros

**CT07 corrigido no ambiente isolado. Etapa 7 entregue parcialmente, em validação; conjunto de 30 cenários não homologado.** Produção e ambiente remoto do Koper não foram acessados ou alterados. Nenhum deploy, migração remota, saneamento ou backfill de dados reais foi executado.

Implementação: commit local `3daa96e3c0ccb64f2ffd18bd31045b2f52cde75e`. [Manifesto final de fontes, hashes e resultados](evidencias/verificacao-final.json).

Branch `feat/financeiro-etapa7-calculos`, iniciada em `95d659ec71e1ee98abe0e61a06a6ec6f34ba9661`. Confirmados como ancestrais `494c55c` (Etapa 5) e `95d659e` (Etapa 6), com worktree inicialmente limpo. Mudanças e evidências anteriores preservadas; nenhuma reescrita do histórico.

Referência normativa: regras v0.1 da Etapa 3, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`; critérios/oráculos da Etapa 4 em `tests/financeiro/fixtures/casos_financeiros.json`, SHA-256 `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`. Nenhum resultado esperado foi alterado. Premissas fictícias dos casos não definem taxas, alçadas, vigência ou política operacional real D01–D14.

## Problemas comprovados e correções

| Prioridade financeira | Antes / problema | Depois / evidência |
|---|---|---|
| Crítica — CT07 | RPC encerrava o título após qualquer pagamento; índice bancário permitia apenas um movimento ativo por título | Livro imutável por evento/componente, múltiplas liquidações identificadas por comando; título só quita com saldo zero. `liquidacoes.json`, CT07 e exemplo do pedido; `render.log` |
| Alta — repetição e concorrência | Estado e movimento único não representavam parcelas; replay e operações iguais exigiam identidade distinta | Comando UUID + payload, lock de saldo e conta, transação atômica. Mesmo comando não repete; comandos concorrentes não excedem saldo; excesso não classificado rejeitado |
| Alta — reversão confundida com devolução | Edição de baixa não preserva a composição necessária para refazer saldo/caixa | Novo evento estorna componentes, mantém/revoga desconto explicitamente e só devolve caixa com prova. CT08 A/B/C: saldo 57.000/62.000; sem devolução, caixa pendente 57.000 |
| Alta — dupla contagem nativa | Nota com contrato e sem medição não cobria corretamente o saldo contratual | Vínculo real por FK nota/parcela/título reduz contrato. Contrato 1.000 + nota 400: futuro 600, total 1.000; antes somava 1.400. Nota + medição do mesmo escopo não duplica |
| Alta — inconsistência em consumidores | Parcial podia sumir do pago ou permanecer integral no aberto; pagamentos anteriores iam para a última data | Núcleo comum para AP/AR, comercial/incorporação, relatório, dashboard, orçamento/custo e IA. No exemplo: pago 30.000 + aberto 70.000; cada caixa usa seu evento/data. Medição quitada com desconto também fica com aberto zero, sem reabrir 5.000 |
| Alta — acesso IA | Caminho de proposta já executada retornava resultado antes de revalidar acesso | Permissão/empresa/entidade conferidas antes do replay; teste nega leitura de resultado de outra organização |
| Alta — custo/pagamento e orçamento | Pago sem prova econômica podia compor incorrido; residual orçamentário podia ser confundido com reestimativa | Evidência econômica pendente separada e preservada. Núcleo distingue R/C/P/Q de incorrido/ETC/EAC; desconhecidos não viram zero nem indicador certificado |
| Alta — CT12 ainda falha | Valor sem obra fica em quarentena, sem título operacional liquidável | Falha reproduzida e **não resolvida**: 6.000 com obra + 4.000 sem obra; pagamento 2.000 sem obra bloqueado, posição declarada 10.000 em vez de 8.000. Nenhuma atribuição fictícia à Flow |
| Média — centavos e leitura | Devolução agrupada pode perder centavo com arredondamento individual; consultas limitadas podem truncar totais | Maior resto conserva 1 centavo entre 3 títulos; relatórios/agenda paginam e propagam erro. Rateio e A Apropriar preservados |

## CT07: comparação numérica

| Sequência | Saldo aberto | Situação apresentada | Caixa acumulado |
|---|---:|---|---:|
| Original 100.000 | 100.000 | Em aberto | 0 |
| Primeiro pagamento 30.000 | **70.000** | **Parcialmente pago** | 30.000 |
| Segundo pagamento 70.000 | **0** | **Quitado** | 100.000 |

O oráculo aprovado CT07 também passou integralmente no banco isolado: primeiro pagamento 40.000 deixa 60.000; segundo liquida 55.000 de principal + 2.000 de juros e reconhece desconto 5.000. Final: H=95.000; desconto=5.000; juros pagos=2.000; caixa=97.000; aberto=0; C=0. Os oito resultados vieram da execução e foram comparados ao arquivo esperado independente.

Adicionalmente testados: repetição, payload conflitante, duas operações disputando saldo, estorno, devolução ou ausência dela, pagamento superior ao saldo e crédito excedente explicitamente classificado. O índice único legado foi preservado para movimentos externos ao novo livro. Repetição da RPC antiga é recusada para conservar o contrato anterior; UI/IA usam identidade UUID de comando.

## Resultado da validação

- **25/25 controles da Etapa 5**, com migrações candidatas instaladas e backup/restauração isolados, incluindo corrupção/erro de restore recusados.
- **24/24 controles da Etapa 6**, repetidos sobre o schema candidato.
- **81/81 regressões** das mesmas suítes anteriores. Esperados e asserções preservados. O harness de uma regressão só ganhou resolução do import do núcleo.
- **16/16 controles novos de banco**; um deles comprova a limitação CT12 e não significa aprovação financeira desse caso.
- **12/12 testes de componentes/carregadores** e **1/1 renderização SSR AP** exercitados. [Execuções e comandos](evidencias/execucoes.json).
- Comparador independente: **6/6** casos com saídas integrais no perímetro isolado; **3/3** oráculos completos de funções puras (CT18/19/21), mantendo esses três como cobertura parcial do fluxo.
- TypeScript e lint dos arquivos alterados verificados; resultados nos logs. Sem navegador/Auth E2E ou homologação humana.

[Resultado individual dos 30 cenários](CENARIOS-30.md): **6 integrais isolados, 17 parciais, 1 reprovado, 6 não executados**. O significado exato de integral é o perímetro automatizado documentado, não homologação de todas as interfaces ou conciliação bancária real. Totais bancários nas fixtures pressupõem a prova fictícia do caso; não certificam extratos reais.

## Estruturas e arquitetura

Duas migrações candidatas introduzem `finance_settlement_events`, `finance_settlement_lines`, `finance_title_charges`, projeções de saldo em AP/AR, view datada de caixa e RPCs transacionais; adaptam a execução financeira aprovada da IA. Eventos têm empresa/obra aplicável, autoria, data, motivo e componentes. RLS e auditoria anterior permanecem ativos; atualização direta de projeção e alteração de eventos são recusadas.

O inventário dos cálculos, funções, tabelas e consumidores, com diferenças conceituais e limites, está em [ARQUITETURA.md](ARQUITETURA.md). Não foi reconstruído o financeiro nem implementado o fluxo completo da Etapa 8. Exportações fiscais preservam valores documentais e não foram declaradas extratos financeiros conciliados.

## Riscos, limitações e próximo lote

1. **CT12 bloqueia aceite integral:** falta mecanismo operacional seguro por entidade para obrigação sem obra, preservando A Apropriar e autorização. Não resolver atribuindo obra padrão.
2. Retenções/tributos, cancelamento econômico, crédito antecipado AR, aplicação multiobra e cenário integrado CT28 ainda exigem teste integral e complementos locais.
3. Núcleo R/C/P/Q e ETC/EAC disponível; previsão descoberta aprovada, reestimativa e cobertura documental universal não estão integralmente persistidas/publicadas. Componentes puros não comprovam o ciclo operacional.
4. Cortes históricos T/K, retificação econômica e reprogramação completa permanecem pendentes. Bloqueio bancário existente não substitui fechamento econômico.
5. Sem evidência nova do Koper remoto, lista dos 26 extras, caso 16032, correspondências históricas, jobs remotos ou schema real conciliado. Não limpar nem interpretar legado automaticamente. Liquidações declaradas pendentes da origem bloqueiam nova baixa até apuração.
6. O schema de teste reutiliza o scaffold da Etapa 6; ele não prova equivalência completa do banco remoto. Sem credenciais produtivas, conciliação documental real, restore do backup real, teste de carga ou Auth/browser E2E. Migrações só poderão ser promovidas após revisão e aceites próprios.
7. Serialização conservadora por empresa pode reduzir throughput. Medir em homologação; nenhuma mudança de produção foi feita.

**Etapa 8:** a infraestrutura permite desenvolvimento isolado dos cenários independentes. O aceite integral da Etapa 7 continua impedido; não há liberação financeira/produtiva. Próximo lote recomendado: CT12 por entidade; conciliação posterior/retenções/cancelamentos; cobertura integrada e persistência de reestimativas. Só então ampliar o fluxo de caixa conforme os aceites aplicáveis.

[Quadro e critérios](ACOMPANHAMENTO.md) · [Planilha atualizada](Elos_OS_Quadro_Etapa7_Calculos.xlsx) · [Comandos](COMANDOS.md). Nenhum aceite financeiro foi emitido em nome de responsável.
