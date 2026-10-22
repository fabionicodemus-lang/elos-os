"""Verifica evidências locais; não acessa produção ou serviços remotos."""
from pathlib import Path
import json,subprocess,hashlib,re,datetime
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[3];E=ROOT/'evidencias'
def git(*args):return subprocess.check_output(['git',*args],cwd=REPO,text=True).strip()
def read(name):return json.loads((E/name).read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
code=git('log','-1','--format=%H','--','supabase/migrations/20261022110000_cashflow_versions.sql')
assert code
ancestors=['494c55c','95d659e','3daa96e','5e18d7f']
for ancestor in ancestors:subprocess.run(['git','merge-base','--is-ancestor',ancestor,code],cwd=REPO,check=True)
counts={}
for name,n in [('anteriores/fundacao/banco-final.json',25),('anteriores/integracao/integracao.json',24),('anteriores/liquidacoes.json',16),('banco.json',8)]:
 d=read(name);assert d['passed']==n and d['failed']==0 and d['container_removed'] is True;counts[name]={'passed':n,'failed':0}
for name,n in [('comparacao-integrais.json',11),('comparacao-componentes.json',5)]:
 d=read(name);assert d['passed_count']==n and d['complete'];counts[name]={'passed':n}
for name,n in [('componentes.log',8),('servidor-tela.log',4),('anteriores/componentes.log',12),('anteriores/render.log',1),('regressao-81.log',81)]:
 value=(E/name).read_text();assert re.search(r'(?:#|ℹ) pass '+str(n)+r'\b',value) and re.search(r'(?:#|ℹ) fail 0\b',value);counts[name]={'passed':n,'failed':0}
for log in ['execucoes.json','rechecagem-final.json']:assert all(r['exit_code']==0 for r in read(log))
original_paths=['tests/financeiro/fixtures','docs/financeiro/implementacao-v1/base-validacao','docs/financeiro/implementacao-v1/etapa6-koper','docs/financeiro/implementacao-v1/etapa7-calculos','tests/financeiro/run.mjs','tests/koper-finance','tests/finance-core','supabase/migrations/20261021120000_financial_foundation_guards.sql','supabase/migrations/20261021140000_koper_financial_snapshots.sql','supabase/migrations/20261021160000_financial_settlement_ledger.sql']
assert git('diff','5e18d7f','--',*original_paths)==''
files=git('diff-tree','--no-commit-id','--name-only','-r',code).splitlines()
for f in files:assert git('diff',code,'--',f)==''
fixture=REPO/'tests/financeiro/fixtures/casos_financeiros.json'
assert sha(fixture)=='fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb'
rule=Path('/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx')
rule_hash='30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28'
if rule.exists():assert sha(rule)==rule_hash
assert read('verificacao-quadro.json')['expected_formulas_dependencies_acceptances_unchanged']
states={}
for row in read('matriz-30.json'):states[row['status']]=states.get(row['status'],0)+1
assert len(states)==3 and sorted(states.values())==[1,11,18]
containers=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines()
assert not any(c.startswith('elos-finance-test-') for c in containers)
manifest={'verified_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'branch':git('branch','--show-current'),'implementation_commit':code,'verified_ancestors':ancestors,'prior_stages_expected_and_historical_evidence_unchanged':True,'normative_docx_sha256':rule_hash,'approved_cases_sha256':sha(fixture),'source_files_sha256':{f:sha(REPO/f) for f in files},'evidence_files_sha256':{str(p.relative_to(E)):sha(p) for p in sorted(E.rglob('*')) if p.is_file() and p.name!='verificacao-final.json'},'test_results':counts,'case_coverage':states,'financial_homologation':False,'production_writes_performed':False,'remote_koper_calls_performed':False,'production_statement_basis':'Somente arquivos locais e PostgreSQL Docker descartável --network none; nenhuma migração, implantação ou escrita remota. Não constitui auditoria de servidor remoto.','no_fixture_containers_left_running':True,'legacy_runner_metadata':'Rótulos históricos preservados; implementation_commit e hashes identificam a candidata efetivamente testada.'}
(E/'verificacao-final.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'implementation_commit':code,'test_results':counts,'case_coverage':states},ensure_ascii=False))
