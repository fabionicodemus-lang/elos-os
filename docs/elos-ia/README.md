# Elos IA — piloto

Assistente do Elos OS com quatro personas (Diretoria, Engenharia, Financeiro e Clientes). Responde com os dados lançados no sistema e fecha com os próximos passos. Fica em **Elos IA**, logo abaixo de **Início** no menu.

## Como funciona

1. O usuário escolhe a persona e pergunta na tela `/elos-ia`.
2. O servidor do Elos OS identifica o usuário, a empresa, a obra ativa e as permissões do papel.
3. O servidor envia à OpenAI a pergunta, as instruções da persona e a lista de consultas que aquela persona pode pedir.
4. A IA pede consultas (ex.: `contas_a_pagar`). Quem executa é o Elos OS, com a sessão do próprio usuário; o resultado volta resumido e já somado.
5. A IA escreve a resposta e os próximos passos.

A IA nunca acessa o banco diretamente e só lê: não lança, altera nem aprova nada.

## Personas e o que cada uma consulta

| Persona | Consultas |
|---|---|
| Diretoria | Resumo da obra, custos x orçamento, cronograma físico, contas a pagar, contas a receber, fluxo de caixa, vendas e unidades, contratos de serviço, diário de obra |
| Engenharia | Cronograma físico, custos x orçamento, contratos de serviço, diário de obra |
| Financeiro | Contas a pagar, contas a receber, fluxo de caixa, custos x orçamento, vendas e unidades, contratos de serviço |
| Clientes | Só o cronograma físico. No piloto é uma simulação interna: mostra como a IA responderia ao comprador. O comprador ainda não tem acesso. |

A persona restringe; quem autoriza é o Elos OS. Se o papel do usuário não tem permissão para uma tela (ex.: Contas a Pagar), a consulta correspondente é recusada e aparece riscada na resposta.

## Quem pode usar

- Permissão `ai.assistant.use` (módulo **Elos IA** em Configurações › Permissões).
- No piloto só **Proprietário** e **Administrador** começam com acesso. Para liberar Diretoria, Engenharia ou Financeiro, marque a permissão no papel.
- `ai.usage.view` permite ver o consumo de toda a empresa (o usuário sempre vê o próprio).

## Limites de consumo

| Camada | Padrão | Variável |
|---|---|---|
| Por resposta do modelo | 16.000 tokens de saída | `ELOS_IA_MAX_OUTPUT_TOKENS` |
| Por pergunta | 4 rodadas de consulta, 60.000 tokens e 100 segundos | `ELOS_IA_MAX_ROUNDS`, `ELOS_IA_TURN_TOKEN_BUDGET` |
| Por usuário, por dia | 300.000 tokens | `ELOS_IA_DAILY_TOKENS_PER_USER` |
| Por empresa, por mês | 5.000.000 tokens | `ELOS_IA_MONTHLY_TOKENS_PER_COMPANY` |

- Ao atingir a cota, a tela bloqueia o campo de pergunta e a API responde 429.
- As cotas diária e mensal dependem da migration `0091` (tabela `ai_usage_log`). Sem ela o Elos IA funciona, mas só com os limites por resposta e por pergunta.
- Além disso, defina um orçamento mensal no projeto da OpenAI: é o teto final de gasto, independente do Elos OS.
- Cada pergunta leva só as últimas 8 mensagens de texto da conversa. Resultados de consultas anteriores não são reenviados, então o custo não cresce a cada pergunta.
- O teto por pergunta é estimado antes de cada ida ao modelo: uma nova rodada de consultas só acontece se ela e a resposta final couberem no orçamento. Os resultados das consultas de uma pergunta somam no máximo 36 mil caracteres.

### Limitações conhecidas da medição (piloto)

- **Perguntas simultâneas:** a cota é conferida antes da pergunta e o consumo é gravado depois. Quem disparar várias perguntas no mesmo instante pode passar da cota diária pelo valor dessas perguntas.
- **Registro feito com a sessão do usuário:** o Elos OS não usa chave de serviço, então um usuário com acesso ao Elos IA consegue, por fora da tela, incluir linhas em `ai_usage_log` da própria empresa. Ele não consegue apagar nem reduzir consumo, mas pode inflar o número e travar a cota do mês.
- Por isso o teto que vale de verdade é o **orçamento mensal configurado na OpenAI**. Antes de cobrar clientes por consumo, a medição deve passar para o servidor (chave de serviço) com os limites de cada plano guardados no banco.

## Configuração (Vercel › elos-os › Settings › Environment Variables)

| Variável | Obrigatória | Valor |
|---|---|---|
| `OPENAI_API_KEY` | sim | Chave da API da OpenAI. Marque como *Sensitive*. Nunca vai ao navegador. |
| `ELOS_IA_MODEL` | não | Padrão `gpt-6-luna` (o mais barato). Para respostas mais elaboradas: `gpt-6.1-sol`. |
| `ELOS_IA_REASONING_EFFORT` | não | Padrão `low`. |

Depois de criar ou alterar uma variável é preciso publicar de novo (Redeploy) para ela valer.

## Dados e privacidade

- As consultas usam a sessão do usuário, então o isolamento por empresa (RLS) vale também para a IA.
- Vai à OpenAI: a pergunta, as últimas mensagens da conversa e os resumos das consultas (valores, nomes de fornecedores, clientes e atividades da obra consultada).
- A chamada usa `store: false`: a OpenAI não guarda a conversa como histórico da API.
- O Elos OS não grava o texto das perguntas nem das respostas. Grava só o consumo: quem, quando, persona, modelo, tokens e quais consultas foram feitas.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/elos-ia/personas.ts` | Instruções e consultas de cada persona |
| `lib/elos-ia/tools.ts` | Consultas ao Elos OS (somente leitura) |
| `lib/elos-ia/summaries.mjs` | Cálculos dos resumos (testados em `summaries.test.mjs`) |
| `lib/elos-ia/agent-loop.mjs` | Laço pergunta → consultas → resposta, com os limites por pergunta |
| `lib/elos-ia/openai.ts` | Chamada à OpenAI (Responses API) |
| `lib/elos-ia/usage.ts` | Cotas e registro de consumo |
| `lib/elos-ia/server.ts` | Orquestração e checagem de acesso |
| `app/api/elos-ia/chat/route.ts` | Rota chamada pela tela |
| `app/elos-ia/` | Tela do chat |
| `supabase/migrations/20261009_0091_elos_ia_usage.sql` | Permissões, tabela de consumo e função das cotas |

## O que ficou fora do piloto

- Acesso real do comprador (persona Clientes). Exige login próprio do cliente e filtro pela unidade dele.
- Respostas aparecendo aos poucos (streaming) e histórico de conversas salvo.
- Tela de consumo por usuário para o administrador (os dados já estão em `ai_usage_log`).
- Qualquer ação de escrita pela IA.
