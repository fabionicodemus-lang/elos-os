# Elos OS — Segurança, proteção de dados e backup

Pacote de segurança V0.72.8 (outubro/2026).

## Diagnóstico de partida (migrations 0001–0092)

| Item | Resultado |
|---|---|
| Tabelas com RLS ativo | 169 de 169 |
| Funções `security definer` sem `search_path` fixo | 0 |
| Políticas liberadas para `anon` | 0 |
| Política `using (true)` | só `permissions` (catálogo de nomes de permissão, sem dados de empresa) |
| Chave `service_role` no navegador | não; só no webhook da Meta (servidor) e no worker Koper |
| Buckets de arquivos | privados, exceto `project-images` (fotos de divulgação dos empreendimentos) |
| Trilha de auditoria geral | não existia (só Qualidade, Contratos e Dados & Backup) |
| Backup automático do banco inteiro | não existia (só exportação manual por empresa) |
| Dependências | Next.js 16.2 com falha crítica conhecida; `xlsx` com falha alta sem correção no npm |

## O que este pacote entrega

1. **Trilha de auditoria** (migration 0093 + tela *Sistema › Trilha de auditoria*): registra
   quem criou, alterou ou excluiu registros de usuários, acessos a obras, contas a pagar e receber,
   contas bancárias, lançamentos, transferências, folha, orçamentos, contratos e medições.
   A trilha é somente-adição: o aplicativo não consegue editá-la nem apagá-la.
   Em alterações guarda só os campos que mudaram (minimização de dados — LGPD art. 6º, III).
   Visível para Proprietário e Administrador (`security.audit.view`).
2. **Cabeçalhos de segurança** em todas as páginas: HTTPS obrigatório (HSTS), bloqueio de
   embutir o sistema em outros sites, bloqueio de adivinhação de tipo de arquivo, política de
   referência e bloqueio de recursos do aparelho não usados.
3. **Next.js 16.4.0**: corrige a falha crítica de segurança da 16.2.
4. **Backup automático diário** (`.github/workflows/database-backup.yml`): todo dia às 03:17
   (Brasília) gera uma cópia do banco (dados, usuários e metadados de arquivos), criptografada
   com AES-256, guardada por 30 dias. **Aos domingos o backup é restaurado num banco descartável**
   e a contagem de linhas de cada tabela é conferida — backup que não é testado não é backup.

## O que depende de você (não dá para fazer pelo código)

1. **Criar o segredo `BACKUP_PASSPHRASE`** no GitHub (Settings › Secrets › Actions):
   uma frase longa (6+ palavras). **Guarde-a fora do GitHub** (cofre de senhas). Sem ela,
   nenhum backup pode ser aberto — nem por você.
2. **Supabase**: confirmar o plano com backup diário e, se possível, ligar o *Point-in-Time
   Recovery* (volta o banco a qualquer minuto dos últimos dias).
3. **Ligar a verificação em duas etapas (MFA)** na conta do GitHub, Vercel, Supabase e OpenAI.
   Quem invade uma delas tem acesso total ao sistema.
4. **Aplicar a migration 0093** (PR operacional `run/supabase-0093`).

## LGPD — situação

| Requisito | Situação |
|---|---|
| Separação de dados entre empresas (RLS) | ✅ |
| Controle de acesso por papel e permissão | ✅ |
| Registro de quem acessa/altera dados sensíveis | ✅ alterações (este pacote); leituras ainda não |
| Portabilidade (exportar dados da empresa) | ✅ *Dados & Backup* |
| Backup e plano de recuperação | ✅ este pacote |
| Elos IA não guarda perguntas nem respostas | ✅ (`store:false`, só contagem de tokens) |
| Política de privacidade e termos de uso publicados | ❌ precisa de texto revisado por advogado |
| Contrato de operador de dados (DPA) com clientes | ❌ precisa de advogado |
| Encarregado de dados (DPO) nomeado | ❌ decisão da empresa |
| Exclusão/anonimização de pessoa a pedido do titular | ❌ próximo pacote |
| Plano de resposta a incidentes (aviso à ANPD em até 3 dias úteis) | ❌ próximo pacote |

## Riscos que continuam abertos

- **`xlsx` (importação de planilhas)**: a versão corrigida não é publicada no npm. O risco é um
  arquivo de planilha malicioso travar o servidor; só usuários logados importam. Próximo passo:
  trocar a leitura por `exceljs` (já usado no projeto).
- **Fotos e documentos** (Storage) não entram no backup do banco — o Supabase os mantém, mas
  uma cópia externa fica para o próximo pacote.
- Falta uma revisão independente das políticas de acesso entre empresas (teste de invasão).
