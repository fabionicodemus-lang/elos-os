# Pacote eObra dividido em partes

O formato `elos.eobra.snapshot.parts.v1` transporta um único snapshot em arquivos
imutáveis. O banco recebe e valida uma parte por chamada, sem reconstruir o JSON
inteiro em memória. O formato conserva a evidência integral e seus vínculos.

## Arquivos e contrato

Todos os arquivos ficam na mesma pasta: `manifest.json`, `part-000001.json`,
`part-000002.json` e assim por diante. Não há subpastas.

```json
{
  "format": "elos.eobra.snapshot.parts.v1",
  "source": {"host":"exemplo.eobra.com.br","capturedAt":"2026-03-20T18:00:00Z","referenceDate":"2026-03-20"},
  "scope": {"projectIds":["project-example"],"allProjects":false},
  "archiveTypes": [],
  "coverage": [],
  "recordCount": 1,
  "parts": [{
    "ordinal": 1,
    "firstRecord": 1,
    "recordCount": 1,
    "byteLength": 123,
    "sha256": "<hash SHA-256 hexadecimal dos bytes reais>",
    "name": "part-000001.json"
  }]
}
```

O exemplo ilustra o formato; tamanho e hash precisam ser calculados a partir do
arquivo real. Cada parte é diretamente um array JSON de registros do snapshot,
sem envelope adicional, codificado em UTF-8 sem BOM. A contagem `firstRecord`
começa em 1 e os intervalos precisam ser contíguos.

| Limite | Valor |
| --- | ---: |
| Manifesto | 2 MiB |
| Arquivo de parte | 2 MiB |
| Registros por parte | 500 |
| Conjunto dos arquivos de partes | 200 MiB |
| Registros no conjunto | 100.000 |
| Quantidade de partes | 1.000 |

O SHA-256 identifica os bytes exatos, incluindo espaços. Reformatar ou editar uma
parte depois da geração invalida o manifesto. A ordem de chaves usada pelo writer
é determinística. Um único registro maior que uma parte é rejeitado com uma
pendência para fragmentar sua evidência; o writer não trunca o registro.

`globalSnapshotHash` é opcional e informativo: o writer registra o hash SHA-256 da
representação canônica do snapshot inteiro antes de dividi-lo. O banco calcula
seus próprios hashes de manifesto, registros e ledger. Não confia em hashes de
registros fornecidos pelo cliente.

## Validação e cobertura

`inspectEobraPackageManifest` valida o envelope, nomes, limites, hashes declarados
e intervalos. `inspectEobraPackagePart` confere bytes, SHA-256, UTF-8, quantidade de
registros e sua forma mínima antes do staging. Ambas são rotinas do servidor.

Validade de transporte não comprova cobertura da origem nem conciliação
financeira. O banco confere relações, valores, duplicatas e cobertura contra os
registros efetivamente recebidos. A interface pode apresentar o manifesto antes
da leitura das partes; totais financeiros só ficam disponíveis após a validação
no banco. O cliente não recalcula nem normaliza valores financeiros.

## Geração local

```sh
node scripts/import-eobra-checkpoint.mjs \
  --input /caminho/privado/checkpoint.json \
  --bundle /caminho/privado/pacote-revisao \
  --report /caminho/privado/revisao.json \
  --markdown /caminho/privado/revisao.md
```

A pasta deve ser nova, mesmo quando `--overwrite` foi autorizado para os
relatórios. Seus arquivos são gravados com permissão privada, e o manifesto só é
gravado depois de todas as partes. Nenhum arquivo é enviado ou importado pelo CLI.
O pacote pode conservar dados explicitamente incompletos; `--require-complete`
retorna código 2 quando a revisão ainda aponta pendências.

A entrada de arquivo único continua disponível por `--out`, como artefato local.
A rota legada de upload único tem limite próprio de 50 MiB. O writer em partes é
o caminho para conjuntos maiores; não exige gzip nem expande limites de cada
requisição ao banco.
