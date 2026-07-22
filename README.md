# Elos OS

Aplicação web multiempresa para gestão de construtoras e incorporadoras.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres e Storage
- Vercel
- GitHub

## Passo atual

Fundação da aplicação: autenticação por e-mail e senha, confirmação de cadastro, sessão por cookies, logout e página protegida.

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
- Adicione também as URLs da Vercel, de teste e de produção quando estiverem disponíveis.

Mantenha a confirmação de e-mail habilitada durante os testes do cadastro.

## Configuração na Vercel

Adicione estas variáveis no projeto:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

A chave `SUPABASE_SERVICE_ROLE_KEY` não é usada neste passo e nunca deve ser exposta ao navegador.

## Segurança

As regras completas do projeto estão em `AGENTS.md`, referenciado também por `CLAUDE.md`.
