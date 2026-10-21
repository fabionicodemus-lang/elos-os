import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

root = Path(__file__).parent / 'fixtures'
spec = importlib.util.spec_from_file_location('independent_comparator', root / 'comparar_resultados.py')
comparator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparator)


class OracleInfrastructure(unittest.TestCase):
    def test_30_cases_and_hash_unchanged(self):
        manifest = json.loads((root / 'manifesto.json').read_text())
        self.assertEqual(hashlib.sha256((root / 'casos_financeiros.json').read_bytes()).hexdigest(),
                         manifest['files_sha256']['casos_financeiros.json'])
        cases = json.loads((root / 'casos_financeiros.json').read_text())['cases']
        self.assertEqual(len(cases), 30)
        self.assertEqual(len({c['id'] for c in cases}), 30)
        for name in ['comparar_resultados.py','parametros_financeiros.json','resultados_modelo.json']:
            self.assertEqual(hashlib.sha256((root/name).read_bytes()).hexdigest(),manifest['files_sha256'][name])

    def test_deliberate_one_cent_error_detected(self):
        # Controle propositalmente errado, não execução do aplicativo.
        expected = next(c for c in json.loads((root / 'casos_financeiros.json').read_text())['cases'] if c['id'] == 'CT01')['expected']
        actual = {'canonical_title_count': 2, 'I03_open_payables_cents': 3000001,
                  'extra_obligations_from_retries': 0, 'title_78_remains_open_cents': 2000000,
                  'deletions_due_to_absence': 0}
        differences = comparator.compare(expected, actual, '$.CT01')
        self.assertEqual(len(differences), 1)
        self.assertEqual(differences[0]['path'], '$.CT01.I03_open_payables_cents')

    def test_null_zero_boolean_missing_remain_distinct(self):
        self.assertTrue(comparator.compare({'amount': None}, {'amount': 0}))
        self.assertTrue(comparator.compare({'amount': None}, {}))
        self.assertTrue(comparator.compare({'count': 1}, {'count': True}))


if __name__ == '__main__':
    unittest.main()
