-- Reproduz o mínimo do ambiente Supabase que as migrations do Elos OS assumem.
-- Serve apenas para materializar o schema e gerar os tipos: não é um substituto
-- do Supabase, e nenhuma política de RLS depende deste arquivo para valer.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'shadow';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  deleted_at timestamptz
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean not null default false,
  avif_autodetection boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  path_tokens text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz default now()
);

-- No Supabase estas funções leem os claims do JWT da requisição. Aqui devolvem
-- o que estiver em current_setting, o suficiente para as migrations compilarem.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- storage.foldername divide o caminho do objeto: 'obra/2026/f.pdf' -> {obra,2026}.
-- As políticas do Elos OS usam o primeiro segmento para isolar por empresa.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end
$$;
