# Ponte financeira por fonte, empresa, obra e corte

Esta ponte observa registros efetivos do PostgreSQL isolado e extratos fixados pelos inputs aprovados, separadamente do algoritmo financeiro do Elos. Cada caso tem obra/conta próprias, embora reutilize a organização fictícia A e o titular fictício A1. Os UUIDs e eventos/documentos constam em `evidencias/ponte.json` e `registros.json`; os extratos originais do teste em `extratos-referencia.json`. Nenhum dos valores representa Bossa/Flow/Alma.

O saldo auxiliar de R$1.000.000 por conta apenas permite executar a massa isolada. Não integra os expected originais, não é abertura documental aprovada nem valida I20. O saldo confirmado permanece null. A diferença abaixo compara os movimentos registrados com linhas de extrato definidas independentemente; zero significa igualdade no perímetro fictício explicitamente enumerado, não completude de uma conta real.

| Fonte/caso | Organização/titular | Obra/conta | Corte T | Saídas registradas | Entradas registradas | Líquido no extrato | Diferença banco | Diferença títulos/ledger |
|---|---|---|---|---:|---:|---:|---:|---:|
| CT03 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 5.000,00 | R$ 0,00 | R$ -5.000,00 | R$ 0,00 | R$ 0,00 |
| CT13 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 0,00 | R$ 14.000,00 | R$ 14.000,00 | R$ 0,00 | R$ 0,00 |
| CT14-fee | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 0,00 | R$ 9.800,00 | R$ 9.800,00 | R$ 0,00 | R$ 0,00 |
| CT14-barter | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 0,00 | R$ 30.000,00 | R$ 30.000,00 | R$ 0,00 | R$ 0,00 |
| CT23 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 16.000,00 | R$ 0,00 | R$ -16.000,00 | R$ 0,00 | R$ 0,00 |
| CT22 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 0,00 | R$ 20.000,00 | R$ 20.000,00 | R$ 0,00 | R$ 0,00 |
| CT06 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 100.000,00 | R$ 0,00 | R$ -100.000,00 | R$ 0,00 | R$ 0,00 |
| CT10 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-21 | R$ 10.000,00 | R$ 0,00 | R$ -10.000,00 | R$ 0,00 | R$ 0,00 |
| CT10 | Fictícia A / A1 | UUIDs em ponte.json | 2026-10-22 | R$ 10.000,00 | R$ 6.000,00 | R$ -4.000,00 | R$ 0,00 | R$ 0,00 |

A ponte por título conserva principal + encargos − principal liquidado − encargo liquidado − desconto − compensação = saldo; inversos têm sinal próprio. A verificação é feita sobre eventos/linhas brutos e confrontada com a projeção armazenada. Não usa `titlePosition` ou `contractRemainder` para produzir seu lado independente. Pai econômico, custo, restituição e contrato sem vínculo continuam fora do total validado, com null explícito. Uma ponte aritmética pode fechar e o fato econômico estar errado: CT10 demonstra essa diferença.

CT06 preserva filhos fornecedor/tributo/retenção, mas o documento pai e liberação nativa não foram simulados como comprovados. CT22 preserva referência de contrato/aplicação, porém não há comprovação de I18 completo. CT10 possui contrato e auditoria reais no scaffold, adiantamento, cancelamento e tentativa de estorno; não há conversão em direito de restituição.

## Ponte histórica, sem corte comum

Os 27 originais do catálogo foram reabertos/conferidos por hash, em modo somente leitura. Seis XLSX F011–F016 contêm versões da mesma população de3.261 IDs, com soma de linhas R$13.710.826,32 em cada; não são somados. Empresa/obra são declarações do catálogo, sem validação de titular jurídico. Corte operacional atual, snapshot Elos correspondente e banco confirmado permanecem desconhecidos.

F011, `Titulos_Koper`, linhas5–3265: subtotal de principal R$13.710.826,32. F007, PDF20, cabeçalho: R$13.561.236,99 e3.261 registros. Diferença **R$149.589,33**, ainda sem causa documental demonstrada. Banco, competência e cobertura contratual não podem ser inferidos dessa diferença. `fontes-historicas.json` guarda identidade declarada, cortes, cobertura, hashes e limitações de cada fonte; `linhas-historicas.json` guarda referência fonte/aba/linha/documento e conserva valores ausentes como null.

O título16032 não aparece nos seis XLSX; isso não prova cancelamento nem resolve sua divergência histórica. A pendência dos26 títulos/R$209.126,91 é informação do handoff, sem confronto atual nesta entrega. Baixa declarada do ERP não é recebimento/pagamento bancário confirmado.

## Ponte ainda ausente

Para uma ponte real: definir entidades/contas/obras e um T comum com K preservado; obter snapshot do destino, origem Koper somente leitura com manifesto, extratos contínuos e abertura comprovada, contratos/itens/aditivos/medição e alocações. Conferir IDs/parcelas/valores/credor, débitos/créditos, faixas e substituições, mantendo exceções. Não há autorização técnica implícita para produção nem responsável nominal de aceite informado.
