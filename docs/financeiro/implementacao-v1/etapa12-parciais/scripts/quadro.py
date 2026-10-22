"""Atualiza execução técnica dos quatro casos; preserva expected, fórmulas e aceites."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib,json,re,openpyxl
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias'
SOURCE=ROOT.parent/'etapa11-reconciliacao/Elos_OS_Quadro_Etapa11_Reconciliacao.xlsx'
OUT=ROOT/'Elos_OS_Quadro_Etapa12_Parciais.xlsx'
old=openpyxl.load_workbook(SOURCE);book=openpyxl.load_workbook(SOURCE);allowed=set()
matrix=json.loads((E/'matriz-16.json').read_text());actual={r['id']:r['actual'] for r in matrix if r['selected']}
when=datetime.fromisoformat(json.loads((E/'casos-obtidos.json').read_text())['execution_context']['executed_at']).astimezone(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
def put(sh,cell,value):book[sh][cell]=value;allowed.add((sh,cell))
def field(value,path):
 for part in path.split('.'):
  m=re.fullmatch(r'([^\[]+)\[([^\]]+)\]',part)
  if m:value=next(row for row in value[m[1]] if row['stage']==m[2])
  else:value=value[part]
 return value
count=0
for row in book['Testes']:
 if row[0].value not in actual:continue
 n=row[0].row;value=field(actual[row[0].value],row[1].value)
 for col,v in [('G',value),('J','etapa12-parciais/evidencias/comparacao-4.json; banco.json; registros.json; servidor-tela-acoes.log — fictício, sem aceite financeiro'),('K','Codex — execução automatizada isolada; não responsável financeiro'),('L',when)]:put('Testes',f'{col}{n}',v)
 count+=1
notes={
'T07':'CT02 SQL/aplicação concordam nos três cortesT/K; timestamps equivalentes e pré-criação protegidos. Demais competências/cortes reais pendentes.',
'T08':'CT02 reimportação e aprovação fictícia preservam duas versões e autoria/motivo; estornos/fechamento econômico ainda têm outras pendências.',
'T10':'CT02 uma identidade, revisão10.000→12.000 e replay sem versão extra. Não é certificação da integração remota.',
'T18':'CT03 dois pagamentos3.000/2.000, aberto7.000/5.000, custo reconhecido10.000 preservado e zero custo adicional.',
'T19':'CT03 extrato independente e reimportação conservam5.000 de caixa, duas saídas, zero novo caixa por conciliar.',
'T26':'CT18 cadeia P/C/R persistida sem sobrepor AF e encargo; CT05/CT06/CT28 e demais vínculos continuam pendentes.',
'T30':'CT18 A–F conforme, Q95.000+AF2.000 migra paraQ97.000 semAF; quadro não certificaQ real completo.',
'T39':'CT29 disponível100.000, finais40.000/−30.000, necessidade50.000; amortização uma vez; origem real e aceite pendentes.',
'T41':'CT29 IA recebe entidade autorizada e retorna a projeção do mesmo carregador/tela. Não homologa todos os indicadores/canais deCT21/24.',
'T44':'Etapa12: CT02/03/18 conformes no recorte isolado; CT29 corrente conforme, referência original parcial.13 parciais permanecem, incluindo CT29. Nenhum aceite financeiro ou homologação global.',
'T45':'Bloqueada: sem deploy/produção. Quatro recortes isolados aptos à revisão, não à liberação financeira real. Pendências anteriores preservadas.',
}
for row in book['Acompanhamento']:
 if row[0].value not in notes:continue
 n=row[0].row
 for col,addition in [('I','etapa12-parciais/README.md; MATRIZ-16.md; evidencias/comparacao-4.json; execucoes.json'),('S','Etapa12: '+notes[row[0].value])]:
  prior=book['Acompanhamento'][f'{col}{n}'].value
  put('Acompanhamento',f'{col}{n}',(prior+' | ' if prior else '')+addition)

s=book.create_sheet('Etapa12_16')
s.append(['Caso','Prioridade','Classes','Selecionado','Estado técnico','Causa demonstrada','Dependências','Esforço técnico estimado','Critério objetivo','Evidência','Aceite financeiro'])
for r in matrix:s.append([r['id'],r['priority'],'/'.join(r['classes']),'Sim' if r['selected'] else 'Não',r['status'],r['demonstrated_cause'],r['dependencies'],r['effort'],r['objective_completion_criterion'],'etapa12-parciais/MATRIZ-16.md; evidencias/matriz-16.json',r['financial_acceptance']])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
for col in ['E','F','G','I','J','K']:s.column_dimensions[col].width=65
s=book.create_sheet('Etapa12_4_Resultados');s.append(['Caso','Campo','Esperado independente','Obtido','Evidência','Aceite financeiro'])
for row in book['Testes']:
 if row[0].value in actual:s.append([row[0].value,row[1].value,row[5].value,row[6].value,'etapa12-parciais/evidencias/comparacao-4.json','Pendente — não preenchido pelo executor'])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions;s.column_dimensions['B'].width=65;s.column_dimensions['E'].width=65;s.column_dimensions['F'].width=55
book.calculation.fullCalcOnLoad=True;book.calculation.forceFullCalc=True;book.save(OUT)
after=openpyxl.load_workbook(OUT);changed=[]
for sh in old:
 for row in sh:
  for c in row:
   if c.value!=after[sh.title][c.coordinate].value:
    assert (sh.title,c.coordinate) in allowed,(sh.title,c.coordinate)
    changed.append(f'{sh.title}!{c.coordinate}')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(E/'verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_existing_cells=changed,executed_fields=count,
 expected_formulas_dependencies_and_task_statuses_unchanged=True,financial_acceptance_recorded=False,
 other_26_cases_unchanged=True,stage11_sheet_and_cells_unchanged=True,formula_caches_recomputed=False),ensure_ascii=False,indent=2)+'\n')
print(f'{count} campos executados; expected, fórmulas,26 casos, Etapa11 e aceites preservados.')
