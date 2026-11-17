# Elos OS — Gestão de Inadimplências

## Acesso

- Menu **Financeiro → Gestão de Inadimplências**, ou atalho em **Contas a Receber**.
- Exige a permissão existente `receivables.view`; a navegação respeita essa permissão e a página confirma no servidor.
- Selecione **Construtora toda** ou um empreendimento. A busca por nome/CPF/CNPJ filtra a lista de inadimplentes; os indicadores no topo continuam consolidados no empreendimento/construtora selecionado.

## Indicadores e regras

| Indicador | Cálculo |
| --- | --- |
| Saldo em aberto de uma parcela | `max(coalesce(nullif(adjusted_amount, 0), amount) - coalesce(paid_amount, 0), 0)` |
| Parcela vencida | `status = 'open'`, saldo positivo e `due_date` anterior à data atual de `America/Sao_Paulo` |
| Total vencido | Soma dos saldos de parcelas vencidas no escopo selecionado |
| Clientes inadimplentes | Clientes distintos com pelo menos uma parcela vencida |
| Parcelas vencidas | Quantidade de parcelas vencidas com saldo positivo |
| Total em aberto | Soma dos saldos de **todas** as parcelas abertas, vencidas ou futuras |
| Envelhecimento | Total vencido em faixas 1–30, 31–60, 61–90 e 91+ dias |

Parcelas pagas, canceladas ou sem saldo não integram os totais. Quando importações legadas deixam `adjusted_amount` zerado, o sistema utiliza o valor nominal. Multas, juros adicionais e descontos ainda não incorporados a `adjusted_amount` não são projetados ou presumidos por esta tela.

O ranking exibe os **inadimplentes**; o consolidado de **total em aberto** também inclui parcelas futuras de clientes ainda adimplentes. A tela mostra vencido e em aberto separadamente para não misturar esses conceitos.

O botão **Ver parcelas** abre o detalhamento do cliente com obra, unidade, descrição, vencimento, valor atualizado, valor recebido e saldo. As parcelas vencidas aparecem primeiro; as futuras vêm em seguida. A ação **Venda** aponta para o cadastro comercial existente e respeita a autorização desse módulo.

## Segurança e escala

- Migration `20261117220600_financial_delinquency_management.sql`: cria apenas dois índices parciais e duas funções de consulta `SECURITY INVOKER`, sem modificar títulos nem lançar cobranças.
- As funções validam `auth.uid()` e `receivables.view`, filtram `company_id` e respeitam as políticas RLS existentes. Os vínculos de projeto são conferidos contra os empreendimentos da construtora no servidor.
- O backend realiza a agregação e a paginação: 25 clientes e 40 parcelas por página, com limites máximos de 100 registros por chamada SQL.

## Homologação e entrega

1. Aplicar a migration **somente no ambiente de homologação** autorizado; não executar automaticamente em produção.
2. Verificar migração sem erro e os acessos dos perfis de Financeiro, Administrador e um usuário sem `receivables.view`.
3. Cadastrar/usar casos de teste com duas obras e clientes com parcela vencida, futura, parcialmente recebida, paga e cancelada. Conferir os valores contra Contas a Receber e a carteira comercial.
4. Validar filtros da construtora/obra, busca, paginação, links, data-base e layout em desktop e celular.
5. Após aceite, implantar a migration e a aplicação em produção por processo de deploy supervisionado, monitorando desempenho das consultas.

**Teste automatizado:** `npm run test:delinquency`. Também integrado ao `npm test`.
