# Banking completo — arquitetura e homologação

Este pacote evolui o núcleo introduzido em `20261013223527_finance_bank_operations.sql`.

## Escopo entregue nesta fase

- múltiplas liquidações por conta a pagar/receber;
- baixa parcial mantendo o título aberto até zerar o saldo;
- separação de valor bruto, líquido e tarifa em recebimentos;
- conexões bancárias desacopladas do provedor;
- cobrança registrada por provedor (`boleto` e `pix`);
- primeiro adaptador real: Asaas;
- webhook idempotente de cobrança;
- baixa automática somente em `PAYMENT_RECEIVED`;
- estruturas persistentes para CNAB 240/400 e ciclo completo de cartão;
- views de saldo residual de contas a pagar/receber.

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

- `PAYMENT_CONFIRMED`: atualiza o estado da cobrança, mas não gera movimento financeiro.
- `PAYMENT_RECEIVED`: registra a liquidação uma única vez.
- valor bruto liquida a parcela;
- valor líquido entra na conta bancária;
- diferença positiva entre bruto e líquido vira tarifa bancária separada;
- o evento externo e o ID da cobrança são usados como chaves de idempotência.

## Segurança

- tabelas novas usam RLS e `GRANT` explícito;
- eventos de webhook só podem ser aplicados pela role de servidor (`service_role`/secret server-side);
- usuários autenticados não escrevem diretamente nas tabelas de liquidação;
- a API key Asaas nunca é enviada ao cliente;
- a baixa manual continua exigindo `receivables.manage` ou `payables.manage`.

## Compatibilidade

As assinaturas públicas `receive_finance_receivable(...)` e `pay_finance_payable(...)` foram mantidas. Telas antigas continuam chamando os mesmos RPCs, mas valores menores que o saldo agora produzem baixa parcial em vez de marcar o título como totalmente pago.

## Próximas entregas para considerar o Banking encerrado comercialmente

1. Interface das conexões e botão de emissão Boleto/Pix na aba Cobranças.
2. Homologação Asaas Sandbox com cliente, boleto, Pix, webhook duplicado, tarifa e estorno/reembolso.
3. Parser de retorno CNAB por banco e geração de remessa homologada (não gerar arquivo bancário por aproximação; usar layout oficial de cada banco).
4. Ciclo de cartão: compras, parcelamento, fechamento, criação do título da fatura, pagamento e estorno.
5. Rotina de refund/chargeback que reverta a liquidação sem apagar histórico.
6. Adapter Nexxera quando houver contrato e documentação/credenciais de homologação.
7. Migração gradual de `SUPABASE_SERVICE_ROLE_KEY` para `SUPABASE_SECRET_KEY` antes do fim da janela de depreciação do Supabase.

## Homologação mínima

- executar todas as migrations em uma base criada do zero;
- confirmar RLS e isolamento entre duas empresas;
- baixa manual parcial em AP e AR;
- duas baixas que completem o mesmo título;
- impedir baixa acima do saldo;
- evento webhook duplicado não pode gerar segunda baixa;
- `PAYMENT_CONFIRMED` não pode movimentar banco;
- `PAYMENT_RECEIVED` deve criar crédito líquido + tarifa separada;
- período fechado deve rejeitar liquidação retroativa;
- testar Sandbox Asaas antes de qualquer credencial de produção.
