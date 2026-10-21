# Etapa 6 — Integração Koper e apropriação financeira

Base: branch `test/financeiro-base-validacao`, commit `494c55c`. Entrega: branch `feat/financeiro-etapa6-koper`, ambiente exclusivamente local/descartável. Regra v0.1 preservada, SHA-256 `30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28`. A autorização atual permite desenvolver e testar os complementos de T09–T17; não substitui os aceites nominais, parâmetros operacionais ou dependências formais ainda pendentes.

## Problemas comprovados e tratamento

| Prioridade | Evidência no estado inicial | Correção candidata / limite |
|---|---|---|
| P0 | `wave2e_nfe_payables` ignora título já mapeado: origem R$12.000, destino mantém R$10.000. O mesmo `continue` existe na onda 4. | Entrada incremental `elos_import.apply_financial_batch` identifica organização + empreendimento de origem + AP + ID + parcela, serializa por origem e grava versões. A revisão suportada chega a R$12.000 com antes/depois e motivo. Ondas históricas não foram reexecutadas nem reativadas. |
| P0 | Ondas 2e/4 selecionam `mirror.bill_to_pay_detail` por `_enterprise='flow'` sem `company_id`; alguns joins de rateio também não fixam organização. Evidência por código; vazamento produtivo não demonstrado. | Caminho novo exige organização, de-para confirmado do empreendimento, autor com permissão e escopo de todas as entidades da organização; rejeita relações cruzadas. Não expõe entrada no navegador/API pública. |
| P0 | Status `Paga` vira `paid` sem conferir se o valor pago extingue o principal; agrupados repartem uma baixa única por proporção. Onda 6 gera movimentos com base nessa declaração e usa vencimento como competência. | Caminho novo conserva valor/status bruto, mas coloca baixa declarada, agrupadores e estornos em revisão. Não chama a onda 6 nem cria banco, competência ou liquidação por inferência. Cancelamento documental sozinho não extingue a dívida. |
| P0 | `allocateByCostAllocations` remove linhas sem serviço e usa somente serviços conhecidos como denominador: R$600 conhecidos + R$400 pendentes viram R$1.000 conhecidos. | Forecast reutiliza centavos/maior resto da Etapa 5 e o valor total do título como base. Conserva pendência explícita ou omitida; excesso de pagamento fica não classificado. Incorporação permanece fora do custo de obra, com o restante pendente preservado. |
| P0 | `allocate_payable` histórico insere novamente e depende da ordem dos pesos. | Novo caminho recebe valores monetários explícitos, não infere pesos por nomes. Atualiza somente sua projeção em `payable_cost_allocations`, mantendo versões anteriores nos snapshots imutáveis. Alocações locais não são apagadas; múltiplas obras ficam pendentes de ledger/vínculos, sem forçar obra padrão. |
| P1 | Carga histórica não fornece manifesto reconciliável de execução atual. | Páginas originais, hashes, filtros, extração, corte, período, moeda, base, cursores, quantidades, subtotal e falhas são preservados. Por ID, relatório mostra origem, destino, diferença e pendências. Universo desconhecido, total divergente, página ausente e cursor repetido não recebem completude. |

## Resultado verificável

- **24 controles de integração** (incluindo duas reproduções do baseline), **5 testes de componentes**, **25/25 controles da Etapa 5 com o schema novo instalado**, **81/81 testes de regressão**. TypeScript e ESLint passaram. Ver [comandos](COMANDOS.md) e [evidências](evidencias/integracao.json).
- CT01 e CT26 executados no perímetro de banco/importação com os expected originais; comparador independente confirma **2/2**. Isso não certifica interfaces, dados reais ou todos os 30 cenários. CT02/CT11/CT12 continuam com cobertura parcial; CT07 permanece crítico. Não preencher aceite financeiro por estes resultados.
- Concorrência com mesmo comando e comandos diferentes, retry após falha injetada, parcelas iguais, ID repetido entre organizações, colisão de chave normalizada, original adulterado, versão antiga, perfis e entidades: controles executados e rastreáveis.
- Um pagamento bancário foi criado **explicitamente pela RPC existente na fixture** para provar preservação da baixa local. Importação criou **zero** movimentos. Valores declarados não são rotulados como caixa confirmado.
- Originais, expected, testes e registros da Etapa 5 preservados. Novos resultados estão apenas nesta pasta. A verificação da fundação usa um adaptador que instala o schema novo e executa as mesmas asserções, sem editar o runner original.

## Comparação monetária — somente massa fictícia

| Verificação | Antes | Depois |
|---|---:|---:|
| Revisão documentada do mesmo título | R$10.000, apesar da origem R$12.000 | R$12.000; ponte +R$2.000; identidade preservada |
| Parcela conhecida no rateio de R$1.000 | R$1.000 no serviço | R$600 no serviço |
| A Apropriar no mesmo rateio | R$0 | R$400 |
| CT01, duas obrigações após três importações + recorte parcial | Sem prova ponta a ponta | 2 títulos, R$30.000; ausente ID78 preservado em R$20.000 |
| CT26 completo / após retry | Sem prova de cursor + efeito | 5 títulos, R$15.000 |
| CT26 com falha na página 2 | Sem prova de incompletude | 2 títulos preparados, subtotal R$3.000, cobertura conhecida 40%, total certificado **null** |
| Sem obra, fixture de R$10.000 | Schema operacional exige obra | R$6.000 no título identificado + R$4.000 preservados na quarentena da entidade; nenhum fallback Flow |
| Parcial declarado sobre principal revisado R$12.000 | Caminho antigo pode encerrar integralmente | R$4.000 declarados preservados; operação mantida aberta em R$12.000, pendente de ledger; diferença aritmética declarada R$8.000 não é saldo normativo certificado |

Os valores em `financial_position` descrevem a carteira **observada de origem**, inclusive cancelados históricos. Não somar essa carteira aos títulos operacionais. `principal_minus_declared_paid_cents` é comparação aritmética, não R normativo: componentes da baixa podem ser desconhecidos. `financial_position_certified=false` e `confirmed_cash_cents=null` evitam afirmar homologação/caixa sem prova. `complete` do lote não certifica toda a posição financeira nem os cenários do plano.

## CT07 e Etapa 7

**CT07 não corrigido integralmente.** A RPC operacional `pay_finance_payable` ainda fecha o título após o primeiro parcial: na fixture original, R$100.000 − R$40.000 deveria deixar R$60.000, mas retorna aberto zero. A nova importação evita repetir esse erro ao receber `Paga` parcial, retendo a declaração e sua divergência, sem chamar a RPC de baixa. Uma baixa local já existente, mesmo divergente, não é reescrita pelo importador.

A Etapa 7 **pode começar tecnicamente em ambiente isolado**, priorizando T16/T18, componentes e eventos de liquidação, continuidade dos vínculos e CT07/CT03/CT08/CT23. O novo registro de origem permite alimentar esses testes. Não está liberada implantação nem saneamento real. Aceites de base, D05/D06/D07/D08 e perímetro aplicável precisam de validação para aplicação real; não inventamos esses parâmetros.

## Limitações e riscos remanescentes

1. **Produção e Koper não acessados nem alterados**; nenhuma requisição de integração real, deploy, job remoto, migração real ou saneamento executado. Relato histórico de execução não virou prova atual. Não reativar `koper-audit-runner` nem usar ondas antigas como sincronizador incremental.
2. Não há snapshot atual, lista dos 26 extras, eventos do 16032 ou amostra validada de fornecedores. T12/T13 seguem sem conclusão, sem exclusão ou patch presumido. O critério histórico “cancelados não entram” não substitui a norma v0.1; o novo caminho conserva rastreabilidade.
3. `payable_cost_allocations` não possui CREATE TABLE histórico localizado no checkout. Nos testes seu contrato é explicitamente simulado; exige introspecção de colunas, constraints, triggers e RLS num clone autorizado antes de implantação. Auth/Storage são os simuladores da Etapa 5, sem E2E de sessão, API, IA, anexos ou cache. Ver [ambiente](AMBIENTE.md).
4. Este caminho cobre snapshots AP conhecidos de `mirror.bill_to_pay_detail` com vínculos revisados. Transporte financeiro produtivo, credenciais, agendamento, checkpoint remoto, SLA D12 e delegação real do ator não foram ativados nem comprovados. Recebíveis, eventos/componentes, conciliação bancária real, N:M entre obras e cadeia nativa completa de documentos continuam com cartões próprios; campos desconhecidos ficam em revisão.
5. Uma exceção não desaparece: falta de entidade/obra/EAP, principal ausente, identidade, estorno, agrupamento, período bancário fechado, alocação local e conflito de edição ficam no original, nas revisões e/ou nas issues. O título operacional pode continuar com saldo conservador divergente da origem até T18; não publicar como posição reconciliada.
6. O backup foi reensaiado no recorte sintético ampliado pelos mesmos controles da Etapa 5. Isso não equivale a restaurar backup produtivo ou todo o Supabase. Nenhuma migração real fica liberada.

[Quadro e critérios de aceite](ACOMPANHAMENTO.md) · [Estruturas e contrato](AMBIENTE.md) · [Comandos](COMANDOS.md) · [Baseline](evidencias/baseline.json) · [Comparação independente](evidencias/comparacao-CT01-CT26.json).
