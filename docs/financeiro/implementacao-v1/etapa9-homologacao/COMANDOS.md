# Execução reproduzível e fontes

Raiz: `/workspace/elos-os`. Regras v0.1 em `/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx`, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`; fixture aprovada `tests/financeiro/fixtures/casos_financeiros.json`, SHA-256 `fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb`.

Foram lidos: AGENTS.md, relatório/matriz30/planilha Etapa8, regras integrais em texto extraído, cartãoT44, cartões/casos pertinentes, catálogo/handoff, originais catalogados, código e evidências anteriores. Os manifests registram caminhos/hashes; documentos anexados são referência, não substituem a autorização e as restrições do pedido atual.

```sh
FINANCE8_EVIDENCE_DIR=docs/financeiro/implementacao-v1/etapa9-homologacao/evidencias/reexecucao npm run test:cashflow
node tests/financial-acceptance/validate.mjs --reuse-stage8
python3 docs/financeiro/implementacao-v1/etapa9-homologacao/scripts/relatorio.py
python3 docs/financeiro/implementacao-v1/etapa9-homologacao/scripts/verificar.py
```

O primeiro terminou0 e repetiu todos os gates anteriores, com logs em `reexecucao/`. O segundo terminou1 porque a homologação financeira está incompleta: não suprimir essa saída. `--reuse-stage8` valida/reutiliza os logs da primeira execução, sem afirmar nova rodada. Sem essa opção o runner executa também os gates anteriores. `execucoes.json` conserva comandos, saídas e logs de cada etapa; `comparacao-30.json` é o relatório estrito do comparador original:20 compatíveis numericamente,4 divergentes/incompletos e6 sem saída integral. A matriz aplica ainda os critérios de persistência/documentos/canais e não promove funções puras a casos integrais.

Requer dependências já instaladas de Node/Python3/openpyxl, Docker local e a imagem PostgreSQL do runtime existente, fixada por digest. Não usar banco real nem instalar essas migrations remotamente. O runner novo reutiliza bootstrap/SQL/cleanup existentes e exerce operações como papéis autorizados; a criação dos cadastros fictícios é feita pelo harness administrativo e não serve como teste de permissão desses cadastros.

`fontes_historicas.py` lê somente `/workspace/financial-source-base/Base_Conferencia_Elos_OS`. `pdftotext` reextrai o cabeçalho do PDF original; openpyxl reabre seis carteiras, sem converter ausente em zero. A inexistência dessas fontes em outro ambiente é impedimento para a ponte histórica, não autorização para inventar valores. O script `quadro.py` deriva a planilha da Etapa8 sem mudar seu arquivo de origem nem aceites. Logs/modelos antigos preservam rótulos históricos; commit/hashes da candidata constam no verificador final.

Não houve rede para dados financeiros, chamada ao Koper, conexão Supabase, migração compartilhada, publicação ou operação de produção. Consulta ao status do ambiente apontou conexão disponível, sem credenciais/identidades configuradas e estado da política de rede desconhecido; não foi tratada como autorização remota. Docker foi conferido pelo socket local antes dos testes. Backup/restauração repetidos são somente da fixture e não aprovam o procedimento real de produção.
