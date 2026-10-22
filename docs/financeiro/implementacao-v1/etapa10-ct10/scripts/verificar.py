"""Verifica artefatos locais, preservação do plano e perímetro; não acessa produção."""
from pathlib import Path
import json,subprocess,hashlib,re,datetime
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[3];E=ROOT/'evidencias'
def git(*a):return subprocess.check_output(['git',*a],cwd=REPO,text=True).strip()
def read(n):return json.loads((E/n).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
code=git('log','-1','--format=%H','--','supabase/migrations/20261023100000_supplier_advance_refunds.sql');assert code
ancestors=['494c55c','95d659e','3daa96e','5e18d7f','6ec4f47','c72ec54','a7a2b13','6354e59']
for a in ancestors:subprocess.run(['git','merge-base','--is-ancestor',a,code],cwd=REPO,check=True)
original=['tests/financeiro','tests/koper-finance','tests/finance-core','tests/cashflow','tests/financial-acceptance','docs/financeiro/implementacao-v1/base-validacao','docs/financeiro/implementacao-v1/etapa6-koper','docs/financeiro/implementacao-v1/etapa7-calculos','docs/financeiro/implementacao-v1/etapa8-fluxo','docs/financeiro/implementacao-v1/etapa9-homologacao']
assert git('diff','6354e59','--',*original)==''
old_migrations=git('ls-tree','-r','--name-only','6354e59','supabase/migrations').splitlines()
assert git('diff','6354e59','--',*old_migrations)==''
fixture=REPO/'tests/financeiro/fixtures/casos_financeiros.json';assert sha(fixture)=='fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb'
rule=Path('/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx');assert sha(rule)=='30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28'
for f in ['execucoes.json','rechecagem.json']:assert all(r['exit_code']==0 for r in read(f))
counts={}
for f,n in [('banco.json',9),('etapa8/anteriores/fundacao/banco-final.json',25),('etapa8/anteriores/integracao/integracao.json',24),('etapa8/anteriores/liquidacoes.json',16),('etapa8/banco.json',8),('etapa9/banco.json',7)]:
 d=read(f);assert d['passed']==n and d['failed']==0 and d['container_removed'];counts[f]={'passed':n,'failed':0}
for f,n in [('servidor-tela.log',4),('etapa8/componentes.log',8),('etapa8/servidor-tela.log',4),('etapa8/anteriores/componentes.log',12),('etapa8/anteriores/render.log',1),('regressao-81.log',81)]:
 s=(E/f).read_text();assert re.search(r'(?:#|ℹ) pass '+str(n)+r'\b',s) and re.search(r'(?:#|ℹ) fail 0\b',s);counts[f]={'passed':n,'failed':0}
for f,n in [('comparacao-ct10.json',1),('etapa9/comparacao-integrais.json',3),('etapa9/comparacao-componentes.json',2)]:assert read(f)['passed_count']==n and read(f)['complete']
assert read('baseline/comparacao-ct10.json')['passed_count']==0 and not read('baseline/comparacao-ct10.json')['complete']
ct=read('banco.json')['states']['CT10'];norm=next(r for r in json.loads(fixture.read_text())['cases'] if r['id']=='CT10');assert ct==norm['expected']
raw=read('registros-ct10.json');assert len(raw['payables'])==1 and raw['payables'][0]['status']=='paid' and raw['payables'][0]['finance_open_amount']==0
assert len(raw['events'])==1 and raw['events'][0]['kind']=='payment' and len(raw['movements'])==2
assert len(raw['rights'])==1 and len(raw['receipts'])==1 and raw['rights'][0]['amount']==10000 and raw['receipts'][0]['amount']==6000
assert raw['rights'][0]['created_by'] and raw['receipts'][0]['created_by'] and raw['rights'][0]['contract_before']['current_value']==10000
assert raw['p']['open_cents']==400000 and raw['p']['operational_revenue_cents']==0 and raw['p']['economic_cost_cents']==0
old={r['id']:r for r in json.loads((ROOT.parent/'etapa9-homologacao/evidencias/matriz-30.json').read_text())};new={r['id']:r for r in read('matriz-30.json')};assert set(old)==set(new)
for k in old:
 if k!='CT10':assert old[k]==new[k]
 assert old[k]['expected']==new[k]['expected'] and old[k]['inputs']==new[k]['inputs']
assert read('verificacao-quadro.json')['expected_formulas_acceptances_dependencies_unchanged']
containers=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines();assert not any(c.startswith('elos-finance-test-') for c in containers)
files=git('diff-tree','--no-commit-id','--name-only','-r',code).splitlines()
for f in files:assert git('diff',code,'--',f)==''
manifest={'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'branch':git('branch','--show-current'),'implementation_commit':code,'operational_base_commit':git('rev-parse','6354e59'),'ancestors_verified':ancestors,'original_rules_fixtures_tests_migrations_historical_evidence_preserved':True,'rule_sha256':sha(rule),'fixture_sha256':sha(fixture),'CT10_expected':norm['expected'],'CT10_actual':ct,'CT10_integral_in_isolated_perimeter':True,'CT10_original_title_and_payment_preserved':True,'other_29_case_states_unchanged':True,'financial_acceptance_recorded':False,'complete_financial_homologation':False,'test_results':counts,'production_writes_performed':False,'remote_koper_calls_performed':False,'no_test_containers_left':True,'source_files_sha256':{f:sha(REPO/f) for f in files},'evidence_files_sha256':{str(p.relative_to(E)):sha(p) for p in sorted(E.rglob('*')) if p.is_file() and p.name!='verificacao-final.json'},'scope_limits':'PostgreSQL descartável sem rede, engenharia parcialmente scaffolded, SSR com transporte/Auth simulados. Não constitui conciliação documental real, auditoria de servidor remoto ou aceite humano.'}
(E/'verificacao-final.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'commit':code,'CT10_actual':ct,'financial_acceptance_recorded':False,'production_writes_performed':False},ensure_ascii=False))
