# Revisão da identidade das unidades

O lote precisa identificar cada unidade física antes de criar vendas ou parcelas vinculadas. O código escrito no eObra pode ser diferente do código existente no Elos. Prefixos, espaços e rótulos históricos não autorizam uma associação automática.

## Fluxo da revisão

Após carregar todos os registros, a preparação entra em `map_units` quando existem registros `unit` sem confirmação. A tela mostra as unidades da fonte em páginas de 50, com filtro de obra e código. Para cada ID da fonte, o operador escolhe uma das ações:

- `reuse`: selecionar um UUID existente na mesma empresa e obra. A escolha registra o hash da identidade apresentada durante a revisão.
- `create`: autorizar explicitamente a criação de uma unidade física que ainda não possui cadastro na obra.

Nenhuma ação vem selecionada. Cada ID real de unidade da coleta precisa de uma decisão; IDs desconhecidos e o uso do mesmo UUID por dois IDs de origem são rejeitados. A confirmação é integral e exige a confirmação expressa de quem revisou. As escolhas ainda não confirmadas permanecem apenas na página aberta.

Os cadastros existentes são consultados em páginas de até 50 pela RPC `eobra_snapshot_unit_options`. O endpoint de aplicação mantém a empresa ativa, a autorização da coleta e as permissões dos módulos. O controle da confirmação tem limite de 3 MiB; não contém o snapshot nem dados brutos da coleta.

## Identidade confirmada e retomada

O mapa tem este formato, usando IDs inteiramente sintéticos:

```json
{
  "source-unit-a": {
    "action": "reuse",
    "unit_id": "11111111-1111-4111-8111-111111111111",
    "expected_identity_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source-unit-b": { "action": "create" }
}
```

O banco deriva a evidência do cadastro nativo, confere seu hash e a associa ao lote e à prévia. Se a identidade mudar depois de ser exibida ou entre a confirmação e a promoção, a operação exige nova conferência. O vínculo reaproveita o cadastro sem sobrescrever código, tipo, áreas, valores ou origem de integração. A situação comercial pode mudar pelo processamento legítimo de uma venda, sujeita aos guards do módulo comercial.

A mesma confirmação pode ser repetida com segurança após perda de resposta. Um mapa diferente não substitui uma confirmação existente. Para alterar decisões confirmadas, prepare uma nova revisão. A preparação só continua para validação, fechamento da prévia e promoção depois desta etapa; carregar um pacote não cria unidades nos cadastros oficiais.

## Rótulos históricos e divergências de inventário

Dois rótulos distintos com o mesmo ID da fonte precisam conservar suas evidências históricas, mas não representam automaticamente duas unidades físicas. Inversamente, IDs de origem distintos não podem ser reunidos apenas porque seus códigos parecem semelhantes. Divergências entre o inventário existente e a lista coletada exigem decisão individual. Unidades nativas sem correspondência na coleta permanecem fora das ações deste importador.

## Verificação

`tests/imports/eobra-unit-map.test.mjs` cobre decisões explícitas, preservação exata dos IDs, unicidade do destino, hash obrigatório, rejeição de campos de mutação, origem da requisição, limites reais de bytes e paginação. Os testes de banco da migration de de-para verificam isolamento, evidência, replay e promoção com reaproveitamento sem sobrescrita.
