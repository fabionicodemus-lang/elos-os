"""Classificação de cobertura; nunca promove comparação de função pura a fluxo homologado."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[3]
fixtures=json.loads((REPO/'tests/financeiro/fixtures/casos_financeiros.json').read_text())
notes={
'CT01':('Integralmente aprovado no perímetro isolado','Banco/importação: 3 repetições, recorte parcial, identidade, 30.000 abertos.','integracao/integracao.json; comparacao-integrais.json'),
'CT02':('Parcialmente coberto','Revisões/reimportação passam; posição histórica completa por corte ainda não executada.','integracao/integracao.json'),
'CT03':('Parcialmente coberto','Parcial/replay preservam saldo e caixa; conciliação posterior por extrato do caso não executada.','liquidacoes.json'),
'CT04':('Parcialmente coberto','Fixture de janelas 30/90/hoje/desconhecido passa; fluxo completo emissão/competência/conciliação não executado.','componentes-casos.json'),
'CT05':('Parcialmente coberto','Adiantamento AP aplicado sem segundo caixa, disponibilidade e reversão testadas; execução econômica do caso completo pendente.','liquidacoes.json'),
'CT06':('Parcialmente coberto','Documento nativo cobre contrato sem somá-lo novamente; separação integral pai/retenção/tributos não testada.','componentes.log'),
'CT07':('Integralmente aprovado no perímetro isolado','Sequência aprovada: 40.000 + 55.000 principal + 2.000 juros − 5.000 desconto; caixa 97.000, saldo 0. Exemplo 30/70 e tela AP passam.','liquidacoes.json; render.log; comparacao-integrais.json'),
'CT08':('Integralmente aprovado no perímetro isolado','Variantes A/B/C: R 57.000/62.000; devolução 57.000 somente com prova fictícia; sem devolução, 57.000 pendentes sem reescrever caixa.','liquidacoes.json; comparacao-integrais.json'),
'CT09':('Parcialmente coberto','Nota e medição vinculadas não duplicam saldo; cancelamento/substituição integral não executado.','componentes.log'),
'CT10':('Não executado','Cancelamento econômico após pagamento e restituição parcial do caso completo pendentes.','—'),
'CT11':('Parcialmente coberto','Rateio parcial, resíduo e devolução agrupada conservam centavos; ledger financeiro multiobra integral pendente.','regressao-81.log; liquidacoes.json; componentes.log'),
'CT12':('Reprovado no fluxo integral','6.000 com obra + 4.000 sem obra preservados; pagamento de 2.000 sem obra bloqueado: posição declarada 10.000, esperado 8.000. Sem fallback Flow.','liquidacoes.json: CT12_limitacao_operacional_sem_obra_reproduzida'),
'CT13':('Parcialmente coberto','Coorte de principal 20.000, vencido 6.000, 30%; parcial AR passa. UI/coorte e caso integral ainda pendentes.','componentes-casos.json; liquidacoes.json'),
'CT14':('Parcialmente coberto','Recebimento parcial e tarifa: direito 10.000, caixa 9.800. Baixa sem caixa disponível; permuta integral do caso não executada.','liquidacoes.json'),
'CT15':('Não executado','Transferência própria/tarifa/ponta em trânsito do caso completo: Etapa 8.','—'),
'CT16':('Não executado','Mútuo e eliminação consolidada do caso completo: Etapa 8.','—'),
'CT17':('Não executado','Reprogramação completa da previsão: Etapa 8; execução não é reescrita pelo ledger.','—'),
'CT18':('Parcialmente coberto','Todos os valores A–F passam em funções puras; loader nativo elimina nota+contrato; persistência da previsão descoberta/AF ainda incompleta.','componentes-casos.json; comparacao-componentes.json; componentes.log'),
'CT19':('Parcialmente coberto','Oráculo completo em função pura: ETC 800.000, EAC 1.250.000, desvio 25%; integração de reestimativa/aditivo persistidos pendente.','componentes-casos.json; comparacao-componentes.json'),
'CT20':('Parcialmente coberto','Período bancário fechado bloqueia liquidação/estorno; duas posições históricas reproduzíveis ainda não entregues.','fundacao/banco-final.json; integracao/integracao.json'),
'CT21':('Parcialmente coberto','Oráculo completo do cálculo puro passa, Q/EAC null; loader marca vínculo ausente. Conciliação documental integral pendente.','componentes-casos.json; comparacao-componentes.json; componentes.log'),
'CT22':('Parcialmente coberto','Crédito antecipado tipado por escopo/contraparte e aplicação controlada existem; adiantamento AR completo do caso não executado.','liquidacoes.json; migração candidata'),
'CT23':('Integralmente aprovado no perímetro isolado','Dois débitos: 10.000 + 6.000; A quitado, B 4.000; repetição sem caixa adicional.','liquidacoes.json; comparacao-integrais.json'),
'CT24':('Parcialmente coberto','RLS entre organizações/entidades/perfis, ledger e proposta IA executada estrangeira bloqueados; cenário completo do consolidado não executado.','fundacao/banco-final.json; integracao/integracao.json; liquidacoes.json'),
'CT25':('Não executado','Substituição da ocorrência de recorrência pela obrigação integral ainda não implementada/testada.','—'),
'CT26':('Integralmente aprovado no perímetro isolado','Paginação completa, falha intermediária e retry passam.','integracao/integracao.json; comparacao-integrais.json'),
'CT27':('Parcialmente coberto','Pagamento sem prova econômica separado do incorrido; execução integral estoque/consumo ainda não testada.','regressao-81.log; lib/cost-vs-budget/server.ts'),
'CT28':('Parcialmente coberto','Componentes isolados de cobertura/adiantamento passam; integração conjunta com retenções e escopo descoberto pendente.','componentes.log; liquidacoes.json'),
'CT29':('Não executado','Disponibilidade/restrições/financiamento contado uma vez: Etapa 8.','—'),
'CT30':('Integralmente aprovado no perímetro isolado','1.200 não liquida silenciosamente 1.000: excesso 200 exige classificação/evidência. Saldo 0, crédito 200, replay 0 mutações.','liquidacoes.json; comparacao-integrais.json'),
}
rows=[dict(id=c['id'],title=c['title'],status=notes[c['id']][0],observed=notes[c['id']][1],evidence=notes[c['id']][2],task_ids=c['task_ids']) for c in fixtures['cases']]
(ROOT/'evidencias/matriz-30.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
text='# Resultado individual dos 30 cenários\n\nIntegral refere-se ao perímetro automatizado isolado indicado. Não é aceite financeiro nominal nem homologação de telas, integrações remotas ou dados reais. Comparador independente preservado; componentes parciais não promovem o caso completo.\n\n| Caso | Situação | Resultado / pendência | Evidência em `evidencias/` |\n|---|---|---|---|\n'
text+='\n'.join(f"| {r['id']} — {r['title']} | {r['status']} | {r['observed']} | {r['evidence']} |" for r in rows)
text+='\n\n**6 integrais no perímetro isolado; 17 parciais; 1 reprovado; 6 não executados. Conjunto não homologado.**\n'
(ROOT/'CENARIOS-30.md').write_text(text)
