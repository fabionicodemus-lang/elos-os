# Banking completo — arquitetura e homologação

Este pacote evolui o núcleo introduzido em `20261013223527_finance_bank_operations.sql`.

## Escopo implementado

- múltiplas liquidações por conta a pagar/receber;
- baixa parcial mantendo o título aberto até zerar o saldo;
- resumos de AP/AR compatíveis com baixa parcial;
- separação de valor bruto, líquido e tarifa em recebimentos;
- conexões bancárias desacopladas do provedor;
- cobrança registrada por provedor (`boleto` e `pix`);
- primeiro adaptador real: Asaas;
- emissão idempotente: antes de criar uma cobrança o Elos procura a mesma `externalReference` no Asaas;
- webhook autenticado e idempotente;
- baixa automática somente em `PAYMENT_RECEIVED`;
- tela `/financeiro/contas-bancarias/integracoes` para conexões, boleto, Pix e liquidações;
- estruturas persistentes para CNAB 240/400;
- ciclo de cartão com configuração, compras, parcelamento em até 48x, criação automática das faturas futuras, cancelamento enquanto abertas, fechamento e pagamento parcial/total;
- tela `/financeiro/contas-bancarias/cartoes`;
- views de saldo residual de contas a pagar, receber e faturas de cartão.

## Asaas

O adaptador usa as APIs oficiais de Clientes, Cobranças, Pix e Webhooks. O Elos desabilita a notificação automática do Asaas ao criar o cliente para evitar comunicação duplicada; a comunicação permanece responsabilidade da construtora/Elos.

### Segredos

Nenhuma chave fica no banco ou no navegador. A conexão guarda apenas `credential_ref`.

Configure no servidor:

```env
ELOS_BANKING_ASAAS_KEYS={"bossa-principal":"$aact_..."}
ELOS_BANKING_ASAAS_WEBHOOK_TOKENS={"bossa-principal":"token-longo-aleatorio"}
```

O `credential_ref` da conexão deve ser `bossa-principal` (ou outra chave do JSON). Use chaves Sandbox durante homologação e Produção somente depois dos testes.

O webhook da conexão é:

```text
POST /api/banking/webhooks/asaas/<CONNECTION_ID>
```

No Asaas, configure o mesmo token em `authToken`; ele chega ao Elos no cabeçalho `asaas-access-token`.

## Regra de liquidação

- `PAYMENT_CONFIRMED`: atualiza o estado da cobrança, mas não gera movimento financeiro;
- `PAYMENT_RECEIVED`: registra a liquidação uma única vez;
- valor bruto liquida a parcela;
- valor líquido entra na conta bancária;
- diferença positiva entre bruto e líquido vira tarifa bancária separada;
- o evento externo e o ID da cobrança são usados como chaves de idempotência;
- um timeout na emissão não deve gerar cobrança duplicada: nova tentativa pesquisa `externalReference` antes do POST.

## Cartões

- o cartão continua sendo um instrumento da conta bancária, sem armazenar número completo;
- configure limite, dia de fechamento e dia de vencimento;
- uma compra após o fechamento entra no ciclo do mês seguinte;
- compras parceladas são divididas com ajuste de centavos na última parcela;
- fatura aberta pode receber compra/cancelamento;
- fatura fechada não aceita mudança nas compras;
- pagamentos podem ser parciais; a fatura só muda para `paid` quando o saldo chega a zero;
- pagamento da fatura cria a saída correspondente no extrato interno.

## Segurança

- tabelas novas usam RLS e `GRANT` explícito;
- eventos de webhook só podem ser aplicados pela role de servidor (`service_role`/secret server-side);
- usuários autenticados não escrevem diretamente nas tabelas de liquidação;
- a API key Asaas nunca é enviada ao cliente;
- o token do webhook é comparado em tempo constante;
- a baixa manual continua exigindo `receivables.manage` ou `payables.manage`;
- períodos bancários encerrados rejeitam liquidações retroativas.

## Compatibilidade

As assinaturas públicas `receive_finance_receivable(...)` e `pay_finance_payable(...)` foram mantidas. Telas antigas continuam chamando os mesmos RPCs, mas valores menores que o saldo agora produzem baixa parcial em vez de marcar o título como totalmente pago.

## CNAB e Nexxera

O núcleo já registra arquivos de remessa/retorno, layout, hash, status e evidência. **Não é seguro gerar remessa CNAB “genérica”.** Os bancos possuem variações de layout, convênio, carteira, códigos de ocorrência e homologação. O adapter de um banco só deve ser ativado depois de receber o manual/layout e dados de convênio daquele cliente.

A arquitetura também prevê `provider = nexxera`, mas o conector Nexxera deve ser implementado/homologado quando houver contrato, documentação técnica e credenciais do ambiente de testes. O restante do Banking não depende disso.

## Pendências antes de produção

1. Rodar as novas migrations numa cópia da base real e numa base criada do zero.
2. Homologar Asaas Sandbox com uma conta de teste e configurar os segredos na Vercel.
3. Exercitar a interface autenticada de integrações e cartões.
4. Implementar estorno financeiro explícito para `PAYMENT_REFUNDED`/chargeback; hoje o evento preserva o status para revisão, sem criar automaticamente um movimento reverso.
5. Homologar CNAB por banco quando surgir o primeiro cliente que realmente usar remessa/retorno tradicional.
6. Adapter Nexxera quando houver contrato/documentação/credenciais.
7. Migrar gradualmente `SUPABASE_SERVICE_ROLE_KEY` para `SUPABASE_SECRET_KEY` antes do fim da janela de depreciação do Supabase.

## Homologação mínima

- executar todas as migrations em uma base criada do zero;
- confirmar RLS e isolamento entre duas empresas;
- baixa manual parcial em AP e AR;
- duas baixas que completem o mesmo título;
- impedir baixa acima do saldo;
- evento webhook duplicado não pode gerar segunda baixa;
- `PAYMENT_CONFIRMED` não pode movimentar banco;
- `PAYMENT_RECEIVED` deve criar crédito líquido + tarifa separada;
- emissão repetida com mesma `externalReference` não pode criar segunda cobrança;
- período fechado deve rejeitar liquidação retroativa;
- compra de cartão em 1x e parcelada;
- compra após fechamento deve cair no ciclo seguinte;
- fechar fatura, pagar parcialmente e completar o pagamento;
- impedir cancelamento de compra em fatura já fechada;
- testar Sandbox Asaas antes de qualquer credencial de produção.
