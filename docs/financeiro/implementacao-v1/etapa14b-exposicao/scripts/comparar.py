"""Compara arquivos de metadados; nunca abre conexão nem executa SQL."""
import argparse
import hashlib
import json
from pathlib import Path

NAMES = (
    'refresh_execution_service_contract_value',
    'refresh_execution_service_contract_measurements',
    'refresh_execution_work_order_values',
)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def compare(observed, reference):
    result = []
    for name in NAMES:
        # O coletor guarda todos os overloads; equivalência exige a assinatura uuid.
        signature = f'{name}(uuid)'
        find = lambda data: [f for f in data['functions']
                             if f['signature'] in (signature, 'public.' + signature)]
        actual, expected = find(observed), find(reference)
        row = {'function': name, 'signature': 'public.' + signature,
               'source_environment': observed.get('environment'),
               'production_exposure': 'NÃO VERIFICADA',
               'requires_operator_attestation_and_gateway_metadata': True}
        if len(actual) != 1 or len(expected) != 1:
            row.update(comparison='ASSINATURA AUSENTE OU AMBÍGUA', observed_count=len(actual))
        else:
            a, b = actual[0], expected[0]
            public_execute = any(x['grantee'] == 'PUBLIC' and x['privilege'] == 'EXECUTE'
                                 for x in a['acl_expanded'] or [])
            effective = {x['role']: x for x in a['effective_roles'] or []}
            acl_match = (not public_execute
                         and effective.get('anon', {}).get('execute') is False
                         and effective.get('authenticated', {}).get('execute') is True
                         and effective.get('service_role', {}).get('execute') is True)
            row.update(body_sha256=sha(a['body']), reference_body_sha256=sha(b['body']),
                       definition_sha256=sha(a['definition']),
                       same_body=a['body'] == b['body'],
                       same_execution_mode=a['security_definer'] == b['security_definer'],
                       same_result_and_language=(a['result'], a['language']) == (b['result'], b['language']),
                       same_function_config=a['config'] == b['config'],
                       expected_core_acl=acl_match, public_execute=public_execute,
                       effective_roles=a['effective_roles'], acl_expanded=a['acl_expanded'])
            row['comparison'] = ('CORPO E ACL BÁSICA EQUIVALENTES À CANDIDATA LOCAL'
                                 if all(row[k] for k in ('same_body', 'same_execution_mode',
                                                       'same_function_config', 'same_result_and_language',
                                                       'expected_core_acl'))
                                 else 'DIFERENÇA — REVISÃO NECESSÁRIA')
        result.append(row)
    return {'results': result,
            'warning': 'Comparação não certifica produção, helpers, RLS, proprietários, grants adicionais, '
                       'gateway nem exploração. Ausência de assinatura vale somente para o snapshot atestado.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = compare(json.loads(args.snapshot.read_text()), json.loads(args.reference.read_text()))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
