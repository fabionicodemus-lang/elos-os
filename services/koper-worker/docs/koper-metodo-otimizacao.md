# Leitura do processo e proposta de otimização — conector Koper

> Escrito em 2026-07-31 a pedido do Fábio, após ~40 ciclos de descoberta em dois dias. Este documento lê o que funcionou, o que consumiu tempo desproporcional, e propõe mudanças concretas de método. Mudanças que afetam regras da constituição estão marcadas e só entram em vigor depois que o Fábio aprovar e a constituição for editada (Seção 0 e 17 dela).

---

## 1. Números do processo até aqui

| Entidade / marco | Ciclos (aprox.) | Resultado |
|---|---:|---|
| Fundação (worker, login, Browserless, Railway) | ~20 commits | fechado em 1 dia |
| Solicitações de estoque — listagem + detalhe + navegação | ~15 ciclos | **fechado** (PR #152 mesclado) |
| Multi-empresa (descoberta + troca Bossa→Flow) | ~6 ciclos + 1 mapeamento manual | **fechado** |
| Orçamentos — listagem histórica (filtro "Todos" + paginação) | ~10 ciclos | **fechado** (440 registros) |
| Orçamentos — detalhe da cotação 3268 | **5 ciclos** | **ainda bloqueado** |

Custo médio real de um ciclo completo (hipótese → código → typecheck/build → commit → push → build Railway → deploy → diagnóstico roda → ler log → esvaziar variável): **4 a 7 minutos** quando tudo funciona, mais que o dobro quando o Browserless encerra a sessão no meio ou o conector Railway/GitHub cai da conversa.

## 2. O que funcionou bem (manter)

1. **Uma hipótese por commit, com a hipótese na mensagem.** O histórico do git é legível como um caderno de laboratório. Foi isso que permitiu reconstruir a documentação perdida e fazer handoffs entre ferramentas (Claude Code → ChatGPT → Cowork → Claude Code) sem perder o fio.
2. **O limite de 3 tentativas por bloqueio** (Seção 5). Evitou afundar horas no filtro de período e no detalhe 3268; forçou parar e pedir evidência visual ao Fábio.
3. **Prints + descrição manual do Fábio.** Os dois maiores destravamentos do projeto vieram deles: a estrutura multi-empresa (que invalidava uma premissa silenciosa de todo o trabalho anterior) e a ordem das opções do menu de período (que destravou o clique por coordenada). Custo: minutos. Equivalente automatizado: 5-10 ciclos cada.
4. **Documentação viva como memória** (`koper-progress.md`, `koper-inventory.md`, Seção 18 da constituição). As trocas de sessão só funcionaram porque isso existia.
5. **Interceptor de segurança com `blockedWrites`.** Os POSTs GraphQL aparecem no relatório sem serem executados — dá visibilidade sem risco.

## 3. Onde o tempo foi perdido (as três classes de desperdício)

### Classe A — brigar com o DOM do Angular por clique (o maior custo)

O Koper (app.koper.com.br) é AngularJS com tabelas virtualizadas, dropdowns customizados sem atributos declarativos (`href`, `ng-click` visível, `role`) e listeners anexados por JavaScript. Resultado: **descobrir "onde clicar" custa muito mais caro que descobrir "qual endpoint a tela chama"**:

- filtro "Todos" do período: 6+ ciclos (select nativo → clique textual → alinhamento visual → coordenada relativa);
- detalhe da cotação 3268: 5 ciclos até agora, incluindo o de hoje — o `td.ng-binding`/`tr.ng-scope` existe no DOM, mas o Playwright não o resolve como clicável (virtualização), nem via `xpath=ancestor::tr[1]`.

O padrão é claro: **cada clique novo em componente customizado do Koper custa 3-6 ciclos.** E o clique em si não é o objetivo — é só o meio de fazer a tela disparar o GET que queremos observar.

### Classe B — um redeploy (ou três) por execução de diagnóstico

O Caminho A (variável de startup) implica: setar variável → redeploy (~60-90s) → ler log → esvaziar variável. Quando também há mudança de código, são dois deploys por ciclo. Isso é o piso de ~4 minutos por hipótese, mesmo quando a hipótese é trivial.

### Classe C — instabilidade da sessão/ferramentas

- Conector Railway caiu desta conversa 3+ vezes; GitHub oscilou; uma troca de ferramenta inteira (para o ChatGPT/Cowork) foi causada por isso.
- Browserless encerrou sessões longas no meio do diagnóstico (`Target page ... has been closed`) pelo menos 3 vezes — cada uma custou um ciclo inteiro sem resultado.
- Commits de documentação duplicados (`e90b3c2`/`84c52c2`, `cd8f219`/`5fa6a55`, `bc57d04`/`b931825`) — sintoma de sessões que não sabiam se o push anterior tinha funcionado.

## 4. Proposta — em ordem de impacto

### 4.1 Sessão de gravação assistida (LiveURL) — resolve a Classe A na raiz

**A mudança de maior impacto imediato.** A fundação do worker já teve um modo de sessão visual com LiveURL do Browserless (removido no commit `3fa21b61` quando o login automático ficou pronto). Reativar uma versão dele, agora com o interceptor de captura ligado:

1. O worker abre a sessão, faz login automático, troca para a empresa-alvo, liga a gravação de rede (só GETs de `api.koper.com.br`, sanitizados como hoje) e devolve a `liveUrl`.
2. **O Fábio navega manualmente** por 10-15 minutos: abre a cotação 3268, passa por Produtos, Frete e Pagamento, abre um pedido de compra, um recebimento, uma nota.
3. O worker entrega o relatório com todos os endpoints, parâmetros e formas de resposta observados.

Uma sessão dessas mapeia o que custaria **10-20 ciclos automatizados**. O clique que o Playwright não consegue dar, o Fábio dá em um segundo. A automação entra depois, já sabendo o endpoint — que é o que interessa para a extração (a Fase 6 da constituição já diz: sincronização usa as operações descobertas, não o crawl visual).

Segurança: a mesma allowlist e o mesmo interceptor de hoje continuam ativos (escritas bloqueadas mesmo se houver clique errado — só leitura passa); `liveUrl` é temporária e privada; nada de novo é logado.

### 4.2 Replay direto de GETs já conhecidos — elimina cliques repetidos

Para endpoints **já observados** (ex.: `GET /purchase/v1/budget`), parar de reproduzir a jornada visual inteira a cada diagnóstico. Executar o GET diretamente do contexto da página autenticada (`page.evaluate(fetch)` na mesma origem), com allowlist explícita de endpoints e parâmetros. É leitura, já permitida pela constituição; a jornada visual só é necessária na **primeira** descoberta de cada tela.

Exemplo concreto: paginar as 440 cotações (18 páginas) por replay leva ~20 segundos; por rolagem visual levaria 18 esperas de scroll + risco de timeout.

*(Nota: reconstruir chamadas com autenticação própria fora do navegador foi descartado pelo Fábio — isso continua valendo. O replay proposto roda dentro da sessão do navegador, com as credenciais que a própria interface já usa.)*

### 4.3 Diagnóstico sem redeploy — corta a Classe B

O worker já expõe `POST /diagnostics/koper/<nome>` autenticado por `WORKER_API_KEY`, e o serviço tem domínio público (`koper-worker-production.up.railway.app`). Ou seja: **o Caminho B já existe e não precisa de redeploy** — só é preciso usá-lo:

- O Fábio (ou um atalho/script local dele) dispara `curl -X POST https://<dominio>/diagnostics/koper/<nome> -H "Authorization: Bearer $WORKER_API_KEY"` e cola o JSON na conversa.
- O Caminho A fica reservado para quando **o código mudou** (aí o deploy é inevitável de qualquer forma, e o diagnóstico de startup pega carona nele — 1 deploy por ciclo, nunca 2-3).
- Adicionar um parâmetro de query simples aos diagnósticos (ex.: `?budgetId=3268`) para variar a execução **sem** recompilar — hoje qualquer variação de alvo exige commit+deploy.

### 4.4 Persistir a sessão autenticada — corta 20-30s por execução e os timeouts

Cada diagnóstico refaz login + troca de empresa (~30-40s dos ~60-90s totais). Persistir o estado de sessão (cookies/storage criptografados, como o README da fundação já previa) e reutilizá-lo entre execuções:

- diagnósticos passam a começar já autenticados no Flow;
- execuções ficam curtas o suficiente para não esbarrar no timeout do Browserless (a causa das 3 mortes de sessão);
- detecção de expiração → refaz login uma vez e re-persiste.

### 4.5 Higiene de processo (custo zero, ganho constante)

1. **Confirmar push antes de re-commitar** (os docs duplicados vieram daí). `git log origin/<branch> -1` após cada push.
2. **Documentar em lote no fim do ciclo**, num único commit de docs, em vez de 2-3 commits pequenos de doc por ciclo (cada um dispara um deploy no Railway à toa — o serviço redeploya até por mudança de `.md`). Alternativa melhor ainda: configurar **watch paths** no Railway para ignorar `docs/**` e `*.md`.
3. **Ao trocar de sessão/ferramenta**, o handoff aponta para os documentos do repositório como fonte única (como já foi feito), nunca duplica o estado no prompt.

### 4.6 Começar a extração em paralelo — o maior ganho estratégico

Solicitações de estoque (Flow: 902 registros) e a listagem de cotações (440) já têm **contrato fechado e validado**. A construção do cliente de produção (`src/koper/`), da staging e da idempotência **não depende de nenhum clique no Koper** — é trabalho de código puro, imune às Classes A e C. Proposta: intercalar — enquanto uma rodada de descoberta espera print/LiveURL do Fábio, avançar a extração das entidades fechadas. O PR #152 foi mesclado, então o marco de revisão da constituição (Seção 6) foi cumprido; falta só o Fábio autorizar explicitamente o início da Fase de staging (itens 9-13 do Marco Técnico).

## 5. O que isso muda na prática — próxima semana proposta

| Prioridade | Ação | Depende de |
|---|---|---|
| 1 | Reativar sessão LiveURL com captura de rede; Fábio navega pelo detalhe da 3268 (Produtos/Frete/Pagamento) e mais 2-3 telas do fluxo (pedido, recebimento, NF) | ~1 ciclo de código + 15 min do Fábio |
| 2 | Com os endpoints do detalhe em mãos, implementar replay direto (4.2) e fechar o contrato de `quotation` inteiro | resultado da ação 1 |
| 3 | Persistência de sessão autenticada (4.4) | nada — pode começar já |
| 4 | Autorização do Fábio para staging de `stock_request` (RLS + migration + amostra Flow, itens 9-13 do Marco) | decisão do Fábio |
| 5 | Watch paths no Railway ignorando `docs/**` | 2 min no painel |

## 6. Mudanças que precisam de aprovação do Fábio antes de valer

1. **4.1 (LiveURL)** — não contraria a constituição, mas reintroduz um fluxo removido; aprovar explicitamente.
2. **4.2 (replay de GET dentro da página)** — coerente com "somente leitura", mas é um mecanismo novo; se aprovado, registrar na Seção 18 da constituição com a allowlist.
3. **4.6 (começar staging)** — é literalmente o próximo item do Marco Técnico, mas a constituição exige validação de RLS e amostra revisada pelo Fábio; precisa do "vai" dele e do CNPJ da Bossa para resolver o `tenant_id` (Seção 3.5).

Tudo o mais (4.3, 4.4, 4.5) é otimização de operação dentro das regras atuais e pode ser adotado imediatamente.
