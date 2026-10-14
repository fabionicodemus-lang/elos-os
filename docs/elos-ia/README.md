# Elos IA — copiloto operacional

Assistente do Elos OS com quatro personas (Diretoria, Engenharia, Financeiro e Clientes). Além de analisar os dados lançados no sistema, a Elos IA pode ler documentos e **preparar lançamentos para revisão humana**, sempre respeitando as permissões do usuário e as regras do módulo de destino.

## Princípio de segurança

O fluxo de escrita é sempre:

**ler → interpretar → preparar proposta imutável → humano revisar → revalidar permissão → executar pela regra oficial do Elos**

A chamada da IA nunca executa o lançamento diretamente. Preparar uma ação não significa lançar, enviar nem aprovar.

## Como funciona

1. O usuário escolhe a persona e pergunta na tela `/elos-ia`.
2. Pode anexar PDF, foto, Excel, Word, CSV ou TXT. Os anexos ficam em bucket privado temporário.
3. O servidor identifica usuário, empresa, obra ativa e permissões atuais.
4. A IA consulta os dados necessários do Elos OS e, quando solicitado, chama uma ferramenta de **preparação de ação**.
5. O Elos valida se obra, cotação, fornecedor, contrato, item e serviço realmente existem. Correspondências ambíguas são recusadas.
6. A ação fica registrada em `ai_action_proposals`, com payload e preview imutáveis, e aparece como cartão de revisão.
7. O usuário — ou outro usuário autorizado em `/elos-ia/acoes` — revisa e clica **Revisado · lançar no Elos**.
8. No clique, o banco revalida a permissão atual e executa a mesma RPC usada pelo fluxo manual do módulo.
9. A execução é transacional e idempotente. Se a regra de domínio falhar, o lançamento não fica parcialmente gravado.

Arquivos e documentos são tratados como **dados não confiáveis**. Instruções escritas dentro deles nunca substituem as regras da Elos IA ou as permissões do sistema.

## Ações disponíveis na primeira versão

### Suprimentos — proposta de fornecedor

Permissão necessária: `procurement.quotations.manage`.

- lê orçamento de fornecedor em PDF, foto, planilha ou texto;
- encontra uma cotação em coleta e um fornecedor já convidado;
- casa somente itens existentes na cotação;
- prepara quantidade, preço, desconto, impostos, frete, marca, fabricante e prazo;
- não presume conformidade técnica: `atende especificação` só fica verdadeiro quando o documento permitir confirmar;
- rateia frete/custos compartilhados preservando o valor total;
- depois da revisão humana executa `save_procurement_material_supplier_offer`;
- o documento-fonte é preservado nos documentos oficiais da cotação.

A IA **não aprova vencedor** e não gera pedido de compra automaticamente nesta versão.

### Execução — medição de contrato

Permissão necessária: `execution.measurements.manage`.

- lê boletim, PDF, foto, planilha ou texto do empreiteiro;
- identifica contrato e itens/locais realmente contratados;
- interpreta a quantidade **desta medição**, não o acumulado;
- calcula bruto, retenções contratuais, impostos/descontos e líquido;
- compara quantidade acumulada e valor medido com os limites do contrato;
- se houver estouro, prepara o cartão para conferência, mas bloqueia execução automática;
- depois da revisão humana executa `save_execution_contract_measurement` com `over_contract_confirmed=false`;
- cria a medição em **rascunho**; submissão, aprovação e financeiro continuam no fluxo normal;
- o documento-fonte é preservado como evidência da medição.

## Personas

| Persona | Consultas | Ações preparáveis |
|---|---|---|
| Diretoria | visão executiva, custos, prazo, caixa, vendas, contratos e diário | cotação de fornecedor e medição, se o papel tiver as permissões correspondentes |
| Engenharia | cronograma, custos, contratos e diário | cotação de fornecedor e medição |
| Financeiro | pagar, receber, fluxo, custos, vendas e contratos | cotação de fornecedor; medição operacional é direcionada à Engenharia |
| Clientes | somente cronograma físico | nenhuma |

A persona restringe o comportamento; **quem autoriza é o Elos OS**. A Elos IA nunca eleva permissões.

## Fila de ações

`/elos-ia/acoes` mostra as ações `pending_review` que o usuário consegue enxergar pela RLS.

Isso permite, por exemplo:

- engenheiro preparar o lançamento;
- coordenador/diretor com a permissão adequada revisar;
- nenhum deles compartilhar senha ou ganhar permissão temporária.

As propostas expiram em 7 dias. A permissão é conferida novamente no momento da execução.

## Anexos

Bucket privado: `ai-action-attachments`.

Limites da interface:

- até 3 arquivos por pergunta;
- até 15 MB por arquivo;
- até 25 MB somados;
- PDF, JPG/JPEG, PNG, WebP, XLSX/XLS, CSV, TXT, DOCX/DOC.

O navegador envia o arquivo diretamente ao Supabase Storage. O servidor registra o anexo e cria uma URL assinada curta somente para a interpretação daquela pergunta. O arquivo-fonte vinculado a uma ação executada é copiado para o bucket oficial do módulo de destino.

## Governança no banco

`ai_action_proposals` mantém:

- empresa, obra, turno e persona;
- tipo de ação e permissão obrigatória;
- payload estruturado;
- preview mostrado ao revisor;
- criador, revisor e executor;
- status, timestamps e resultado final.

A permissão necessária é derivada no próprio banco pelo `action_type`; o cliente não consegue escolher uma permissão mais fraca. Payload e preview preparados não podem ser alterados depois da criação.

`ai_execute_action_proposal` executa a ação de forma transacional e idempotente. Atualmente encaminha apenas para RPCs oficiais já existentes:

- `save_procurement_material_supplier_offer`;
- `save_execution_contract_measurement`.

## Limites de consumo

Além dos limites de tokens por resposta/pergunta/usuário/empresa, o Elos IA possui teto mensal em USD por empresa. O custo é estimado internamente para proteção e não substitui a cobrança oficial da OpenAI.

Variáveis principais:

| Variável | Papel |
|---|---|
| `OPENAI_API_KEY` | chave da API, somente servidor |
| `ELOS_IA_MODEL` | modelo utilizado |
| `ELOS_IA_REASONING_EFFORT` | esforço de raciocínio |
| `ELOS_IA_MAX_OUTPUT_TOKENS` | saída máxima por resposta |
| `ELOS_IA_MAX_ROUNDS` | rodadas de consulta/ação por pergunta |
| `ELOS_IA_TURN_TOKEN_BUDGET` | orçamento total de tokens da pergunta |
| `ELOS_IA_DAILY_TOKENS_PER_USER` | limite diário do usuário |
| `ELOS_IA_MONTHLY_TOKENS_PER_COMPANY` | proteção mensal por tokens |
| `ELOS_IA_MONTHLY_USD_PER_COMPANY` | teto mensal estimado em USD por empresa |

## Dados e privacidade

- consultas e ações usam a sessão do usuário e o isolamento RLS da empresa;
- vai à OpenAI somente o conteúdo necessário da pergunta, arquivos anexados naquela pergunta, histórico textual curto e resultados das ferramentas;
- chamadas usam `store: false`;
- documentos ficam em buckets privados;
- o histórico operacional da ação fica auditável no Elos OS.

## Arquivos principais

| Arquivo | Papel |
|---|---|
| `lib/elos-ia/personas.ts` | instruções, consultas e política de safe write |
| `lib/elos-ia/tools.ts` | ferramentas de leitura |
| `lib/elos-ia/action-tools.ts` | preparação de ações operacionais |
| `lib/elos-ia/action-utils.mjs` | matching, rateio e cálculos conservadores |
| `lib/elos-ia/action-executor.ts` | execução humana + preservação do documento-fonte |
| `lib/elos-ia/attachments.ts` | validação/registro de anexos e conteúdo multimodal |
| `lib/elos-ia/agent-loop.mjs` | laço pergunta → ferramentas → resposta |
| `lib/elos-ia/openai.ts` | chamada Responses API |
| `lib/elos-ia/usage.ts` | cotas e custo estimado |
| `lib/elos-ia/server.ts` | orquestração, permissões e ações do turno |
| `app/api/elos-ia/chat/route.ts` | chat e anexos |
| `app/api/elos-ia/actions/[proposalId]/route.ts` | executar/descartar ação revisada |
| `app/elos-ia/` | chat, cartões e fila de revisão |
| `supabase/migrations/20261014100000_elos_ia_safe_write.sql` | fila, anexos, bucket e RLS |
| `supabase/migrations/20261014100100_elos_ia_safe_write_attachment_link.sql` | vínculo arquivo → ação |
| `supabase/migrations/20261014100200_elos_ia_safe_write_execute.sql` | execução transacional |

## Próximas ações candidatas

A arquitetura foi feita para crescer sem dar SQL livre ao modelo. Cada nova ação precisa de schema próprio, permissão própria, preview próprio e executor que reutilize a regra oficial do módulo. Próximos candidatos naturais: contas a pagar/receber, recebimentos, pedidos de compra, aditivos, diário de obra, inspeções de qualidade e cadastros comerciais — sempre no padrão **preparar → revisar → executar**.
