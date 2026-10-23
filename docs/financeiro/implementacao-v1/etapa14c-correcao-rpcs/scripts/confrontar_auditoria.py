from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
E = ROOT / 'evidencias'
audit = json.loads((E / 'auditoria-recebida.json').read_text())
targets = {
    'refresh_execution_service_contract_value': '20260728_0038_execution_service_contracts.sql',
    'refresh_execution_service_contract_measurements': '20260801_0067_service_contract_procurement.sql',
    'refresh_execution_work_order_values': '20260729_0040_execution_work_orders.sql',
    'is_company_member': '20260722_0001_multitenancy.sql',
    'has_company_permission': '20260810_0081_owner_admin_full_access.sql'
}
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
rows = []
for item in audit['functions'] + audit['helpers']:
    name = item['function_name']
    body = re.search(r'AS \$function\$([\s\S]*?)\$function\$', item['definition'])[1]
    file = REPO / 'supabase/migrations' / targets[name]
    source = file.read_text().split('create or replace function public.' + name + '(', 1)[1]
    native = re.search(r'\bas\s+\$\$([\s\S]*?)\$\$;', source, re.I)[1]
    normalized = body.replace('\r\n', '\n')
    assert normalized == native.replace('\r\n', '\n'), name
    if 'definition_md5' in item:
        assert hashlib.md5(item['definition'].encode()).hexdigest() == item['definition_md5'], name
    rows.append(dict(function=name, source=str(file.relative_to(REPO)),
                     received_body_sha256=sha(body), lf_normalized_sha256=sha(normalized),
                     local_native_lf_sha256=sha(native.replace('\r\n', '\n')),
                     identical_except_line_endings=True,
                     definition_md5_provided='definition_md5' in item,
                     definition_md5_consistent=True if 'definition_md5' in item else None))
report = ROOT / 'referencias/Elos_OS_Etapa14B_Seguranca_Producao_2026-10-23.html'
result = dict(report_sha256=hashlib.sha256(report.read_bytes()).hexdigest(),
              source='Relatório fornecido pelo solicitante; metadados transcritos, não nova conexão produtiva.',
              production_database_vulnerable_definitions='CONFIRMADAS NO RELATÓRIO',
              production_HTTP_exposure='NÃO COMPROVADA', checks=rows,
              original_patch_local_commit=subprocess.check_output(['git', 'rev-parse', '39d858c'], cwd=REPO, text=True).strip(),
              original_patch_paths=['supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql',
                                    'supabase/migrations/20261025110000_work_order_financial_tenant_guard.sql'])
assert result['report_sha256'] == 'fd55e241398da0eb86074a75fff58ff68eb3a4017730deb75fb2108b2d729707'
(E / 'confronto-auditoria.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(compared_bodies=len(rows), literal_SQL_MD5_matches=3,
                      production='Confirmada no relatório; HTTP não comprovada'), ensure_ascii=False))
