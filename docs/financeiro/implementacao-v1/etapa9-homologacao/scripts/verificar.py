"""Conferência local da entrega; nenhum acesso remoto ou alteração de dados."""
from pathlib import Path
import subprocess,hashlib,json,re,datetime,collections
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[3];E=ROOT/'evidencias'
def git(*a):return subprocess.check_output(['git',*a],cwd=REPO,text=True).strip()
def read(n):return json.loads((E/n).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
code=git('log','-1','--format=%H','--','tests/financial-acceptance/database.mjs');assert code
ancestors=['494c55c','95d659e','3daa96e','5e18d7f','6ec4f47','c72ec54']
for a in ancestors:subprocess.run(['git','merge-base','--is-ancestor',a,code],cwd=REPO,check=True)
untouched=['app','lib','supabase','tests/financeiro','tests/koper-finance','tests/finance-core','tests/cashflow','docs/financeiro/implementacao-v1/etapa8-fluxo','docs/financeiro/implementacao-v1/etapa7-calculos','docs/financeiro/implementacao-v1/etapa6-koper','docs/financeiro/implementacao-v1/base-validacao']
assert git('diff','c72ec54','--',*untouched)==''
fixture=REPO/'tests/financeiro/fixtures/casos_financeiros.json';assert sha(fixture)=='fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb'
rule=Path('/workspace/financial-plan-input/Elos_OS_Pacote_Codex_Financeiro_v1/regras/Elos_OS_Regras_Financeiras_v0_1.docx');assert sha(rule)=='30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28'
results={}
for n,count in [('reexecucao/anteriores/fundacao/banco-final.json',25),('reexecucao/anteriores/integracao/integracao.json',24),('reexecucao/anteriores/liquidacoes.json',16),('reexecucao/banco.json',8),('banco.json',7)]:
 d=read(n);assert d['passed']==count and d['failed']==0 and d['container_removed'];results[n]={'observations_passed':count}
for n,count in [('reexecucao/componentes.log',8),('reexecucao/servidor-tela.log',4),('reexecucao/anteriores/componentes.log',12),('reexecucao/anteriores/render.log',1),('reexecucao/regressao-81.log',81)]:
 s=(E/n).read_text();assert re.search(r'(?:#|ℹ) pass '+str(count)+r'\b',s) and re.search(r'(?:#|ℹ) fail 0\b',s);results[n]={'passed':count}
assert all(r['exit_code']==0 for r in read('reexecucao/execucoes.json'))
for n,count in [('comparacao-novos-integrais.json',3),('comparacao-componentes-adicionais.json',2),('reexecucao/comparacao-integrais.json',11),('reexecucao/comparacao-componentes.json',5)]:assert read(n)['passed_count']==count and read(n)['complete']
strict=read('comparacao-30.json');assert strict['passed_count']==20 and strict['selected_count']==30 and strict['complete'] is False
assert {r['id'] for r in strict['cases'] if r['status']=='não_executado'}=={'CT05','CT09','CT20','CT24','CT27','CT28'}
assert {r['log'] for r in read('execucoes.json') if r['exit_code']!=0}=={'comparacao-lacunas.log','comparacao-30.log'}
assert all(r['exit_code'] in (0,1) for r in read('execucoes.json'))
m=read('matriz-30.json');original={r['id']:r for r in json.loads(fixture.read_text())['cases']}
for r in m:assert r['expected']==original[r['id']]['expected'] and r['inputs']==original[r['id']]['inputs'] and r['financial_acceptance'].startswith('Pendente')
coverage=dict(collections.Counter(r['classification'] for r in m));assert sorted(coverage.values())==[1,3,10,16]
bridge=read('ponte.json');assert len(bridge)==9
for b in bridge:
 assert b['bank_delta_cents']==0 and b['statement_complete_within_fixture'] and b['confirmed_closing_cents'] is None
 assert all(d['open_delta_cents']==0 and d['economic_cost_cents'] is None for d in b['documents'])
assert read('verificacao-quadro.json')['expected_formulas_acceptances_dependencies_unchanged']
history=read('fontes-historicas.json');assert len(history['sources'])==27 and all(r['hash_matches'] for r in history['sources']) and history['F011_vs_F007']['unreconciled_difference_cents']==14958933
for r in history['sources']:
 p=Path('/workspace/financial-source-base/Base_Conferencia_Elos_OS')/r['caminho_original'];assert sha(p)==r['observed_sha256']
containers=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines();assert not any(n.startswith('elos-finance-test-') for n in containers)
files=git('diff-tree','--no-commit-id','--name-only','-r',code).splitlines()
for f in files:assert git('diff',code,'--',f)==''
manifest={'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'branch':git('branch','--show-current'),'test_implementation_commit':code,'operational_base_commit':git('rev-parse','c72ec54'),'verified_ancestors':ancestors,'operational_modules_migrations_previous_tests_evidence_unchanged':True,'expected_and_inputs_unchanged':True,'rule_sha256':sha(rule),'fixture_sha256':sha(fixture),'test_results':results,'strict_numeric_matches':20,'strict_full_output_missing':6,'strict_numeric_different_or_unknown':4,'case_classifications':coverage,'new_independent_cases':['CT13','CT14','CT23'],'CT10':'executado e reprovado — direito de restituição ausente','independent_bridge_positions':9,'historical_originals_verified':27,'financial_acceptance_recorded':False,'financial_homologation_complete':False,'production_writes':False,'remote_koper_calls':False,'no_test_containers_left':True,'source_files_sha256':{f:sha(REPO/f) for f in files},'evidence_files_sha256':{str(p.relative_to(E)):sha(p) for p in sorted(E.rglob('*')) if p.is_file() and p.name!='verificacao-final.json'},'limitation':'Ações desta execução são locais/descartáveis. Não é auditoria do servidor remoto nem aceite humano. Ponte de saldo real e equivalência integral do esquema ausentes.'}
(E/'verificacao-final.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'test_commit':code,'case_classifications':coverage,'financial_homologation_complete':False,'production_writes':False},ensure_ascii=False))
