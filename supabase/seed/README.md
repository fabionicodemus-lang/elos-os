# Dados iniciais da Bossa

A estrutura das tabelas de fornecedores e clientes está em:

- `supabase/migrations/20260722_0002_suppliers_clients.sql`

A carga inicial é gerada a partir da base consolidada `Elos_OS_V0_25_2_Bossa_Flow_Dados.html` e executada separadamente no SQL Editor do Supabase, depois da migration de estrutura.

Ordem obrigatória:

1. `20260722_0001_multitenancy.sql`
2. `20260722_0002_suppliers_clients.sql`
3. carga inicial dos fornecedores e clientes da Bossa
4. futuras migrations de contas a pagar e vendas do Flow

A carga é idempotente e usa `source_system + source_id` para evitar duplicidades.
