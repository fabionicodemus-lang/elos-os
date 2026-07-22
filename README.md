# Elos OS

Aplicação web multiempresa para gestão de construtoras e incorporadoras.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres e Storage
- Vercel
- GitHub

## Passo atual

Fundação da aplicação com:

- autenticação por e-mail e senha;
- confirmação de cadastro e sessão por cookies;
- empresas com dados isolados;
- obras vinculadas à empresa;
- perfis, papéis e permissões;
- seleção do ambiente ativo;
- tela inicial de usuários e acessos.

## Configuração local

1. Instale as dependências:

```bash
npm install
```

2. Copie o arquivo de exemplo das variáveis:

```bash
cp .env.example .env.local
```

3. Preencha no `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

4. Rode o projeto:

```bash
npm run dev
```

5. Abra `http://localhost:3000`.

## Configuração no Supabase

Em **Authentication → URL Configuration**:

- Site URL local: `http://localhost:3000`
- Redirect URL local: `http://localhost:3000/auth/confirm`
- Adicione também as URLs da Vercel, de teste e de produção.

Mantenha a confirmação de e-mail habilitada durante os testes do cadastro.

### Instalar o banco multiempresa

1. Abra **SQL Editor** no Supabase.
2. Abra o arquivo `supabase/migrations/20260722_0001_multitenancy.sql` deste repositório.
3. Copie todo o conteúdo para o editor.
4. Execute o script uma única vez.
5. Volte ao dashboard do Elos OS e cadastre a primeira empresa e obra.

A migration cria tabelas, índices, funções seguras e políticas de Row Level Security para empresas, obras, perfis, papéis e permissões.

## Configuração na Vercel

Adicione estas variáveis no projeto:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

A chave `SUPABASE_SERVICE_ROLE_KEY` não é usada neste passo e nunca deve ser exposta ao navegador.

## Fluxo de usuários

1. Cada pessoa cria e confirma a própria conta no Elos OS.
2. Um proprietário ou administrador abre **Usuários e acessos**.
3. Informa o e-mail já cadastrado e escolhe o papel.
4. O usuário passa a enxergar somente a empresa, as obras e os módulos permitidos.

## Segurança

As regras completas do projeto estão em `AGENTS.md`, referenciado também por `CLAUDE.md`.
