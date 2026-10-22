# Etapa14 — Isolamento financeiro entre empresas

**Recomendação: BLOQUEAR a certificação global e a liberação multiempresa.** A candidata passou nos recortes descritos em [CANAIS.md](CANAIS.md), mas há canais não certificados, diferenças entre o harness e o ambiente remoto e decisões de acesso pendentes. Não houve deploy, migração produtiva, acesso a dados de clientes ou operação remota do Koper.

Foram corrigidas três RPCs que atravessavam a fronteira de empresa, preservando seus cálculos. **342 verificações de Auth/HTTP/Storage/IA/Next/Chromium passaram**, além de64 comparações independentes de permissões,8 controles complementares de autorização e4 de valores de OS. As regressões anteriores passaram. O quadro mantém **13 parciais,7 conformes por teste independente anterior,10 por evidência técnica herdada e0 aceites formais**. Este lote usa outra massa fictícia; não substitui as entradas/esperados do CT24 original.

## Base, regras e ambiente

- Base limpa `feat/financeiro-etapa13-segundo-grupo`, `bd6d311`, com implementação `f3055a7`. Trabalho em `test/financeiro-etapa14-isolamento`. Correções e testes no commit `39d858c`.
- Regras v0.1: `../t01-t02/referencias/Elos_OS_Regras_Financeiras_v0_1.docx`, SHA256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. Identidade/organização e limites seguem §4/§11; RLS por empresa segue AGENTS.md e as migrações RBAC. Esperados financeiros originais permanecem intactos.
- **Correção de referência documental:** o handoff anterior associa D02/D13 à matriz nominal de acessos. Na norma v0.1, D02 é corte comum/histórico e D13 é operações entre entidades/obras. Esses IDs não foram redefinidos. A matriz nominal de permissões reais é uma pendência de implantação própria; não foi apresentada como decisão D13 aprovada.
- Empresas exclusivamente fictícias: **Construtora Horizonte (A)** e **Construtora Atlântico (B)**, com obras, contratos, contas, AP/AR, pagamentos/recebimentos, documentos e oito identidades de Auth. Cada identidade testada pertence somente à sua empresa. Não se criou regra que proíba um usuário legitimamente associado às duas empresas.
- Reutilizado PostgreSQL17 e bootstrap financeiro anterior; acrescentados GoTrue2.184.0, PostgREST13.0.7 e StorageAPI1.33.0 reais, fixados por digest. Rede Docker interna, sem publicação das portas dos serviços; gateway e Next somente em localhost. Banco e arquivos temporários, recursos removidos ao terminar.
- Login real por senha, JWT real verificado por PostgREST/Storage, SQL/RLS, rotas originais do fluxo/exportação/login e Chromium. A UI foi compilada em um projeto Next temporário que reexporta os módulos originais, sem substituir AppShell, workspace, cliente Supabase ou cálculos. Isso **não** equivale a um build/certificação de todo o Elos.
- Auth usa banco descartável separado, com IDs correspondentes no scaffold de `auth.users` da aplicação. DDL parcial de Engenharia é declarado; funções exercitadas vêm literalmente das migrações nativas. Schema Storage vem do serviço real, com políticas bancárias/contratuais originais reinstaladas. Grants técnicos padrão de schema, omitidos ao evitar recriar roles, foram restaurados conforme a migração0002 do Storage; não houve ampliação de permissões de negócio.
- Fontes locais pelo hook oficial de teste do `next/font`, sem mudar layout ou acessar Google Fonts. Não é certificação tipográfica. O modo `next dev` apresentou erros intermitentes de manifests JSON e não foi certificado; falhas iniciais estão em `evidencias/tentativas-iniciais/`.

## Vulnerabilidades comprovadas e correções

| ID | Causa e efeito antes | Correção mínima | Evidência depois / nível |
|---|---|---|---|
|V01|`refresh_execution_service_contract_value(uuid)` era SECURITY DEFINER, sem teste de empresa/permissão e com EXECUTE herdado dePUBLIC. FinanceiroA e até uma chamada sem autenticação obtiveram o valor privadoB100.000 e atualizaram seu cabeçalho90.000→100.000.|Guard por associação ativa à empresa e permissões contratuais existentes; retirar EXECUTE dePUBLIC/anon, manter authenticated e contexto service_role confiável.|HTTP real:403 para todas as identidades estrangeiras, negação anônima; FinanceiroB recalcula100.000. `vulnerabilidades-antes.json`, `tentativas.json`, `formulas-preservadas.json`.|
|V02|`refresh_execution_service_contract_measurements(uuid)` usava o mesmo padrão. EngenhariaA atualizou medidoB0→20.000 e retido0→2.000, mesmo sem ler o contrato por RLS.|Mesmo guard e ACL, sem alterar agregações/retornos.|HTTP real:403 entre empresas; chamada própria204 e valores20.000/2.000 conservados. Hash do corpo financeiro idêntico após remover apenas o guard.|
|V03|`refresh_execution_work_order_values(uuid)` atualizava autorizado/executado/aceito/medido de outra empresa por UUID. A linha era invisível por SELECT/RLS, mas a função com privilégios do proprietário atualizou0→20.000/8.000/7.000/6.000.|Guard por empresa e permissões de OS existentes, retirarPUBLIC/anon, preservar serviço confiável e fórmula instalada.|Prova SQL com papel authenticated/claims; estrangeiro e anon negados, operaçãoB conserva20.000/8.000/7.000/6.000. `ordens-servico.json`. **Não houve teste HTTP/Auth do módulo completo de OS.**|

As fórmulas originais foram preservadas por comparação de corpos/hashes, além dos testes numéricos. V01/V02 foram reproduzidas em chamadas HTTP antes de aplicar a candidata no banco descartável. V03 foi reproduzida separadamente em SQL. Nenhum desses resultados é inferido de um workflow com status de sucesso.

O guard preserva a execução técnica própria já permitida aos perfis com leitura/gestão contratual ou de OS. Não transforma leitura em autorização para alterar itens, aprovar aditivos ou liquidar títulos. A intenção operacional da execução técnica por leitores deve constar na matriz nominal aprovada; não foi decidida em nome do financeiro.

**Servidor/interface:** a exportação agora responde403 para perímetro indisponível, sem confirmar se o identificador existe; a página apresenta mensagem uniforme sem dados. Erros de banco continuam erros, não viram zero ou visão vazia. Autenticação e a permissão de entrada continuam verificadas antes do carregamento.

## Esperado independente versus observado

| Verificação fictícia | Esperado | Obtido |
|---|---:|---:|
| AP Horizonte:10.000−3.000 |7.000|7.000|
| AR Horizonte:5.000−2.000 |3.000|3.000|
| AP Atlântico:90.000−10.000 |80.000|80.000|
| AR Atlântico:45.000−5.000 |40.000|40.000|
| Eventos de liquidação / movimentos bancários |4 /4|4 /4|
| PreçoB: itens90.000+aditivo10.000, recalculado por usuário autorizado |100.000|100.000|
| Serviço aceitoB / retenção contratual da fixture |20.000 /2.000|20.000 /2.000|
| Valores OSB autorizado/executado/aceito/medido |20.000 /8.000 /7.000 /6.000|iguais|
| Leituras financeiras estrangeiras por ID/filtro nos recortes testados |0|0|
| Mutações estrangeiras persistidas após correção |0|0|

Esses são registros fictícios e invariantes do teste de segurança, não validação econômica/documental de clientes. Pagamentos e recebimentos foram registrados; sem extratos independentes neste lote, não se certifica caixa conciliado. Subtotais continuam separados deQ/EAC incompletos, conforme Etapa13.

## Perfis, evidência e decisões

[PERMISSOES.md](PERMISSOES.md) confronta64 pares esperado/observado, com fontes de configuração e cada identidade. Engenharia possui leitura/gestão contratual explicitamente configurada pelas migrações nativas; **não** recebeu acesso automático a AP, AR, bancos ou exportação financeira. Dentro da empresa, o alcance nominal de contratos/anexos e de rotinas técnicas ainda exige aprovação do responsável. A lacuna anterior A1/A2 dentro da mesma organização não foi confundida com isolamento Horizonte×Atlântico.

Cada tentativa está em `evidencias/tentativas.json`/`.csv`, com identidade, empresa, perfil, canal, registro, expectativa, resposta efetiva e resultado. `politicas-banco.json` inventaria82 estruturas de tabelas/views e suas políticas/opções do ambiente observado; não é inspeção do remoto. Funções SECURITY DEFINER exigem autorização própria: RLS sozinha não protege execução com privilégios do proprietário.

Arquivos bancários passaram por upload, registro de metadados, download próprio, tentativas estrangeiras de download/assinatura/upload/delete, URL pública e expiração de assinatura. A URL assinada válida respondeu200 sem sessão e expirou com400: **é uma credencial portadora temporária, diferente do identificador**. Não se certificou impedir compartilhamento/reuso dessa credencial entre usuários. A política de documentos deve decidir se basta a expiração atual ou se cada download precisa revalidar usuário/permissão; nenhuma regra foi alterada por suposição.

## Arquivos e reprodução

| Local | Alteração |
|---|---|
| `supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql` |Autorização e ACL das duas RPCs contratuais; preserva o corpo instalado.|
| `supabase/migrations/20261025110000_work_order_financial_tenant_guard.sql` |Mesma fronteira para totais financeiros de OS.|
| `lib/finance-core/cashflow.mjs` / `.d.mts` |Somente classificador de erros de perímetro; calculadores permanecem idênticos.|
| `app/api/financeiro/fluxo-de-caixa/route.ts` |Negação403 controlada, no-store, sem transformar falha de leitura em saldo zero.|
| `app/financeiro/fluxo-de-caixa/page.tsx` |Mensagem de acesso indisponível no AppShell, sem registros estrangeiros.|
| `tests/finance-isolation/` |Stack real descartável, massa fictícia, Auth/HTTP/browser/Storage, comparação independente de perfis, guards e OS.|
| `package.json` |`npm run test:finance-isolation`.|

Na execução desta sessão, os comandos do runner foram executados individualmente; `evidencias/execucoes.json` registra essa distinção. As regressões foram redirecionadas para `evidencias/regressao-etapa13/`, preservando os arquivos anteriores. O runner reúne a sequência para reprodução; requer Docker local, imagens fixadas, Chromium e Playwright disponíveis.

Resultados detalhados em [TESTES.md](TESTES.md). Quadro derivado: `Elos_OS_Quadro_Etapa14_Isolamento.xlsx`; fórmulas, esperados, valores anteriores dos30 casos e aceites permanecem inalterados. Novas abas distinguem configuração, observação e certificação limitada. Nenhuma tarefa foi marcada concluída apenas pela redação do relatório.

## Encerramento

**Aprovação técnica somente dos recortes certificados da candidata isolada. BLOQUEIO da certificação global/liberação:** faltam cobertura dos demais canais/buckets/RPCs, worker operacional, build integral estável, equivalência de schema/infraestrutura e decisões nominais indicadas em [CANAIS.md](CANAIS.md). O CT24 permanece parcial e não houve aceite financeiro em nome do responsável. Não se avançou a outra etapa.
