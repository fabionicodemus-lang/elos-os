# Importação de estudo de viabilidade pela Elos IA

## Fluxo

1. Selecionar a construtora e o empreendimento existente no cabeçalho.
2. Na persona Diretoria, Engenharia ou Financeiro, anexar o estudo e pedir: “Leia este estudo de viabilidade e prepare o lançamento para eu revisar”. Usa a leitura de anexos já existente na Elos IA.
3. A ação `preparar_estudo_viabilidade` cria somente uma proposta, exibida no chat e em Ações pendentes. Pedidos de importação identificados com anexo são direcionados à preparação, sem passar pela consulta de resultado econômico que exige baseline.
4. **Revisar dados do estudo** abre uma página com totais declarados, premissas, tipologias, áreas adicionais, observações e referências de páginas/células. Permite corrigir campos e adicionar/remover linhas antes da confirmação.
5. O botão **Confirmar lançamento do estudo**, com conferência obrigatória, cadastra um novo estudo em rascunho. Permissão e empresa são revalidadas no servidor e no banco.

## Dados e limites

- Campos ausentes/ilegíveis permanecem `null` na extração e na memória de revisão. Zero só é usado quando informado. Nunca buscar valores operacionais atuais para preencher silenciosamente o estudo histórico.
- Tipologias e áreas completas são inseridas nas coleções do módulo de viabilidade. Linhas incompletas ficam integralmente na memória da importação para complementação. Forma de pagamento e CUB-base incompletos também ficam na memória, sem inventar o restante.
- O cadastro legado do simulador exige algumas premissas e tem valores padrão. As premissas não preenchidas pela importação são explicitadas na página do estudo; seus indicadores são identificados como **simulação com premissas atuais**, separada dos totais declarados no arquivo.
- Outros dados sem campo específico (custos globais discriminados, cronogramas, premissas especiais) ficam em observações com referência da fonte. Não são transformados automaticamente em orçamento executivo, unidades, contratos ou lançamentos financeiros.
- O empreendimento ativo fornece contexto; a ausência de baseline aprovado, orçamento ou tabela de preços não bloqueia preparar/cadastrar o estudo.
- A importação não aprova viabilidade nem substitui baseline. Como se destina a um empreendimento existente, fica bloqueada a conversão desse rascunho em outro empreendimento para evitar duplicação. O fluxo de aprovação de estudos manuais não importados permanece inalterado.
- Arquivo fonte permanece vinculado à proposta no bucket privado existente e é aberto por URL temporária. A memória guarda extração original, revisão confirmada, campos mapeados, usuário e horário. Não há envio de arquivos a destinatários.
- Repetir a confirmação da mesma proposta retorna o mesmo estudo. Erros em qualquer linha desfazem todo o cadastro. Preparações anteriores com o mesmo nome de arquivo geram aviso; nome igual não é prova de conteúdo igual e não bloqueia revisões legítimas.

## Validação

Testes PostgreSQL/PGlite usam empresas e documentos fictícios: ausência de escrita no domínio ao preparar, isolamento entre construtoras, permissão revogada, proposta expirada/descartada, campos forjados, rollback, idempotência, preservação de dados ausentes e bloqueio de substituição/conversão de baseline. Testes do contrato da ferramenta verificam roteamento e extração sem dependência de dados operacionais.

`node --test lib/elos-ia/*.test.mjs tests/commercial/*.test.mjs`

Interface verificada com formulário real e dados fictícios em desktop/mobile. A leitura real de cada PDF depende de sua legibilidade e do provedor de IA existente. O screenshot enviado para esta tarefa mostra a tentativa anterior, não contém o PDF completo; nenhum estudo comercial real foi confirmado durante a implementação.
