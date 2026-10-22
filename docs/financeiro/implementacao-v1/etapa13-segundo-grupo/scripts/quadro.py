"""Copia o quadro anterior sem modificar esperados, fórmulas ou aceites."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json,hashlib,openpyxl
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias'
SOURCE=ROOT.parent/'etapa12-parciais/Elos_OS_Quadro_Etapa12_Parciais.xlsx'
OUT=ROOT/'Elos_OS_Quadro_Etapa13_Segundo_Grupo.xlsx'
old=openpyxl.load_workbook(SOURCE);book=openpyxl.load_workbook(SOURCE);allowed=set()
matrix=json.loads((E/'matriz-30.json').read_text());actual={r['id']:r['actual'] for r in matrix if r['executed_as_main_case_stage13']}
when=datetime.fromisoformat(json.loads((E/'casos-obtidos.json').read_text())['execution_context']['executed_at']).astimezone(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
def put(sheet,cell,value):book[sheet][cell]=value;allowed.add((sheet,cell))
for row in book['Testes']:
 if row[0].value not in actual:continue
 n=row[0].row;value=actual[row[0].value][row[1].value]
 for col,v in [('G',value),('J','etapa13-segundo-grupo/evidencias/comparacao-2.json; banco.json; testes-etapa13.log — recorte fictício; cenário global parcial'),('K','Codex — teste automatizado isolado, sem autoridade para aceite financeiro'),('L',when)]:put('Testes',f'{col}{n}',v)
notes={
 'T05':'CT24 mantém três títulos e autorizações UA/UB/UR/UG; resposta de contratos do fluxo aplica entidade autorizada. Leitura nativa de Engenharia, Auth, storage e demais canais ainda pendentes.',
 'T30':'CT21 sinaliza ausência de vínculo no núcleo; R140.000 e compromisso840.000 separados; Q/EAC não certificados, sem ajuste artificial.',
 'T38':'CT21 dashboard e exportação JSON readonly recebem os mesmos indicadores centrais; snapshot comum sob concorrência e K histórico não certificados.',
 'T40':'CT21 retorno conserva null e fonte; nenhuma exceção operacional D12 foi liberada.',
 'T41':'CT21/24 ferramenta real da IA e exportação usam a mesma posição capturada do carregador SQL/RLS. Sem certificado de todos os canais Auth/PostgREST.',
 'T42':'CT24 SQL nega mutações UR/UA fora de entidade/organização. Persistem lacunas transversais de autorização da fonte nativa compartilhada.',
 'T44':'Dois recortes numéricos conformes, ambos continuam parciais. Quadro individual:13 parciais,7 conformes por teste independente anterior,10 apenas por evidência técnica herdada; zero aceite formal.',
 'T45':'Sem deploy ou alteração de produção. Não há homologação financeira global; demais pendências preservadas.'}
for row in book['Acompanhamento']:
 if row[0].value not in notes:continue
 n=row[0].row
 for col,addition in [('I','etapa13-segundo-grupo/README.md; MATRIZ-30.md; evidencias/comparacao-2.json; execucoes.json'),('S','Etapa13: '+notes[row[0].value])]:
  previous=book['Acompanhamento'][f'{col}{n}'].value
  put('Acompanhamento',f'{col}{n}',(str(previous)+' | ' if previous else '')+addition)
s=book.create_sheet('Etapa13_30');s.append(['Caso','Título','Situação global','Evidência técnica','Expectativa independente','Obtido','Pendência','Dependências','Evidências','Aceite financeiro'])
for r in matrix:s.append([r['id'],r['title'],r['classification'],r['technical_evidence'],json.dumps(r['expected'],ensure_ascii=False),json.dumps(r['actual'],ensure_ascii=False),r.get('remaining_evidence'),r['dependencies'],'; '.join(r['evidence']),r['financial_acceptance']])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
for col in 'BCDEFGHIJ':s.column_dimensions[col].width=60
s=book.create_sheet('Etapa13_2_Resultados');s.append(['Caso','Campo','Esperado independente','Obtido','Cobertura','Aceite financeiro'])
for r in matrix:
 if not r['executed_as_main_case_stage13']:continue
 for k,v in r['expected'].items():s.append([r['id'],k,v,r['actual'][k],'Comparação numérica conforme; cenário global parcial','Pendente — não assinado pelo executor'])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
book.calculation.fullCalcOnLoad=True;book.calculation.forceFullCalc=True;book.save(OUT)
after=openpyxl.load_workbook(OUT);changed=[]
for sh in old:
 for row in sh:
  for c in row:
   if c.value!=after[sh.title][c.coordinate].value:
    assert (sh.title,c.coordinate) in allowed,(sh.title,c.coordinate)
    changed.append(f'{sh.title}!{c.coordinate}')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(E/'verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_existing_cells=changed,expected_formulas_task_statuses_and_financial_acceptance_unchanged=True,other_28_test_cases_unchanged=True,prior_sheets_unchanged_except_explicit_tracking_cells=True,formula_caches_recomputed=False,financial_acceptance_recorded=False),ensure_ascii=False,indent=2)+'\n')
