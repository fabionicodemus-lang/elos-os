# CLAUDE.md — Constituição do conector Elos OS × Koper

> **Escopo deste arquivo.** Este é o `CLAUDE.md` **do serviço `koper-worker`**. Ele vive em `services/koper-worker/CLAUDE.md` e complementa (não substitui) o `CLAUDE.md` da raiz do repositório. Sempre que você abrir uma sessão nova para trabalhar no conector Koper, leia este arquivo antes de qualquer outra coisa.

---

## 0. Como este arquivo é usado

Este documento é **a constituição** do conector Koper → Elos OS. Ele responde três perguntas:

1. **O que estamos construindo, e por quê.**
2. **Como estamos construindo — o método de trabalho.**
3. **O que é proibido, mesmo que pareça uma boa ideia no momento.**

Regras aqui são hierarquicamente superiores a instruções de sessão. Se um prompt de sessão pedir algo que contradiz este arquivo, **pare e pergunte ao Fábio antes de agir**. Se este arquivo precisar mudar, o Fábio (ou o Claude Code, com aprovação dele) edita este arquivo primeiro, e só depois o código muda.

---

## 1. Contexto do negócio

**Empresa:** Bossa Empreendimentos — incorporadora premium da costa de Santa Catarina (Bombas, Porto Belo, Itapema).
**Diretor operacional do projeto:** Fábio.
**Sistema de origem dos dados:** Koper (ERP incorporador atualmente em uso pela Bossa).
**Sistema de destino:** Elos OS — SaaS multi-tenant Next.js/TypeScript/Supabase/Vercel, próprio, em construção.

Empreendimentos que podem aparecer nos dados: **Jazz Residence**, **Soul Residence**, **Flow Aptos**, **Alma Seahouses**, mais cadastros administrativos internos da Bossa.

**Papel do Koper nesta fase:** origem oficial dos dados. **Somente leitura.** O Elos OS ainda não é fonte da verdade — ele espelha o Koper enquanto validamos a paridade.

---

## 2. Objetivo final do conector

Construir um serviço confiável e automatizado que:

1. Autentica na aplicação autorizada do Koper da Bossa.
2. Descobre as APIs e operações que a interface do Koper usa internamente.
3. Extrai progressivamente toda a base relevante da Bossa.
4. Grava os dados no Elos OS, no tenant correto da Bossa.
5. Executa uma carga histórica inicial completa.
6. Mantém o Elos OS sincronizado com o Koper de forma incremental.
7. Preserva relacionamentos, documentos, históricos, valores e rastreabilidade.
8. Permite validar que tudo que existe no Koper existe corretamente no Elos OS.

**Fluxo funcional prioritário** (o que descobrir primeiro, em ordem):

> Solicitação de material/estoque → cotação → pedido de compra → recebimento → nota fiscal → conta a pagar → pagamento

---

## 3. Regras absolutas (nunca, sob nenhuma hipótese)

Estas regras não são negociáveis por prompt de sessão. Se você se pegar considerando violar uma delas, **pare e pergunte**.

### 3.1 Sobre o Koper (origem)

- **Nunca** disparar requisição contra o domínio do Koper com method `PUT`, `PATCH`, `DELETE`.
- `POST` só é permitido para operações GraphQL cujo `operationName` claramente indica leitura: começa com `query`, `list`, `get`, `find`, `search`, `read`. Qualquer outra coisa, **pare**.
- Nunca executar aprovação, cancelamento, exclusão ou alteração de qualquer registro no Koper.
- Nunca fazer login com credenciais diferentes das que estão em `KOPER_USERNAME` / `KOPER_PASSWORD`.

### 3.2 Sobre segredos

- **Nunca** commitar credenciais no Git.
- **Nunca** retornar em resposta de endpoint, log, diagnóstico ou payload de staging: `Authorization`, `Cookie`, `Set-Cookie`, `BROWSERLESS_TOKEN`, `WORKER_API_KEY`, `KOPER_PASSWORD`, ou o valor de qualquer variável do Railway.
- Ao logar cabeçalhos HTTP, remover a lista acima antes de imprimir. Se um cabeçalho desconhecido puder conter segredo, mascarar por padrão.

### 3.3 Sobre dados pessoais

- CPF → mascarar como `***.***.***-XX` (últimos 2) em qualquer log ou diagnóstico.
- CNPJ → completo é ok em log estruturado interno; mascarar em log público.
- Telefone → mascarar como `(XX) XXXXX-1234` (últimos 4).
- E-mail → mascarar como `f***@dominio.com` em log.
- Anexos com dados pessoais (contratos, documentos) → armazenar em bucket privado, nunca em log.

### 3.4 Sobre multi-tenant

- **Nunca** gravar linha no Elos OS sem `tenant_id` explícito.
- **Nunca** usar service key do Supabase fora do worker.
- Antes da primeira gravação em qualquer tabela nova, validar que a RLS está ativa e que existe policy que restringe leitura por `tenant_id`. Se a policy não existir, **pare** e proponha a policy antes de gravar.

### 3.5 Sobre identidade do tenant da Bossa

- O `tenant_id` da Bossa não é chumbado neste arquivo. Você **precisa buscá-lo** consultando a tabela de tenants do Elos OS pelo CNPJ da Bossa (pergunte ao Fábio o CNPJ na primeira vez, e a partir daí guarde em variável de ambiente do worker: `BOSSA_TENANT_ID`).
- Nunca aceite string do tipo `"bossa"` ou `"1"` como tenant. Sempre UUID retornado pela consulta.

---

## 4. Método iterativo obrigatório

Trabalhamos em pequenos ciclos. Cada ciclo é assim:

1. **Ler** o código atual e o último resultado registrado.
2. **Formular uma hipótese específica**, escrita em uma frase. Ex.: *"O clique em `[data-testid="button-Suprimentos"]` deve expandir um submenu, e o link real de Solicitações está num `<a>` filho criado por portal React."*
3. **Fazer a menor alteração possível** que testa essa hipótese. Nunca reescrever mais de um arquivo por ciclo, nunca alterar mais de ~50 linhas por ciclo, salvo em criação de arquivo novo.
4. **Rodar** `typecheck` e `build` local.
5. **Commitar** na branch de trabalho com mensagem no formato: `koper: <o que mudou> — hipótese: <hipótese>`.
6. **Esperar** o deploy no Railway ficar `Active`.
7. **Executar** o diagnóstico apropriado (ver seção 4.2 abaixo).
8. **Ler o resultado inteiro** — não escanear, ler.
9. **Registrar** em `services/koper-worker/docs/koper-progress.md`: hipótese, resultado, confirmada ou descartada, próximo passo.
10. **Repetir**.

Não fazer reescrita grande baseada em suposição. Reescrita grande só depois que a hipótese está confirmada por evidência.

### 4.1 Verificação inicial de ambiente

Na primeira mensagem de toda sessão nova, **antes** de qualquer alteração:

- Listar as ferramentas disponíveis nesta sessão do Claude Code.
- Confirmar que existem integrações ativas para GitHub e Railway. Se não existirem, **pare** e avise o Fábio antes de tentar qualquer commit ou deploy.

### 4.2 Como disparar um diagnóstico no worker

Os endpoints `/diagnostics/*` são autenticados por `WORKER_API_KEY`. Existem três caminhos válidos, escolha o que for viável para a situação:

- **Caminho A (preferido durante desenvolvimento).** Setar `KOPER_STARTUP_DIAGNOSTIC=<nome>` como variável no Railway, redeployar, aguardar `Active`, ler `KOPER_STARTUP_DIAGNOSTIC_RESULT` nos logs. Depois de ler, **remover a variável** para não repetir a cada boot.
- **Caminho B.** No Console/Shell do serviço no Railway, disparar `curl -X POST http://localhost:$PORT/diagnostics/koper/<nome> -H "Authorization: Bearer $WORKER_API_KEY"`. A `WORKER_API_KEY` já está no ambiente do container — nunca imprimir o valor.
- **Caminho C.** Rodar o worker localmente com as mesmas variáveis carregadas via `.env` (não commitado) e chamar o endpoint da máquina local.

Nunca expor o endpoint sem autenticação, mesmo temporariamente.

---

## 5. Critério para parar e chamar o Fábio

Pare **imediatamente** e resuma no chat, em vez de tentar mais uma hipótese, quando:

- **Três iterações consecutivas** falharam em avançar em nada novo (mesmo bloqueio, mesmo tipo de erro, mesma tela). Não tente uma quarta hipótese sozinho.
- Uma decisão exigiria interpretar regra de negócio (ex.: "esse campo do Koper mapeia para receita ou para custo?").
- Um caminho técnico exigiria mudar arquitetura maior (ex.: trocar Playwright por outra abordagem, migrar de Supabase para outra base).
- Você identificar risco de vazamento de dado ou de escrita indevida no Koper.
- Você não conseguir confirmar que a policy RLS existe antes da primeira gravação em tabela nova.
- Qualquer regra da Seção 3 estiver na iminência de ser violada.

Ao parar, entregar:

1. O que foi tentado (última hipótese, resultado).
2. Por que está bloqueado.
3. **Duas ou três alternativas** de caminho, com trade-off de cada uma.
4. Sua recomendação, se tiver.

---

## 6. Modelo de branch e commit

- **Branch atual do conector:** `feature/koper-connector-bootstrap`.
- Durante a **fase de descoberta** (identificar rotas e operações GraphQL do fluxo prioritário), commits diretos na branch de trabalho estão liberados. Ritmo alto, ciclos curtos.
- Quando fechar a etapa de "Solicitações de estoque" (item 8 do Marco Técnico abaixo), **pare, abra Pull Request para `main`, e chame o Fábio para revisar antes de seguir** para cotações.
- Cada commit toca no mínimo possível. Nada de mega-commit "wip várias coisas".
- Se você identificar que o `README.md` do serviço está desatualizado por causa de uma mudança que você acabou de fazer, atualize o README **no mesmo commit** da mudança de código.

---

## 7. Estrutura de pastas do worker

O código atual está sendo dominado pelos diagnósticos, o que é ok agora. À medida que uma rota se comprova, extrair para código de produção com esta estrutura:

```
services/koper-worker/src/
  config/
    env.ts                  # já existe
  browser/
    browserless.ts          # já existe
  auth/
    koper-auto-login.ts     # já existe
  diagnostics/              # ferramentas exploratórias, não são código definitivo
  koper/                    # cliente de produção do Koper
    session.ts              # gerencia sessão autenticada reutilizável
    graphql-client.ts       # cliente GraphQL com retry, timeout, backoff
    operations/             # uma operação GraphQL por arquivo, tipada
    extractors/             # transforma resposta bruta em modelo canônico
    pagination.ts           # helpers de paginação (offset, cursor, etc.)
    types.ts                # tipos canônicos do Koper
  sync/
    runner.ts               # orquestra uma rodada de sincronização
    checkpoints.ts           # persistência de progresso por entidade
    reconciliation.ts       # comparação Koper × Elos OS
  elos/
    supabase.ts             # cliente Supabase com service key
    repositories/           # um por entidade, encapsula upsert
    mappers/                # tradução Koper → Elos OS
docs/
  koper-inventory.md        # inventário vivo das entidades (ver Seção 15)
  koper-progress.md         # log iterativo (ver Seção 4)
```

Diagnósticos **não viram** código de produção. Eles alimentam a construção do código de produção, mas o `src/koper/`, `src/sync/`, `src/elos/` são escritos limpos, com tipagem, tratamento de erro e testabilidade.

---

## 8. Camada de staging e idempotência

**Regra dura:** nenhum dado do Koper vai direto para a tabela operacional do Elos OS. Sempre passa por uma tabela de staging (`koper_staging_*`) antes.

### 8.1 Colunas obrigatórias em toda staging

- `tenant_id` (UUID da Bossa)
- `source` — sempre `'koper'` neste worker
- `entity` — nome canônico da entidade (`stock_request`, `quotation`, etc.)
- `koper_id` — identificador imutável no Koper
- `koper_parent_id` — quando aplicável
- `payload` — JSON bruto sanitizado
- `payload_hash` — hash do payload **após normalização** (ver 8.3)
- `koper_created_at` — data de criação no Koper
- `koper_updated_at` — data de atualização no Koper
- `first_seen_at` — timestamp da primeira importação
- `last_seen_at` — timestamp da última leitura
- `processing_status` — `pending`, `processed`, `error`
- `processing_error` — mensagem de erro de transformação, quando houver
- `mapping_version` — versão do mapeamento aplicado
- `elos_id` — UUID no Elos OS, uma vez transformado

### 8.2 Identificação

Nunca usar **nome** ou **descrição** como chave. Sempre `koper_id`. Se uma entidade não expuser ID imutável, **pare** e pergunte.

### 8.3 Idempotência real

O upsert é feito pela tupla `(tenant_id, source, entity, koper_id)`. Rodar a importação duas vezes com o mesmo estado do Koper **não pode** duplicar linhas nem gerar alteração falsa em `payload_hash`.

Para o hash não flutuar por lixo:

1. Ordenar as chaves do JSON alfabeticamente (recursivo).
2. Remover campos voláteis conhecidos: timestamps de resposta (`_responseAt`), IDs de request (`_traceId`), campos de auditoria efêmera.
3. Só então hashear (SHA-256).

Registrar em `docs/koper-inventory.md` quais campos foram removidos para cada entidade.

### 8.4 Sobre exclusões

- Nunca apagar registro no Elos OS automaticamente.
- Se um registro deixar de aparecer no Koper, marcar `sync_state = 'missing_at_source'` e alertar. A decisão de arquivar é humana.

---

## 9. Multi-tenant e RLS

Antes da primeira gravação em qualquer tabela do Elos OS (staging ou operacional):

1. Verificar via SQL que a tabela tem RLS habilitada (`SELECT relrowsecurity FROM pg_class WHERE relname = '<tabela>'`).
2. Verificar que existe policy de leitura restringindo por `tenant_id = auth.jwt() ->> 'tenant_id'` (ou equivalente ao modelo em uso).
3. Se qualquer uma das duas falhar, **pare** e proponha a policy. Não grave.

O worker usa service key (bypassa RLS), então a proteção real é aplicada quando o app cliente lê os dados. Documente isso no cabeçalho do arquivo `src/elos/supabase.ts`.

---

## 10. Sanitização e segurança de logs

Antes de qualquer `console.log`, `logger.info`, ou de gravar em `payload` da staging:

- Remover cabeçalhos sensíveis (lista em 3.2).
- Mascarar CPF, telefone, e-mail (regras em 3.3).
- Nunca imprimir o corpo de uma requisição de login.
- Nunca imprimir cookies de resposta.
- Nunca imprimir o valor de nenhuma variável de ambiente cujo nome contenha `TOKEN`, `KEY`, `SECRET`, `PASSWORD`.

Ter uma função utilitária `sanitize()` centralizada em `src/koper/session.ts` (ou similar). Toda saída externa passa por ela.

---

## 11. Ordem de extração por fase

A ordem é rígida — não pular etapas.

**Fase 1 — Descoberta e inventário.** Mapear menus, rotas, operações GraphQL e REST. Preencher `docs/koper-inventory.md` para cada entidade encontrada. Nenhuma escrita ainda.

**Fase 2 — Cadastros-base.** Empresas, empreendimentos, obras, centros de custo, etapas, fornecedores, clientes, unidades imobiliárias, usuários e responsáveis relevantes. Estes são pré-requisito para tudo transacional.

**Fase 3 — Suprimentos.** Solicitações de estoque/material, itens, aprovações, cotações, participantes, preços, pedidos de compra, recebimentos, notas fiscais, XMLs, anexos.

**Fase 4 — Financeiro a pagar.** Títulos, parcelas, vencimentos, baixas, pagamentos, retenções, vínculos com pedidos e notas.

**Fase 5 — Comercial e contas a receber.** Contratos e vendas, clientes por contrato, unidades, planos de pagamento, parcelas, CUB e correções, recebimentos, inadimplência, renegociações, distratos.

> **Antes** de projetar qualquer estrutura para recebíveis e CUB, **rode um grep recursivo no repositório inteiro** por `CUB`, `receb`, `correc`, `INCC`, `IPCA`. Já existe histórico anterior de importação de recebíveis do Koper e tratamento de CUB no Elos OS. Reaproveitar antes de duplicar. Se você não encontrar nada, pergunte ao Fábio antes de criar tabela nova.

**Fase 6 — Conciliação e sincronização contínua.** Contagem por entidade, totalização de valores, órfãos, duplicidades, sincronização incremental, painel de saúde da integração.

Sincronização incremental **deve** usar as operações GraphQL descobertas, não repetir o crawl visual. Visual só na descoberta.

---

## 12. Validação e conciliação por entidade

Uma entidade só é considerada **homologada** quando:

- Quantidade total no Koper × quantidade em staging × quantidade em tabela operacional do Elos OS batem.
- Amostra manual de 5 registros (escolhidos por Fábio) confere campo a campo.
- Zero relacionamentos órfãos.
- Zero duplicidades por `(tenant_id, source, entity, koper_id)`.

Para entidades financeiras, adicionar:

- Soma do valor original bate.
- Soma do valor atualizado bate (respeitando índice de correção).
- Soma recebida / soma paga bate.
- Soma em aberto bate.
- Vencidos, cancelados e parcelas conferem.
- Arredondamentos documentados (se o Elos OS decidir arredondar diferente do Koper, isso é decisão humana e vai no inventário).

---

## 13. Confiabilidade operacional

Implementar progressivamente, na ordem que a necessidade aparecer:

- Paginação completa (não parar na primeira página).
- Retry com backoff exponencial em erro 5xx e timeout de rede.
- Limite de concorrência (não mais que 3 requisições paralelas ao Koper por padrão).
- Timeout duro de 60s por requisição.
- Checkpoint por entidade (retomar de onde parou).
- Logs estruturados (JSON com `correlation_id`, `entity`, `phase`, `duration_ms`).
- Métricas por entidade (contagem, taxa de erro, tempo médio).
- Dead-letter: registros que falharem 3 vezes vão para tabela `koper_deadletter`.
- Dry-run: modo que roda transformação sem gravar.
- Importação por intervalo de datas, por empreendimento, por entidade.
- Carga histórica **separada** do incremental (jobs distintos).

---

## 14. Critério de encerramento por iteração

Toda vez que fechar um ciclo (com sucesso ou paralisia), entregar em uma mensagem única:

- Diagnóstico executado (nome + caminho).
- Resultado retornado (JSON ou trecho relevante).
- Hipótese confirmada ou descartada.
- Arquivo alterado (caminho + linhas mudadas).
- Commit realizado (hash + mensagem).
- Deployment do Railway (status).
- Próximo bloqueio.
- Próxima alteração pequena sugerida.

Sem essa estrutura, o Fábio perde o fio da história entre sessões.

---

## 15. Documento de inventário

Manter em `services/koper-worker/docs/koper-inventory.md` uma tabela por entidade:

| Campo | Conteúdo |
|---|---|
| módulo do Koper | ex.: Suprimentos |
| rota visual | ex.: `/suprimentos/solicitacoes` |
| endpoint | ex.: `https://api.koper.<...>/graphql` |
| operação | ex.: `queryStockRequests` |
| variáveis | ex.: `{ page, size, empresaId }` |
| paginação | ex.: offset baseado em `page/size` |
| campos principais | ex.: `id, number, requester, status, ...` |
| identificador | ex.: `id` (UUID no Koper) |
| relacionamentos | ex.: `empresaId → empresas.id`, `obraId → obras.id` |
| volume encontrado | ex.: ~3.400 registros |
| tabela staging | ex.: `koper_staging_stock_requests` |
| tabela final Elos OS | ex.: `supply_requests` |
| status | não iniciado / descoberto / extraindo / homologado / sincronizado |

Este documento é a **memória do projeto**. Se ele estiver desatualizado, o próximo Claude Code começa cego.

---

## 16. Marco técnico atual

Estamos na **Fase 1 / entidade "Solicitações de estoque"**.

Fechar esta entidade significa:

1. Rota real de Solicitações de estoque confirmada.
2. Forma correta de navegação confirmada (clique direto, submenu, portal React, iframe, microfrontend — o que for).
3. Endpoint GraphQL confirmado.
4. `operationName` da listagem e do detalhe confirmados.
5. Se for persisted query: `persistedQuery.version`, `persistedQuery.sha256Hash`, `operationName`, `variables`, `endpoint`, cabeçalhos estritamente necessários (nunca cookies ou `Authorization`).
6. Variáveis da listagem, paginação, filtros, ordenação, campos retornados documentados.
7. Operação do detalhe confirmada.
8. Identificadores imutáveis dos registros confirmados.
9. Cliente GraphQL de produção escrito em `src/koper/` (extraído dos diagnósticos).
10. Camada de staging criada com policy de RLS e migration versionada.
11. Amostra pequena da obra **Flow Aptos** importada em staging (não em tabela operacional ainda).
12. Validação manual Koper × staging feita pelo Fábio.
13. Idempotência comprovada rodando duas vezes seguidas sem duplicar.
14. Só então: ampliar para todas as solicitações de todas as obras, e mover de staging para tabela operacional.

Só depois disso, avançar para cotações.

---

## 17. Manter este arquivo vivo

- Se uma regra deste arquivo ficar obsoleta, **edite este arquivo antes** de escrever código diferente.
- Se descobrir um comportamento novo do Koper que afeta a estratégia, adicione uma seção "Aprendizados sobre o Koper" no final e referencie a evidência (commit, diagnóstico).
- Este arquivo é revisado pelo Fábio a cada PR grande.

---

## 18. Aprendizados sobre o Koper

- **A listagem de Solicitações de estoque não é GraphQL — é REST.** As primeiras hipóteses (commits `0e45f2a`, `0a1627f`) tentaram capturar operações GraphQL na listagem e não encontraram nenhuma (`graphql: []` em todos os diagnósticos rodados). O mapeamento de transporte completo (commit `f25ca307`) e a inspeção da resposta (commit `e7d01c45`) confirmaram que a tela `/suprimentos/solicitacoes/` busca dados via `GET https://api.koper.com.br/stock/v1/request`. Ver `docs/koper-progress.md`, iteração de `2026-07-30T21:23Z`, e `docs/koper-inventory.md`, entidade `stock_request`. **A Seção 3.1 e o item 3 do Marco Técnico (Seção 16) devem ser lidos como "endpoint GraphQL **ou REST** confirmado"** — a regra de segurança (só `GET`, nunca `PUT`/`PATCH`/`DELETE`, `POST` só para leitura GraphQL identificada por prefixo) continua valendo integralmente para REST: nenhuma requisição de escrita a `api.koper.com.br` é permitida, ponto.
- A navegação até a tela de Solicitações não é um link direto nem uma rota descoberta por texto na página: é preciso abrir o módulo **Suprimentos** no menu principal e clicar no item visível **Solicitações** dentro dele (commits `87fd0a88`, `b730dc9d`). A estratégia registrada como bem-sucedida no diagnóstico é `"open-menu-and-click-visible-item"`.
- O Koper detecta sessão autenticada pela **ausência do campo de senha** na tela renderizada, não por um evento de navegação (commit `e49dc72f`).
- **Cada empreendimento da Bossa é uma empresa separada dentro do Koper, selecionada por um seletor no canto superior direito da interface — não uma "obra" dentro de uma única empresa Bossa.** Mapeado manualmente em 2026-07-31 (ver `docs/koper-progress.md`, ciclo "Mapeamento manual — módulo Engenharia e seletor de empresa", e `docs/koper-inventory.md`, entidade "Empresas do Koper"). Estrutura conhecida: **Bossa Empreendimentos** (administrativo, escritório central, pós-obra do Soul Residence), **empresa do Flow** (Flow Aptos), **empresa do Alma** (Alma Seahouses) — nomes e IDs exatos do Flow e do Alma ainda não capturados. **Isso significa que toda a descoberta de Solicitações de estoque feita até agora (rota, navegação, endpoints de listagem e detalhe) foi validada dentro da empresa Bossa Empreendimentos, que não é necessariamente onde estão os dados reais de suprimentos do Flow.** O worker precisa descobrir a lista de empresas disponíveis e o mecanismo de troca antes de assumir que a empresa ativa pós-login é o escopo certo para extração. Dois endpoints já observados em capturas de rede anteriores (`GET /administrative/v1/enterprise`, `GET /administrative/v1/multi_company`) são candidatos fortes a fonte da lista de empresas, mas ainda não confirmados.
- **O endpoint de detalhe de uma entidade não segue o padrão REST `/{recurso}/{id}` do endpoint de listagem.** Para solicitações de estoque, a listagem é `GET /stock/v1/request` mas o detalhe é `GET /stock/v1/product_request?requestId={numero}` — um recurso com nome diferente, identificador como query param em vez de segmento de caminho. Não presumir o endpoint de detalhe por convenção; sempre mapear o tráfego de rede completo da tela de detalhe antes de filtrar (ver `docs/koper-progress.md`, ciclo "Detalhe da solicitação de estoque descoberto").
