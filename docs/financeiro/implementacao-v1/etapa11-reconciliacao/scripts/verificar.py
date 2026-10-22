"""Valida entrega e hashes sem certificar dados financeiros ausentes."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import platform
import re
import subprocess
import zipfile
import fitz
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
E = ROOT / 'evidencias'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=REPO, text=True).strip()
base = git('rev-parse', '9c5d016')
ancestors = {}
for c in ['494c55c','95d659e','3daa96e','5e18d7f','6ec4f47','c72ec54','6354e59','282436d','9c5d016']:
    subprocess.run(['git','merge-base','--is-ancestor',c,'HEAD'], cwd=REPO, check=True)
    ancestors[c] = True
relative = ROOT.relative_to(REPO).as_posix()
protected_changes = git('diff','--name-only',base,'--','.',':(exclude)'+relative)
assert not protected_changes, protected_changes
report = json.loads((E/'reconciliacao.json').read_text())
rows = json.loads((E/'registros.json').read_text())
assert len(rows) == 3261 and all(r['delta_cents'] == 0 for r in rows)
assert all(r['allocated_header_difference_cents'] is None for r in rows)
assert report['bridge']['financial_cause_unallocated_cents'] == 14958933
assert report['bridge']['certified_financial_total_cents'] is None
assert report['identity_checks']['F011_distinct_ids'] == 3261
assert report['identity_checks']['F007_distinct_ids'] == 3261
sources = {}
source_base = Path('/workspace/financial-source-base/Base_Conferencia_Elos_OS')
archive = next(Path('/workspace/attachments').rglob('Base_Conferencia_Financeira_Elos_OS.zip'))
with zipfile.ZipFile(archive) as z:
    for sid, r in report['sources'].items():
        digest = sha(source_base/r['caminho_original'])
        zip_digest = hashlib.sha256(z.read('Base_Conferencia_Elos_OS/'+r['caminho_original'])).hexdigest()
        assert digest == r['observed_sha256'] == r['sha256'] == zip_digest
        sources[sid] = dict(sha256=digest, matches_catalog_and_archive=True, unchanged_after_audit=True)
rules = REPO/'docs/financeiro/implementacao-v1/t01-t02/referencias/Elos_OS_Regras_Financeiras_v0_1.docx'
assert sha(rules) == '30f19b5ef98157d72c32a9c471c8893bac3b17a60167d6a417a346c6efb36c28'
fixture = REPO/'tests/financeiro/fixtures/casos_financeiros.json'
assert sha(fixture) == 'fad6ded4f65b20848b8e8b3c95ca087eff8893fac387571fc8aac8d0cc1fd6fb'
commands = [
    ('python scripts/reconciliar.py', 'reconciliacao.log', None),
    ('python scripts/test_reconciliacao.py', 'testes-diagnostico.log', 12),
    ('python scripts/quadro.py', 'verificacao-quadro.json', None),
    ('node --test tests/koper-finance/collection.test.mjs tests/financeiro/money.test.mjs tests/finance-core/components.test.mjs tests/cashflow/engine.test.mjs','regressao-financeira.log',28),
    ('Lista preservada em tests/supplier-refunds/validate.mjs para regressao-81.log; comando completo em CASOS-DE-TESTE.md','regressao-81.log',81),
    ('npm test','npm-test-142.log',142),
]
results = []
for command, log, n in commands:
    content = (E/log).read_text()
    if n == 12:
        assert 'Ran 12 tests' in content and '\nOK\n' in content
    elif n:
        assert re.search(rf'ℹ tests {n}\b',content)
        assert re.search(rf'ℹ pass {n}\b',content)
        assert 'ℹ fail 0' in content
    results.append(dict(command=command, log=log, exit_code=0, passed=n))
tracking = json.loads((E/'verificacao-quadro.json').read_text())
assert tracking['all_30_case_cells_unchanged'] and not tracking['financial_acceptance_recorded']
wb = openpyxl.load_workbook(E/'Reconciliacao_F011_F007.xlsx', read_only=True)
try:
    assert wb['Registros'].max_row == 3262
    assert wb['Paginas'].max_row == 166
finally:
    wb.close()
# Validate page/line locators against the original preserved text, not our exports.
pages = (source_base/'03_textos_pdf/F007/Contas a pagar (20).txt').read_text().split('\f')
for row in rows:
    assert pages[row['F007_page']-1].splitlines()[row['F007_text_line']-1].split()[0] == row['external_id']
files = {str(p.relative_to(ROOT)):sha(p) for p in sorted(ROOT.rglob('*'))
         if p.is_file() and '__pycache__' not in p.parts and p.name != 'manifesto-entrega.json'}
manifest = dict(executed_at_utc=datetime.now(timezone.utc).isoformat(), repository='fabionicodemus-lang/elos-os',
    branch=git('branch','--show-current'), base_commit=base, prior_commits_present=ancestors,
    runtime=dict(python=platform.python_version(), node=subprocess.check_output(['node','--version'],text=True).strip(),
                 pymupdf=fitz.VersionBind, openpyxl=openpyxl.__version__,
                 tools='Poppler pdftotext/pdfinfo, PyMuPDF, Python Decimal/openpyxl; dados locais somente leitura',
                 test_database='PGlite em memória, apenas nos testes existentes que o criam',
                 managed_status='capabilities=[]; network_policy.mode=restricted/state=unknown; sem credencial financeira configurada'),
    sources=sources, archive_sha256=sha(archive), normative_rules_sha256=sha(rules), approved_30_cases_sha256=sha(fixture),
    prior_code_migrations_fixtures_audits_and_evidence_unchanged=True, scope_of_changes=relative,
    production_modified=False, koper_modified=False, financial_remote_connections=False,
    financial_rule_changes=False, financial_cause_proven=False, financial_total_certified=False,
    financial_acceptance_recorded=False, tests=results,
    full_25_and_24_database_controls_rerun=False, full_30_scenarios_rerun=False,
    page_line_locators_verified=3261, file_hashes=files)
(E/'manifesto-entrega.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(verified_records=3261, verified_pages=165, regression_counts=[12,28,81,142],
    financial_cause_proven=False, financial_residual_cents=14958933,
    prior_code_and_evidence_unchanged=True, production_modified=False),ensure_ascii=False))
