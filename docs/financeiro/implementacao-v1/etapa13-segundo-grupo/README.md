# Etapa13 — Segundo grupo de pendências financeiras

Foram selecionados **CT24 e CT21**, prioridades1 e3 da matriz da Etapa12. CT02/03/18/29 foram excluídos do lote principal e preservados como dependências/regressões. Limitar o lote a dois permite tratar primeiro isolamento e risco de certificar uma soma sobreposta; não foi iniciado CT28 antes de CT05/06 nem ampliado o módulo de medições/tributos. **Os dois cenários continuam parciais globalmente, embora a comparação numérica do recorte executado seja conforme. Nenhum aceite financeiro foi registrado.**

## Base e integração anterior

- Base limpa: `feat/financeiro-etapa12-parciais`, `bdf2f04` (implementação `f37d21e`). Trabalho: `feat/financeiro-etapa13-segundo-grupo`. Correção e testes: commit `f3055a7`.
- Ancestralidade confirmada de Etapa5 `494c55c`, Etapa6 `95d659e`, Etapa7 `3daa96e`/`5e18d7f`, Etapa8 `6ec4f47`/`c72ec54`, CT10 `282436d`/`9c5d016`, Etapa11 `65fe2cc` e Etapa12 `f37d21e`/`bdf2f04`. Todas as branches locais listadas são ancestrais da candidata: nenhuma correção local concluída ficou fora dela. Não houve conflito de merge nem merge nesta entrega.
- A referência **local**, não atualizada por fetch, de `origin/main` está em `28180e0`. As etapas financeiras não estão integradas nessa referência. Isso não certifica o estado remoto atual nem autoriza publicação.
- Regras v0.1: `../t01-t02/referencias/Elos_OS_Regras_Financeiras_v0_1.docx`, SHA256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`.
- Esperados aprovados: `tests/financeiro/fixtures/casos_financeiros.json`, SHA256 `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`. Comparator original preservado. `evidencias/base.json` registra branches, ancestralidade e hashes anteriores; `manifesto-entrega.json` confere a preservação.

## CT24 — Perímetro financeiro da resposta de contratos

**Falha demonstrada:** com a política SELECT nativa de `20260728_0038_execution_service_contracts.sql`, UA tem leitura de Engenharia na organizaçãoA, mas autorização financeira apenas emA1. `loadCashflow(A,A1)` devolvia também o contrato deA2 no campo `contracts`. A consulta nativa é por organização; o retorno do carregador filtrava apenas obra/status, omitindo entidade. Evidência SQL e carregador real: `evidencias/baseline-registros.json`, `baseline-banco.json`.

**Regra:** §4, §11, §14 item13, D02/D13. O filtro financeiro não pode ampliar autorizações de entidades. Nenhuma matriz nominal real foi inventada.

**Correção mínima:** o carregador consulta a função existente `finance_entity_scope`, filtra contratos pelo titular autorizado/selecionado e obra, limita a construção nativa de compromissos e o seletor de entidades ao perímetro legível. Falha de autorização não vira visão vazia. Não modifica a política de Engenharia nem os registros de contratos.

| Medida | Esperado independente | Antes | Depois |
|---|---:|---:|---:|
| Contratos deA2 na resposta financeira deUA/A1 |0|1|0|
| Títulos canônicos entre as duas organizações |3|3|3|
| UA/A1 |R$1.000|R$1.000|R$1.000|
| UB/B1 |R$9.000|R$9.000|R$9.000|
| UG/A1; A2; consolidadoA; B |R$1.000;3.000;4.000;9.000|iguais|iguais|
| Mutações financeiras indevidas UA/UR |0|0|0|
| Ocorrências de dados estrangeiros na nova exportação/IA deUA |0|não executado|0|

**Limite importante:** consulta direta de UA à tabela nativa de contratos ainda retorna **uma linha deA2** sob a política de Engenharia. A correção é da resposta financeira, não uma certificação de todos os acessos ao banco. Alterar globalmente o alcance de Engenharia exige mapear seus consumidores e a matriz aplicável. Auth/PostgREST, detalhes/anexos/storage, jobs e cache de sessão completos não foram certificados. CT24 permanece parcial; essa lacuna é prioritária, não foi ocultada por testes de títulos aprovados.

## CT21 — Completude e valores desconhecidos

**Falha demonstrada no núcleo:** para título com posição certificadaR140.000, compromissoC840.000 sem vínculo e datas informadas, `futureCashRows` não apontava ausência do mapa; `projectCashflow` podia retornar `complete=true` para uma soma de980.000 não comprovadamente exclusiva. `evidencias/baseline-core.json` usa as funções reais de `bdf2f04`, entrada fictícia explícita e esperado independente `false`.

**Distinção de evidência:** na cadeia SQL anterior à correção, títulos sem eventos eram reconstruídos como saldos legados e **já** produziam `complete=false`. Não se afirma que essa consulta SQL específica estava completa antes. A prova do defeito de completude é a função com posição certificada; a cadeia SQL prova valores, composição e a lacuna de vínculo específica. Datas e igualdade de valores não provam cobertura.

**Regra:** §7.2 e §11, I12/I14/I15/I22. Ausência de vínculo exige subtotal/compromisso separados; universo desconhecido não produz100%; orçamento/ETC ausentes não produzem EAC ou desvio zero.

**Correção mínima:** o núcleo adiciona exceção explícita para obrigação aberta sem cobertura em compromisso contratual. Conserva ambos os valores em revisão e impede `complete=true`. O carregador reutiliza `financialCoverage` para expor os mesmos indicadores em dashboard, exportação JSON somente leitura e ferramenta existente da IA. Não foi criada outra fórmula deQ/EAC nem dedução artificial para forçar igualdade.

| Indicador | Esperado aprovado | Obtido nos três canais |
|---|---:|---:|
| Subtotal conhecido de obrigações |R$140.000|R$140.000|
| Compromisso apresentado separadamente |R$840.000|R$840.000|
| Q |desconhecido|null|
| EAC |desconhecido|null|
| Desvio percentual do orçamento |desconhecido|null|
| Cobertura do universo externo |desconhecido|null|
| Estado |incompleto|incompleto|

Os três registros conhecidos (dois títulos e um compromisso) permanecem na composição. Não há ponte presumida para eliminar140.000, nem certificação de980.000 comoQ. O endpoint usa a permissão existente `cashflow.view`, contexto ativo de empresa/obra e `Cache-Control: private, no-store`; não permite escolher outra empresa pela URL. Não é exportação fiscal. K histórico não suportado é rejeitado; os metadados informam `known_at=null` e `historical_knowledge_supported=false`.

**Limites:** canais são os componentes e handlers reais com a posição capturada do carregador real sobre PostgreSQL/RLS. Não houve HTTP/Auth/PostgREST real nem prova de snapshot transacional comum sob escritas concorrentes. D12 operacional continua pendente; nenhuma exceção foi liberada. O relatório não afirma conhecer o universo externo, ETC econômico ou orçamento vigente. CT21 permanece parcial até fechar esse alcance.

## Arquitetura e arquivos

| Localização | Mudança / reaproveitamento |
|---|---|
| `lib/finance-core/cashflow.mjs: futureCashRows` |Exceção de cobertura ausente; conserva valores e reutiliza vínculos/abatimentos existentes.|
| `lib/finance-core/cashflow-server.ts: loadCashflow` |Aplica `finance_entity_scope`; devolve indicadores via `financialCoverage`, fontes e limites explícitos.|
| `app/financeiro/fluxo-de-caixa/page.tsx` |Completude, subtotais separados, desconhecidos e link da exportação. Reutiliza AppShell/estilos existentes.|
| `app/api/financeiro/fluxo-de-caixa/route.ts: GET` |Exporta posição central autorizada em JSON; readonly/no-store, valida datas e rejeita K não suportado.|
| `lib/elos-ia/tools.ts: runFluxoDeCaixa` |Repassa indicadores/fontes do mesmo carregador; mantém permissões do dispatcher.|
| `tests/finance-second/` |Reproduções, testes de núcleo, SQL/RLS e canais; runner com saídas redirecionadas.|

Sem nova tabela, RPC, migração, saneamento ou alteração de trilha de auditoria. A apropriação não foi presumida e o financeiro de outros cenários não foi reimplementado.

## Testes, rastreabilidade e acompanhamento

Comando reproduzível: `npm run test:finance-second` (`node tests/finance-second/validate.mjs`). O runner fixa Docker no socket local, limpa seletores TLS/contexto e redireciona todas as evidências herdadas para esta pasta. PostgreSQL com imagem fixada por digest, `network=none`, sem portas, armazenamento temporário e container removido. Bootstrap/DDL parcial de Engenharia e JWT simulado são limitações explícitas, não equivalência comprovada do remoto.

Resultados finais e códigos de saída: `evidencias/execucoes.json` e `RESUMO-TESTES.md`. O runner da Etapa12 repete os controles anteriores **sem alterar assertivas/fixtures**, incluindo backup/restauração, CT10, os quatro casos da Etapa12, regressões81 e testes gerais. Comparador original: `evidencias/comparacao-2.json`, **2/2 numéricos conformes**, sem atribuir aceite financeiro.

`MATRIZ-30.md`/`evidencias/matriz-30.json` registram cada cenário com entrada, regra, esperado, obtido, evidência e pendência. Situação global preservada: **13 parciais,7 conformes por teste independente anterior,10 apenas por evidência técnica herdada;0 aceitos formalmente**. CT21/24 possuem nova evidência independente no recorte, mas continuam nos13 parciais. Não há homologação global.

Quadro derivado: `Elos_OS_Quadro_Etapa13_Segundo_Grupo.xlsx`. Atualiza execução dos dois casos e notas técnicas; mantém esperados, fórmulas, status de tarefas e aceites financeiros. `evidencias/verificacao-quadro.json` verifica célula a célula; os caches das fórmulas não foram recalculados. Nenhuma tarefa completa foi declarada apenas pela redação deste relatório.

## Critérios e próximo encaminhamento

Cumpridos: base/integração verificadas; dois defeitos reproduzidos; correções localizadas; comparação com esperados originais; valores conhecidos conservados; testes e regressões registrados; rastreabilidade e fontes anteriores preservadas. Pendentes: escopo completo deCT21/24, aceite nominal, fontes reais e conciliação documental. Apenas os recortes corrigidos estão prontos para **revisão técnica/financeira**, não para liberação operacional global.

`PENDENCIAS.md` enumera documentos, acessos e decisões necessários. A Etapa11 não foi reaberta e seus arquivos permanecem idênticos. Produção, Koper remoto e seus dados não foram acessados ou alterados; não houve deploy/push/merge em produção. O trabalho termina neste grupo.
