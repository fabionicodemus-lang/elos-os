# Ambiente comprovado

O executor usa Docker com digest `postgres@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939`, correspondente ao PostgreSQL 17.11 na execução. Cada rodada cria `elos-finance-test-<pid>`, banco `elos_finance_test`, `--network none`, sem mapeamento de portas, 1 GB de memória/duas CPUs e PGDATA em tmpfs de 512 MB. A autenticação local sem senha existe exclusivamente no contêiner inacessível pela rede. O `finally` remove o contêiner, inclusive em falha. O relatório registra configuração inspecionada, versão efetiva e remoção comprovada.

## Reutilização da cadeia

`tests/financeiro/runtime.mjs` executa estas migrations reais:

- 0001 multiempresa; 0002 fornecedores/clientes; 0003 contas a pagar; 0004 unidades/vendas; 0005 recebíveis;
- 0030 entidades legais; 0048 banco e RPCs; 0048a segurança de saldo;
- 20261013223527 operações bancárias; função vigente `has_company_permission` extraída de 0081;
- somente no candidato, 20261021120000 controles financeiros.

Para este recorte, a infraestrutura de teste cria roles `anon/authenticated/service_role`, schemas e estruturas mínimas Auth/Storage, mais colunas pré-requisito de correção/papéis. `auth.uid()` lê o claim de uma configuração de sessão controlada pelo harness. **A política de permissão financeira é a função real**, não um retorno booleano simulado. Consultas de usuário executam `SET LOCAL ROLE authenticated`, não como dono das tabelas. A identidade administrativa somente prepara a massa e confere invariantes.

Não há servidor Supabase Auth/Storage, Next.js ou Koper rodando. Uma chamada SQL que passa não demonstra JWT, cookies, HTTP 403/404, arquivos assinados ou proteção de todos os canais. As orientações de testes de Next 16 em `node_modules/next/dist/docs/01-app/02-guides/testing/` distinguem esses testes de integração dos testes E2E de componentes assíncronos.

## Massa, reinício e concorrência

As organizações/usuários têm UUIDs determinísticos declarados no executor, e-mails `example.invalid`, fornecedores e bancos fictícios. CNPJs sintéticos com dígitos verificadores apenas satisfazem a validação do cadastro. Nenhum cadastro do cliente foi copiado. CT24 fornece a matriz UA/UB/UR/UG; ela não substitui decisões reais D02/D13.

Os 30 documentos de casos originais ficam em `validation.cases`, sem conceder acesso ao usuário comum. Os eventos operacionais usados nos controles são criados no schema financeiro real selecionado, com seus triggers e constraints. Cada rodada começa de banco novo, portanto repetir não acumula massa. As outras 27 definições permanecem catálogo, sem alegação de que os eventos completos foram reproduzidos.

Concorrência: dois processos `psql`/conexões PostgreSQL independentes executam comandos em paralelo. Pagamento e revisão mantêm a transação aberta com `pg_sleep(0.2)` para exercitar bloqueios. Os resultados verificam uma transação bancária por liquidação, um título por identidade, uma revisão por comando, valores e quantidade de eventos, rejeição de reuso de chave com outro conteúdo e inexistência de eventos órfãos de `ON CONFLICT DO NOTHING`. Não é apenas uma fila de Promises em PGlite.

Nenhum arquivo `.env`, credencial real, permissão real, dado de produção ou serviço externo foi alterado. A exceção de infraestrutura é baixar a imagem oficial Docker; integridade foi mantida pelo digest.
