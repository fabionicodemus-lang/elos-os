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

## Conciliação do orçamento (analítico × RESUMO GRUPOS)
O RESUMO soma R$ 19.959.432,07. O orçamento no Elos fecha em R$ 20.031.838,33 (+R$ 72.406,26), diferença que vem do próprio analítico:
grupo 01 +1.155, grupo 02 +33.447, grupo 14 +7.250, grupo 16 +220, grupo 18 +30.334.
Incluídos por decisão do Fábio os valores que só existem no RESUMO: Decoração R$ 900.000 (28.01) e Ligação externa ao lote R$ 30.000 (02.10).
O 03.16 foi reduzido a Forma + Armadura (R$ 302.561,48) porque a planilha soma nele também o 03.16.06, que já é serviço próprio.
