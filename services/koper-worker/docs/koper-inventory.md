# Inventário de entidades — Koper

> Memória viva do projeto (Seção 15 da constituição). Reconstruído em 2026-07-31 a partir do histórico de commits de `feature/koper-connector-bootstrap` e dos logs de diagnóstico do Railway — ver `docs/koper-progress.md` para o relato completo do ciclo que gerou cada linha. Atualizar esta tabela a cada avanço, não só ao final da entidade.

---

## `stock_request` — Solicitações de estoque

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Suprimentos |
| rota visual (listagem) | `https://app.koper.com.br/suprimentos/solicitacoes/` (chegada via clique: abrir menu "Suprimentos" → clicar item visível "Solicitações"; não há link/rota direta detectável no DOM) |
| rota visual (detalhe) | `https://app.koper.com.br/suprimentos/solicitacoes/{requestId}` (ex.: `.../8649`), alcançada clicando na linha (`table tbody tr`) da listagem |
| endpoint (listagem) | `GET https://api.koper.com.br/stock/v1/request` — **REST, não GraphQL** (ver `CLAUDE.md`, Seção 18) |
| endpoint (detalhe) | `GET https://api.koper.com.br/stock/v1/product_request?requestId={numero}` — **endpoint diferente do de listagem**, não é `/stock/v1/request/{id}` |
| operação | N/A (REST simples, sem `operationName`) |
| variáveis — listagem (query params confirmados) | `group=request`, `limit=25`, `offset=0`, `open=yes`, `orderFlag=desc`, `orderby=requestDate`, `typeDate=requestDate`, além de `accessToken` e `cb` (cache-buster, tratar como sensível por segurança) |
| variáveis — detalhe (query params confirmados) | `requestId={numero}` (obrigatório, ex. `8649`), `group=request`, `appVersion`, `visited-page` (caminho da tela atual), além de `accessToken` e `cb` |
| paginação | offset-based (`limit`/`offset`) na listagem; **não confirmado ainda** se `itemsAmount` reflete o total geral ou só da página, nem o comportamento ao avançar `offset` além da primeira página |
| campos principais — listagem (confirmados na resposta) | `itemsAmount`; por item em `requests[]`: `requestId`, `requestAuxId`, `stockPlaceId`, `stockPlaceName`, `productAmount`, `requestDate`, `deadline`, `status`, `userName`, `userId`, `isUrgent`, `userAbbreviation`, `notApprovedAmount`, `isDraft`, `deadlinePeriod` |
| campos principais — detalhe (confirmados na resposta) | `itemsAmount`, `stockPlaceName`, `requestDate`, `userName`, `userId`, `deadline`, `showDeadline`, `stockPlaceId`, `techAssistId`, `buildMonitoringId`, `isDraft`, `requestId`, `status`, `requestAuxId`, `notApprovedAmount`, `commentRequest`, `filename`, `fileId`, e **itens** em `products[]`: `productId`, `productName`, `productFullName`, `mainProductId`, `genericProdSeq`, `prodReference`, `productAmount`, `prodFinished`, `prodCanceled`, `prodCancelRequest`, `approvedTransf`, `approvedPurchase`, `productRequestId`, `approvedAmount`, `approvedDate`, `approvedUserName`, `historyId`, `historyMessage`, `unitMeasureId`, `symbol`, `inputId`, `inputUnit`, `specialMeasure`, `comments`, `totalComments`, `enabledToCancel`, `measures`, e serviços em `products[].services[]`: `itemMonitInputId`, `monitInputPchId`, `inputAmount` |
| campos visíveis na tela (não necessariamente 1:1 com a API) | Solicitação (nº, ex. `#10531`), Local De Consumo, Quantidade, Solicitado Em, Entregar Até, Status |
| identificador | **Quase confirmado, falta comparar valores.** O endpoint de detalhe é endereçado por `requestId` como query param (valor `8649` = mesmo número da rota e do texto exibido `#8649`) — forte candidato a `koper_id`. A resposta do detalhe também expõe `requestAuxId` como campo **separado**; ainda não capturamos os *valores* de `requestId` e `requestAuxId` lado a lado no mesmo registro para provar se são iguais. Próximo diagnóstico deve capturar esses dois valores especificamente antes de decidir em definitivo (Seção 8.2 da constituição: nunca usar nome/descrição como chave, e não gravar staging sem confirmar o ID imutável). |
| relacionamentos | `stockPlaceId` → local de estoque/obra (nome em `stockPlaceName`; amostra observada inclui "Escritório Central" e "Soul Residence" — indica que `stockPlaceId` pode misturar centros administrativos e empreendimentos, não só obras); `userId` → usuário solicitante (nome em `userName`, abreviação em `userAbbreviation`); `products[].productId` → produto/material; `techAssistId`, `buildMonitoringId` → possíveis vínculos com assistência técnica e monitoramento de obra, ainda não investigados |
| volume encontrado | Não medido ainda — só a primeira página (`limit=25`) da listagem e um registro de detalhe (`#8649`) foram observados. Amostra visível na tela incluía registros de datas entre 2023 e 2026. |
| endpoint relacionado observado | `GET https://api.koper.com.br/stock/v1/stock_place` (`accessToken`, `cb`) — provável listagem de locais de estoque para filtro; não investigado a fundo ainda |
| tabela staging | Não criada. |
| tabela final Elos OS | Não definida. |
| status | **descoberto** (listagem e detalhe confirmados; paginação completa e valor exato do identificador imutável ainda em aberto — ver Marco Técnico, Seção 16, itens 4, 8) |

---

## `engineering_work` — Obras (módulo Engenharia)

> Mapeado manualmente pelo Fábio via prints em 2026-07-31, não por diagnóstico automatizado. Ver `docs/koper-progress.md`, ciclo "Mapeamento manual — módulo Engenharia e seletor de empresa".

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Engenharia |
| rota visual | `https://app.koper.com.br/engenharia/obras` (caminho: ícone "Engenharia" na barra vertical esquerda → "Obras" no submenu) |
| endpoint | não descoberto |
| empresa observada | Bossa Empreendimentos |
| obras observadas | ESCRITÓRIO CENTRAL (Itapema-SC, Edifício Comercial, sem data de conclusão); SOUL RESIDENCE (Itapema-SC, Edifício Residencial, conclusão 28/10/2023) |
| campos visíveis na tela | nome da obra, localização, tipo, data de conclusão; card com botão "VER MAIS DETALHES"; controles: "ORDENAR POR" (padrão "Nome da obra A-Z"), "Pesquisar em obras", "+ OBRA", "VER FINALIZADAS", contador "Número de registros" |
| menu lateral do módulo (não explorado ainda) | Obras, Orçamentos de obra, Planejamento de obra, Acompanhamento de obra, Diário de obra, Ordens de produção, Contratos e medições (com submenu), Cadastros (com submenu) |
| status | **rota visual confirmada; API ainda não descoberta** |

## Entidade transversal — Empresas do Koper (escopo multi-empresa)

> **Achado crítico, mapeado manualmente em 2026-07-31.** Cada empreendimento da Bossa é tratado no Koper como uma **empresa separada**, não como uma obra dentro de uma única empresa. Isso afeta todo o desenho do conector — ver `CLAUDE.md`, Seção 18, e `docs/koper-progress.md` para a implicação completa.

| Campo | Conteúdo |
|---|---|
| comportamento | seletor de empresa ativa no canto superior direito da interface; a empresa selecionada define o escopo de todos os dados carregados nas telas e (presumivelmente) nas chamadas de API |
| escopo conhecido até agora | **Bossa Empreendimentos** (custos administrativos, escritório central, e pós-obra do Soul Residence — contém as obras ESCRITÓRIO CENTRAL e SOUL RESIDENCE); **empresa do Flow** (dados operacionais/financeiros/engenharia/suprimentos do Flow Aptos — nome e ID exatos ainda não capturados); **empresa do Alma** (idem, para Alma Seahouses — nome e ID exatos ainda não capturados) |
| endpoints candidatos (já observados em capturas de rede anteriores, ainda não confirmados como a fonte da lista de empresas) | `GET https://api.koper.com.br/administrative/v1/enterprise` e `GET https://api.koper.com.br/administrative/v1/multi_company` — ambos vistos no diagnóstico `discover-stock-route` de 2026-07-30 (`accessToken`, `cb`, `page`), nunca inspecionados a fundo |
| identificador | não descoberto — priorizar ID original do Koper e/ou CNPJ; nunca usar posição no menu ou nome como chave |
| mecanismo de troca de empresa | não descoberto (variável GraphQL, header, cookie, `localStorage`/`sessionStorage`?) |
| status | **seleção visual confirmada; nomes completos, IDs e API ainda não descobertos** |

---

## Todas as demais entidades do fluxo prioritário

Ainda **não iniciado**: cotação, participantes/preços, pedido de compra, recebimento, nota fiscal, conta a pagar, pagamento — e toda a Fase 2 (cadastros-base: empresas, empreendimentos, obras, centros de custo, etapas, fornecedores, clientes, unidades imobiliárias, usuários).

| entidade | status |
|---|---|
| cadastros-base (Fase 2) | não iniciado |
| quotation (cotação) | não iniciado |
| purchase_order (pedido de compra) | não iniciado |
| receipt (recebimento) | não iniciado |
| invoice (nota fiscal) | não iniciado |
| accounts_payable (conta a pagar) | não iniciado |
| payment (pagamento) | não iniciado |
| comercial / contas a receber (Fase 5) | não iniciado — **lembrete:** antes de desenhar qualquer estrutura de recebíveis/CUB, rodar grep por `CUB`, `receb`, `correc`, `INCC`, `IPCA` no repositório (Seção 11 da constituição); já existem migrations `supabase/migrations/20260723_0007_koper_receivable_details.sql` e `20260723_0007_koper_receivables_audit.sql` que precisam ser revisadas antes de duplicar trabalho. |
