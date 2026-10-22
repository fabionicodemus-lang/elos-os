"""Verifica entrega, limites e preservação; não concede aceite financeiro."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess,openpyxl
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[3];E=ROOT/'evidencias'
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=REPO,text=True).strip()
base=git('rev-parse','65fe2cc');code=git('rev-parse','f37d21e')
for c in ['494c55c','95d659e','3daa96e','5e18d7f','6ec4f47','c72ec54','6354e59','282436d','65fe2cc',code]:
 subprocess.run(['git','merge-base','--is-ancestor',c,'HEAD'],cwd=REPO,check=True)
allowed={'app/financeiro/fluxo-de-caixa/actions.ts','app/financeiro/fluxo-de-caixa/page.tsx','lib/finance-core/cashflow-server.ts','lib/finance-core/cashflow.d.mts','lib/finance-core/cashflow.mjs','lib/finance-core/ledger-position.mjs','lib/elos-ia/tools.ts','package.json','supabase/migrations/20261024100000_cash_adjustment_realizations.sql'}
changed=git('diff','--name-only',base).splitlines()
assert all(f in allowed or f.startswith(('tests/finance-partials/','docs/financeiro/implementacao-v1/etapa12-parciais/')) for f in changed),changed
assert not git('diff','--name-only',code,'--',*sorted(allowed),'tests/finance-partials')
fixture=REPO/'tests/financeiro/fixtures/casos_financeiros.json'
rules=REPO/'docs/financeiro/implementacao-v1/t01-t02/referencias/Elos_OS_Regras_Financeiras_v0_1.docx'
assert sha(fixture)=='fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb'
assert sha(rules)=='30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28'
matrix=read(E/'matriz-16.json');allcases=read(E/'matriz-30.json');old=read(ROOT.parent/'etapa10-ct10/evidencias/matriz-30.json')
assert len(matrix)==16 and len(allcases)==30
selected={r['id'] for r in matrix if r['selected']};assert selected=={'CT02','CT03','CT18','CT29'}
assert sum(c['classification']=='Parcialmente coberto' for c in allcases)==13
assert next(c for c in allcases if c['id']=='CT29')['classification']=='Parcialmente coberto'
for c in old:
 new=next(r for r in allcases if r['id']==c['id'])
 assert c['expected']==new['expected'] and c['financial_acceptance']==new['financial_acceptance']
 if c['id'] not in selected:assert c==new,c['id']
comparison=read(E/'comparacao-4.json');assert comparison['complete'] and comparison['passed_count']==4
new=read(E/'banco.json');assert new['passed']==4 and new['failed']==0 and new['container_removed']
execs=read(E/'execucoes.json');assert len(execs)==14 and all(r['exit_code']==0 for r in execs)
checks={}
for path,expected in [('reexecucao/anteriores/fundacao/banco-final.json',25),('reexecucao/anteriores/integracao/integracao.json',24),('reexecucao/anteriores/liquidacoes.json',16),('reexecucao/etapa8/banco.json',8),('reexecucao/etapa9/banco.json',7),('reexecucao/etapa10/banco.json',9)]:
 d=read(E/path);assert d['passed']==expected and d['failed']==0,(path,d.get('failed'))
 assert all(r.get('pass',r.get('passed',False)) for r in d.get('checks',d.get('results',[])))
 if 'container_removed' in d:assert d['container_removed']
 checks[path]=expected
for log,n in [('servidor-tela-acoes.log',10),('componentes-anteriores.log',29),('regressao-81.log',81),('npm-test.log',142)]:
 text=(E/log).read_text();assert re.search(rf'ℹ tests {n}\b',text) and re.search(rf'ℹ pass {n}\b',text) and 'ℹ fail 0' in text,log
ct10=read(E/'reexecucao/etapa10/comparacao-ct10.json');assert ct10['complete'] and ct10['passed_count']==1
tracking=read(E/'verificacao-quadro.json');assert tracking['executed_fields']==50 and tracking['stage11_sheet_and_cells_unchanged'] and not tracking['financial_acceptance_recorded']
source=ROOT.parent/'etapa11-reconciliacao/Elos_OS_Quadro_Etapa11_Reconciliacao.xlsx'
original=openpyxl.load_workbook(source);book=openpyxl.load_workbook(ROOT/'Elos_OS_Quadro_Etapa12_Parciais.xlsx')
assert all(row[5].value==book['Acompanhamento'][f'F{row[0].row}'].value for row in original['Acompanhamento'])
for row in original['Testes']:
 for col in ['C','D','E','F','H','I','M','N','O','P','Q']:
  cell=f'{col}{row[0].row}';assert original['Testes'][cell].value==book['Testes'][cell].value
baseline=read(E/'baseline.json');assert baseline['CT18']['actual_Q_scenario_cents']==9900000 and baseline['CT18']['expected_Q_scenario_cents']==9700000
assert baseline['CT02_extension']['actual_visible']==1 and baseline['CT02_extension']['expected_visible_before_first_known_version']==0
assert baseline['CT02_offset']['actual_principal_cents']==1200000
views=read(E/'views.json');assert views['CT29']['projection']['closing_cents']==-3000000
assert views['CT29']['baseline']['closing_cents']==-5000000 and not views['CT29']['baseline']['complete']
assert 'Referência original parcial' in (E/'tela-ct29.html').read_text()
for path in ROOT.glob('*.md'):
 for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if not target.startswith(('http','mailto:')):assert (path.parent/target.split('#')[0]).exists(),(path,target)
stage11=REPO/'docs/financeiro/implementacao-v1/etapa11-reconciliacao'
protected={str(p.relative_to(REPO)):sha(p) for p in stage11.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
for name,digest in protected.items():assert hashlib.sha256(subprocess.check_output(['git','show',base+':'+name],cwd=REPO)).hexdigest()==digest
artifacts={str(p.relative_to(ROOT)):sha(p) for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='manifesto-entrega.json'}
codefiles={p:sha(REPO/p) for p in sorted(allowed)}
codefiles.update({str(p.relative_to(REPO)):sha(p) for p in (REPO/'tests/finance-partials').glob('*.mjs')})
manifest=dict(verified_at_utc=datetime.now(timezone.utc).isoformat(),repository='fabionicodemus-lang/elos-os',branch=git('branch','--show-current'),base_commit=base,implementation_commit=code,
 normative_rules_sha256=sha(rules),approved_30_cases_sha256=sha(fixture),selected_cases=sorted(selected),
 independent_numeric_comparison_passed=4,isolated_conformity_new_cases=['CT02','CT03','CT18'],CT29_remains_partial=True,remaining_partial_cases=13,
 test_counts=dict(new_database_chains=4,new_actions_SSR_AI=10,prior_components_SSR=29,prior_regressions=81,general_suite=142,prior_database_checks=checks),
 all_commands_exit_zero=True,final_targeted_rechecks=['node --test tests/finance-partials/server.test.mjs tests/finance-partials/actions.test.mjs','npx tsc --noEmit','npx eslint — arquivos alterados e testes do lote'],
 known_limits=['Scaffolds mínimos não certificam esquema remoto integral','Auth/PostgREST/browser/storage/cache/jobs integrais não certificados','CT29 original anterior ao vínculo permanece parcial; corrente conforme','Dados reais/aceites/decisões operacionais ausentes; nunca substituídos por zero','AF parcial/AR/legado sem vínculo/estorno de encargo fora deste recorte'],
 stage11_preserved=True,other_26_cases_unchanged=True,prior_audits_tests_expected_and_rules_preserved=True,
 production_modified=False,koper_modified=False,remote_financial_connections=False,production_migrations_or_deploy=False,financial_acceptance_recorded=False,
 source_code_sha256=codefiles,protected_stage11_sha256=protected,artifact_sha256=artifacts)
(E/'manifesto-entrega.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(selected_numeric_passed=4,new_isolated_conformity=3,partial_remaining=13,CT29='parcial',other_26_preserved=True,stage11_preserved=True,financial_acceptance_recorded=False),ensure_ascii=False))
