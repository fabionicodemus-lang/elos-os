# Inventário de entidades — Koper

> Memória viva do projeto (Seção 15 da constituição). Reconstruído em 2026-07-31 a partir do histórico de commits de `feature/koper-connector-bootstrap` e dos logs de diagnóstico do Railway — ver `docs/koper-progress.md` para o relato completo do ciclo que gerou cada linha. Atualizar esta tabela a cada avanço, não só ao final da entidade.

---

## `stock_request` — Solicitações de estoque

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Suprimentos |
| rota visual | `https://app.koper.com.br/suprimentos/solicitacoes/` (chegada via clique: abrir menu "Suprimentos" → clicar item visível "Solicitações"; não há link/rota direta detectável no DOM) |
| endpoint | `GET https://api.koper.com.br/stock/v1/request` — **REST, não GraphQL** (ver `CLAUDE.md`, Seção 18) |
| operação | N/A (REST simples, sem `operationName`) |
| variáveis (query params confirmados) | `group=request`, `limit=25`, `offset=0`, `open=yes`, `orderFlag=desc`, `orderby=requestDate`, `typeDate=requestDate`, além de `accessToken` e `cb` (cache-buster, não é segredo de sessão persistente — mas tratar como sensível por segurança) |
| paginação | offset-based (`limit`/`offset`); **não confirmado ainda** se `itemsAmount` no corpo da resposta é o total geral ou só da página, nem o comportamento ao avançar `offset` além da primeira página |
| campos principais (confirmados na resposta) | `itemsAmount`; por item em `requests[]`: `requestId`, `requestAuxId`, `stockPlaceId`, `stockPlaceName`, `productAmount`, `requestDate`, `deadline`, `status`, `userName`, `userId`, `isUrgent`, `userAbbreviation`, `notApprovedAmount`, `isDraft`, `deadlinePeriod` |
| campos visíveis na tela (não necessariamente 1:1 com a API) | Solicitação (nº, ex. `#10531`), Local De Consumo, Quantidade, Solicitado Em, Entregar Até, Status |
| identificador | **Não confirmado.** Candidatos: `requestId` (provável PK interna) vs. `requestAuxId` (número público exibido, ex. `#10531`, `#8649`). Antes de gravar qualquer staging, confirmar qual dos dois é estável e único — ver regra da Seção 8.2 da constituição: nunca usar nome/descrição como chave, e se não houver ID imutável confirmado, parar e perguntar. |
| relacionamentos | `stockPlaceId` → local de estoque/obra (nome já vem em `stockPlaceName`; amostra observada inclui "Escritório Central" e "Soul Residence" — indica que `stockPlaceId` pode misturar centros administrativos e empreendimentos, não só obras); `userId` → usuário solicitante (nome em `userName`, abreviação em `userAbbreviation`) |
| volume encontrado | Não medido ainda — só a primeira página (`limit=25`) foi observada. Amostra visível na tela incluía registros de datas entre 2023 e 2026. |
| endpoint relacionado observado | `GET https://api.koper.com.br/stock/v1/stock_place` (`accessToken`, `cb`) — provável listagem de locais de estoque para filtro; não investigado a fundo ainda |
| tabela staging | Não criada. |
| tabela final Elos OS | Não definida. |
| status | **descoberto** (listagem confirmada; detalhe, paginação completa e identificador imutável ainda em aberto — ver Marco Técnico, Seção 16, itens 4, 7, 8) |

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
