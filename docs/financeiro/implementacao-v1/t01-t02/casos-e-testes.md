# T01/T02 — Cobertura e resultados

Os sete casos do pacote foram lidos, com inputs, premissas, steps, expected e assertions preservados. **Nenhum caso integral do pacote foi certificado**: executar testes de componentes não é executar o oráculo completo. Não foram gerados resultados_obtidos preenchidos artificialmente, nem rodado comparador contra o próprio modelo. A instalação do harness de todos os casos pertence a T03, fora do escopo atual.

| Caso / cartões | Estado | Evidência e limite |
| --- | --- | --- |
| CT01, T01 | Não executado integralmente; cobertura de componente apenas | P08 comprova somente repetição/namespace na staging; não há adaptador de promoção e eventos do título completo nem manifesto por tentativa. |
| CT21, T01 | Não executado integralmente; cobertura de componente apenas | Código inspecionado: defaults zero/limites e mensagens parciais; P07 mostra total de sobreposição. Não executados dashboard/export/IA com mesmo T/K. |
| CT24, T01 | Não executado integralmente; cobertura de componente apenas | Testes existentes verificam recortes de isolamento bancário; P08 testa namespace simulado. Não executadas todas as superfícies nem ACL por entidade A1/A2. |
| CT26, T01 | Não executado integralmente; cobertura de componente apenas | P01/P02/P03 cobrem helper por offset, 3 páginas, erro parcial e repetição de IDs. Cursor Koper/retry/manifesto/completude do lote não executados. |
| CT04, T02 | Não executado integralmente; cobertura de componente apenas | P05 mostra pagamento posterior entrando no realizado; testes de resumos usam datas. Fixtures integrais de competência, banco e horizontes não executadas. |
| CT11, T02 | Não executado integralmente; cobertura de componente apenas | Testes existentes cobrem rateio de centavos; P06 evidencia pendência perdida. Fixture integral entre obras, eventos parciais e desempate por ID não executada. |
| CT20, T02 | Não executado integralmente; cobertura de componente apenas | Testes existentes de ledger fechado e snapshots passam; fixture de custo original/reapresentado em T/K não executada. |


74 testes existentes: **74 aprovados, 0 falhas, 0 ignorados**, em Node 22.23.3, sobre funções puras e PGlite em memória. Dez arquivos: engine, snapshot-comparison, summaries, contract-calculations, ofx, bank-operations, finance-safe-write-db, aurora-regressions, development-costs e development-result. O teste de ações da IA simula RPCs financeiras: não prova as próprias RPCs ou autorização produtiva.

Nove sondas diagnósticas: P01/P02/P08 demonstram capacidades em recorte; P03–P07/P09 reproduzem limites/falhas. `diagnostic_reproduced=true` significa que a observação diagnóstica se repetiu; **não** significa aprovação normativa. `expected_observation_for_reproduction` é a assinatura da reprodução, separada de `normative_contrast`; não altera expected de casos_financeiros.json. Valores das sondas são BRL, salvo sufixo `_cents`.

Fontes simuladas são declaradas: requester em memória, Query que filtra arrays, schema mínimo PGlite e permissões simuladas apenas para testar liquidação. Não há chamada Supabase/Koper nem gravação em banco persistente. O SQL da RPC é extraído da migration; nada foi migrado em ambiente real.

Logs: [testes existentes](evidencias/testes-existentes.log), [sondas e contraste normativo](evidencias/sondas.json), [fontes e hashes](evidencias/fontes.json). Reexecução em [comandos.md](comandos.md).
