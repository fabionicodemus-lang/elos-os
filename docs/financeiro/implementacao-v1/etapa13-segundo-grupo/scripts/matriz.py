"""Preserva expectativas aprovadas e separa comparação numérica de aceite."""
from pathlib import Path
import json,csv,collections,os
ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'evidencias'
source=ROOT.parent/'etapa12-parciais/evidencias/matriz-30.json'
matrix=json.loads(source.read_text())
new={c['id']:c for c in json.loads((E/'casos-obtidos.json').read_text())['cases']}
remaining={c['id']:c for c in json.loads((ROOT.parent/'etapa12-parciais/evidencias/matriz-16.json').read_text())}
notes={
 'CT24':'Recorte SQL/RLS dos três títulos e resposta financeira corrigida. Consulta nativa direta de contrato de A2 ainda retorna uma linha para UA com execution.contracts.view. Auth/PostgREST, detalhes/anexos/storage, cache de sessão e jobs completos não certificados. Definir alcance das permissões de Engenharia antes de restringir globalmente tabelas compartilhadas.',
 'CT21':'Recorte fictício de dashboard/JSON/IA conforme e exceção de vínculo explícita. Testes de canais usam o carregador persistido capturado, sem Auth/PostgREST real; não demonstram snapshot transacional comum sob escrita concorrente. K histórico é explicitamente não suportado e rejeitado na exportação. Falta política operacional D12 para exceções, sem transformar ausência em zero.'
}
def inherited_reference(p):
 # Etapa12 inherited relative links from the Etapa9 evidence context;
 # explicitly qualified Etapa10/12 references use the implementation root.
 candidates=[ROOT.parent/p,ROOT.parent/'etapa9-homologacao/evidencias'/p]
 for candidate in candidates:
  if candidate.is_file():return os.path.relpath(candidate.resolve(),ROOT)
 raise ValueError('Fonte herdada não localizada: '+p)
for r in matrix:
 old=r['classification'];r['stage12_classification']=old
 if old.startswith('Parcial'): state='Parcial';level='Evidência parcial herdada'
 elif old.startswith('Conforme técnico'):state='Conforme apenas por evidência técnica herdada';level=state
 else:state='Conforme por teste independente';level='Teste independente de etapa anterior, preservado'
 if r['id'] in new:
  r['actual']=new[r['id']]['actual'];r['differences']=[];r['numerical_comparison_complete']=True
  r['remaining_evidence']=notes[r['id']];level='Conforme por teste independente no recorte CT21/24; cenário global parcial'
  r['evidence']=['evidencias/comparacao-2.json','evidencias/banco.json','evidencias/registros.json','evidencias/testes-etapa13.log']
 else:
  # Resolve inherited references in their original context, not in this new directory.
  r['evidence']=[inherited_reference(p) for p in r.get('evidence',[])]
 r['classification']=state;r['technical_evidence']=level
 r['financial_acceptance']='Pendente — nenhum aceite formal registrado pelo executor'
 r['executed_as_main_case_stage13']=r['id'] in new
 r['dependencies']=remaining.get(r['id'],{}).get('dependencies',r.get('remaining_evidence',''))
 if r['id']=='CT10':r['dependencies']='Correção 282436d/9c5d016 integrada; regressão dedicada Etapa10, sem reabrir investigação.'
(E/'matriz-30.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n')
cols=['id','title','classification','technical_evidence','financial_acceptance','remaining_evidence','dependencies']
with (E/'matriz-30.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=cols,extrasaction='ignore');w.writeheader();w.writerows(matrix)
lines=['# Situação individual dos 30 cenários — Etapa13','',
 'Nenhum aceite financeiro foi registrado. Testes independentes usam dados fictícios. Comparação numérica conforme não encerra as lacunas de cobertura. CT02/03/18/29 aparecem somente como herança ou regressão.','',
 '| Caso | Situação global | Evidência | Pendência específica |','|---|---|---|---|']
for r in matrix:lines.append('|'+r['id']+' — '+r['title']+'|'+r['classification']+'|'+r['technical_evidence']+'|'+r.get('remaining_evidence','').replace('|',' / ')+'|')
lines+=['','Contagens: '+str(dict(collections.Counter(r['classification'] for r in matrix)))+'.',
 'Bloqueios por fonte/decisão constam nas pendências individuais; não são novos resultados de teste. Não há caso formalmente aceito nesta entrega. Entradas, regras, esperado e obtido de cada caso estão em `evidencias/matriz-30.json`; as expectativas são as originais.']
(ROOT/'MATRIZ-30.md').write_text('\n'.join(lines)+'\n')
