"""Cópia derivada; preserva esperados, fórmulas, dependências e aceites originais."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib,json,openpyxl
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'etapa6-koper/Elos_OS_Quadro_Etapa6_Koper.xlsx'
OUT=ROOT/'Elos_OS_Quadro_Etapa7_Calculos.xlsx'
w=openpyxl.load_workbook(SOURCE); old=openpyxl.load_workbook(SOURCE); allowed=set()
notes={
'T15':('Em andamento','CT12 integral reprovado: 4.000 sem obra preservados, pagamento de 2.000 bloqueado, posição declarada 10.000 em vez de 8.000. Sem fallback. Resolver com política D01 e título operacional da entidade.'),
'T16':('Em andamento','Livro liga título/evento/banco; vínculo nativo nota–contrato elimina duplicação local. Cadeia documental universal e retenções ainda pendentes.'),
'T17':('Em andamento','Centavos/rateio parcial/resíduo e devolução agrupada preservados. Multiobra integral e D05 real pendentes.'),
'T18':('Em validação','CT07 corrigido no núcleo e tela AP: 100.000−30.000=70.000; depois zero. Oráculo juros/desconto, replay, excesso e concorrência passam. Falta aceite nominal e interfaces integrais.'),
'T19':('Em andamento','Comando/evento evita segundo caixa; conciliação posterior documental/extrato do CT03 integral ainda pendente.'),
'T20':('Em andamento','Adiantamento AP tipado, aplicação sem segundo caixa e estorno testados; execução econômica integral CT05 pendente.'),
'T21':('Em andamento','Não converter retenção em desconto; desdobramento bruto/líquido/tributo e CT06 integral pendentes.'),
'T22':('Em andamento','Nota/medição não duplicam contrato; pagamento sem prova econômica separado do incorrido. CT09/27 integrais pendentes.'),
'T23':('Em validação','CT08 A/B/C passam no banco isolado; reversão imutável, devolução comprovada separada e desconto explícito. Sem aceite nominal/real.'),
'T24':('Em andamento','Cancelamento inseguro de título movimentado bloqueado; cancelamento econômico integral CT10 não executado.'),
'T25':('Em andamento','Núcleo puro distingue aditivo aprovado de proposta; ciclo persistido/escopo e aceite CT19 integral pendentes.'),
'T26':('Em andamento','C=V−H−N−Rv; CT18 puro e vínculo nativo passam. Cobertura universal incompleta fica null/pendência.'),
'T27':('Em andamento','Orçamento não é usado para inventar ETC/EAC; versionamento e aceite integral do orçamento pendentes.'),
'T28':('Em andamento','CT19 puro ETC/EAC independente passa. Persistência da reestimativa econômica/financeira integral pendente.'),
'T30':('Em andamento','financialIndicators publica R/C e incompletude de P/Q/EAC; CT18 puro A–F e CT21 passam. Composição publicada universalmente e previsões aprovadas pendentes.'),
'T31':('Em andamento','Identidade AR existente preservada, projeção residual compartilhada. CT13/22 integrais pendentes.'),
'T32':('Em validação','Parcial AR e tarifa passam: 10.000 direito, caixa 9.800. Sem conciliação real/aceite financeiro.'),
'T33':('Em andamento','Baixa sem caixa/crédito exigem tipo/evidência/escopo. CT14 permuta e CT22 completos pendentes.'),
'T34':('Em andamento','Coorte pura 20.000/6.000=30% passa; publicação e recebíveis futuros integrais pendentes.'),
'T37':('Em andamento','Bloqueio de período bancário preservado; cortes T/K e duas posições históricas do CT20 não entregues.'),
'T38':('Em andamento','Dados ausentes não viram total certificado; caixa sem devolução fica pendente. Qualidade integral por todos os indicadores pendente.'),
'T40':('Em andamento','AP/AR/comercial/dashboard/relatórios/agenda usam núcleo; exportação fiscal mantém fonte documental. Conciliação fiscal e E2E pendentes.'),
'T41':('Em andamento','IA usa saldos/eventos comuns; proposta UUID, replay e negação de resultado estrangeiro testados. Consultas remotas e aceite integral pendentes.'),
'T42':('Em andamento','RLS/perfis/entidade/IA e regressões repetidos. Auth/cache/exportações/jobs reais ainda não certificados.'),
'T44':('Em andamento','6 integrais isolados, 17 parciais, CT12 reprovado, 6 não executados. Conjunto NÃO homologado; nenhum aceite nominal preenchido.'),
}
def put(sheet,cell,val):w[sheet][cell]=val;allowed.add((sheet,cell))
for row in w['Acompanhamento']:
 if row[0].value in notes:
  state,note=notes[row[0].value];n=row[0].row
  for col,val in [('F',state),('I','etapa7-calculos/README.md; CENARIOS-30.md; evidencias/execucoes.json; evidencias/liquidacoes.json'),('S',note)]:put('Acompanhamento',f'{col}{n}',val)
model=json.loads((ROOT/'evidencias/casos-obtidos.json').read_text())
actual={c['id']:c['actual'] for c in model['cases'] if c['status']=='executado'}
assert set(actual)=={'CT01','CT07','CT08','CT23','CT26','CT30'}
when=datetime.fromisoformat(model['execution_context']['executed_at'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
checked=0
for row in w['Testes']:
 if row[0].value not in actual:continue
 value=actual[row[0].value]
 for part in row[1].value.split('.'):value=value[part]
 if value is None:value='null'
 elif row[1].value.endswith('_percent'):value=float(value)
 for col,val in [('G',value),('J','etapa7-calculos/evidencias/comparacao-integrais.json; liquidacoes.json; integracao/integracao.json — isolamento, sem aceite financeiro'),('K','Codex — execução automatizada isolada'),('L',when)]:put('Testes',f'{col}{row[0].row}',val)
 checked+=1
sheet=w.create_sheet('Etapa7_Cobertura');sheet.append(['Caso','Título','Situação','Observado / pendência','Evidência','Aceite financeiro'])
for r in json.loads((ROOT/'evidencias/matriz-30.json').read_text()):sheet.append([r['id'],r['title'],r['status'],r['observed'],r['evidence'],'Pendente — não preenchido pelo executor'])
sheet.freeze_panes='A2';sheet.auto_filter.ref=sheet.dimensions
for col,width in [('A',10),('B',65),('C',40),('D',110),('E',65),('F',45)]:sheet.column_dimensions[col].width=width
w.calculation.fullCalcOnLoad=True;w.calculation.forceFullCalc=True;w.save(OUT)
after=openpyxl.load_workbook(OUT);changes=[];same=0
for sheet in old:
 for row in sheet:
  for c in row:
   if c.value!=after[sheet.title][c.coordinate].value:
    assert (sheet.title,c.coordinate) in allowed;changes.append(f'{sheet.title}!{c.coordinate}')
   else:same+=1
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(ROOT/'evidencias/verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_existing_cells=changes,unchanged_existing_cells_checked=same,executed_test_rows=checked,expected_formulas_dependencies_acceptances_unchanged=True,added_sheet='Etapa7_Cobertura',formula_values_recomputed=False,execution_timezone='America/Sao_Paulo'),ensure_ascii=False,indent=2)+'\n')
print(f'{checked} linhas de resultado; {len(changes)} células originais alteradas; aceites e esperados preservados.')
