# Conversão de capturas da interface do eObra

O adaptador `lib/eobra-import/checkpoint.mjs` converte capturas locais em um pacote
`elos.eobra.snapshot.v1`. Não acessa a origem nem grava no Elos. O comando de linha
produz o pacote e uma revisão separada com as pendências.

## Evidência e limites

O arquivo de entrada usa `schema="eobra.ui-checkpoint.v1"`, `sourceHost`,
`capturedAt` (timestamp real), `capturedOn` (data do corte) e `captures`. O adaptador
aceita valores diretos e resultados de ferramentas cujo `content[].text` contém
JSON. Texto adicional, HTML, metadados e páginas duplicadas continuam preservados.

Cada captura é guardada uma única vez em arquivos complementares do próprio
pacote. Um manifesto contém a estrutura original e referências aos fragmentos.
`reconstructEobraCheckpoint(snapshot)` reconstitui os mesmos valores JSON da
entrada e confere seu hash. A representação preserva inclusive as strings JSON
originais dentro de resultados de ferramentas. O hash não depende da indentação
do arquivo externo.

Coleções grandes são fragmentadas também pelo tamanho UTF-8, além da quantidade
de itens, para caber no transporte multipart sem remover evidências. Um item
individual que ultrapasse o limite continua sendo rejeitado.

Mensagens repetidas de pendência ficam em um dicionário complementar dentro do
pacote. Cada candidato arquivado guarda os códigos correspondentes; o relatório
JSON conserva as mensagens completas por ID. Essa compactação não remove campos,
observações conflitantes ou dados brutos.

Registros normalizados referenciam essa evidência. Campos incompletos ou
conflitantes ficam em `raw_archive` tipado, com o candidato e a lista de pendências.
Arquivar a captura não significa promover a entidade. Não se substitui um campo
ausente por zero, não se atribui toda diferença de valores à correção e não se
vinculam pessoas, contas, índices ou obras por nome.

Os IDs de rotas, atributos e campos explícitos precisam concordar. O número
comercial de um título não substitui o ID da parcela. IDs de construção e de
centro de custo pertencem a relações diferentes. Um rascunho com data inválida
fica em `sale_draft`; sua data original permanece preservada.

Contas a pagar vinculadas explicitamente a uma venda herdam a obra dessa venda,
assim como os recebíveis. Obras conflitantes continuam bloqueadas; o rótulo do
centro de custo não produz um vínculo. E-mails únicos têm apenas espaços externos
removidos, conservando o contato original em `source_emails`. Endereços inválidos
ou múltiplos contatos continuam exigindo revisão.

Valores financeiros da listagem usam `data-value`. Casas adicionais só são
removidas se forem zeros: `"100.2300"` pode virar `"100.23"`, enquanto
`"100.2301"` exige revisão. O sinal negativo de uma linha explicitamente a pagar
é convertido em magnitude e continua intacto no bruto. O saldo pode ser calculado
pela diferença exata entre atualizado e pago quando ambos existem; a proveniência
dessa operação fica explícita. Essa conta não determina a composição de juros,
multa, correção, outros acréscimos ou desconto.

Um campo `capturedOn` que contém apenas a data não produz um horário fictício.
Enquanto o timestamp real não estiver disponível, a revisão lista a pendência e
o pacote não é declarado válido. `allProjects` só é verdadeiro quando informado
explicitamente, e a cobertura ainda precisa comprovar o escopo.

## Complementação por IDs de origem

As coleções `saleDetails`, `personDetails`, `installmentDetails`, `unitDetails`,
`accountDetails`, `indexDetails` e `settlementDetails` aceitam arrays ou objetos
indexados pelo `sourceId`. Cada detalhe pode conservar campos/tabelas da interface
ou acrescentar uma observação estruturada do coletor:

```json
{
  "sourceId": "sale-example",
  "sourceProjectId": "project-example",
  "normalized": {
    "number": "41",
    "sale_date": "2026-01-10",
    "total_amount": "100000.00",
    "status": "active"
  },
  "links": [
    {"entity":"unit","sourceId":"unit-example","role":"unit","primary":true,"allocated_amount":"100000.00"},
    {"entity":"person","sourceId":"person-example","role":"buyer"}
  ],
  "raw": {"description":"Detalhe sintético capturado pelo coletor"}
}
```

`normalized` deve conter apenas o que foi efetivamente observado ou uma
normalização explícita e verificável desse dado. Ausência de `primary` permanece
ausência. Valores diferentes para o mesmo campo/ID em duas observações geram
conflito; o adaptador não escolhe silenciosamente a versão mais recente.

`installmentDetails` exige `entity="receivable"` ou `entity="payable"` para uma
parcela ainda não identificada na listagem. As relações seguem o contrato do
snapshot. Baixas exigem ID da conta, salvo meio explicitamente não bancário;
“Conta Prevista” e o nome mostrado na listagem não identificam a conta liquidada.

Os cabeçalhos podem acompanhar cada tabela ou ser acrescentados como
`captures.salesHeaders` e `captures.unitsHeaders`; `salesHeaderCapture` também
aceita um resultado com `headers`. A contagem de uma consulta usada apenas para
obter cabeçalhos não é aplicada a outra listagem que usou filtros diferentes.
Uma captura `units<ID>` declara
o contexto de construção escolhido pelo coletor, sem converter esse ID em centro
de custo. `captures.indexDetails` fornece a identidade técnica dos índices;
`captures.cub` sozinho não identifica o índice pai pelo nome da coleção.

O vínculo documentado `data-lnksli` nas linhas de unidade com classe `linked`
identifica a venda gerenciada. O adaptador inverte essa relação por IDs, confere
o catálogo/detalhe de vendas e propaga a construção da unidade à venda e aos seus
recebíveis. Nunca usa o texto do centro de custo para isso. Quando o inventário de
unidades está completo e a relação consistente tem cardinalidade um, registra
`primary_unit_basis="sole_unit"`, sem fabricar um `primary=true` observado.
Somente essa relação exclusiva com uma venda concluída pode provar `sold`, com
proveniência explícita; múltiplas unidades, vendas estornadas, inventário parcial
ou conflito com estoque continuam pendentes. Rotas de estoque
`Construction/Sales/Available/c/<ID>` comprovam `available`; rotas de ativos não
criam unidades imobiliárias.

Pessoas são identificadas por IDs de rota/linha. As classes observadas de pessoa
física/jurídica e os rótulos CPF/CNPJ associados aos documentos permitem
normalização com conferência de dígitos. Todos os telefones/e-mails/documentos
continuam preservados; um campo principal só é preenchido quando há um valor
único. Papéis de cliente, fornecedor e corretor vêm das relações observadas. A
ausência de status cadastral não gera `active` automaticamente.

Os coletores podem acrescentar `captures.coverage` com as entradas exatas do
contrato de snapshot. Cobertura desconhecida permanece com expectativas `null` e
`complete=false`; ausência de visita nunca se transforma em conjunto vazio.
As contagens globais da tela mista de contas a pagar/receber ficam no relatório e
não são usadas como contagens por obra ou por entidade. Páginas e filtros
conflitantes permanecem visíveis.

Quando a paginação da origem repete IDs em fronteiras de datas, as páginas
originais continuam intactas. Consultas de recuperação usam
`captures.billsSupplemental`, com cada página contendo `baseCapture="bills"`,
`filters`, `footer`, `page`, `headers` e `rows`. A união só fecha a cobertura da
consulta principal se cada suplemento estiver completo, usar os mesmos filtros
exceto um intervalo de vencimento contido no principal, e suas linhas tiverem
datas dentro desse intervalo. A contagem é sempre de IDs únicos, não a soma das
linhas. Consultas de competência ou outros filtros não são tratadas como
subconjuntos de uma consulta por vencimento. O relatório conserva a quantidade
original e os IDs adicionais comprovados pelos suplementos.

## Uso local

Na listagem de parcelas, o indicador explícito `Pago parcialmente` da célula
`Valor` identifica saldo residual. Nesses casos o atualizado é esse saldo mais
`Valor pago`; o saldo não sofre uma segunda dedução. A origem dos dois campos
calculados fica registrada. Marcadores que contradizem status ou valores mantêm
o registro pendente. Essa regra não atribui ajustes ao CUB e não altera os bytes
do checkpoint.

```sh
node scripts/import-eobra-checkpoint.mjs \
  --input /caminho/privado/checkpoint.json \
  --input /caminho/privado/detalhes-complementares.json \
  --out /caminho/privado/snapshot.json \
  --report /caminho/privado/revisao.json \
  --markdown /caminho/privado/revisao.md
```

`--captured-at` aceita o timestamp real do fechamento da captura, quando ele ainda
não foi gravado no checkpoint. `--reference-date` explicita o corte. Nenhum desses
valores é inferido da hora de execução. `--require-complete` faz o comando terminar
com código 2 quando o pacote ainda tem pendências. Por padrão, gerar uma revisão
parcial é uma operação bem-sucedida. Arquivos existentes não são sobrescritos sem
`--overwrite`.

O campo `lastCheckpointAt`, quando contém o timestamp real fornecido pelo coletor,
também pode identificar o fechamento da captura parcial. Ele não substitui nem
inventa timestamps individuais das linhas.

O CLI rejeita saídas dentro do repositório para impedir inclusão acidental de
dados reais. Testes e documentação usam somente exemplos sintéticos. O núcleo
local aceita até 200 MiB, sem descartar evidência. Para transporte, `--bundle`
produz uma pasta nova com `manifest.json` e `part-000001.json` lado a lado,
respeitando 2 MiB e 500 registros por parte. Consulte
`eobra-package-parts.md`. Validade estrutural do arquivo ou do transporte não
significa cobertura completa da origem nem promoção canônica.
