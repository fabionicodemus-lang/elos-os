# Importação limpa do sistema legado → Elos OS

Plano completo: documento "Importação limpa Koper → Elos OS" (Claude Docs). Este arquivo registra o que já foi executado no banco de produção (`elos-os-dev`).

## Regras
- Nenhum nome do sistema de origem em campo visível. O vínculo vive em `integration_mappings` e em `source_system/source_id`.
- O cadastro do Elos manda; o que não existe é criado no padrão Elos.
- Documentos entram pelo caminho nativo (solicitação → cotação → pedido → recebimento → nota → título; contrato → medição → nota manual → título).
- Renumeração no padrão Elos; histórico desde o início do Flow; cancelados não entram.
- Toda exclusão guarda cópia em `elos_import.backup_rows`.

## Executado (18/out/2026)
| Etapa | Resultado |
| --- | --- |
| Fundação | esquema `elos_import` (rodadas, pendências, backup, de-para) |
| Fornecedores | 643 da origem: 581 vinculados por CPF/CNPJ, 62 criados, 47 cadastros antigos limpos |
| Insumos | 6.587 produtos: casados com o catálogo mestre e copiados para a Bossa; 157 criados como `NV.01` |
| Contas | 31 contas da origem → 15 no Elos (as "provisórias" de Flow/Alma são a mesma conta física) |
| Orçamento | Rev03 promovido no Flow Aptos (código O1, versão R03), 157 itens, R$ 20.031.838,33 |
| De-para | 158 centros de custo do acompanhamento do Flow → serviços do orçamento (`flow-depara-centros-de-custo.json`); grupo 29 vai para viabilidade |
| Solicitações (2a) | 839 SM, 3.464 itens; 237 itens sem centro de custo (SEM-CC), 5 de viabilidade |
| Pedidos (2b) | 1.346 PC, 3.723 itens, 3.365 vínculos com solicitação |
| Recebimentos (2c) | 1.066 REC, 3.129 itens (custo do item do pedido) |
| NF-e (2d) | 1.069 NFE, R$ 4.663.850,01 = origem; 4 canceladas fora; XML original não acompanha (caminho neutro pela chave) |
| Títulos de NF-e (2e) | 1.523 títulos, R$ 4.583.072,41 = origem; 1.468 pagos com data, valor e conta |
| Contratos e medições (3a) | 22 CT (cadeia SS → MC → CT), R$ 5,16 mi contratados; 138 MED aprovadas, R$ 2.325.837,44 |
| Notas manuais (3b) | 1.864 NM, R$ 12.425.297,19 líquido = títulos; 262 ligadas a contrato, 47 a medição |
| Demais títulos (4) | 2.560 títulos, R$ 14.850.110,42 = origem (tributos, contas avulsas, créditos, vendas, comissões, medições) |
| Comercial (5) | 39 unidades, 35 vendas ativas (VD-0001…0035) e 5 distratos (VD-0036…0040); 3.698 parcelas, R$ 13.730.856,26 recebidos |
| Bancos (6) | 5.672 movimentos ligados aos títulos (+9 recebimentos da Beatriz/Marcela em 18/10) |
| Transferências e avulsos (7) | extrato completo das 11 contas do Flow (5.969 movimentos) lido da tela Contas bancárias: 5 transferências entre contas do Flow, 168 transferências com outras empresas do grupo e 130 lançamentos avulsos (tarifas, integralização, pró-labore, ajustes). Saldo de cada conta do Flow no Elos = extrato da origem, ao centavo |
| Diário de obra (8) | 599 RDOs aprovados (09/10/2023 a 30/09/2026) com os 1.180 registros da origem: efetivo nas observações do dia, 590 ocorrências e 4 reuniões, clima de manhã/tarde/noite (1.078). Clima da origem lido como 1 ensolarado, 2 nublado, 3 chuva, 4 tempestade. Os 6 anexos ficam para a etapa de anexos |
| Distratos | 7 distratos com data, valor recebido, devolvido (títulos "Distrato VD-…" no contas a pagar) e retido nas observações da venda |
| Total a pagar | 4.083 títulos, R$ 19.433.182,83 = origem (títulos agrupadores ficam de fora para não duplicar) |

## Pendências abertas
- R$ 4,86 mi sem centro de custo na origem (SEM-CC): sugestão por regras em `elos_import.sem_cc_groups` (291 grupos), planilha enviada ao Fábio para decisão.
- 4 títulos duplicados que o atualizador antigo gravou na Flow Aptos foram cancelados; a rotina antiga (koper-audit-runner) foi desligada em 18/10 (comando trocado por um aviso). Não aceitar a mudança antiga que está pendente nesse serviço.
- Vendas da Beatriz Cristina Marques Almeida (2302, VD-0041) e da Marcela Gomes Lourenço (1901, VD-0042) lidas da tela de Vendas da origem e criadas em 18/10; as 99 parcelas (R$ 1.811.510,19) foram ligadas. Clientes criados sem CPF (o CPF não é copiado da origem; preencher no cadastro).
- Tela de Vendas da origem (18/10): 51 unidades (37 vendidas R$ 26.177.197,59 + 14 disponíveis R$ 14.455.127,30) = Elos; 12 unidades disponíveis criadas. 37 vendas ativas = origem. Distratos: 7 no Elos (VD-0036…0040 com valor e data corrigidos pela origem; VD-0043 Joaquim/503 e VD-0044 Marilei/803 criados, sem parcelas). A venda cancelada da Atmosfera (901) foi refeita no mesmo dia para o mesmo cliente e não entrou como distrato — confirmar com o Fábio.
- Contas a receber: 3.797 parcelas, R$ 14.233.282,83 recebidos = origem.
- A rotina antiga do Flow também está travada no banco (`elos_import.block_old_flow_sync`): títulos `koper_flow` e fornecedores automáticos na Flow Aptos são recusados.
- Exclusão do Flow2 após a conciliação final.

## Conciliação do orçamento (analítico × RESUMO GRUPOS)
O RESUMO soma R$ 19.959.432,07. O orçamento no Elos fecha em R$ 20.031.838,33 (+R$ 72.406,26), diferença que vem do próprio analítico:
grupo 01 +1.155, grupo 02 +33.447, grupo 14 +7.250, grupo 16 +220, grupo 18 +30.334.
Incluídos por decisão do Fábio os valores que só existem no RESUMO: Decoração R$ 900.000 (28.01) e Ligação externa ao lote R$ 30.000 (02.10).
O 03.16 foi reduzido a Forma + Armadura (R$ 302.561,48) porque a planilha soma nele também o 03.16.06, que já é serviço próprio.
