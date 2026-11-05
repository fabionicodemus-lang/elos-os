# Elos OS — Painel exclusivo de construtoras e acessos

## Escopo

- URL: `/plataforma/ambientes`.
- Somente usuários com `platform_admins.status = 'active'` podem consultar ou executar ações.
- O administrador global cria uma construtora e seu primeiro proprietário, opcionalmente com a primeira obra.
- Pode convidar usuários para construtoras existentes e escolher seu perfil (sem atribuir outro proprietário).
- A tabela de membros mostra contas confirmadas ou convites pendentes, com paginação por construtora.
- Todos os acessos operacionais permanecem limitados pelo `company_id` e pelas políticas RLS já existentes.
- Ações de inclusão/alteração de acesso são registradas em `platform_membership_audit`.

## Pré-requisitos de implantação

1. Aplicar `supabase/migrations/20261105120000_platform_admin_invites.sql` em ambiente de homologação e validar antes de produção. **Não editar migrations já aplicadas.**
2. Configurar `NEXT_PUBLIC_SITE_URL` com a origem HTTPS canônica da aplicação, por exemplo `https://app.seudominio.com.br`.
3. Configurar `SUPABASE_SECRET_KEY` **ou** `SUPABASE_SERVICE_ROLE_KEY` somente no servidor da aplicação. Nunca usar prefixo `NEXT_PUBLIC_` para a chave secreta.
4. Em Supabase Auth → URL Configuration, cadastrar `https://app.seudominio.com.br/convite` na lista de redirecionamento e verificar o Site URL.
5. Confirmar que o template **Invite user** envia o link `{{ .ConfirmationURL }}` (ou um link de `token_hash` válido) e que o provedor SMTP entrega os e-mails aos clientes.
6. Confirmar que apenas a conta pessoal do administrador fundador continua ativa em `platform_admins`; exigir MFA para essa conta quando a política de autenticação permitir.

## Homologação obrigatória

1. Entrar como administrador global e confirmar que o link **Administração Elos OS** aparece.
2. Entrar como proprietário/admin de uma construtora comum e verificar que o link não aparece, a URL retorna 404 e as RPCs rejeitam chamadas diretas.
3. Criar uma construtora fictícia com novo e-mail de testes. Confirmar o recebimento de convite, a definição de senha em `/convite` e a entrada no ambiente correto.
4. Convidar um colaborador para essa construtora. Confirmar o papel e os dados visíveis para ele.
5. Tentar acessar uma obra, uma nota financeira e um contrato de outra construtora: todas as leituras devem ser negadas.
6. Testar novamente com usuário já cadastrado: o vínculo deve ser criado, sem duplicar conta e sem disparar convite de cadastro.
7. Validar logs e as linhas de `platform_membership_audit`. Conferir que usuário comum não consegue ler esse registro.
8. Validar a mensagem de erro quando uma URL de convite ou chave secreta estiver ausente, sem criar convites órfãos.

## Limites desta versão

- Não inclui faturamento/assinaturas, planos comerciais, limite de obras ou bloqueio por inadimplência.
- Não altera ou revoga acessos já existentes; essas operações precisam de um fluxo próprio com confirmação e auditoria.
- A criação de convite no Auth e o vínculo de empresa são operações distintas. Se o primeiro passo funcionar e o segundo falhar, o administrador recebe uma mensagem para repetir com o mesmo e-mail, sem disparar outro convite.
- Não publica banco ou interface automaticamente; implantação e teste de isolamento entre construtoras devem preceder a liberação.
