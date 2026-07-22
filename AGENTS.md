<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Elos OS — Constituição do Projeto

Este repositório transforma o protótipo HTML `Elos_OS_V0.25.3` em uma aplicação web multiempresa real.

## Regras invioláveis

- Desenvolver em passos pequenos, completos e testáveis.
- O protótipo HTML está congelado e serve apenas como referência visual e funcional.
- Arquitetura: Next.js App Router + TypeScript, Supabase e Vercel.
- Toda tabela de negócio deve ter `company_id`, `project_id` quando aplicável, `created_by`, `created_at` e `updated_at`.
- RLS deve estar ativo em toda tabela que contenha dados de empresa.
- A chave `service_role` nunca pode ser enviada ao navegador.
- Segredos ficam somente em variáveis de ambiente.
- Listas grandes devem usar paginação e filtros no servidor.
- O primeiro ambiente real de validação será Bossa Empreendimentos / Flow Aptos.

## Roadmap

1. Fundação: login, empresas, usuários, perfis, permissões, seleção de empresa e obra, menu e dashboard.
2. Cadastros da Bossa.
3. Financeiro e comercial do Flow.
4. Engenharia, execução, diário e qualidade.
5. Operação avançada, anexos, auditoria e notificações.

## Passo atual

Entregar integração com Supabase, login, cadastro, confirmação de e-mail, logout e uma página protegida mínima.
