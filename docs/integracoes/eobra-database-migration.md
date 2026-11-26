# Migração eObra: contrato de banco e operação

Esta implementação separa a evidência capturada da criação de dados operacionais. Um registro preservado como arquivo, índice, conta de origem ou evento histórico mantém `status=archived` e aparece em `promotion_result.archived`; ele não entra em `promotion_result.created`.

## Ordem das migrations

Aplicar a sequência do repositório, sem saltar arquivos. As migrations do importador completo são:

1. `20261126150339_eobra_snapshot_foundation.sql`: documento original, registros, relações, cobertura, de-para, ledger e histórico de origem.
2. `20261126152634_eobra_snapshot_promotion.sql`: projeção dos campos canônicos, dependências e promoção inicial para pacotes pequenos.
3. `20261126153443_commercial_sale_units_eobra.sql`: todas as unidades do contrato, alocações observadas e exclusividade de venda ativa.
4. `20261126154832_eobra_snapshot_resumable.sql`: processamento por lotes, progresso persistido, validação de dependências nativas e retomada.
5. `20261126162954_eobra_snapshot_parts.sql`: transporte por manifesto e partes imutáveis, recibos de integridade por registro e resumo calculado uma vez por transição.

As migrations de armazenamento privado, suporte financeiro parcial e políticas explícitas de correção ficam intercaladas pelos próprios timestamps. A foundation utiliza os helpers de tipos, documentos fiscais e hash de `20261126135809_integration_eobra_import.sql`.

## Preparação retomável

| RPC | Entrada | Resultado e limite |
| --- | --- | --- |
| `begin_eobra_snapshot` | `p_company_id`, pacote JSON original, `p_project_map` | UUID do run; grava documento imutável, sem dados operacionais. |
| `append_eobra_snapshot` | `p_run_id`, `p_limit` | Extrai o próximo conjunto diretamente do documento no banco; padrão 250, máximo 500. |
| `finish_eobra_snapshot_append` | `p_run_id` | Confere correspondência do conjunto, relações e manifesto; muda de loading para validating. |
| `validate_eobra_snapshot_chunk` | `p_run_id`, `p_limit` | Confere registros ainda pendentes; padrão e máximo 100. |
| `seal_eobra_snapshot` | `p_run_id` | Deriva cobertura, totais e hash; termina em ready ou review. |
| `review_eobra_snapshot` | `p_run_id` | Lê a revisão e o progresso; não repete a validação de todos os registros. |
| `eobra_snapshot_progress` | `p_run_id` | Contagens e próxima etapa. |

`p_project_map` tem formato `{ "id_da_obra_na_origem": "uuid_da_obra_no_Elos" }`. O banco confere empresa, visibilidade e consistência do de-para. Centro de custo não substitui a identidade da obra.

O progresso contém `run_id`, `status`, `stage`, `expected_records`, `loaded_records`, `validated_records`, `promoted_records`, `remaining_records`, `next_step`, `preview_hash`, `summary` e `promotion_result`. `next_step` é um de `append`, `finish_append`, `validate`, `seal`, `promote`, `complete` ou `blocked`. A interface pode parar entre chamadas e retomar somente com o UUID do run, sem reenviar o arquivo.

`stage` é `loading`, `validating` ou `sealed`. O estado de negócio é `building`, `review`, `ready`, `promoting`, `imported` ou `cancelled`. `promoted_records` mede itens concluídos pelo processador, incluindo evidência arquivada; os resultados canônicos e os arquivos permanecem separados nos estados das linhas e no resultado final.

O wrapper antigo `stage_eobra_snapshot` aceita no máximo 500 registros. Entradas maiores devem usar as chamadas retomáveis. O limite do documento normalizado é 60 MiB e 100 mil registros; o upload público aplica seu limite anterior de 50 MiB. Esses limites de tamanho não equivalem a uma garantia de duração de uma chamada.

## Transporte de pacotes grandes

Pacotes completos usam `elos.eobra.snapshot.parts.v1`. O manifesto e as partes ficam no bucket privado `eobra-migration-bundles`, no mesmo diretório `companyUUID/userUUID/bundleUUID/`: `manifest.json`, `part-000001.json`, `part-000002.json` e assim por diante. O JSON monolítico continua disponível para arquivos menores.

O manifesto conserva `source`, `scope`, `archiveTypes` e `coverage` do formato semântico do snapshot. Ele substitui `records` por `recordCount` e pela lista ordenada `parts`:

```json
{
  "format": "elos.eobra.snapshot.parts.v1",
  "recordCount": 500,
  "parts": [
    {
      "ordinal": 1,
      "firstRecord": 1,
      "recordCount": 500,
      "byteLength": 123456,
      "sha256": "hash hexadecimal SHA-256 de 64 caracteres",
      "name": "part-000001.json"
    }
  ]
}
```

O exemplo mostra apenas os campos de transporte; origem, escopo, tipos de arquivo e cobertura continuam obrigatórios. Cada arquivo de parte contém um **array JSON de registros**, sem repetir o envelope. `byteLength` e `sha256` correspondem aos bytes UTF-8 exatos do arquivo, sem BOM. Reformatar o JSON muda o hash do arquivo. O banco calcula seu próprio hash do manifesto completo, incluindo origem, cobertura, escopo e descritores das partes.

| RPC | Entrada | Comportamento |
| --- | --- | --- |
| `begin_eobra_snapshot_parts` | `p_company_id`, `p_manifest`, `p_project_map`, `p_storage_path` | Valida e preserva o manifesto; retorna o UUID do run. |
| `append_eobra_snapshot_part` | `p_run_id`, `p_part_ordinal`, `p_json_text` | Confere bytes/hash, recebe somente a próxima parte e materializa seus registros/relações atomicamente. |

O manifesto aceita até 2 MiB e 1.000 descritores. Cada parte aceita até 2 MiB e 500 registros; a soma das partes aceita até 200 MiB e 100 mil registros. As faixas `firstRecord`/`recordCount` precisam ser contíguas e corresponder ao total. Não há concatenação de partes em um JSON global no PostgreSQL.

`eobra_migration_snapshots.document` conserva o manifesto; `eobra_migration_snapshot_parts.json_text` conserva cada parte original. Os recibos `record_hashes` são calculados pelo guard do banco e vinculam qualquer INSERT de registro à evidência da parte. Inserções diretas nas tabelas continuam sujeitas aos mesmos hashes, escopo e estados. Campos de recibo enviados pelo cliente não são usados como prova.

O run guarda `source_storage_path` imutável. O begin exige um caminho da empresa e do usuário que está criando o pacote. A continuação é autorizada por empresa, obras e permissões nativas: outro operador com essas permissões pode retomar o mesmo run. O acesso ao pacote multipart exige o conjunto completo de permissões dos módulos desde o manifesto, antes que as entidades das partes sejam recebidas.

O progresso acrescenta `transport` (`parts` ou `document`), `expected_parts`, `uploaded_parts`, `next_part_ordinal`, `expected_source_bytes` e `uploaded_source_bytes`. Enquanto faltam partes, `next_step=upload_part`. Após a última parte, seguem `finish_append`, `validate`, `seal` e `promote`, com as RPCs já descritas. Reenvio dos mesmos bytes é idempotente; outra versão, parte truncada, ordinal fora da ordem, lacuna ou total divergente são rejeitados.

Uma falha durante a materialização desfaz a parte inteira, incluindo seu recibo. As partes anteriores permanecem disponíveis. Os arquivos precisam continuar disponíveis no Storage para retomar a carga das partes ainda ausentes; depois de recebida, a evidência da parte também está preservada no banco.

## Promoção e falhas

`promote_eobra_snapshot_chunk(p_run_id, p_preview_hash, p_limit)` usa padrão e máximo de 50 registros. A primeira chamada confere o hash global aprovado e muda o run para `promoting`. As chamadas seguintes usam a mesma prévia imutável, processam apenas itens ainda não concluídos e conferem as dependências necessárias a cada item.

A ordem é obra/de-para, pessoas, contas e índices de origem, unidades, vendas, títulos, pagamentos, estornos, movimentos bancários de origem e arquivos complementares. O ledger identifica cada objeto por empresa, host, entidade, tipo de arquivo quando aplicável e ID da origem. A obra é um vínculo, não parte da identidade global.

Cada chamada é uma transação. Se um item falha, a chamada inteira é desfeita, mas chamadas anteriores continuam concluídas e visíveis. O progresso permanece no run. Repetições não criam novas linhas para identidades já concluídas; conteúdo diferente sob o mesmo ID é conflito e nunca sobrescreve o destino.

Antes de criar um filho, o banco trava para leitura e confere as dependências nativas. Mudança de comprador/unidade da venda, obra da unidade, CPF/CNPJ de contraparte, ou identidade/valores de um título antes das baixas pausa o lote. A auditoria `created_by` não é confundida com a identidade da fonte: outro usuário autorizado pode retomar. A mudança legítima de unidade disponível para vendida também é preservada.

Não há rollback automático de lotes já concluídos. `cancel_eobra_snapshot` aceita a preparação antes de qualquer resultado concluído; depois de promoção parcial, exige retomada ou nova revisão. Uma nova revisão usa o ledger para reconhecer o que já existe. O wrapper `promote_eobra_snapshot` fica restrito a até 100 registros.

## Valores financeiros e histórico

Todos os títulos precisam reconciliar valor atual = valor pago líquido + saldo histórico e valor atual = original + componentes explícitos. Totais incluem linhas bloqueadas quando seus valores são interpretáveis; `totals.*.complete=false` informa que há valores não interpretados.

`balance_amount` conserva o saldo histórico da origem. `collectible_balance_amount` exclui títulos cancelados. Um cancelamento pode preservar valor pago e saldo histórico positivo; seu estado deixa o exigível em zero, sem criar desconto ou estorno fictício.

Baixas e estornos ficam em `eobra_source_events`, com `posting_policy=historical_source_only`. A promoção não cria transações bancárias nativas. Uma baixa explicitamente anulada sem data válida de estorno usa `kind=voided_payment`, conserva valor/data originais, aponta para o arquivo tipado do estorno e tem efeito financeiro zero. `history_dates_complete=false` mantém a limitação temporal visível. O histórico financeiro minimizado é consultado pela RPC autorizada `finance_title_payment_events`, não por leitura irrestrita das tabelas de origem.

Parcelas parciais mantêm valor nominal, componentes e pagamento acumulado; não são divididas artificialmente. As contas a pagar usam o valor atualizado gerado pelo schema nativo. Recebíveis são criados com correção travada. Índices e competências capturados ficam separados; ativar atualização futura exige o fluxo posterior de política explícita e paridade no corte.

## Segurança e integridade

As RPCs do importador usam security invoker. Acesso ao run exige `admin.company.manage`, todas as permissões nativas das entidades presentes e acesso às obras do de-para. Arquivos genéricos exigem o conjunto máximo de permissões dos módulos envolvidos.

Documento, origem, de-para, conteúdo dos registros e relações tornam-se imutáveis. Guards derivam o hash e o resultado da validação: flags, erros, totais, permissões e alvos enviados em escritas diretas não substituem a evidência. No transporte legado, a conferência do documento é feita por conjunto. No multipart, cada INSERT confere o recibo da parte antes de persistir; o fechamento confere contagens e cardinalidades, sem repetir a expansão dos recibos já conferidos. A materialização atômica, os ordinais únicos, a imutabilidade e a ausência de DELETE preservam essa prova entre chamadas. Os detalhes de cobertura usam consultas em conjunto, sem busca quadrática em arrays de IDs.

As unidades secundárias do contrato ficam em `commercial_sale_units`. A principal corresponde a `sales.unit_id`; alocações e participações ausentes permanecem ausentes. Há trava de concorrência por unidade entre a venda principal nativa e vínculos secundários. Cancelamento e reativação sincronizam as unidades, respeitando outra venda ativa.

## Verificação local

`node --test tests/imports/eobra-snapshot-database.test.mjs tests/imports/eobra-snapshot-parts-database.test.mjs` executa os cenários em PostgreSQL/PGlite, com dados sintéticos. Os cenários incluem tenant/RLS, permissões nativas, origem e estados adulterados, cobertura incompleta, referências, reaproveitamento fiscal, conflitos, promoção por dependências, retomada, falha atômica do lote, múltiplas unidades/compradores, parcelas parciais, cancelamentos com histórico, baixas sem data de estorno, índices e ausência de movimentos bancários duplicados. Os testes multipart acrescentam truncamento, divergência de hash/tamanho, ordem, limites, reenvio, recibos forjados, dependências entre partes e retomada por outro operador.

Um ensaio sintético anterior ao delta multipart usou 40 mil registros e 28.038.379 bytes, com cobertura de todos os detalhes: begin de 4,14 s; append de 500 com máximo de 3,53 s; finish_append de 10,38 s; validação de 100 com máximo de 3,42 s; seal de 30,64 s. O mesmo ambiente rejeitou por falta de memória um begin monolítico de 157.118.391 bytes, mesmo quando o gzip tinha somente 856.128 bytes. O limite maior foi usado somente nessa fixture em memória; não foi aplicado ao contrato monolítico. Essa evidência motivou a divisão do transporte e a eliminação de reconstruções repetidas do resumo. Os números são de PGlite/WASM e não prometem a mesma duração em produção.

O ensaio multipart final preservou 40 mil registros em 80 partes, com 156.526.750 bytes de fonte (aproximadamente 149 MiB), manifesto de 605.796 bytes e maior parte de 1.957.001 bytes. O fechamento terminou em `ready`, com cobertura dos 40 mil detalhes conferida.

| Etapa medida | Duração observada |
| --- | --- |
| Begin do manifesto | 0,079 s |
| Recepção de 500 registros | máximo de 4,38 s; 219,66 s no conjunto das 80 partes |
| Finish append | 6,31 s |
| Validação real dos primeiros 100 registros | 3,55 s |
| Seal, com cobertura e hash globais | 19,25 s |

Esse ensaio isola transporte e fechamento: após validar os primeiros 100 registros pela RPC, a fixture em memória semeou o estado de revisão dos demais arquivos sintéticos para medir o seal. Ele não representa uma promoção financeira de 40 mil linhas. O ensaio anterior de 28 MB executou a validação de todos os 40 mil registros. Os testes funcionais separados cobrem os caminhos financeiros, comerciais, de integridade e de autorização. O consumo residente final do processo multipart ficou em aproximadamente 778 MiB; o caminho monolítico maior havia falhado com cerca de 2.306 MiB observados.

Validar os passos globais e os tempos por lote no Postgres de homologação antes da primeira execução de grande porte. A preparação e a promoção devem ser feitas por chamadas separadas; não envolver toda a sequência de lotes em uma única transação HTTP nem substituir o processamento retomável por um timeout maior.
