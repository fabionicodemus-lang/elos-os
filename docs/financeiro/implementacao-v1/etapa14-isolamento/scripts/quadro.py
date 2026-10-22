from pathlib import Path
import json,hashlib,openpyxl
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias'
SOURCE=ROOT.parent/'etapa13-segundo-grupo/Elos_OS_Quadro_Etapa13_Segundo_Grupo.xlsx';OUT=ROOT/'Elos_OS_Quadro_Etapa14_Isolamento.xlsx'
old=openpyxl.load_workbook(SOURCE);book=openpyxl.load_workbook(SOURCE);allowed=set()
notes={
 'T05':'Etapa14: isolamento company_id testado com Horizonte/Atlântico e8 usuários;342 verificações e64 pares de permissões conformes. Não encerra entidadesA1/A2 nem matriz nominal real.',
 'T38':'Etapa14: JSON do fluxo certificado no recorte Next/HTTP original; exportações fiscais/XLSX e demais relatórios NÃO CERTIFICADOS.',
 'T41':'Etapa14: ferramenta financeira da IA com consultas PostgREST reais nega perímetro estrangeiro; chat/provedor e outras ferramentas NÃO CERTIFICADOS.',
 'T42':'Etapa14: corrigidas3 RPCs SECURITY DEFINER sem fronteira de empresa;2 comprovadas porHTTP/Auth e1porSQL. Storage bancário validado; outrosbuckets/URLs assinadas vinculadas à sessão e canais restantes pendentes.',
 'T44':'Etapa14:342/342,64/64,8/8 e4/4 nos recortes; regressões preservadas. CT24 segue parcial, sem substituir os inputs/expected originais. Zero aceite formal.',
 'T45':'BLOQUEAR certificação global/liberação multiempresa. Sem produção. Candidatas de autorização aguardam revisão e canais não certificados/decisões descritos em CANAIS.md.'}
for row in book['Acompanhamento']:
 if row[0].value not in notes:continue
 for col,text in [('I','etapa14-isolamento/README.md; CANAIS.md; evidencias/resultado.json; formulas-preservadas.json'),('S',notes[row[0].value])]:
  cell=f'{col}{row[0].row}';prior=book['Acompanhamento'][cell].value;book['Acompanhamento'][cell]=(str(prior)+' | ' if prior else '')+text;allowed.add(('Acompanhamento',cell))
s=book.create_sheet('Etapa14_Permissoes');s.append(['Usuário','Identidade','Empresa','Perfil','Permissão','Esperado própria','Observado própria','Esperado estrangeira','Observado estrangeira','Comparação técnica','Aceite nominal'])
for r in json.loads((E/'matriz-permissoes.json').read_text()):
 a=r['identity'];s.append([a['email'],a['id'],a['company'],a['profile'],r['permission'],r['expected_own'],r['observed_own'],False,r['observed_foreign'],'Conforme' if r['passed'] else 'Reprovado','Pendente — não aprovado pelo executor'])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
s=book.create_sheet('Etapa14_Tentativas');s.append(['Teste','Usuário','ID usuário','Empresa','Perfil','Canal','Registro solicitado','Esperado','Resposta efetiva','Resultado','Evidência','Aceite financeiro'])
for r in json.loads((E/'tentativas.json').read_text()):
 a=r['identity'] or {};s.append([r['id'],a.get('email'),a.get('id'),a.get('company'),a.get('profile'),r['target'].get('channel'),json.dumps(r['target'],ensure_ascii=False),r['expected'],json.dumps(r.get('actual'),ensure_ascii=False),'Conforme' if r['passed'] else 'Reprovado','etapa14-isolamento/evidencias/tentativas.json','Pendente — sem aceite registrado'])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
s=book.create_sheet('Etapa14_Canais');s.append(['Canal','Estado','Critério / limite','Aceite financeiro'])
for line in (ROOT/'CANAIS.md').read_text().splitlines():
 if not line.startswith('|') or line.startswith('|---') or line.startswith('| Canal'):continue
 cells=[c.strip() for c in line.strip('|').split('|')];s.append(cells+['Pendente — responsável a indicar'])
s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
for name in ['Etapa14_Permissoes','Etapa14_Tentativas','Etapa14_Canais']:
 for col in book[name].columns:book[name].column_dimensions[col[0].column_letter].width=45
book.calculation.fullCalcOnLoad=True;book.calculation.forceFullCalc=True;book.save(OUT)
after=openpyxl.load_workbook(OUT);modified=[]
for sh in old:
 for row in sh:
  for c in row:
   if c.value!=after[sh.title][c.coordinate].value:assert (sh.title,c.coordinate) in allowed,(sh.title,c.coordinate);modified.append(f'{sh.title}!{c.coordinate}')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(E/'verificacao-quadro.json').write_text(json.dumps(dict(source_sha256=sha(SOURCE),derived_sha256=sha(OUT),modified_cells=modified,all_30_case_expected_and_actual_cells_unchanged=True,financial_acceptance_formulas_and_task_statuses_unchanged=True,formula_caches_recomputed=False),ensure_ascii=False,indent=2)+'\n')
