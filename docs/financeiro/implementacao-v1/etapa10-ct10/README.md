# Etapa 10 — Correção exclusiva do CT10

**CT10 corrigido e conforme ao oráculo aprovado em ambiente isolado.** Nenhum aceite financeiro nominal foi registrado. Os outros29 casos conservam suas classificações da Etapa9, incluindo16 parciais; não há homologação financeira global.

Branch `fix/financeiro-etapa10-ct10`, base `6354e59`. Ancestralidade das Etapas5–9 preservada. Implementação no commit `282436d`; hashes dos fontes/testes e evidências em [verificacao-final.json](evidencias/verificacao-final.json). Código e dados reais do Koper, produção e documentos normativos permaneceram inalterados por esta execução. Não houve conexão financeira remota, implantação ou migração em produção.

## Causa raiz comprovada e correção

A RPC `change_execution_service_contract_status` alterava status e auditoria contratual, sem transformar o adiantamento pago em direito de restituição. A alternativa `reverse_finance_settlement` desfaz a liquidação e reabre o AP por definição. A reprodução anterior à instalação da candidata está em `evidencias/baseline/`: direito criado0, saída10.000/devolução6.000 conservadas, mas AP reaberto10.000. O comparador original reprova esse caminho.

A correção acrescenta dois registros financeiros tipados: direito de restituição vinculado a contrato/fornecedor/título/linha do adiantamento, e recebimentos desse direito vinculados ao banco. Reutiliza pagamento, extrato, conciliação, cancelamento/auditoria contratual, RLS e núcleo de caixa existentes. O AP original continua **quitado**, com principal e pagamento preservados; não se cria venda, cliente ou receita para representar o fornecedor.

`cancel_supplier_advance_contract` exige autorização financeira e de cancelamento, mesma empresa/titular/obra/fornecedor, adiantamento integral comprovado no extrato, escopo integral sem execução/faturamento/aplicações e provas documentais explícitas. Constitui o direito e cancela o contrato atomicamente, sem entrada bancária. Conserva o valor nominal/documental original; o compromisso financeiro vigente do escopo cancelado passa a zero e o crédito permanece separado, sem C negativo.

`receive_supplier_refund` registra somente a parcela efetivamente devolvida, como movimento bancário `refund`, e reduz o direito. Locks, comando idempotente e identificador da devolução por conta impedem repetição e excesso. O mesmo comando não pode ser reutilizado no ledger anterior ou em encargos. Operações que tentem estornar/aplicar novamente o adiantamento convertido, reativar o contrato ou apagar fatos canônicos são bloqueadas. Estornos legítimos dos demais pagamentos mantêm o comportamento anterior.

## Esperado versus calculado

Valores em BRL, com comparação exata em centavos pelo comparador original, sem recalcular expected pelo Elos.

| Medida CT10 | Esperado | Calculado |
|---|---:|---:|
| Direito integral após cancelamento |10.000,00 |10.000,00 |
| Saída bruta histórica |10.000,00 |10.000,00 |
| Entrada por restituição conciliada |6.000,00 |6.000,00 |
| Saída líquida |4.000,00 |4.000,00 |
| Direito ainda aberto |4.000,00 |4.000,00 |
| Custo apropriado ao escopo |0,00 |0,00 |
| Obrigação/compromisso contratual remanescente |0,00 |0,00 |
| Reabertura indevida do AP original |0,00 |0,00 |
| Receita operacional criada |0,00 |0,00 |

O zero econômico resulta da não execução comprovada da fixture e dos controles documentais, não da suposição de que pagamento seja custo. Nenhuma medição aceita, NF aprovada ou apropriação de custo foi criada pela correção. Não certifica I01 em dados reais. O direito remanescente sem prazo documentado aparece **sem data**, não como zero ou recebimento confirmado. A confirmação bancária usa os vínculos de extrato, sem deslocar a data de caixa para a data da conciliação.

[Comparação independente CT10](evidencias/comparacao-ct10.json) · [Registros e vínculos](evidencias/registros-ct10.json) · [Resultados das variantes](evidencias/banco.json).

## Testes e regressões

- **9/9 controles novos de banco:** CT10 principal; nenhuma restituição; restituição integral; parciais2.000/3.000/5.000 (saldos8.000/5.000/0); replay por comando e origem; concorrência; permissões/titular/centavos/fechamento; cancelamento legado bloqueado/execução existente; reutilização de crédito bloqueada; snapshots e cortes. Os agrupamentos estão identificados no JSON de resultados.
- **4/4 testes de núcleo/carregador/SSR:** caixa10.000/6.000, direito4.000, AP/AR comercial sem nova dívida, cortes T/K, autoria e valores anteriores, tela real e rejeição explícita de duplicidade/corrupção. Transporte/Auth são simulados no SSR; RLS/mutações são testados no PostgreSQL com papéis SQL.
- Repetidos com a candidata instalada: **25/25 controles Etapa5** (incluindo backup/restauração isolados), **24/24 Etapa6**, **16/16 ledger Etapa7**, **8/8 banco Etapa8**, **7/7 sondas Etapa9**. CT10 histórico da Etapa9 agora verifica a recusa da rota defeituosa; o caso financeiro é conferido no teste novo pelo mesmo expected original.
- Preservados: componentes/SSR anteriores8+4+12+1, comparadores novos da Etapa9 (CT13/14/23 e componentes CT02/11), **81/81 regressões**, TypeScript e ESLint sem erros. Configuração de CI atualizada para executar a nova suíte; nenhuma execução remota de CI foi alegada.

[Nomes, comandos, saídas e logs](COMANDOS.md) · [execucoes.json](evidencias/execucoes.json). Todos os comandos da rodada candidata terminaram0. O comparador da reprodução anterior termina1, como evidência da falha corrigida. Containers PostgreSQL17 sem rede/portas publicadas, descartados ao final; cadastros e evidências integralmente fictícios.

## Arquivos e funções

| Localização | Alteração restrita ao CT10 |
|---|---|
| `supabase/migrations/20261023100000_supplier_advance_refunds.sql` | Duas tabelas append-only com RLS; RPCs de cancelamento/restituição; guardas contra estorno/reutilização/reativação/execução do escopo; snapshots das novas versões. Sem backfill |
| `lib/finance-core/cashflow.mjs` e `.d.mts` | `supplierRefundPositions`; camada `REFUND` separada de AR comercial/receita; compromisso cancelado excluído mediante vínculo documentado; preservação de corte e fonte congelada |
| `lib/finance-core/cashflow-server.ts` | Leitura paginada sob RLS e composição central de direitos, recebimentos e candidatos; tela e IA usam esse carregador |
| `app/financeiro/fluxo-de-caixa/page.tsx` e `actions.ts` | Apresentação dos direitos e operações autenticadas/documentadas; restituição não pode ser criada como previsão manual |
| `lib/elos-ia/tools.ts` | Resposta de fluxo inclui restituições, com natureza explícita de recuperação de adiantamento |
| `tests/supplier-refunds/`, `package.json`, `.github/workflows/finance-foundation.yml` | Fixture isolada, testes, adaptadores de regressão e comando `test:supplier-refunds` |
| `docs/financeiro/implementacao-v1/etapa10-ct10/` | Relatório, evidências, matriz derivada e cópia do quadro; histórico das etapas anteriores preservado |

A modelagem de recebíveis comerciais exige venda/unidade/cliente. Reutilizá-la criando uma venda fictícia para o fornecedor violaria o escopo; por isso o direito tipado é aditivo e entra uma única vez no núcleo de caixa, em categoria própria.

## Quadro, pendências e parada

[Quadro atualizado](Elos_OS_Quadro_Etapa10_CT10.xlsx): CT10 tecnicamente conforme, T24 em validação, T33/T44 ainda em andamento e T45 bloqueada para liberação. Onze campos monetários do expected original conferidos; campos de aceite, fórmulas, dependências e estados dos outros29 casos preservados. Nenhuma tarefa integral foi concluída somente pelo relatório.

Não foi necessária nova decisão normativa para o caso fictício: §§7.1/8.3 já determinam o direito de restituição e a preservação do desembolso. Permanecem necessários aceite nominal e revisão de documentos reais, equivalência do esquema remoto, matriz de acesso vigente e demais parâmetros/pendências das Etapas anteriores. Cancelamento parcial, execução já ocorrida, vários adiantamentos/aplicações ou crédito em outra moeda são recusados para análise própria; não foram antecipados. Correção/estorno de um recebimento de restituição lançado incorretamente exige procedimento posterior por evento, sem edição/exclusão do original; não se libera o estorno do pagamento para contornar isso.

Os scaffolds de engenharia dos testes não substituem o esquema remoto integral. Não houve validação documental real, integração Koper, teste de navegador/Auth real ou restauração de backup produtivo. As16 pendências parciais, divergência histórica149.589,33 e demais impedimentos da Etapa9 continuam abertos. A execução encerra nesta entrega, sem avançar para outra etapa ou publicar em produção.
