"""Atualiza somente o CT10 e notas das tarefas afetadas, sem preencher aceites."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json,hashlib,openpyxl
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias';SOURCE=ROOT.parent/'etapa9-homologacao/Elos_OS_Quadro_Etapa9_Homologacao.xlsx';OUT=ROOT/'Elos_OS_Quadro_Etapa10_CT10.xlsx'
w=openpyxl.load_workbook(SOURCE);old=openpyxl.load_workbook(SOURCE);allowed=set();d=json.loads((E/'banco.json').read_text());actual=d['states']['CT10'];when=datetime.fromisoformat(d['execution_context']['executed_at'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Sao_Paulo')).replace(tzinfo=None)
def put(sheet,cell,val):w[sheet][cell]=val;allowed.add((sheet,cell))
notes={
'T20':('Em validação','CT10: adiantamento integral pago é convertido em direito, não fica disponível para nova aplicação. Histórico/AP/banco preservados; demais cenários de adiantamento permanecem com pendências anteriores.'),
'T24':('Em validação','CT10 corrigido e conforme ao oráculo isolado: bruto10.000, restituição6.000, líquido4.000, direito4.000, custo/obrigação/reabertura0. Outros cancelamentos e aceite financeiro nominal pendentes.'),
'T33':('Em andamento','CT10 agora passa no caminho de restituição de fornecedor, sem venda fictícia/receita/AP reaberto. CT21/22 e demais pendências da tarefa continuam abertas.'),
'T44':('Em andamento','CT10 conforme no banco/núcleo/tela isolados; outros29 estados da Etapa9 preservados. Não há homologação financeira global, conciliação real ou aceite nominal.'),
'T45':('Bloqueada','Nenhuma implantação autorizada. CT10 tecnicamente corrigido não resolve os16 parciais, fontes/cortes reais, parâmetros e aceites anteriores.'),
}
for row in w['Acompanhamento']:
 if row[0].value not in notes:continue
 state,note=notes[row[0].value];n=row[0].row
 for col,val in [('F',state),('I','etapa10-ct10/README.md; evidencias/comparacao-ct10.json; evidencias/execucoes.json'),('S',note)]:put('Acompanhamento',f'{col}{n}',val)
count=0
for row in w['Testes']:
 if row[0].value!='CT10':continue
 value=actual
 for part in row[1].value.split('.'):value=value[part]
 for col,val in [('G',value),('J','etapa10-ct10/evidencias/comparacao-ct10.json; banco.json; registros-ct10.json — massa fictícia; sem aceite financeiro'),('K','Codex — execução automatizada isolada, não responsável financeiro'),('L',when)]:put('Testes',f'{col}{row[0].row}',val)
 count+=1
matrix=json.loads((ROOT.parent/'etapa9-homologacao/evidencias/matriz-30.json').read_text());r=next(r for r in matrix if r['id']=='CT10');previous=r['classification'];r.update(classification='Conforme no cenário isolado — pendente aceite',actual=actual,observed='Bruto10.000, restituição6.000, líquido4.000, direito aberto4.000; custo/obrigação contratual/reabertura0. Sem receita operacional. Direitos e recebimentos imutáveis; oráculo original preservado.',remaining_evidence='Aceite nominal, equivalência do esquema remoto e documentos reais; outros16 parciais da Etapa9 preservados. Cancelamentos fora de escopo integral antes da execução não foram antecipados.',evidence=['etapa10-ct10/evidencias/banco.json','etapa10-ct10/evidencias/comparacao-ct10.json','etapa10-ct10/evidencias/servidor-tela.log'],numerical_comparison_complete=True,differences=[],stage9_classification=previous)
(E/'matriz-30.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n')
s=w.create_sheet('Etapa10_CT10');s.append(['Caso','Estado anterior','Estado atual','Saída bruta','Restituído','Líquido','Direito aberto','Custo','Obrigação contratual','AP reaberto','Evidência','Aceite financeiro']);s.append(['CT10',previous,r['classification'],actual['historical_gross_outflow_cents']/100,actual['confirmed_refund_cents']/100,actual['net_outflow_cents']/100,actual['refund_right_after_receipt_cents']/100,actual['cost_cents']/100,actual['after_cancellation_C_cents']/100,json.loads((E/'registros-ct10.json').read_text())['payables'][0]['finance_open_amount'],'etapa10-ct10/evidencias/comparacao-ct10.json; banco.json','Pendente — não preenchido pelo executor']);s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
for col in ['B','C','K','L']:s.column_dimensions[col].width=65
w.calculation.fullCalcOnLoad=True;w.calculation.forceFullCalc=True;w.save(OUT);after=openpyxl.load_workbook(OUT);changed=[];same=0
for sh in old:
 for row in sh:
  for c in row:
   if c.value!=after[sh.title][c.coordinate].value:assert (sh.title,c.coordinate) in allowed;changed.append(f'{sh.title}!{c.coordinate}')
   else:same+=1
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();(E/'verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_existing_cells=changed,unchanged_cells=same,executed_CT10_rows=count,expected_formulas_acceptances_dependencies_unchanged=True,other_29_classifications_unchanged=True,financial_acceptance_recorded=False,formula_caches_recomputed=False),ensure_ascii=False,indent=2)+'\n');print(f'CT10: {count} campos numéricos atualizados; outros29 estados e aceites preservados.')
