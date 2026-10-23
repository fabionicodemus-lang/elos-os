from pathlib import Path
import ast
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
E = ROOT / 'evidencias'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads((E / p).read_text())
base = read('base.json')
for f, h in base['protected_sha256'].items():
    assert sha(REPO / f) == h, f
for ref in ['39d858c', '10ae3f7', '6d9fecb', '460147e']:
    subprocess.run(['git', 'merge-base', '--is-ancestor', ref, 'HEAD'], cwd=REPO, check=True)
result = read('resultado.json')
assert result['passed'] == 33 and result['failed'] == 0 and result['fatal_error'] is None
assert result['resources_removed'] and result['production_calls'] == 0 and result['koper_calls'] == 0
assert all(r['passed'] for r in result['checks'])
formulas = read('formulas-preservadas.json')
assert len(formulas) == 3
assert all(r['native_sha256'] == r['financial_sha256'] for r in formulas.values())
assert all(not r['anon'] and not r['authenticated'] and not r['custom'] and r['service'] for r in read('ACL.json'))
audit = read('confronto-auditoria.json')
assert len(audit['checks']) == 5 and all(r['identical_except_line_endings'] for r in audit['checks'])
assert len(read('chamadores.json')['callers']) == 16
assert read('publicacao-preflight.json')['matching_push_workflows'] == 0
assert read('coletor-sintaxe.json')['syntax_valid']
for p in ['regressao-etapa13/execucoes.json', 'regressao-etapa13/regressao-etapa12/execucoes.json']:
    assert all(r['exit_code'] == 0 for r in read(p)), p
reg = E / 'regressao-etapa13/regressao-etapa12'
for p, n in [('reexecucao/anteriores/fundacao/banco-final.json', 25), ('reexecucao/anteriores/integracao/integracao.json', 24), ('reexecucao/anteriores/liquidacoes.json', 16), ('reexecucao/etapa8/banco.json', 8), ('reexecucao/etapa9/banco.json', 7), ('reexecucao/etapa10/banco.json', 9), ('banco.json', 4)]:
    r = json.loads((reg / p).read_text())
    assert r['passed'] == n and r['failed'] == 0, p
for f, n in [('regressao-81.log', 81), ('npm-test.log', 153)]:
    text = (reg / f).read_text()
    assert f'tests {n}' in text and f'pass {n}' in text and 'fail 0' in text, f
assert read('verificacao-quadro.json')['all_30_case_values_expected_classifications_and_acceptances_unchanged']
assert all(r['exit_code'] == 0 for r in read('execucoes.json')['results'])
assert read('execucoes.json')['migration_sha256_at_capture'] == sha(REPO / 'supabase/migrations/20261025120000_financial_refresh_internal_authorization.sql')
publication = read('publicacao.json')
assert publication['code_commit'].startswith('47be2b9')
assert publication['remote_branch_ref_at_code_publication'] == publication['code_commit']
assert publication['original_39d858c_now_reachable_in_published_history']
assert publication['main_ref_unchanged'] == '460147e74be9b67c9cff2613b710a9cf0c264274'
for p in (ROOT / 'scripts').glob('*.py'):
    ast.parse(p.read_text())
changed = subprocess.check_output(['git', 'diff', '--name-only', base['integration_merge']], cwd=REPO, text=True).splitlines()
assert all(p.startswith(('docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/', 'tests/finance-rpc-security/'))
           or p == 'supabase/migrations/20261025120000_financial_refresh_internal_authorization.sql' for p in changed), changed
manifest = dict(
    branch=base['branch'], published_code_commit=publication['code_commit'], original_patch='39d858c', integration_base=base['integration_merge'],
    production_vulnerable_database_definitions='CONFIRMADAS NO RELATÓRIO RECEBIDO',
    production_HTTP_exposure='NÃO COMPROVADA', protected_prior_files=len(base['protected_sha256']),
    security_controls=33, foundation=25, koper_integration=24, settlements=16,
    financial_regression=81, repository_tests=153, formal_financial_acceptances=0,
    production_connections=0, production_functions_invoked=0, production_changes=0,
    release='REVISÃO TÉCNICA; aplicação produtiva bloqueada sem autorização explícita/preflight',
    migration_sha256=sha(REPO / 'supabase/migrations/20261025120000_financial_refresh_internal_authorization.sql'),
    files_sha256={str(p.relative_to(REPO)): sha(p)
                  for p in [*ROOT.rglob('*'), *(REPO / 'tests/finance-rpc-security').glob('*.mjs')]
                  if p.is_file() and p.name != 'manifesto-entrega.json' and '__pycache__' not in p.parts})
(E / 'manifesto-entrega.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(protected_prior_files=manifest['protected_prior_files'],
                      security_controls=33, financial_regression=81, repository_tests=153,
                      production_changes=0, formula_changes=0, formal_acceptances=0), ensure_ascii=False))
