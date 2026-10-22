from pathlib import Path
from decimal import Decimal
import json
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias';read=lambda n:json.loads((E/n).read_text())
def brl(v):return 'desconhecido' if v is None else 'R$ '+f'{Decimal(v)/100:,.2f}'.replace(',','X').replace('.',',').replace('X','.')
p=read('ponte.json');text='''# Ponte financeira por fonte, empresa, obra e corte

Esta ponte observa registros efetivos do PostgreSQL isolado e extratos fixados pelos inputs aprovados, separadamente do algoritmo financeiro do Elos. Cada caso tem obra/conta próprias, embora reutilize a organização fictícia A e o titular fictício A1. Os UUIDs e eventos/documentos constam em `evidencias/ponte.json` e `registros.json`; os extratos originais do teste em `extratos-referencia.json`. Nenhum dos valores representa Bossa/Flow/Alma.

O saldo auxiliar de R$1.000.000 por conta apenas permite executar a massa isolada. Não integra os expected originais, não é abertura documental aprovada nem valida I20. O saldo confirmado permanece null. A diferença abaixo compara os movimentos registrados com linhas de extrato definidas independentemente; zero significa igualdade no perímetro fictício explicitamente enumerado, não completude de uma conta real.

| Fonte/caso | Organização/titular | Obra/conta | Corte T | Saídas registradas | Entradas registradas | Líquido no extrato | Diferença banco | Diferença títulos/ledger |
|---|---|---|---|---:|---:|---:|---:|---:|
'''
for r in p:
 text+=f"| {r['case']} | Fictícia A / A1 | UUIDs em ponte.json | {r['cutoff']} | {brl(r['registered_out_cents'])} | {brl(r['registered_in_cents'])} | {brl(r['statement_net_cents'])} | {brl(r['bank_delta_cents'])} | {brl(sum(d['open_delta_cents'] for d in r['documents']))} |\n"
text+='''
A ponte por título conserva principal + encargos − principal liquidado − encargo liquidado − desconto − compensação = saldo; inversos têm sinal próprio. A verificação é feita sobre eventos/linhas brutos e confrontada com a projeção armazenada. Não usa `titlePosition` ou `contractRemainder` para produzir seu lado independente. Pai econômico, custo, restituição e contrato sem vínculo continuam fora do total validado, com null explícito. Uma ponte aritmética pode fechar e o fato econômico estar errado: CT10 demonstra essa diferença.

CT06 preserva filhos fornecedor/tributo/retenção, mas o documento pai e liberação nativa não foram simulados como comprovados. CT22 preserva referência de contrato/aplicação, porém não há comprovação de I18 completo. CT10 possui contrato e auditoria reais no scaffold, adiantamento, cancelamento e tentativa de estorno; não há conversão em direito de restituição.

## Ponte histórica, sem corte comum

Os 27 originais do catálogo foram reabertos/conferidos por hash, em modo somente leitura. Seis XLSX F011–F016 contêm versões da mesma população de3.261 IDs, com soma de linhas R$13.710.826,32 em cada; não são somados. Empresa/obra são declarações do catálogo, sem validação de titular jurídico. Corte operacional atual, snapshot Elos correspondente e banco confirmado permanecem desconhecidos.

F011, `Titulos_Koper`, linhas5–3265: subtotal de principal R$13.710.826,32. F007, PDF20, cabeçalho: R$13.561.236,99 e3.261 registros. Diferença **R$149.589,33**, ainda sem causa documental demonstrada. Banco, competência e cobertura contratual não podem ser inferidos dessa diferença. `fontes-historicas.json` guarda identidade declarada, cortes, cobertura, hashes e limitações de cada fonte; `linhas-historicas.json` guarda referência fonte/aba/linha/documento e conserva valores ausentes como null.

O título16032 não aparece nos seis XLSX; isso não prova cancelamento nem resolve sua divergência histórica. A pendência dos26 títulos/R$209.126,91 é informação do handoff, sem confronto atual nesta entrega. Baixa declarada do ERP não é recebimento/pagamento bancário confirmado.

## Ponte ainda ausente

Para uma ponte real: definir entidades/contas/obras e um T comum com K preservado; obter snapshot do destino, origem Koper somente leitura com manifesto, extratos contínuos e abertura comprovada, contratos/itens/aditivos/medição e alocações. Conferir IDs/parcelas/valores/credor, débitos/créditos, faixas e substituições, mantendo exceções. Não há autorização técnica implícita para produção nem responsável nominal de aceite informado.
'''
(ROOT/'PONTE-FINANCEIRA.md').write_text(text)
ct=read('banco.json');r=next(r for r in ct['results'] if r['name'].startswith('CT10'))['evidence'];t=r['after_refund_title']
(ROOT/'CT10.md').write_text('''# CT10 — executado e reprovado

Regra v0.1 §7.1/§8.3, I02/I09/I10/I12. A compra de R$10.000 foi cancelada antes de execução, com direito integral de restituição explicitamente definido pela fixture. Expected fixo preservado. Não há ambiguidade normativa que autorize substituir o direito por uma nova dívida a pagar.

Execução: `tests/financial-acceptance/database.mjs`, resultado em `evidencias/banco.json`, entradas aprovadas em `tests/financeiro/fixtures/casos_financeiros.json`. Foi reutilizada a RPC `change_execution_service_contract_status`, extraída sem alteração da migration `20260728_0038_execution_service_contracts.sql`, incluindo seu DDL de auditoria. A tabela de contrato continua scaffold parcial e recebe somente as colunas necessárias à RPC; isso não prova equivalência com o esquema remoto.

1. Título de adiantamento R$10.000 pago por `settle_finance_titles`, crédito `supplier_advance` ligado ao contrato; saída vinculada a extrato fictício fixo de−R$10.000.
2. Cancelamento pela RPC com motivo documental: contrato fica `cancelled`, gera auditoria, mas não nasce direito de restituição. O campo cadastral `current_value` continua10.000; ele não foi confundido com preço financeiro vigente validado, que permanece null na observação por falta do evento/mapa.
3. A RPC disponível de estorno foi testada como alternativa, sem chamá-la de cancelamento econômico: devolução R$6.000 via `reverse_finance_settlement`, vinculada a crédito independente no extrato. Ela conserva o histórico bancário, mas reabre o AP original integral. Não implementamos uma operação fictícia para produzir o resultado aprovado.

| Medida | Esperado independente | Obtido |
|---|---:|---:|
| Direito após cancelamento | R$10.000 | R$0 de crédito de restituição criado pelo caminho; ausência comprovada |
| Direito após devolução parcial | R$4.000 | Desconhecido: inexiste reclassificação/conta vinculada do direito |
| Saída histórica bruta | R$10.000 | R$10.000 |
| Devolução bancária vinculada | R$6.000 | R$6.000 |
| Saída líquida | R$4.000 | R$4.000 |
| Preço vigente/H imputável/C/Q após cancelamento | Zero em cada medida | Sem representação validada no caminho examinado; null explícito |
| Custo econômico | Zero | Sem evento/consulta econômica integral comprovada; null explícito |

Após a tentativa de estorno, AP aberto **'''+brl(round(t['finance_open_amount']*100))+'''**, caixa em apuração **'''+brl(round(t['finance_cash_pending']*100))+'''**. Isso não é um direito de restituição; AP e ativo não podem ser compensados silenciosamente. As projeções não recebem selo de completo.

O comparador original retorna código1 para CT10; o harness de observação termina a sonda com sucesso porque conseguiu executar e capturar a falha. São resultados diferentes. `comparacao-lacunas.json` conserva cada expected/obtido e não transforma desconhecido em zero.

Correção mínima proposta, sem implementação operacional nesta etapa: evento idempotente de cancelamento econômico aprovado, vinculado ao contrato/escopo/adiantamento/documento e actor/motivo/data; extinguir/reclassificar cobertura financeira do preço cancelado e criar direito de restituição10.000; conciliar/liquidar6.000 desse direito, conservar4.000 e o débito original. Reutilizar ledger/auditoria/bancos e testar replay, devoluções sucessivas, estorno, concorrência e escopos/empresas. Não alterar `reverse_finance_settlement` para presumir cancelamento econômico em todos os estornos. T24/T20/T16/T33 precisam da extensão localizada e do aceite documental aplicável.
''')
(ROOT/'DIVERGENCIAS.md').write_text('''# Divergências, causa e menor ação necessária

Impactos em BRL; não somar riscos de universos/cortes diferentes. Falta de prova não equivale a erro financeiro de valor zero.

| Prioridade / tipo | Indicador e documento | Esperado / obtido / impacto | Causa demonstrada e limite | Ação mínima |
|---|---|---|---|---|
| P0 — falha funcional CT10 | I09/direito de restituição; contrato, adiantamento e cancelamento do caso CT10, UUIDs em banco.json | Direito10.000 esperado, nenhum criado; remanescente4.000 não representado após banco6.000. Alternativa de estorno reabre AP10.000 | RPC contratual atualiza status/auditoria sem reclassificação financeira. RPC de estorno reabre liquidação por definição; não implementa cancelamento econômico. Demonstração em scaffold local, não diagnóstico remoto | Evento de conversão/restituição com vínculos e liquidação parcial, mantendo histórico; teste CT10 completo antes de aceite T24/T33 |
| P1 — divergência documental histórica | F011 Titulos_Koper linhas5–3265 versus F007 PDF20 cabeçalho; composição de principal/obrigações | 13.710.826,32 versus13.561.236,99; diferença149.589,33 | Diferença de fontes reproduzida; causa financeira não demonstrada. Contagem igual não prova bases iguais | Ponte linha/ID/documento entre XLSX e PDF, descontos/bruto/líquido e corte, com validação do responsável. Nenhum ajuste para fechar por diferença |
| P1 — informação/acesso ausente | Koper/Elos atual,26 títulos e16032 do handoff, fornecedores históricos |26/R$209.126,91 são relato histórico, impacto atual desconhecido;16032 sem valor atual comprovado | Sem snapshot pareado, logs remotos ou extratos; ausência no XLSX não prova extinção | Captura somente leitura com manifesto/T/K e documentação por título/fornecedor; não repetir saneamento sem prova |
| P1 — cobertura parcial CT06/28 | I05/I08/I10/I12/I14, documento bruto/filhos/retenção | CT06100.000 conserva componentes, retenção10.000; C/Q/custo desconhecidos. CT28 Q esperado1.180.000 ainda sem saída conjunta integral | Ledger dos componentes passa; não foi demonstrado ciclo nativo pai/filhos/liberação/mapas econômico-financeiros | Completar fixture persistida com documento, contrato, credores e condição; testar composição uma vez |
| P1 — vínculo/persistência pendente CT22 | I18 contrato/parcela/adiantamento | Banco20.000 e parcela20.000 abertos passam; futuro contratual60.000/I1880.000 não demonstrados | Aplicação do crédito está vinculada e não cria caixa; falta mapa exclusivo contrato/parcela/antecipação no resultado integral | Ligar mapa existente ao contrato e comparar o caso completo, sem dedução global adicional |
| P1 — hipótese que exige integração CT11 | Apropriação multiobra, título10.000/pagamento3.000 | Oráculo1.800/1.200 passa; erro monetário real não demonstrado | Consumidor puro não transporta project_id; importador detecta multiobra e marca multi_project_requires_ledger, impedindo aprovação automática. Não é prova de desvio operacional consumado | Testar cadeia multiobra persistida na mesma entidade, reaproveitando quarentena e valores monetários; depois corrigir somente o ponto que perder dimensão |
| P2 — falha na evidência anterior, resolvida no teste | CT23 títulos A/B e primeira alocação | Anterior:10.000/10.000 e6.000/4.000. Pacote:8.000/12.000 e4.000/6.000. Impacto final observado zero, identidade da entrada divergente | Fixture anterior chegava aos mesmos saldos por outra entrada, comprovado por leitura de settlements.mjs. Não era prova do caso exato | Nova execução com entradas corretas e extrato independente passou. Nenhuma mudança na operação/expected necessária |
| P2 — independência de teste anterior | I02/I17/I20 em confirmAccounts da Etapa8 | Impacto desconhecido; não é erro monetário comprovado | Função criava extrato a partir das movimentações; assegurava coerência interna, não conferência documental independente | Novos extratos fixados pelos inputs nos casos executados. Manter teste antigo como regressão técnica; não chamá-lo de extrato externo independente |

As demais lacunas, por cada um dos18 casos, estão em PARCIAIS-18.md e no confronto campo a campo. Nenhum desconhecido foi convertido em zero ou ajuste artificial. Assinar ponte/aceite permanece tarefa de responsável nominal, não do agente.
''')
