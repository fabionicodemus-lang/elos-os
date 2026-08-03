# Fase 3 — contratos, comprometido e medições

## Objetivo

A Fase 3 cria a camada **Comprometido** entre o orçamento e o contas a pagar. O Elos OS já possuía contratos e medições operacionais; por isso a implementação evolui as tabelas existentes em vez de criar um segundo módulo concorrente.

Não há migração ou cópia de registros antigos. A migration é incremental e não gera contas a pagar retroativas.

## Estruturas reutilizadas

- `suppliers`
- `execution_service_contracts`
- `execution_service_contract_items`
- `execution_service_contract_amendments`
- `execution_contract_measurements`
- `execution_contract_measurement_items`
- `execution_service_contract_audit`
- `execution_contract_measurement_audit`
- `payables`

## Nova estrutura

### `execution_service_contract_amendment_items`

Aloca financeiramente cada aditivo aos itens e serviços do contrato.

Campos principais:

- `company_id` e `project_id` para isolamento multiempresa e por obra;
- `contract_id` e `amendment_id`;
- `contract_item_id` e `service_id`;
- `value_change`, positivo para acréscimo e negativo para supressão;
- auditoria de criação.

A tabela possui RLS e usa as permissões existentes de contratos. A soma das alocações de um aditivo financeiro precisa coincidir com o valor do aditivo.

## Fórmulas

### Valor vigente

```text
valor vigente = valor original + soma dos aditivos
```

### Saldo contratual

```text
saldo contratual = valor vigente − medições aprovadas, comprometidas ou pagas
```

Medições estornadas não entram no saldo medido. O saldo pode ficar negativo; o sistema não limita o resultado a zero.

### Retenção acumulada

```text
retenção acumulada =
soma da retenção contratual + garantia das medições válidas
```

A retenção aparece como valor a devolver no encerramento. Nesta fase a devolução continua sendo uma conta a pagar manual.

### Comprometido por serviço

```text
comprometido do serviço =
itens dos contratos não cancelados
+ aditivos alocados ao serviço
```

### Desvio contra o orçamento

```text
desvio = comprometido − valor do serviço no orçamento vinculado
```

Desvio positivo é exibido em vermelho e nunca bloqueia a operação.

## Medição mensal simples

A tela `/engenharia/contratos` permite registrar uma medição por:

- valor bruto do período; ou
- percentual do valor vigente do contrato.

A competência é convertida para o primeiro e último dia do mês. O valor é distribuído proporcionalmente entre os itens do contrato, considerando o valor base, os aditivos alocados e o que já foi medido.

Para medições detalhadas por quantidade, a tela anterior permanece disponível em `/execucao/medicoes-contratos`.

## Estouro contratual

Uma medição pode ultrapassar a quantidade do item ou o valor vigente do contrato, mas exige confirmação explícita.

Quando confirmado, são gravados:

- `over_contract_confirmed`;
- `over_contract_confirmed_by`;
- `over_contract_confirmed_at`.

O estouro fica destacado em vermelho. O sistema não reduz nem esconde o valor medido.

## Aprovação e conta a pagar

A aprovação passa a ser uma única transação:

```text
medição enviada
→ aprovação técnica
→ cálculo do líquido
→ criação da conta a pagar
→ vínculo measurement.payable_id
→ atualização dos acumulados
→ auditoria
```

A conta a pagar recebe:

- empresa, obra e fornecedor do contrato;
- documento igual ao número da medição;
- valor igual ao líquido da medição;
- vencimento igual à data da aprovação mais `payment_days`;
- `source_system = elos_os`;
- `source_id = measurement:<UUID>`.

Medições antigas já aprovadas não recebem contas retroativas. O fluxo antigo de envio ao financeiro permanece disponível apenas para esses registros legados.

## Estorno

Foi adicionada a permissão:

```text
execution.measurements.reverse
```

Regras:

1. somente medições aprovadas ou comprometidas e ainda não pagas podem ser estornadas;
2. o motivo é obrigatório;
3. a conta a pagar aberta é cancelada;
4. uma conta já paga bloqueia o estorno até a reversão do pagamento;
5. a medição recebe status `reversed`;
6. os acumulados do contrato são recalculados;
7. registros não são apagados.

## Tela unificada

Rota:

```text
/engenharia/contratos
```

A tela possui:

- filtros por obra, status, fornecedor e texto;
- cartões de valor contratado, medido, saldo, retido e pago;
- detalhe do contrato;
- itens e serviços;
- aditivos e alocação por serviço;
- comparativo comprometido × orçamento;
- medição mensal simples;
- aprovação com geração automática da payable;
- estorno;
- linha do tempo de auditoria;
- alertas de integridade e estouro.

As telas anteriores continuam disponíveis para edição detalhada e compatibilidade.

## Multiempresa e segurança

Todas as novas estruturas possuem `company_id`, `project_id` e RLS. As funções `SECURITY DEFINER` validam empresa, obra, vínculo dos itens e permissão antes de gravar.

A política da nova tabela usa `has_company_permission(company_id, ...)`, impedindo leitura ou escrita por membros de outra empresa.

## Testes

Foram adicionados testes para:

- soma dos itens e valor original;
- saldo com acréscimos, supressões e estornos;
- vencimento da payable;
- confirmação de estouro;
- retenção acumulada;
- desvio contra o orçamento;
- presença de RLS e isolamento por `company_id` na migration.

A validação transacional completa da criação e estorno da payable deve ser executada em ambiente Supabase de homologação antes do merge para produção.
