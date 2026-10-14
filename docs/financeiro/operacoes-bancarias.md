# Operações bancárias — implementação inicial

Rota: `/financeiro/contas-bancarias/operacoes`, acessível pelo botão **Extratos e conciliação** em Contas bancárias.

## Situação das cinco prioridades

| Prioridade | Implementado nesta alteração | Ainda pendente |
| --- | --- | --- |
| 1. Importação e conciliação | OFX BRL de uma conta, SGML/XML, validação de banco/conta/data/valor/FITID, deduplicação por arquivo e por FITID, rejeição atômica de divergências e vínculos com o razão interno | Conexão automática com o banco; validação com amostras dos bancos utilizados pela Bossa |
| 2. Correspondências e diferenças | Sugestões por saldo não conciliado, natureza e data; vários vínculos parciais; desfazer com motivo; registro explícito de tarifa/juros/ajuste e conciliação atômica | Baixas parciais de contas a pagar/receber, descontos e liquidação líquida de recebimento com tarifa de sinal contrário |
| 3. Extrato e controle | Saldo acumulado antes da paginação; fechamento/reabertura justificados; bloqueio de movimentos antigos, importações retroativas e saldo inicial; comprovantes PDF privados vinculados a lançamentos | Validação ponta a ponta com sessão autenticada, Storage e dados de homologação |
| 4. Cobrança bancária | Preparação e cancelamento de rascunhos por parcela, valor corrigido, vencimento, multa, juros e instruções | Escolha de banco/provedor; convênio/carteira; emissão e registro real; remessa/retorno ou API/webhooks; homologação e baixa automática idempotente |
| 5. Organização e instrumentos | Grupos e saldos, arquivamento PDF, cadastro de cartão pelos últimos quatro dígitos, controle e compensação interna de cheque | Compras, parcelas e fechamento de faturas de cartão; estorno de compensação de cheque; leitura automática de extrato PDF |

**Importar OFX não cria pagamentos nem baixa títulos. Rascunho de cobrança não é boleto. Compensação de cheque registra uma operação já realizada no banco; não envia ordem bancária.**

## Regras de dados e segurança

- Migration: `20261013223527_finance_bank_operations.sql`. Não aplicada à produção nesta entrega.
- Novas tabelas com RLS, empresa e autoria. Escritas passam por funções autenticadas e verificações de permissão e conta. Funções com privilégios elevados ficam em `finance_private`, com `search_path` vazio e sem execução pública/anônima.
- Vínculos ativos nunca podem ultrapassar os saldos do extrato ou do lançamento. Bloqueios por conta serializam importação, conciliação e fechamento. Estornos preservam evidência.
- Conciliação manual anterior não equivale a comprovação por extrato. O fechamento exige vínculos completos de todos os movimentos não cancelados e de todo o extrato até a data; diferenças legadas precisam ser conferidas primeiro.
- As views de saldo e valores ainda conciliáveis usam `security_invoker`. Somas são feitas no banco antes de paginação, inclusive com vários vínculos por movimento.
- O fechamento protege as rotinas antigas por triggers. Alteração de saldo inicial exige reabertura. Mudanças de período e conciliação ficam auditadas.
- PDF em bucket privado `bank-documents`, máximo de 4 MB. Links temporários expiram em cinco minutos. Um comprovante pode ser associado a um lançamento da mesma conta. O conteúdo não é extraído automaticamente.
- Arquivos OFX são processados e identificados por hash; o binário original não é arquivado. A tela lista até 100 candidatos internos por busca e pagina registros em blocos de 50. Contas e grupos: até 500.
- A diferença registrada pela conciliação utiliza o restante inteiro do movimento e sua natureza. Não use essa ação para registrar novamente um lançamento existente.
- Os módulos antigos de contas a pagar/receber continuam com a semântica anterior de baixa integral. Não representam múltiplos recebimentos/pagamentos parciais de um título.

## Validação reproduzível

```sh
npm ci
npm run test:banking
npx eslint app/financeiro/contas-bancarias/operacoes lib/banking/ofx.ts
npx tsc --noEmit
npm run build
```

Os testes executam a migration em PostgreSQL embarcado (PGlite) com uma base mínima de autenticação, Storage e tabelas de origem, usando as definições reais das tabelas bancárias e da função legada de lançamento. Cobrem OFX, atomicidade, duplicidade, permissões, isolamento de empresa, limites parciais, estorno, fechamento, tarifas, cheques, cobranças corrigidas e metadados PDF. A base mínima não substitui a execução da cadeia completa de migrations, o serviço real de Storage ou testes concorrentes com múltiplas conexões.

## Homologação antes da produção

1. Aplicar a migration em ambiente de homologação que já possua as migrations anteriores. Fazer backup e validar as permissões reais de operador e consulta.
2. No contexto Bossa / Flow, importar OFX anonimizado de cada banco usado, repetir o arquivo e um arquivo sobreposto, conferir as quantidades e rejeitar conta diferente.
3. Conferir vínculo parcial, complemento, tarifa explicitamente justificada e estorno; verificar razão e saldo.
4. Fechar o período e testar rotinas antigas de lançamento, transferência, cancelamento e edição do saldo inicial. Reabrir com motivo e conferir auditoria.
5. Enviar PDF, vincular a lançamento, abrir o link temporário e testar isolamento em outra empresa.
6. Validar desktop/mobile e navegação das seis abas com usuário autenticado. Esta sessão validou código e SQL, sem sessão autenticada de homologação.
7. Somente após homologação, aplicar a migration e publicar o código. Nenhuma credencial bancária é necessária para o escopo implementado.

Para boletos reais, definir banco/provedor e obter credenciais de sandbox por canal de segredos. A implementação deve incluir contrato de integração, estados de registro, idempotência, autenticação dos retornos e testes homologados; preencher credenciais sozinho não habilita esses recursos.
