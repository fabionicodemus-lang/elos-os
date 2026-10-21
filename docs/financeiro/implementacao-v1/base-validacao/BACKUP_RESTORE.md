# Backup e restauração — ensaio da base fictícia

Foram executados os scripts reais `.github/scripts/backup-database.sh` e `restore-test.sh`, reutilizados pelo workflow existente. Eles delegam ao executor Python de biblioteca padrão, com cliente PostgreSQL 17 via Docker. O caminho especial `PG_DOCKER_CONTAINER` aceita exclusivamente contêiner de validação com nome/rótulo conferidos; não é uma rota genérica de restauração em produção.

## Correções do procedimento

- Exportação de snapshot em transação read-only/repeatable-read mantida aberta. O `pg_dump --snapshot` e a contagem de tabelas usam **o mesmo snapshot**; escritas posteriores não alteram o manifesto.
- Dump completo dos schemas não sistêmicos da base acessível, incluindo `finance_private`/schemas auxiliares que o procedimento anterior omitia. Mantém ACLs; continua `--no-owner`.
- Arquivo criptografado AES-256, SHA-256 do dump e do ciphertext, manifesto v2 com nome exato do arquivo e tabelas qualificadas. Não escolhe o primeiro arquivo por glob.
- Senha por pipe do GnuPG, sem aparecer na linha de comando. Dump em diretório temporário privado, removido também em falha; o artefato do workflow recebe somente ciphertext/manifesto.
- Restauração somente em localhost e banco **novo** `elos_restore_*`; recusa destino existente. `pg_restore --exit-on-error --single-transaction`, sem `|| true`. Todas as tabelas do manifesto são conferidas; zero tabelas não produz aceite.

## Evidência executada

O relatório `evidencias/banco-final.json`, controle `backup_restauracao_e_controles_restaurados`, conserva o manifesto com hashes/snapshot e contagem das **35 tabelas** do recorte. Durante o backup houve escritas reais numa tabela fictícia, demonstrando a captura consistente. A restauração manteve sete títulos a pagar/R$126.010,00 e três títulos a receber, hashes do histórico antes/depois, restrição de leitura e trigger de imutabilidade (tentativa de alteração inclusive como administrador foi recusada). Quantidade de escritas concorrentes e IDs efetivos constam no relatório, não são parâmetros fixados pelo financeiro.

Controles negativos executados: ciphertext corrompido recusado; destino existente recusado; arquivo descriptografado com hashes válidos, mas conteúdo inválido de dump, rejeitado pelo próprio `pg_restore`, sem indicação de sucesso. Contêiner, bancos e arquivos fictícios são destruídos no final.

## Limites antes de migrar dados reais

Este ensaio não restaura um backup da Bossa nem certifica todo o Supabase. Papéis ausentes do cluster de teste são recriados NOLOGIN, sem clonar senhas/privilégios de login/superusuário; propriedade dos objetos e infraestrutura Auth/Storage precisam de ensaio próprio. Extensões externas, arquivos armazenados fora do banco, configuração de serviços e disponibilidade de recuperação não foram validadas. RPO/RTO e retenção real não foram aprovados aqui.

Backups v1 não têm o manifesto consistente v2 exigido pelo novo verificador. Seu acervo permanece preservado, mas precisa de procedimento/ensaio específico; não houve conversão ou exclusão automática nem alegação de restauração desses arquivos. O workflow de backup não foi acionado nesta sessão.

Antes de uma futura migração real: executar apenas o preflight SELECT de `supabase/diagnostics/20261021_financial_foundation_preflight.sql`; resolver/registrar pendências sem saneamento automático; capturar backup autorizado da base própria; ensaiar sua restauração num destino controlado, conferir contagens/valores/vínculos/ACLs/arquivos; registrar aprovação nominal, ponte e plano de reversão. **Este relatório não libera migração produtiva.**
