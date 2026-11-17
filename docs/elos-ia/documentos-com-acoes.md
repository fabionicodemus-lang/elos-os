# Elos IA — documentos com revisão e confirmação

Data: 17/11/2026. Estado: implementação em branch para revisão e homologação. As migrações deste recurso não foram aplicadas em ambientes hospedados nesta entrega.

## Resultado esperado

O usuário anexa um documento à Elos IA e pede o cadastro. A IA interpreta o arquivo, consulta os cadastros permitidos e prepara um cartão com os campos e os efeitos da operação. O cartão permite abrir o documento original, conferir os itens e descartar a proposta. O registro operacional só é criado quando um usuário autorizado pressiona o botão de confirmação.

As ações usam os serviços de domínio já existentes. A IA não opera o navegador nem recebe SQL livre. Os registros gerados aparecem nos módulos normais do Elos OS.

| Documento | Botão | Efeito confirmado |
|---|---|---|
| Contrato de venda | Confirmar e criar venda | Cliente novo, se necessário e autorizado; proposta aprovada/convertida; venda; parcelas em aberto; unidade vendida; tratamento das propostas concorrentes conforme regra oficial |
| Orçamento de fornecedor para nova cotação | Confirmar e registrar cotação | Cotação em coleta, itens de solicitação aprovada e proposta do fornecedor |
| Contrato de empreiteiro | Confirmar e criar contrato | Contrato em elaboração, serviços e etapas, vinculado à concorrência aprovada |

O orçamento de fornecedor em **cotação já existente** continua usando `preparar_cotacao_fornecedor`. O boletim de medição continua usando `preparar_medicao_contrato`. Esses fluxos não foram substituídos.

## Experiência de uso

1. Selecionar empresa e obra.
2. Abrir Elos IA, inclusive pelo painel da tela atual.
3. Anexar o documento e pedir a operação.
4. Conferir o cartão: identificação, cadastros associados, datas, quantidades, preços, parcelas, condições, avisos e efeitos.
5. Abrir o documento original se necessário.
6. Confirmar pelo botão específico. A conversa não possui ferramenta para executar a confirmação.
7. Conferir o resultado no módulo. A tela **Revisão e histórico** preserva cartões pendentes, confirmados e descartados, com paginação.

Para corrigir dados, descartar o cartão anterior e reenviar o documento com o ajuste. Cada cartão tem ID e conteúdo imutáveis; não existe edição silenciosa de uma versão já revisada. Edição de campos dentro do próprio cartão não faz parte desta versão.

Se faltar um campo obrigatório ou um vínculo necessário, a ferramenta pede o complemento e não cria registros operacionais. Condições comerciais que o motor atual não representa aparecem como impedimentos no cartão quando há dados suficientes para montá-lo.

### Exemplos de pedidos

> Leia este contrato da unidade 1901 e prepare a venda, com o cliente e todas as condições de pagamento, para eu conferir.

> Use este orçamento do fornecedor na solicitação SM-0001 e prepare uma nova cotação. Mostre itens, frete e condições antes de gerar.

> Confira este contrato de pintura contra a concorrência aprovada MC-0001 e prepare o contrato com os serviços e as etapas de medição.

## Venda de unidade

Reutiliza `commercial_set_proposal_status` e `commercial_convert_proposal` dentro de uma transação. O cliente existente é identificado por CPF/CNPJ normalizado dentro da empresa; identificação ambígua impede o cadastro. Se houver cliente novo, todos os campos são exibidos e sua criação depende também de `clients.manage` no momento da confirmação.

O preview mostra o preço de tabela, o desconto calculado, o valor do contrato, o comprador, a unidade, o corretor/comissão, as séries e **todas as parcelas**. A soma fecha em centavos. As datas são calculadas por calendário, preservando o dia de aniversário ao atravessar fevereiro. Propostas concorrentes que serão rejeitadas pela conversão são mostradas antes do clique.

O helper atribui `correction_index_id` aos títulos após a conversão, na mesma transação. Isso preserva a correção simples quando o fluxo legado passaria somente o nome textual do índice. O início da correção deve ser explícito e o índice cadastrado precisa ter base válida.

### Escopo e limites

- Um comprador e uma unidade por contrato.
- Até 24 séries e 240 parcelas totais, em BRL.
- Entrada, mensais, reforços, chaves e pós-chaves com datas determinadas.
- Cliente existente ou novo; corretor já cadastrado.
- Correção simples por índice cadastrado, com início contratual explícito.
- A forma de pagamento é preservada nas observações porque o recebível atual não tem coluna própria para ela.
- CPF/CNPJ tem formato conferido; não há consulta cadastral externa ou certificação da identidade.

Juros mensais, permuta, múltiplos compradores, vencimentos dependentes de evento, troca de índice por evento, pagamentos históricos e cláusulas não representadas **bloqueiam a geração**. O cartão conserva a pendência. Não omitir uma condição para fazer o contrato caber no cadastro.

Um contrato com CUB durante a obra e IPCA + juros após as chaves, por exemplo, exige evolução específica das regras financeiras antes de ser liberado por este importador. A importação de uma carteira com parcelas já pagas também precisa do fluxo de migração/reconciliação apropriado.

Não são emitidos boletos, registradas baixas, enviadas cobranças ou realizados pagamentos por esta ação.

## Cotação de materiais

A abertura de cotação respeita a solicitação aprovada existente, seu saldo e os itens do catálogo. A ferramenta de contexto permite localizar solicitação, itens e fornecedor ativo. O modelo não pode inventar IDs, associar material só por nome parecido ou converter unidades sem evidência.

Na confirmação, chama em uma única transação:

1. `save_procurement_material_quotation_v2`.
2. `open_procurement_material_quotation`.
3. `save_procurement_material_supplier_offer`.

Confere quantidade, unidade, preços, descontos, impostos, frete, outros custos e total. Conformidade técnica só é marcada quando confirmada. Documento sem total declarado mostra aviso; o total dos itens é calculado pelo sistema.

Esta versão trabalha com uma solicitação por cartão e até 100 itens. Fornecedor, solicitação e itens precisam existir. A ação não aprova vencedor, gera pedido, registra recebimento ou cria conta a pagar. Nova proposta em uma cotação existente usa a ferramenta anterior.

## Contrato de empreiteiro

O Elos atual exige `source_competition_id` para novos contratos. Por isso a ação parte de uma concorrência aprovada, com vencedor definido, e utiliza `generate_execution_service_contract_from_competition`.

O documento é conferido contra todos os itens aprovados: fornecedor, serviço, unidade, quantidade e preço. Retenções, garantia, prazo de pagamento, vigência e etapas de medição devem ser informados explicitamente. Não se presume uma etapa de 100% sem confirmação.

O contrato nasce em elaboração. A ação preserva o fluxo normal de ativação, execução, medição, aprovação e financeiro. Não cria serviço executado nem transforma todo o valor contratado em dívida vencida.

Limites: até 100 serviços e 20 etapas por serviço. Contrato histórico sem concorrência aprovada não é importado por um atalho; requer processo específico de migração.

## Permissões e integridade

| Ação | Permissões principais |
|---|---|
| Uso da IA | `ai.assistant.use` |
| Venda | `commercial.proposals.manage`, `.approve`, `.convert`, `sales.manage`, `receivables.manage`; acesso a clientes e `clients.manage` para novo cliente |
| Cotação | `procurement.quotations.manage` |
| Contrato | `execution.contract_procurement.contract` e demais validações do fluxo oficial |

Personas limitam ferramentas; a autorização vem da sessão, das permissões atuais e do banco. Venda fica em Diretoria/Financeiro; contrato em Diretoria/Engenharia; Clientes não prepara ações.

Garantias implementadas:

- Preparação atômica de cartão e vínculo de origem, sem escrita no domínio.
- Empresa e usuário obtidos da sessão; obra conferida dentro da empresa.
- Preview canônico validado no banco contra payload e cadastros, na preparação e na confirmação.
- Payload, preview e documento associado imutáveis.
- Implementações novas privilegiadas no schema não exposto `elos_ia_private`, com wrappers públicos `SECURITY INVOKER` e grants explícitos. Não incluir esse schema na lista de schemas expostos da Data API.
- Revalidação de permissões e snapshots antes da confirmação.
- Transação única para domínio, resultado e retenção da fonte.
- Lock e resultado persistido para clique repetido/retry.
- Detecção de reenvio do mesmo arquivo e chave de negócio no fluxo da aplicação.
- Fonte em bucket privado, URL curta, leitura condicionada ao acesso atual, inclusive para quem enviou.
- Sem política de UPDATE/DELETE dos uploads para usuários autenticados; cópia revisada não é substituída durante a confirmação.
- Endpoints legados de claim/finish/fail retirados do papel autenticado; fontes documentais não podem ser vinculadas pelas rotinas legadas.
- Instruções dentro dos arquivos permanecem dados sem autoridade sobre o agente.

O SHA-256 é calculado pelo backend sobre os bytes no fluxo normal. A coluna de metadata pode ser inserida por um usuário autenticado via Data API; portanto o digest não é um atestado criptográfico contra um cliente que forje chamadas diretas. A chave de negócio é derivada no SQL. Regras de domínio, permissões e transações continuam obrigatórias independentemente do digest.

Documentos confirmados recebem `retained_at` e deixam de expirar automaticamente. Esta entrega não instala um job de limpeza. A política de retenção da empresa e eventual limpeza administrativa devem preservar documentos retidos e respeitar a necessidade de auditoria.

## Implantação e desligamento

A flag `ELOS_IA_DOCUMENT_ACTIONS_ENABLED` nasce `false`. O código compila e os fluxos anteriores continuam disponíveis sem aplicar as novas migrações. A flag controla a aplicação; não substitui os grants do banco.

Aplicar, primeiro em homologação isolada, nesta ordem:

1. `20261117155420_elos_ia_document_action_foundation.sql`.
2. `20261117155428_elos_ia_document_commercial.sql`.
3. `20261117155434_elos_ia_document_procurement.sql`.
4. `20261117155439_elos_ia_document_execution.sql`.

Depois habilitar a flag somente nesse ambiente e executar os testes funcionais abaixo. Não apontar uma prévia de interface para o banco de produção para testar gravações. A migração de fundamento substitui policies e funções existentes; comparar o catálogo real com o branch e revisar a compatibilidade antes de aplicá-la.

Para interromper o recurso, desligar a flag. Se for necessário bloquear também chamadas diretas, revogar `EXECUTE` de `authenticated` para `ai_prepare_document_action(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text)` e `ai_execute_document_action_proposal(uuid)` nos schemas `public` e `elos_ia_private`. Manter os dados e documentos já gerados. Não tentar reverter vendas ou contratos apagando linhas da auditoria.

## Verificação

Comandos automatizados:

```bash
npm run test:documents
npm test
node --test lib/elos-ia/finance-safe-write-db.test.mjs
npx tsc --noEmit
npx eslint app/elos-ia app/api/elos-ia lib/elos-ia components/global-elos-ia-drawer.tsx
npm run build
```

Os testes de domínio usam corpos reais de RPCs e do trigger de correção em PGlite. A fixture omite parte da infraestrutura externa aos módulos. Os testes do núcleo usam helpers de domínio controlados para isolar lifecycle, RLS, rollback e retenção. Essas verificações não substituem a homologação no Supabase.

Roteiro funcional antes de liberar:

- PDF com texto, PDF digitalizado/imagem e orçamento em planilha: comparar extração com o original.
- Venda simples com cliente existente; venda com cliente novo; correção simples; todas as parcelas.
- Contrato com juros ou condição de evento: conferir bloqueio e preservação da pendência.
- Cotação ligada à solicitação aprovada: total, saldo, unidade e aceite técnico.
- Contrato ligado à concorrência aprovada: serviços, valores, etapas e status de elaboração.
- Conferir que enviar o documento e montar o cartão não criam negócio.
- Duplo clique, retry e dois revisores concorrentes: um resultado, sem duplicação.
- Mudança de unidade, saldo, vencedor, índice ou permissão entre revisão e confirmação: interromper e pedir nova revisão.
- Usuários das duas empresas: confirmar isolamento na interface, Data API e Storage.
- Conferir documento original e cartão no histórico depois de recarregar a sessão.
- Testar a integração real com OpenAI usando documentos de demonstração e sem disparar comunicações externas.

## Referências técnicas

- Base do projeto: `ab97f5f23f4592d793f32bfbaf7b8877dbd914a5`.
- Estrutura existente da IA: `docs/elos-ia/README.md`.
- OpenAI, entradas de arquivo: https://developers.openai.com/api/docs/guides/file-inputs
- OpenAI, saídas estruturadas: https://developers.openai.com/api/docs/guides/structured-outputs
- Supabase, RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, grants explícitos em novas tabelas: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
