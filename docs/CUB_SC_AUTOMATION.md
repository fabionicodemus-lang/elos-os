# Atualização mensal do CUB-SC

O Elos consulta a publicação oficial do Sinduscon Grande Florianópolis a cada hora, somente nos dias **1 a 3 do calendário em America/Sao_Paulo**. Ao validar a publicação do mês de uso, encerra a busca até o próximo mês. Não estende o período em feriados; sem publicação até o dia 3, o Financeiro vê a pendência.

## Operação

- Configuração e histórico em **Financeiro → Índices de correção → CUB-SC automático**, com permissões `indices.view`/`indices.manage` e isolamento por empresa.
- Fonte fixa: https://sinduscon-fpolis.org.br/servico/cub-mensal/ . Modalidades atendidas: Residencial Médio e Comercial Médio, Norma 2006. Não inferir R8-N, desonerado ou outros padrões.
- O mês de referência da pesquisa e o mês de uso são armazenados separadamente. O valor entra em `correction_index_values.reference_month` no **mês de uso**, seguindo o calendário dos contratos no Elos.
- Um índice por construtora pode aderir à coleta. A migração habilita apenas cadastros já explicitamente identificados com modalidade e fonte oficiais. Demais empresas precisam selecionar índice/modalidade. Ativações posteriores à coleta do mês aguardam o próximo ciclo; o cadastro manual continua disponível.
- A inserção não sobrescreve mês cadastrado manualmente. Divergência gera pendência individual. Uma falha de aplicação em uma empresa não impede as demais.
- A publicação usa o motor de correção contratual existente, sem alterar bases/regras dos contratos. O disparo de atualização preserva parcelas pagas, parciais, travadas, importadas do eObra e com cobrança não cancelada. Revisões dessas parcelas exigem o fluxo financeiro apropriado.
- Mantém fonte, hash SHA-256, modalidade, competência e histórico por empresa. Variação superior a 10% frente à publicação anterior coletada fica para conferência.

## Agendamento e segurança

`vercel.json` chama `GET /api/cron/cub-sc` em `17 * 1-4 * *` (UTC). O quarto dia UTC cobre as últimas três horas do dia 3 em Brasília. Aplicação **e banco** bloqueiam qualquer consulta fora dos dias locais 1–3. Após sucesso, o agendador ainda pode invocar a rota, mas ela não consulta a fonte novamente.

Produção exige `CRON_SECRET` exclusivo, gerado aleatoriamente e salvo como segredo na Vercel; o agendador envia `Authorization: Bearer ...`. Não reutilizar chaves bancárias/Supabase. Preview/desenvolvimento ficam desabilitados. A frequência exige plano Vercel com suporte a cron horário.

`cub_sc_claim` e `cub_sc_finish` são exclusivos do servidor (`service_role`). O banco determina o relógio/mês, bloqueia linha e reserva uma única tentativa por hora com lease de cinco minutos. Retries/execuções concorrentes não duplicam consultas nem valores. O schema privado não é exposto ao cliente; configurações/históricos têm RLS e escrita apenas por rotinas autorizadas.

## Validação e implantação

1. Executar `node --test tests/finance/cub-sc-*.test.mjs`, regressões financeiras/eObra, TypeScript, ESLint e build.
2. Aplicar `20261127142911_cub_sc_monthly_automation.sql` antes do deploy da interface.
3. Configurar `CRON_SECRET` apenas em produção e publicar. Conferir cron ativo e endpoint sem credenciais retornando 401.
4. Não forçar relógio ou inserir publicação em produção para testar. Os testes locais PostgreSQL/PGlite simulam viradas UTC/Brasília, isolamento, retries, conflitos e preservação das parcelas.
5. A primeira execução real do ciclo mensal permanece uma validação operacional futura. Em caso de falha, consultar o painel e cadastrar manualmente apenas após conferência financeira.

Para pausar uma construtora, desative a opção no painel. Para pausar globalmente, desabilite o cron no projeto; preservar valores/histórico existentes. Nenhum pagamento ou transferência é implementado por este fluxo.
