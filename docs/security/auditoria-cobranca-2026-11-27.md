# Auditoria inicial de segurança — 27/11/2026

Base: `089a181bfc00db8a358b54e5824181b491e9756a` (main). Escopo: autenticação/sessões, Central de Cobrança, conectores Sicredi/Santander, regras de acesso do banco, dependências e automações de implantação. Produção consultada somente para metadados, permissões, definições de funções e contadores de configuração. Nenhum recebível, saldo, destinatário ou integração foi alterado. Não houve simulação de ataque em produção.

## Decisões do produto

- Não exigir MFA nesta etapa, conforme decisão do responsável.
- Logout após **30 minutos sem interação**, aviso a partir de 28 minutos e opção de continuar conectado.
- Integração bancária exclusivamente para cobrança/recebimentos. Não habilitar APIs de pagamentos, transferências, Pix de saída ou agendamentos. Lançamentos contábeis internos permanecem permitidos.
- Esta revisão não é certificação, teste de invasão completo ou autorização para ativar integrações reais.

## Achados priorizados

| Prioridade | Evidência e impacto | Situação / ação |
|---|---|---|
| P0 | `apply_procurement_inventory_balance` é `SECURITY DEFINER`, possui EXECUTE para anon/authenticated e não verifica identidade/permissão. `post_procurement_inventory_movement` também possui EXECUTE para anon e sua condição de autorização não rejeita identidade ausente. Confirmado por catálogo e leitura da definição vigente, sem executar mutações. | Migration preparada para tornar o helper interno e retirar execução anônima do ponto de entrada. Preserva o encadeamento autorizado por SECURITY DEFINER. **Não aplicada em produção.** Ainda revisar demais chamadores e vínculo entre empresa/obra/local. |
| P1 | O advisor aponta 230 funções SECURITY DEFINER executáveis por anon e 247 por authenticated. Isso é superfície de revisão, não 477 vulnerabilidades confirmadas: muitas fazem checagens internas. Saldo bancário e lançamento bancário examinados possuem `has_company_permission`. | Classificar individualmente, remover acesso anônimo desnecessário e revisar helpers internos antes da integração real. A correção desta branch cobre apenas as duas funções acima. |
| P1 | Workflows antigos de migrations são acionados por título de issue e usam segredo do banco, sem filtro de autor/environment no YAML examinado (ex.: `apply-supabase-0032.yml`). A disponibilidade do segredo e controles externos do GitHub não foram verificados. | Restringir a execução a acionamento administrativo e ambiente protegido; não executar esses workflows para testar. Revisar também passos condicionados por título de PR em `build.yml`. |
| P1 | `npm audit` reportou 11 dependências: 2 altas e 9 moderadas. `xlsx` 0.18.5 tem avisos de prototype pollution/ReDoS e não apresenta correção pelo registry nesse relatório; `zod` transitivo tem aviso de consumo de memória. | Planejar atualização/substituição com regressão dos importadores. Não executar `npm audit fix --force`: a sugestão para exceljs inclui downgrade incompatível. Explorabilidade de cada caminho ainda não demonstrada. |
| P1 | Não havia controle de inatividade da pessoa no aplicativo. Renovação automática do token pode conservar uma sessão aberta. | Implementado logout no navegador, aviso, persistência por sessão, checagem antes de aceitar interação, sincronização entre abas e saída local no servidor. **Pendente de publicação.** |
| P2 | Proteção de senha vazada desabilitada segundo advisor. | Habilitar após confirmar disponibilidade/plano; não envolve exigir MFA. Nenhuma configuração de Auth alterada nesta rodada. |
| P2 | 13 funções com search_path mutável; 14 tabelas com RLS sem políticas (inclui tabelas internas). | Examinar individualmente. Ausência de política com RLS normalmente bloqueia acesso; não criar políticas abertas para silenciar o aviso. |
| P2 | CSP configurada protege contra framing/objects, porém não restringe scripts com nonce. | Avaliar CSP mais restritiva em homologação com Next.js; não declarar proteção completa contra XSS. |

## Controles confirmados nesta rodada

- 220 tabelas públicas com RLS ativo; esse número não comprova sozinho a correção de todas as políticas.
- Tabelas novas da Central sem SELECT anônimo e sem INSERT/UPDATE/DELETE direto de authenticated. View `finance_collection_center` com `security_invoker=true`.
- Funções de confirmação bancária, eventos dos provedores, despacho e marcação de conciliação acessíveis somente ao serviço privilegiado. Operações da equipe verificam `receivables.manage` e empresa.
- Em produção: zero configurações de cobrança e zero configurações homologadas para banco, email ou WhatsApp nesta consulta.
- `bank-documents` privado. Não foi realizado teste de download com usuários de empresas diferentes nesta rodada.
- Conectores atuais têm escopo sandbox, hosts restritos, TLS validado, bloqueio de redirects e journal contra repetição de registro. O worker rejeita adapter sandbox para operar a carteira real. Não há operação de saída bancária nos conectores examinados.
- Configurações novas invalidam a homologação; beneficiário/conta/valor/identificadores são preservados na cobrança. O teste SQL existente cobre SPE incorreta, empresa distinta, correção importada, parcial, tarifa, estorno, repetição e lembretes.
- Cliente administrativo usa `server-only`; segredos dos conectores são lidos em execução no servidor/CLI. Não foram solicitadas nem exibidas credenciais reais.
- Existe workflow de backup criptografado e teste de restauração. A existência do YAML não comprova que o último backup/restauro concluiu: verificar execuções e restauração em etapa seguinte.

## Logout: funcionamento e limites

O componente é global. Pointer, teclado, rolagem e toque reais na aba visível renovam o prazo; foco, polling, renderização, refresh de token e abertura de outra aba não renovam. A chave de atividade usa o `session_id`, preservado entre refreshes e distinto entre logins. O registro não armazena tokens ou dados financeiros.

Aos 28 minutos aparece o aviso. Aos 30, o conteúdo fica oculto/inert, a renovação automática é interrompida e uma Server Action encerra somente a sessão corrente (`scope: local`), limpa cookies de autenticação/empresa/obra e retorna ao login. Se outra aba iniciou um novo login, a ação não encerra essa nova sessão. Falha de rede mantém a tela bloqueada e tenta a saída novamente. Um registro expirado não é reaberto por clique, reload ou foco. Armazenamento inicialmente indisponível falha fechado.

**Limite importante:** este controle atende a inatividade no navegador cooperativo. Não é controle de autorização no banco: JavaScript/localStorage podem ser manipulados, o HTML inicial pode ser renderizado antes da checagem e um JWT já emitido pode continuar válido até expirar. Ainda falta política de sessão aplicada pelo servidor/banco para garantir rejeição imediata de tokens em todos os acessos diretos à API. Não anunciar o logout como revogação instantânea de todos os tokens. Outras sessões/dispositivos continuam independentes.

O timeout nativo de inatividade do Supabase mede renovação de sessão, não interação humana; deve ser planejado junto com a renovação automática e a duração do JWT. Não foi alterado nesta rodada. Referências: [sessões](https://supabase.com/docs/guides/auth/sessions), [saída](https://supabase.com/docs/guides/auth/signout).

## Validação e publicação

- 11 testes de prazo/aviso, atividade, suspensão, reload, múltiplas abas, novo login, relógio e falhas de armazenamento.
- 4 testes da Server Action real com adaptadores simulados: sessão local, proteção de login novo, falha de revogação remota e cookies de sessão expirada.
- 1 teste PostgreSQL/PGlite das permissões da migration, reaplicação e chamada interna autorizada. Usa funções fictícias para isolar o efeito das ACLs, não altera estoque real.
- 112 testes existentes de cobranças, conectores simulados, conciliação bancária, inadimplência e eObra.
- TypeScript e ESLint dos arquivos alterados.
- Build de produção concluído localmente. Validação visual/E2E em navegador pendente: executável Chromium indisponível e download bloqueado no ambiente. Os testes de múltiplas abas acima simulam armazenamento compartilhado; não equivalem a homologação visual.
- CI específico sem segredos e sem implantação automática de migrations.

Publicação exige revisar o PR, aplicar somente a migration nova e conferir os grants; publicar o aplicativo e validar o login/logout em homologação com usuários de teste. Não aplicar todas as migrations históricas em lote. Nesta etapa não houve deploy, habilitação de APIs, MFA, mensagens a clientes, pagamentos ou transferências.

Próxima etapa: revisar as demais funções privilegiadas, endurecer automações de implantação, resolver dependências de importação, testar isolamento com usuários reais de homologação e validar revogação/timeout no servidor. APIs bancárias e canais permanecem pendentes de credenciais e homologação.
