# Continuidade da correção de recebíveis do eObra

## Entrega e limites operacionais

A migração `receivable_explicit_correction_policies` acrescenta uma política
explícita por parcela, revisão com hash, histórico dos índices, fila de atualização
e cálculo por máxima do período. A instalação não cria nem ativa políticas para
parcelas existentes. Nenhum cliente, obra, ID de regra ou índice é fixado no código.

O painel fica em `/configuracoes/importacoes/correcao-eobra`. O fluxo é:

1. Promover o pacote de origem e preservar sua série mensal.
2. Escolher o índice da origem e o índice canônico do Elos, conferir os valores e
   confirmar o vínculo. A escolha usa IDs explícitos; não há correspondência por nome.
3. Abrir uma parcela, conferir regra, base, série e igualdade financeira no corte.
4. Confirmar a continuidade dessa parcela. A ativação é individual.
5. Conferir a fila do mês corrente e continuar os lotes enquanto houver parcelas
   pendentes de processamento.

Não há agendamento mensal configurado por esta entrega. O repositório continha
gatilhos de atualização de índices, mas não foi encontrado um agendador mensal
para esta finalidade. O painel informa essa condição. A publicação de um índice
inicia um lote limitado; o operador pode continuar a fila. Há também uma entrada
privada preparada para um agendador futuro, cuja configuração exige revisão
separada. Nenhuma configuração de produção é alterada por esses arquivos.

## Política suportada

O mecanismo desta versão habilita apenas recebíveis abertos, sem pagamento
líquido, com regra da origem completa e paridade financeira comprovada:

```json
{
  "mode": "index_number",
  "source_rule_id": "regra-sintetica",
  "base_month": "2026-01",
  "base_value": "1000.000000",
  "reference_month": "2026-03",
  "reference_value": "1100.000000",
  "negative_variation_policy": "maximum_of_period",
  "correct_until_settled": true,
  "additional_rate": "0.000000",
  "penalty_rate": "0.000000",
  "interest_rate": "0.000000",
  "compound_interest": false
}
```

O exemplo é sintético. Os campos pertencem a `normalized.correction`. Ausência de
taxa não significa zero. Regra fixa, taxa adicional não zero, juros compostos,
defasagem não zero e configuração incompleta permanecem pendentes de continuidade,
sem impedir a preservação do histórico importado.

`reference_method="current_month_sao_paulo"` é a escolha do motor apresentada na
aprovação, não um fato fabricado no pacote de origem. O campo não é exigido no JSON
capturado. A revisão mostra que, após a ativação, o período irá da base explícita
ao mês corrente em `America/Sao_Paulo`, incluindo parcelas com vencimento futuro.
Índices de competências futuras podem permanecer cadastrados e não entram no
cálculo antes do seu mês.

Quando `lag_months` foi efetivamente informado na origem, esta versão aceita
somente o valor zero. Ausência desse campo não grava uma defasagem contratual
inventada. A base não é obtida de `sales.sale_date`, do vencimento, de um mês
anterior disponível ou da carência legada de quatro meses.

## Relação com o legado e com pagamentos

Os recebíveis continuam com `correction_locked=true`. O novo gatilho de proteção
executa antes de `receivables_automatic_correction`, preservando o lock mesmo que
um formulário antigo envie `false`. A política aprovada conserva os IDs da empresa,
obra e índice e o par competência/valor-base. Formulários antigos não podem trocar
essa identidade contratual.

A correção, o valor atualizado e a referência também não podem ser substituídos
diretamente, deixando a política ativa com uma valorização diferente da aprovada.
Ativação e recálculo registram uma intenção exata em tabela privada, limitada à
mesma transação, parcela e valores calculados. O gatilho exige essa intenção para
alterar o CUB e a remove na própria operação. Não há flag de sessão que permita
liberar a escrita. Edições coerentes dos componentes financeiros continuam
permitidas e são preservadas no recálculo seguinte.

O recálculo explícito só atua em parcelas abertas com `paid_amount=0`. Quitação,
cancelamento ou qualquer pagamento parcial suspende a política e preserva o valor
histórico imediatamente. Alteração do principal também suspende a continuidade
até nova revisão. Não há amortização presumida nem correção sobre principal já
recebido.

A nova política não muda a regra de recebíveis que não foram explicitamente
ativados. Mudança da data da venda ou de sua carência não redefine a base da nova
política.

## Cálculo e conferência

Para cada competência entre a base e a referência, inclusive, deve existir um
índice numérico positivo e válido. Lacuna, índice inativo, valor-base divergente ou
valor fora da precisão geram pendência. O valor vigente da parcela é conservado;
não há retorno silencioso ao nominal.

O maior índice da janela é aplicado ao principal. Em empate, a competência mais
recente é registrada como a máxima efetiva. São mantidos separadamente:

- Referência solicitada: mês corrente que foi conferido e seu índice publicado.
- Referência efetiva: mês e valor da máxima usados no cálculo.
- Base explícita: competência e valor aprovados na origem.

O cálculo transforma o principal em centavos e os índices em milionésimos. Usa
quociente inteiro e resto para um único arredondamento `HALF_UP`, sem arredondar
antecipadamente a razão e sem depender da precisão de `Number`.

```text
principal corrigido = HALF_UP(original × máxima_do_período / índice_base)
correção = principal corrigido − original
atualizado = principal corrigido + juros + multa + outros acréscimos − desconto
```

Somente `correction_amount`, `adjusted_amount` e os metadados da correção são
atualizados. Os componentes financeiros permanecem separados e são preservados.

Antes de habilitar, a prévia verifica o ledger de promoção, a identidade da parcela,
empresa/obra, situação, pagamento, todos os componentes, o vínculo do índice, cada
valor da série no corte e a igualdade exata com o snapshot. A referência da origem
deve coincidir com o mês do corte. O hash é refeito dentro da ativação após adquirir
o lock do índice e da parcela, impedindo confirmar uma prévia que mudou.
Repetir a mesma ativação com o mesmo registro e hash devolve a política já criada,
inclusive depois de uma atualização mensal legítima, sem reaplicar o corte antigo.

## Persistência e auditoria

| Tabela | Função |
| --- | --- |
| `correction_indices`, `correction_index_values` | Cadastros canônicos existentes, reutilizados |
| `correction_index_source_links` | Correspondência explícita entre índice preservado e índice canônico, com prova da conferência |
| `correction_index_value_history` | Histórico imutável das inclusões, alterações e remoções de valores mensais |
| `receivable_correction_policies` | Política, base, origem, prova de paridade e última avaliação por parcela |
| `receivable_correction_queue` | Geração de mudanças por empresa/índice e motivo da atualização |
| `receivable_correction_events` | Ativações, cálculos, bloqueios e suspensões, com valor anterior e posterior |

O vínculo de índice copia somente competências ausentes. Valores iguais são
reutilizados; divergências são mostradas na prévia e impedem sobrescrita automática.
Novas competências da mesma origem exigem uma nova prévia e geram seus registros
de histórico. O vínculo de identidade original permanece imutável.

Cada política conserva um hash da série já aplicada. Revisar uma competência desse
período coloca a política em `review_required` e mantém o valor da parcela. Esta
versão não substitui automaticamente uma política aprovada nem implementa uma
reescrita de contratos/histórico. A revisão dessa situação é uma operação separada;
não há um botão que simplesmente ignore o conflito.

### Estados

| Estado | Comportamento |
| --- | --- |
| `active` | Política validada; pode aguardar um novo lote se mês ou geração mudaram |
| `blocked` | Mês/índice pendente; mantém o valor e tenta novamente após nova competência ou mudança do mês |
| `suspended` | Pagamento, parcial ou cancelamento preservado; não recalcula |
| `review_required` | Base histórica, principal ou série já aplicada mudou; não recalcula sem revisão |

Uma parcela pode estar `active` e ainda ter processamento pendente para o novo mês.
O contador `pending` compara o mês e a geração conferidos, evitando apresentar o
primeiro lote como atualização de toda a carteira.

## RPCs

Os endpoints públicos são wrappers `SECURITY INVOKER`. A escrita ocorre em funções
privadas com permissões explícitas. Nenhum endpoint recebe valores de parcela do
navegador para substituir o snapshot ou um `company_id` sem conferir a sessão.

| RPC pública | Uso |
| --- | --- |
| `preview_eobra_correction_index(company, source_index, canonical_index)` | Prévia do vínculo, contagens, conflitos e hash |
| `bind_eobra_correction_index(company, source_index, canonical_index, hash)` | Confirma a correspondência e copia valores ausentes |
| `preview_eobra_receivable_correction(company, receivable, source_record)` | Regra, valores, série e prova de paridade |
| `activate_eobra_receivable_correction(company, receivable, source_record, hash)` | Habilita uma parcela revisada |
| `refresh_receivable_correction_policies(company, index_or_null, limit)` | Processa de 1 a 1.000 parcelas por chamada; painel usa 500 |
| `receivable_correction_overview(company)` | Contagens de fila, políticas e pendências |
| `eobra_receivable_correction_candidates(company, limit, offset)` | Lista paginada dos recebíveis promovidos e suas políticas |

Revisão e ativação exigem vínculo ativo com a empresa e permissões
`admin.company.manage`, `indices.manage` e `receivables.manage`. Refresh exige
vínculo com a empresa e `indices.manage` ou `receivables.manage`. As tabelas novas
têm RLS e só concedem leitura ao papel `authenticated`; não há DML direto para
alterar hashes, políticas ou eventos. Rotinas internas de cálculo, fila, gatilho e
agendador não concedem execução a `authenticated` ou `anon`.

O painel exige `indices.manage`, permitindo ao Financeiro continuar os lotes sem
receber administração da empresa. Os formulários de vínculo/ativação aparecem
somente para quem possui todas as permissões de revisão. A lista de parcelas
também verifica `receivables.view` ou `receivables.manage`.

## Lotes, concorrência e operação mensal

Uma inclusão/alteração/remoção de valor mensal registra histórico, incrementa a
geração do índice e tenta até 100 parcelas. O painel permite continuar em lotes de
500. O retorno informa `processed`, `updated`, `blocked`, `history_preserved`,
`pending` e `total_blocked`. Processar até `pending=0` conclui a fila disponível;
pendências de dados continuam visíveis em `total_blocked`.

O mesmo mês/geração não é aplicado novamente. Locks consultivos isolam o índice;
`FOR UPDATE SKIP LOCKED` protege as parcelas por lote. O cálculo trava o recebível
antes da linha da política, em ordem compatível com a baixa. A ativação revalida a
prévia sob lock. Pagamento concorrente que tornou a parcela parcial/quitada impede
a habilitação ou suspende a atualização.

No primeiro processamento de um mês sem índice publicado, a política fica
`blocked`. Quando o índice faltante é cadastrado, uma nova geração retoma essas
parcelas. O operador vê as pendências e pode drenar os lotes restantes.

Para um futuro agendador aprovado, a entrada
`finance_correction_private.refresh_due_all(limit)` é privada e executável apenas
pelo proprietário do banco. O limite é por empresa. Pode ser chamada em ciclos
curtos para drenar os lotes; não precisa simular `auth.uid()` nem usar claims
fabricadas. A criação efetiva de um job `pg_cron` ou equivalente não faz parte
desta migração e deve considerar frequência, duração, observabilidade e fila total.

## Verificação local

```sh
node --test tests/imports/eobra-correction-database.test.mjs
npx tsc --noEmit
npx eslint app/configuracoes/importacoes/correcao-eobra/page.tsx \
  app/configuracoes/importacoes/correcao-eobra/actions.ts \
  tests/imports/eobra-correction-database.test.mjs
```

O teste PGlite executa a migração e o gatilho legado real com dados sintéticos.
Confere isolamento, permissões, prova desatualizada, máxima do período, ausência de
índice atual, índice futuro, preservação de componentes, baixa parcial, alteração
histórica, bloqueio de escrita direta do CUB, replay de ativação, limites de
paginação, fuso de São Paulo e cálculo exato. Um cenário com 105 políticas verifica
que o gatilho processa 100, mostra cinco pendentes e permite concluir a fila em
novos lotes sem reaplicar parcelas já processadas.
