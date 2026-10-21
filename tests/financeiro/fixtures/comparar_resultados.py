#!/usr/bin/env python3
"""Compara saídas informadas com oráculos fixos; não executa nem importa o Elos."""
import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

BASE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path):
    def reject_constant(value):
        raise ValueError('Número JSON inválido: ' + value)
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=reject_constant)


def compare(expected, actual, path='$'):
    """Igualdade tipada; estados identificados por stage, nunca pela ordem da lista."""
    errors = []
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [{'path': path, 'reason': 'Objeto esperado', 'expected': expected, 'actual': actual}]
        for key in expected:
            if key not in actual:
                errors.append({'path': path + '.' + key, 'reason': 'Campo ausente', 'expected': expected[key]})
            else:
                errors.extend(compare(expected[key], actual[key], path + '.' + key))
        for key in actual.keys() - expected.keys():
            errors.append({'path': path + '.' + key, 'reason': 'Campo fora do contrato esperado'})
        return errors
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [{'path': path, 'reason': 'Lista esperada'}]
        if expected and all(isinstance(x, dict) and 'stage' in x for x in expected):
            if not all(isinstance(x, dict) and isinstance(x.get('stage'), str) for x in actual):
                return [{'path': path, 'reason': 'Cada estado precisa de stage textual'}]
            stages = [x['stage'] for x in actual]
            if len(stages) != len(set(stages)):
                return [{'path': path, 'reason': 'Stage duplicado'}]
            return compare({x['stage']: x for x in expected}, {x['stage']: x for x in actual}, path)
        if len(expected) != len(actual):
            errors.append({'path': path, 'reason': 'Quantidade de itens divergente', 'expected': len(expected), 'actual': len(actual)})
        for i, (exp, got) in enumerate(zip(expected, actual)):
            errors.extend(compare(exp, got, path + '[' + str(i) + ']'))
        return errors
    equal = type(expected) is type(actual) and expected == actual
    # Percentuais são textos decimais exatos em pontos percentuais, e não frações.
    if isinstance(expected, str) and path.endswith('_percent') and isinstance(actual, str):
        try:
            exp, got = Decimal(expected), Decimal(actual)
            equal = exp.is_finite() and got.is_finite() and exp == got
        except InvalidOperation:
            equal = False
    if not equal:
        errors.append({'path': path, 'reason': 'Valor ou tipo divergente', 'expected': expected, 'actual': actual})
    return errors


def run(results_path, selected=None):
    fixture_path = BASE / 'casos_financeiros.json'
    fixtures = load_json(fixture_path)
    manifest = load_json(BASE / 'manifesto.json')
    expected_hash = manifest['files_sha256']['casos_financeiros.json']
    if digest(fixture_path) != expected_hash:
        raise ValueError('Casos alterados desde a versão do manifesto; revisar e versionar o oráculo antes de comparar.')
    cases = {c['id']: c for c in fixtures['cases']}
    if len(cases) != len(fixtures['cases']):
        raise ValueError('ID duplicado na massa normativa.')
    selected = selected or list(cases)
    if len(set(selected)) != len(selected) or any(cid not in cases for cid in selected):
        raise ValueError('Lista de casos contém ID inválido ou repetido.')
    results = load_json(results_path)
    actuals = results.get('cases', [])
    if not isinstance(actuals, list) or not all(isinstance(x, dict) and 'id' in x for x in actuals):
        raise ValueError('cases deve ser uma lista de objetos com id.')
    by_id = {x['id']: x for x in actuals}
    if len(by_id) != len(actuals):
        raise ValueError('ID de caso duplicado nos resultados.')
    if any(cid not in cases for cid in by_id):
        raise ValueError('Resultados contêm caso fora da massa normativa.')
    context = results.get('execution_context', {})
    context_errors = []
    for key in ['implementation_version', 'executed_at', 'environment', 'fixture_sha256']:
        if not isinstance(context.get(key), str) or not context[key].strip():
            context_errors.append('execution_context.' + key + ' ausente')
    if context.get('fixture_sha256') and context['fixture_sha256'] != expected_hash:
        context_errors.append('Hash da massa usada não corresponde ao manifesto.')
    checks = []
    for cid in selected:
        got = by_id.get(cid)
        if got is None or got.get('status') != 'executado':
            checks.append({'id': cid, 'status': 'não_executado', 'passed': False, 'differences': []})
            continue
        differences = compare(cases[cid]['expected'], got.get('actual'), '$.' + cid)
        evidence = got.get('evidence', [])
        if not isinstance(evidence, list) or not any(isinstance(v, str) and v.strip() for v in evidence):
            differences.append({'path': '$.' + cid + '.evidence', 'reason': 'Falta referência à evidência da execução'})
        checks.append({'id': cid, 'status': 'comparado', 'passed': not differences and not context_errors, 'differences': differences})
    return {
        'scope': 'Comparação das saídas fornecidas. Este script não executa o Elos e não verifica a autenticidade dos links de evidência.',
        'fixture_sha256': expected_hash,
        'context_errors': context_errors,
        'selected_count': len(selected),
        'passed_count': sum(x['passed'] for x in checks),
        'complete': bool(checks) and not context_errors and all(x['passed'] for x in checks),
        'cases': checks,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path, help='JSON preenchido pelo adaptador/execução do aplicativo')
    parser.add_argument('--only', nargs='+', help='IDs separados por espaço ou vírgula; padrão: todos')
    parser.add_argument('--report', type=Path, help='Salvar comparação em JSON')
    args = parser.parse_args()
    try:
        selected = [x for token in (args.only or []) for x in token.split(',') if x] or None
        report = run(args.results, selected)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print('ERRO DE ENTRADA: ' + str(exc), file=sys.stderr)
        return 2
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['complete'] else 1


if __name__ == '__main__':
    sys.exit(main())
