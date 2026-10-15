# Importador de orçamento — staging e promoção

## Princípio

O arquivo externo nunca define a identidade interna do Elos OS. O XLSX é lido, normalizado e gravado em staging. Só depois de revisão o lote poderá ser promovido para orçamento, serviços, insumos e composições.

Fluxo obrigatório:

`XLSX -> parser/adaptador -> staging -> Mapa de Integrações -> revisão -> promoção -> conciliação`

## Primeiro adaptador real: Flow

Arquivo usado para desenvolver o adaptador: orçamento atualizado do Flow.

Estrutura detectada:

- aba principal: `ORCAMENTO ANALITICO`;
- aba de preços: `Lista de Preços`;
- resumo: `RESUMO GRUPOS`;
- hierarquia: Grupo -> Serviço/Subgrupo -> Insumos da composição;
- códigos de catálogo compatíveis com o namespace Koper;
- 34 grupos;
- aproximadamente 402 serviços/subgrupos;
- aproximadamente 1.930 linhas de insumos/composição;
- área construída informada: 6.717 m²;
- custo de obra no resumo: R$ 19.959.432,07;
- referência interna do arquivo: O1 / Revisão 01;
- data interna do orçamento analítico: 08/05/2023.

O nome do arquivo pode indicar revisão diferente da revisão escrita dentro das células. Ambos devem permanecer rastreáveis; o staging não deve corrigir silenciosamente a origem.

## Classificação das linhas do formato legado

### Grupo

Linha em que a coluna E contém `GRUPO: XX`. Vira hierarquia do orçamento; não cria serviço nem insumo.

### Serviço

Linha com código numérico hierárquico na coluna E (ex.: `04.01.01`) e descrição na coluna G. Quantidade, unidade, unitário e total são lidos das colunas H, I, J e K.

### Insumo da composição

Linha abaixo de um serviço com descrição e unidade, normalmente com código na coluna A (ex.: `MB.07.17`). Algumas linhas manuais não possuem código; nesses casos o matching usa nome + unidade e a linha permanece revisável.

Para composições, o staging guarda tanto a quantidade absoluta do insumo quanto um coeficiente calculado em relação à quantidade do serviço quando possível. O coeficiente bruto auxiliar da planilha também é preservado separadamente.

## Matching

Ordem nesta primeira etapa:

1. Mapa de Integrações confirmado;
2. código exato no catálogo Elos;
3. nome + unidade exatos;
4. ambíguo quando há mais de um destino possível;
5. novo quando não há equivalente.

Similaridade/fuzzy ficará para a etapa de revisão assistida e nunca confirmará vínculo automaticamente.

Para o Flow, o lote tem `source_system = xlsx`, mas `catalog_namespace = koper`, pois os códigos técnicos usados na planilha são os mesmos códigos externos usados no Koper. Assim os de-paras já aprendidos podem ser reaproveitados sem transformar o Koper em identidade interna.

## Segurança

A primeira entrega não promove nenhum dado. Ela cria apenas:

- `engineering_budget_import_batches`;
- `engineering_budget_import_rows`;
- `parent_group_id` em `engineering_budget_groups` para preservar hierarquia.

A tela de revisão mostra encontrados, novos e ambíguos. A promoção fica bloqueada até a próxima etapa, quando serão implementadas resolução manual, criação controlada de novos cadastros e conciliação de totais.
