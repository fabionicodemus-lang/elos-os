from pathlib import Path
import hashlib,json,subprocess,re
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidencias';REPO=ROOT.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base=json.loads((E/'base.json').read_text())
for p,h in base['protected_sha256'].items():assert sha(REPO/p)==h,p
assert (REPO/'AGENTS.md').read_bytes()==subprocess.check_output(['git','show','bd6d311:AGENTS.md'],cwd=REPO)
result=json.loads((E/'resultado.json').read_text());assert result['completed'] and result['passed']==342 and result['failed']==0 and result['fatal_error'] is None
tests=json.loads((E/'tentativas.json').read_text());assert len(tests)==342 and all(r['passed'] for r in tests)
perms=json.loads((E/'matriz-permissoes.json').read_text());assert len(perms)==64 and all(r['passed'] for r in perms)
actors=json.loads((E/'ambiente.json').read_text())['actors'];assert {r['identity']['id'] for r in perms}=={a['id'] for a in actors.values()}
for file,count in [('guards.json',8),('ordens-servico.json',4)]:
 j=json.loads((E/file).read_text());assert j['passed']==count and j['failed']==0,file
orders=json.loads((E/'ordens-servico.json').read_text());assert orders['baseline']['foreign_rows_visible_before']==0 and orders['baseline']['unauthorized_after']['authorized_value']==20000
formulas=json.loads((E/'formulas-preservadas.json').read_text());assert all(r['original_sha256']==r['financial_body_after_removing_guard_sha256'] for r in formulas.values())
original=subprocess.check_output(['git','show','bd6d311:lib/finance-core/cashflow.mjs'],cwd=REPO,text=True)
current=(REPO/'lib/finance-core/cashflow.mjs').read_text();stripped=re.sub(r'// Same denial[^\n]*\n// perimeter[^\n]*\nexport function isCashflowScopeError[^\n]*\n','',current)
assert stripped==original,'Calculador financeiro alterado além do classificador de erro'
old=json.loads((ROOT.parent/'etapa13-segundo-grupo/evidencias/matriz-30.json').read_text());new=json.loads((E/'matriz-30.json').read_text())
assert len(new)==30
for a,b in zip(old,new):
 for k in ['id','expected','actual','classification','financial_acceptance']:assert a[k]==b[k],(a['id'],k)
for p in ['execucoes.json','regressao-etapa13/execucoes.json','regressao-etapa13/regressao-etapa12/execucoes.json']:
 assert all(r['exit_code']==0 for r in json.loads((E/p).read_text())),p
r=E/'regressao-etapa13/regressao-etapa12'
for p,count in [('reexecucao/anteriores/fundacao/banco-final.json',25),('reexecucao/anteriores/integracao/integracao.json',24),('reexecucao/anteriores/liquidacoes.json',16),('reexecucao/etapa8/banco.json',8),('reexecucao/etapa9/banco.json',7),('reexecucao/etapa10/banco.json',9),('banco.json',4)]:
 j=json.loads((r/p).read_text());assert j['passed']==count and j['failed']==0,p
for p,count in [('regressao-81.log',81),('npm-test.log',142)]:
 text=(r/p).read_text();assert f'ℹ tests {count}' in text and f'ℹ pass {count}' in text and 'ℹ fail 0' in text,p
manifest=dict(base_commit=base['base_commit'],branch=subprocess.check_output(['git','branch','--show-current'],cwd=REPO,text=True).strip(),code_commit=subprocess.check_output(['git','log','-1','--format=%H','--','supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql'],cwd=REPO,text=True).strip(),
 protected_prior_files_verified=len(base['protected_sha256']),rules_expected_and_prior_evidence_unchanged=True,AGENTS_unchanged=True,financial_core_calculators_unchanged=True,
 HTTP_checks=342,permission_comparisons=64,supplemental_guard_tests=8,work_order_SQL_tests=4,formal_financial_acceptances=0,global_recommendation='BLOQUEAR',production_or_remote_koper_operations=[],
 delivery_files_sha256={str(p.relative_to(ROOT)):sha(p) for p in ROOT.rglob('*') if p.is_file() and p.name!='manifesto-entrega.json' and '__pycache__' not in p.parts})
(E/'manifesto-entrega.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(protected_files=manifest['protected_prior_files_verified'],HTTP=342,permission_comparisons=64,guards=8,OS_SQL=4,core_formulas_unchanged=True,acceptances=0,recommendation='BLOQUEAR'),ensure_ascii=False))
