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
for p, expected in {**base['protected_prior_files_sha256'], **base['reference_files_sha256']}.items():
    assert sha(REPO / p) == expected, p
assert base['base_commit'].startswith('10ae3f7')
assert base['correction_commit'].startswith('39d858c')
subprocess.run(['git', 'merge-base', '--is-ancestor', '39d858c', '10ae3f7'], cwd=REPO, check=True)
changed = subprocess.check_output(['git', 'diff', '--name-only', '10ae3f7'], cwd=REPO, text=True).splitlines()
assert all(p.startswith(('docs/financeiro/implementacao-v1/etapa14b-exposicao/',
                         'tests/finance-exposure/')) for p in changed), changed
runtime, local = read('acessos-runtime.json'), read('acessos-locais.json')
assert runtime['observations_current'] and not runtime['secrets'] and not runtime['outbound_identities']
assert not local['remote_attempts'] and local['identity_manifest']['connection_count'] == 0
assert len(read('riscos.json')) == 3
assert all(r['production_version_status'] == 'NÃO VERIFICADA' and r['production_definition'] is None
           for r in read('riscos.json'))
for file, expected in [('testes-metadados.json', 7), ('guards.json', 8), ('ordens-servico.json', 4)]:
    r = read(file)
    assert r['passed'] == expected and r['failed'] == 0 and r['container_removed'], file
assert read('testes-metadados.json')['fatal_error'] is None
for file in ['isolado-antes.json', 'isolado-depois.json', 'isolado-contencao.json', 'isolado-overload-ausente.json']:
    r = read(file)
    assert r['environment'] == 'ISOLADO_FICTICIO_NAO_PRODUCAO'
    assert r['transaction_read_only'] == 'on'
    assert r['current_user'] == 'e14b_metadata_reader'
for file, count in [('regressao-81.log', 81), ('npm-test.log', 142)]:
    text = (E / file).read_text()
    # npm usa TAP; o reporter spec usa os símbolos de resumo do Node.
    assert f'tests {count}' in text and f'pass {count}' in text and 'fail 0' in text, file
execs = read('execucoes.json')['executions']
assert len(execs) == 6 and all(r['exit_code'] == 0 for r in execs)
assert read('verificacao-quadro.json')['formal_acceptance_task_statuses_and_formulas_unchanged']
for p in (ROOT / 'scripts').glob('*.py'):
    ast.parse(p.read_text())
collector = (ROOT / 'sql/inventario-metadados.sql').read_text()
assert 'repeatable read read only' in collector and collector.rstrip().endswith('rollback;')
assert base['production_RPC_calls'] == 0 and base['production_changes'] == 0
assert 'NÃO FOI POSSÍVEL COMPROVAR' in (ROOT / 'README.md').read_text()
manifest = dict(
    base_commit=base['base_commit'], branch=base['branch'],
    protected_prior_files_verified=len(base['protected_prior_files_sha256']),
    production_exposure='NÃO VERIFICADA', final_answer='NÃO FOI POSSÍVEL COMPROVAR',
    production_connections=0, production_business_rows_read=0, production_RPC_calls=0,
    production_changes=0, remote_koper_calls=0, formal_financial_acceptances=0,
    global_recommendation='BLOQUEAR', metadata_controls=7, contract_guards=8,
    work_order_SQL_controls=4, financial_regression=81, repository_tests=142,
    prior_342_HTTP_checks='HERDADOS; não reexecutados na14B',
    rules_expected_application_code_and_prior_evidence_preserved=True,
    delivery_files_sha256={str(p.relative_to(REPO)): sha(p)
                          for p in [*ROOT.rglob('*'), *(REPO / 'tests/finance-exposure').glob('*.mjs')]
                          if p.is_file() and p.name != 'manifesto-entrega.json' and '__pycache__' not in p.parts}
)
(E / 'manifesto-entrega.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: manifest[k] for k in ['protected_prior_files_verified', 'final_answer',
                 'metadata_controls', 'contract_guards', 'work_order_SQL_controls',
                 'financial_regression', 'repository_tests', 'global_recommendation']}, ensure_ascii=False))
