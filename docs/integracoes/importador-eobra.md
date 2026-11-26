# Importador eObra por arquivos

## Estado e escopo

O Elos recebe arquivos CSV ou XLSX em **Sistema → Importações** (`/configuracoes/importacoes`). A primeira versão trata fornecedores, clientes, contas a pagar e contas a receber. Ela identifica cada ambiente eObra pelo hostname e cada registro pelo código estável da origem.

Esta versão não autentica no eObra, não consulta endpoints privados, não armazena senha de origem e não agenda sincronização. O layout real de exportação precisa ser validado com uma amostra obtida em uma sessão autorizada. Não há nesta entrega evidência de importação de dados reais de um cliente.

Cada lote contém um tipo de registro. Fornecedores e clientes pertencem à empresa; títulos financeiros pertencem a uma obra selecionada explicitamente. Uma coluna de obra com mais de uma origem distinta bloqueia o arquivo. Um código de obra da origem pode ser associado à obra do Elos sem depender de nomes iguais.

## Fluxo de operação

1. Confirmar a empresa ativa no Elos.
2. Exportar o relatório detalhado da origem, incluindo códigos estáveis de cadastro/parcela e a data de referência. Para títulos, filtrar uma obra por arquivo.
3. Selecionar o tipo de registro, ambiente de origem, referência e, se financeiro, a obra de destino.
4. Enviar o arquivo, indicar a linha de cabeçalho e ler as colunas. Se houver mais de uma aba, escolher a correta.
5. Conferir o mapeamento sugerido e os exemplos. As sugestões são correspondências de cabeçalhos; não constituem confirmação de compatibilidade com todo relatório eObra.
6. Preparar a prévia. Essa ação grava apenas o lote de revisão; não cria cadastro nem título financeiro.
7. Conferir linhas, vínculos e totais com o relatório de origem. Corrigir todas as pendências e preparar outra revisão quando necessário.
8. Confirmar a importação integral do lote. O resultado discrimina registros criados, cadastros reutilizados e identidades já importadas.

Cancelar uma prévia conserva a trilha de revisão e não exclui registros oficiais. Um lote já importado não pode ser cancelado por esse fluxo. Correções posteriores nos dados oficiais dependem dos fluxos próprios de cadastro/financeiro e de conferência de impacto.

## Arquivos e colunas

- Até 4 MiB por arquivo e 2.000 linhas de dados por lote.
- CSV com delimitador ponto e vírgula, vírgula ou tabulação; aspas, campos com quebra de linha e codificações UTF-8, UTF-16 e Windows-1252 são tratados.
- XLSX lido por ExcelJS, com limites de abas, células e conteúdo descompactado. Macros, ActiveX e objetos incorporados são rejeitados. XLS, XLSB e XLSM não são aceitos.
- Cabeçalho selecionável entre as linhas 1 e 50 na interface. Cabeçalhos duplicados não são sobrescritos. Colunas sem nome recebem identificação e continuam nos dados brutos.
- Fórmulas não são executadas. Resultados em cache só são aceitos quando presentes e sem indicação de recálculo pendente ou referência externa.
- Células mescladas na área de dados são recusadas para impedir repetição de valores. Linhas com erros do Excel permanecem visíveis como pendências. Valores numéricos preservam também a representação original do XML para detectar perda de precisão.
- Identificadores são texto. Zeros à esquerda são preservados; notação científica e números Excel inseguros para identidade produzem pendência.
- Datas civis válidas podem vir em `DD/MM/AAAA`, `AAAA-MM-DD` ou formato próprio de célula Excel.
- Dinheiro é normalizado em centavos inteiros e armazenado na revisão como string decimal. Campo inválido permanece pendente; não vira zero.

### Cadastros

| Campo | Regra |
| --- | --- |
| ID na origem | Obrigatório, estável e único no arquivo |
| Nome / razão social | Obrigatório |
| CPF / CNPJ | Opcional; quando informado, valida dígitos e auxilia a identidade exata |
| Tipo de pessoa | PF, PJ ou outro, com validação de consistência |
| E-mail, telefone, endereço, cidade, UF, observações | Opcionais |
| Situação | Ativo/inativo; ausência assume ativo com aviso |

Um CPF/CNPJ único já existente pode ser reutilizado. A revisão identifica o cadastro que será vinculado e seus dados não são atualizados pelo importador. Documentos ambíguos bloqueiam a promoção. Nomes semelhantes não são usados para fundir identidades.

### Títulos financeiros

| Campo | Regra |
| --- | --- |
| ID da parcela | Obrigatório; usar a parcela, não apenas o número da nota ou do contrato |
| Vencimento | Obrigatório |
| Valor original | Obrigatório |
| Situação na origem | Obrigatória, preservada junto da situação normalizada |
| Descrição ou documento | Pelo menos um deve identificar o lançamento |
| Valor atual, valor pago, saldo | Conferidos conjuntamente; derivação só é feita quando inequívoca e fica registrada nos avisos |
| Data de pagamento/recebimento | Obrigatória para títulos quitados |
| Juros, multa, correção, outros acréscimos e desconto | Mantidos separadamente e conciliados com o valor atual |
| Fornecedor/cliente | Documento ou identidade externa exata; o nome da origem é preservado |
| Venda/contrato | Para recebíveis, deve resolver uma venda real da obra, com cliente e unidade consistentes |
| Obra na origem | Recomendado mapear quando existir; associa-se à obra escolhida explicitamente |

As regras do banco revalidam os valores e relacionamentos na promoção. O servidor não aceita IDs canônicos de fornecedor, cliente, unidade ou venda enviados na planilha como vínculos confiáveis.

## Limites financeiros desta versão

**Pagamentos parciais ficam bloqueados.** O financeiro atual do Elos usa situações aberto, pago e cancelado, e alguns resumos ainda tratam o valor integral de um título aberto. O importador conserva original, atual, pago e saldo na revisão, sem reduzir silenciosamente o principal ao saldo.

Contas a pagar com valor atual diferente do original ficam bloqueadas porque o cadastro canônico não representa separadamente todos os ajustes. Recebíveis podem conservar os componentes de atualização, desde que original mais acréscimos menos desconto corresponda ao atual.

Recebíveis exigem venda, cliente e unidade reais da mesma empresa e obra. Esta versão não cria automaticamente unidades ou contratos para preencher referências ausentes. O vínculo é revalidado na promoção, inclusive situação da venda e documento do cliente.

Títulos quitados históricos são registrados com valor e data explícitos, sem chamar RPC de pagamento ou gerar nova movimentação bancária. Saldos bancários, extratos, conciliação, rateios, transferências, antecipações, notas fiscais, documentos anexos, compras, estoque, contratos de engenharia e cronogramas não são importados por este fluxo.

Recebíveis são gravados com a atualização da referência preservada (`correction_locked=true`). Uma eventual retomada da correção automática exige revisão dos índices, contratos e data de corte; o importador não presume essa configuração.

Os totais da revisão incluem todos os valores legíveis, inclusive linhas bloqueadas e identidades já importadas. Eles servem para comparar o arquivo da origem, não para representar apenas novos lançamentos. Quando algum valor não puder ser interpretado, `totals_complete=false` identifica que o total é incompleto e a importação permanece bloqueada.

## Identidade, reenvio e revisão

As tabelas adicionadas são:

- `integration_import_batches`: origem, empresa, obra, arquivo, mapeamento, referência, resumos e resultado.
- `integration_import_rows`: linha física, dados brutos, dados normalizados, erros, avisos e destino.
- `integration_import_records`: identidade permanente da origem e vínculo canônico.

A identidade permanente combina empresa, hostname eObra, entidade, escopo e ID externo. O escopo é a empresa nos cadastros e a obra nos títulos. O `source_id` canônico usa `host|uuid_do_escopo|id_externo`, com `source_system=eobra`.

Um registro já importado com o mesmo conteúdo é reconhecido sem duplicar. O mesmo ID com conteúdo de origem alterado gera conflito e nunca sobrescreve o cadastro ou título automaticamente. Uma nova exportação não perde essa proteção por ter outro nome ou hash de arquivo.

Os snapshots são imutáveis. Corrigir vínculos ou cadastros e reenviar o mesmo arquivo pode criar outra revisão, mantendo a anterior. Reenviar uma revisão cancelada também pode criar novo lote. O fingerprint do arquivo/mapeamento e o hash da fonte impedem trocar o conteúdo sob a mesma identidade de arquivo; campos resolvidos localmente não são tratados como alteração da origem.

A promoção verifica o hash da prévia, bloqueia o lote durante a transação e revalida todas as linhas. A gravação é atômica: qualquer falha desfaz as criações daquele lote. A repetição de uma promoção concluída devolve seu resultado anterior.

## Acesso e segurança

- Sessão autenticada, vínculo ativo com a empresa e permissão `admin.company.manage`.
- Além disso: `suppliers.manage`, `clients.manage`, `payables.manage` ou `receivables.manage`, conforme a entidade.
- Políticas RLS nas três tabelas e funções `SECURITY INVOKER`; não há uso de service role na aplicação.
- A empresa vem da sessão. O identificador exibido pelo formulário apenas detecta uma troca de empresa em outra aba.
- Rotas multipart verificam origem, autenticam antes de ler o arquivo e limitam o stream mesmo sem `Content-Length`.
- Credenciais do eObra não são solicitadas nem armazenadas pelo importador. O hostname identifica a origem e não é usado para fazer requisições.
- Dados reais de clientes e arquivos de exportação não devem entrar no repositório de testes.

## Instalação e verificação

Aplicar a migration `supabase/migrations/20261126135809_integration_eobra_import.sql` antes de disponibilizar a interface. Ela é aditiva e não executa carga de dados de empresas. O identificador do arquivo acompanha a versão registrada pelo serviço de migrations.

```sh
npm ci
npm run test:eobra
npx eslint lib/eobra-import app/api/imports/eobra app/configuracoes/importacoes tests/imports
npx tsc --noEmit
npm run build
```

Os testes usam arquivos sintéticos e PGlite com papéis autenticados e RLS. Cobrem formatos, centavos e datas, duplicidades, documentos exatos, reprocessamento, estado financeiro, vínculos entre empresas/obras, cancelamento, revisão imutável e rollback integral.

Antes da primeira carga real, conferir uma amostra autorizada do relatório eObra, determinar sua granularidade, verificar se o código identifica a parcela, comparar contagens e totais por obra/situação e resolver dependências comerciais. A carga real só é confirmada após a prévia. Guardar a exportação original e a referência permite reconciliar o histórico com a operação de origem.
