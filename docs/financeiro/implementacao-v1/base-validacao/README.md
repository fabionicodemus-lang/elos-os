# Base isolada de validação financeira

Entrega na branch `test/financeiro-base-validacao`, a partir de `16188348c18e06d816acb576f3f63494c14599fd`. O pedido desta etapa autoriza preparar e corrigir a base técnica relacionada a T03–T08. Não constitui aceite financeiro de D01–D14 ou autorização de implantação. Os documentos T01/T02 permanecem como evidência da revisão anterior, sem atualização retroativa.

## Resultado

- PostgreSQL **17.11 real**, contêiner descartável com imagem fixada por digest, rede `none`, sem porta publicada, dados em tmpfs e remoção ao finalizar. A massa usa organizações A/B, entidades A1/A2/B1 e perfis UA/UB/UR/UG fictícios. Nenhum acesso ao Elos/Supabase real ou ao Koper.
- **30 casos aprovados carregados** como catálogo de definições na base descartável e versionados em `tests/financeiro/fixtures/`. Entradas, oráculos, modelo e comparador originais preservados por SHA-256. Carregar as definições não significa executar todos os cenários.
- **25 controles PostgreSQL aprovados**, incluindo duas conexões concorrentes por operação, RLS/perfis, vínculos, idempotência, versões, autoria, motivo e restauração. Sete testes monetários e três testes do comparador aprovados. Regressão: 81 testes aprovados, dos quais 74 existentes e os sete monetários novos. TypeScript e ESLint dos arquivos alterados passaram.
- **Nenhum dos 30 casos foi certificado integralmente**: CT07, CT11 e CT24 têm execuções parciais; 27 permanecem não executados. O comparador independente retorna código 1 e zero casos integrais certificados, evitando converter cobertura parcial em aceite.

## Estado inicial e correções

| Área | Antes | Candidato testado |
| --- | --- | --- |
| Dinheiro/data/resíduo | 2/7 testes aprovados; cinco falhas | 7/7. Conversão decimal exata, limite de centavos seguros, NaN não convertido em zero, data real validada, desempate de resíduos por ID estável |
| Banco/perfis/integridade/histórico | 7/20 controles aprovados; 13 falhas/lacunas, incluindo ausência das novas RPCs | Os mesmos controles passam; mais cinco controles de preflight, comparação e backup completam 25/25 |
| Migration bancária 0048 | Montagem nova falhava em ON CONFLICT sem predicado correspondente ao índice parcial | Duas cláusulas corrigidas; cadeia financeira selecionada executada no PostgreSQL descartável |
| Backup | Manifesto em outro corte, somente três schemas, privilégios omitidos; restore ignorava erros com `|| true` | Dump e manifesto no mesmo snapshot, schemas não sistêmicos e ACLs no dump, checksums, erro interrompe restore, destino novo/local obrigatório |

As falhas iniciais estão em [moeda-inicial.log](evidencias/moeda-inicial.log) e [banco-inicial.json](evidencias/banco-inicial.json). O baseline SQL é sem a extensão nova; contém a correção de montagem da 0048 para permitir executar os controles. Ausência de uma RPC nova é classificada como capacidade ainda inexistente, não como regressão de um serviço implantado.

## Reaproveitamento e mudanças reais

1. `node:test`, PGlite, tabelas financeiras, memberships, políticas e RPCs bancárias existentes foram mantidos. O PostgreSQL Docker complementa PGlite para verificar concorrência entre conexões independentes.
2. `lib/money.mjs` usa decimais textuais e BigInt internamente, retornando centavos seguros. Os consumidores existentes `lib/financial-installments.ts` e `lib/cost-vs-budget/native-allocation.mjs` passam a usá-lo. A regra testada de maior resto/ID é a premissa fictícia de CT11; D05 real continua pendente, sem aplicação a dados reais.
3. `20261021120000_financial_foundation_guards.sql` é **migração candidata, executada somente nos testes**. Reusa tabelas/ACLs existentes, acrescenta guardas de relações, restrições por entidade, auditoria append-only e revisão de título por comando idempotente/versão esperada. Não faz backfill. Controle por entidade exige opt-in e concessões explícitas; nenhuma empresa real recebeu configuração.
4. A nova trilha registra valores anteriores/novos, ator autenticado, motivo, data efetiva explícita e instante de registro. Motivo/autoria são exigidos no perímetro ativado. Datas desconhecidas não são copiadas do vencimento. O histórico T/K verifica versões criadas pelo novo caminho; não reconstrói automaticamente o legado.
5. Scripts e workflow de backup existentes foram reaproveitados. O executor Python mantém o snapshot aberto durante dump e contagens. A restauração exige banco novo `elos_restore_*` em localhost; não aceita URL remota como destino.

## Lacunas remanescentes

- **CT07, primeiro pagamento:** título fictício de R$100.000, parcial de R$40.000, saldo esperado R$60.000; RPC atual retorna estado `paid` e aberto zero. A correção do ledger de liquidações/componentes pertence a T18 e dependências; não foi disfarçada alterando o oráculo ou inventando desconto. CT30/excedentes também não está homologado.
- CT11 verifica o componente matemático, sem provar todo o ciclo financeiro/rateio entre obras. CT24 verifica o banco; **API Next, sessão Auth real, cache, exportações, IA e Storage real** ainda precisam de testes de superfície. Não ativar ACLs reais com base apenas nesta suíte.
- O recorte de schema inclui migrations financeiras e infraestrutura Auth/Storage simulada. Não é um clone completo do Supabase nem prova de aplicação de toda a história de migrations. Tipos/funções reais carregados estão em `tests/financeiro/runtime.mjs`.
- D01–D14 continuam sem valores operacionais/validação nominal quando assim registrados em T02. Não houve alteração de taxas, alçadas, critério real de rateio ou tratamento contábil.
- Nenhum backup produtivo foi restaurado, nenhum job externo foi disparado e nenhum workflow novo teve execução remota comprovada. O ensaio local não libera migração de dados reais.
- O caminho novo de revisão/auditoria ainda não está conectado a todas as telas e integrações. Dados anteriores à instalação não recebem versões inventadas; o preflight e a definição do legado são necessários antes de implantar.

## Evidências e próximos passos

- [Ambiente e limites](AMBIENTE.md), [casos e cobertura](CASOS.md), [tarefas e quadro](TAREFAS.md).
- [Backup/restauração](BACKUP_RESTORE.md), [comandos](COMANDOS.md).
- [Resultado final PostgreSQL](evidencias/banco-final.json), [comparação dos casos](evidencias/comparacao-casos.json), [regressão](evidencias/regressao.log), [execução da fundação](evidencias/fundacao-final.log).

Próximo lote proposto: completar os aceites técnicos e testes de superfície de T03–T08, confirmar o perímetro D02/D13 e demais parâmetros aplicáveis; depois abordar vínculos/componentes de T16 e liquidações T18. Antes de qualquer migração real: preflight somente leitura, backup consistente próprio, ensaio de restauração desse backup, ponte de dados/valores, plano de reversão e aceites aplicáveis. Nenhuma tarefa recebe conclusão financeira automática por este relatório.
