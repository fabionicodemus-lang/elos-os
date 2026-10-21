# Financeiro v1.0 — entrega T01/T02

Estado: **em validação, sem conclusão automática e sem aceite financeiro**. Escopo solicitado em 21/10/2026: inventariar, reproduzir diagnóstico e fixar referência/pendências; nenhuma tarefa T03–T45 foi executada.

Repositório fabionicodemus-lang/elos-os, branch inicial `work`, commit analisado `28180e0ed81823af49ebea90899672e755ce31dd`. Branch isolada da entrega: `docs/financeiro-v1-t01-t02`. Working tree estava limpo antes da criação. Ambiente cloud Linux /workspace/elos-os; testes Node 22.23.3 e PostgreSQL PGlite em memória. Inspecionados código/DDL, não banco real. Fontes, ambiente e hashes em [contexto](evidencias/contexto.json).

**Entregáveis**

- A: [inventário de componentes e reuso](inventario.md) e [mapa I01–I22](indicadores.md).
- B: [matriz E01–E19](matriz-diagnostico.md), com [JSON](matriz-diagnostico.json) e [CSV](matriz-diagnostico.csv), incluindo roteiro, fonte, classe, impacto e menor ação.
- C: [D01–D14](parametros.md) e [registro estruturado](parametros.json); [regra v0.1 inalterada](referencias/Elos_OS_Regras_Financeiras_v0_1.docx).
- D: [quadro/impedimentos](acompanhamento.md) e [XLSX atualizado](Elos_OS_Quadro_Implementacao_v1_T01_T02.xlsx).
- E: este resumo, [casos/testes e limites](casos-e-testes.md), [jobs](jobs.md) e [comandos reexecutáveis](comandos.md).

**Funciona e é candidato a reaproveitamento**: staging com chave/hash; cadastros e de-para; vínculos documentos/parcelas/títulos; consumo de estoque e medições; contratos/aditivos; OFX/ledger/conciliação N:M e proteção de períodos; snapshots de previsão; resumos determinísticos e exports. Foram aprovados 74 testes existentes, sem ignorados. Isso não certifica todos os indicadores normativos nem implantação produtiva.

**Lacunas atuais reproduzidas**, sem alterar o produto:

1. P09: RPC real em schema fictício aceita receber R$100 de R$1000 e encerra o título; saldo R$900 some da carteira aberta.
2. P07: carregador real com contrato R$1000, nota contratual sem medição e pagamento R$400 mantém futuro R$1000 e produz projetado R$1400. Norma exige cobertura única.
3. P06: rateio R$400 classificado + R$600 pendente atribui R$1000 ao serviço; falta preservar parcela não alocada.
4. P04: pagamento fora do horizonte causa curto-circuito `||=` e ignora títulos abertos. P05: realizado inclui pagamento posterior ao corte.
5. Por leitura: dashboard seleciona vencimento antes de somar por data da baixa; acumulados e fluxo não incorporam disponibilidade inicial; limites de 10 mil e defaults podem omitir/zerar dados; inadimplência usa carteira aberta, não principal exigível da coorte. IA de banco/NF solicita campos incompatíveis com DDL versionado.

**Fontes históricas comprovadas**: 53 hashes internos do pacote sem divergência. Regra v0.1 SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. S1/S2/S3 disponíveis. Nas seis F011–F016 há 3261 IDs únicos e R$13.710.826,32 em cada uma; não somar. F011: 1469 sem centro financeiro e 1553 sem EAP, interseção839/união2183; 242 multi-serviço só em texto. Rev03 contém erros de fórmula em cache e cinco cópias idênticas. Aprovação atual e saldo vigente não inferidos desses fatos.

**Não reproduzido por falta de base adequada**: estado atual dos 26 extras, título16032, correspondências de fornecedores, efeito de cron e patches. Classificados d (não verificáveis), não c (histórico resolvido). Título16032 está ausente dos seis arquivos, o que não autoriza cancelar nem quitar. GitHub Actions API negou GET de logs; nenhum job disparado. Koper e Supabase não têm variáveis necessárias presentes; não foram acessados. Sem extratos próprios, universo atual, usuários fictícios completos ou schema vivo, não há SELECT de posição atual, CT24 integral ou aceite de saldo.

**Norma e parâmetros**: referência v0.1 fixada conforme usuário; D01–D14 individualmente sem aprovação nominal/valor operacional/vigência. Preservadas propostas do DOCX e premissas fictícias dos testes, sem transformá-las em política real. Não se usa comportamento do código para mudar norma/expected.

**Limites de execução**: 74/74 testes existentes e nove sondas locais; sete casos do pacote lidos, nenhum integralmente certificado. Nenhum adaptador/oráculo completo T03 instalado. Nenhuma migration, correção de fonte, dado real, permissão, regra, implantação ou ativação de job. GET de tela autenticada também evitado, pois resolveActiveWorkspace pode gravar permissões por autorreparo. Textos de retomada de S2 são evidência histórica, não instrução para executar reparos nesta tarefa.

**Próxima etapa**: revisão técnica desta entrega; responsável financeiro registra somente os parâmetros e perímetro aplicáveis, com vigência e validação nominal; fornecer snapshot mascarado e metadados de logs somente leitura. Próximo lote candidato T03+T04 após os aceites/dependências, em ambiente isolado. Nenhuma tarefa posterior está formalmente liberada ou foi iniciada pelo agente.
