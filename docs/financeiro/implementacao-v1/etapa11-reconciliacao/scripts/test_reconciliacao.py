"""Oráculos fixos dos documentos e exemplos independentes; sem algoritmo Elos."""
from pathlib import Path
import json
import unittest
from reconciliar import br_cents, cents, compare, header_values, parse_pdf_text, subtotal

E = Path(__file__).resolve().parents[1] / 'evidencias'


def record(id='1', amount=100000, **extra):
    return dict(external_id=id, installment='1/1', displayed_cents=amount,
                due='22/07/2026', paid_date=None, **extra)


class ReconciliationTests(unittest.TestCase):
    def test_decimal_exact_and_missing(self):
        self.assertEqual(br_cents('149.589,33'), 14958933)
        self.assertEqual(cents('0.01'), 1)
        self.assertIsNone(cents(None))
        with self.assertRaises(ValueError):
            cents('0.001')

    def test_missing_amount_is_not_zero(self):
        self.assertEqual(subtotal([50000, None]),
                         dict(known_subtotal_cents=50000, missing_count=1, total_cents=None))
        self.assertEqual(subtotal([50000, 0])['total_cents'], 50000)

    def test_record_values_differ(self):
        r = compare([record(amount=7000000)], [record(amount=10000000)])[0]
        self.assertEqual(r['classification'], 'different_value')
        self.assertEqual(r['delta_cents'], 3000000)

    def test_exclusive_ids_are_not_compensated(self):
        r = compare([record('1')], [record('2')])
        self.assertEqual([x['classification'] for x in r], ['only_F007', 'only_F011'])
        self.assertTrue(all(x['delta_cents'] is None for x in r))

    def test_duplicate_is_not_silently_paired(self):
        r = compare([record(), record()], [record()])[0]
        self.assertEqual(r['classification'], 'duplicate_key')
        self.assertEqual(r['F007_count'], 2)
        self.assertIsNone(r['delta_cents'])

    def test_unknown_amount_prevents_equality(self):
        r = compare([record(amount=None)], [record()])[0]
        self.assertEqual(r['classification'], 'unknown_amount')
        self.assertIsNone(r['confirmed_cash_cents'])

    def test_footer_date_does_not_create_a_payment(self):
        text = ' 13701  1/3 PREVISAO JFM26  R$ 7.500,00 20/07/2026 -\nGerado por KOPER Página 1 de 1 22/07/2026 10:00:47\n\f'
        rows, _ = parse_pdf_text(text)
        self.assertEqual(rows[0]['displayed_cents'], 750000)
        self.assertIsNone(rows[0]['paid_date'])

    def test_missing_page_and_ambiguous_amount_stop_analysis(self):
        with self.assertRaises(ValueError):
            parse_pdf_text(' 1 1/1 NF R$ 1.000,00 22/07/2026\nPágina 1 de 2\f')
        with self.assertRaises(ValueError):
            parse_pdf_text(' 1 1/1 NF R$ 1.000,00 R$ 100,00 22/07/2026\nPágina 1 de 1\f')

    def test_synthetic_document_is_not_a_fiscal_link(self):
        r = compare([record(document='-', raw='-')], [record(document='KOPER 1')])[0]
        self.assertEqual(r['document_classification'], 'synthetic_KOPER_reference_for_missing_document')
        self.assertIsNone(r['legal_entity_id'])

    def test_actual_sources_fixed_documentary_oracle(self):
        r = json.loads((E / 'reconciliacao.json').read_text())
        self.assertEqual(r['counts'], dict(F011=3261, F007=3261, pages=165, with_paid_date=3255, without_paid_date=6))
        self.assertEqual(r['totals']['F011']['total_cents'], 1371082632)
        self.assertEqual(r['totals']['F007_lines']['total_cents'], 1371082632)
        self.assertEqual(r['header']['total_cents'], 1356123699)
        self.assertEqual(r['header']['paid_cents'], 1353762437)
        self.assertEqual(r['header']['unpaid_cents'], 2361262)
        self.assertEqual(r['totals']['F007_dated']['total_cents'], 1368721370)
        self.assertEqual(r['totals']['F007_undated']['total_cents'], 2361262)
        self.assertEqual(r['bridge']['total_difference_cents'], 14958933)
        self.assertEqual(r['bridge']['F011_minus_F007_lines_cents'], 0)
        self.assertEqual(r['bridge']['financial_cause_unallocated_cents'], 14958933)
        self.assertFalse(r['financial_cause_proven'])
        self.assertIsNone(r['bridge']['certified_financial_total_cents'])

    def test_actual_sources_two_extractors_and_all_records(self):
        r = json.loads((E / 'reconciliacao.json').read_text())
        rows = json.loads((E / 'registros.json').read_text())
        self.assertEqual(r['extraction_checks']['matched_rows'], 3261)
        self.assertTrue(r['extraction_checks']['preserved_text_matches'])
        self.assertEqual(len(rows), 3261)
        self.assertTrue(all(x['delta_cents'] == 0 for x in rows))
        self.assertEqual(r['document_classifications'], dict(same_reference=2537, synthetic_KOPER_reference_for_missing_document=724))
        self.assertTrue(all(x['allocated_header_difference_cents'] is None for x in rows))

    def test_discount_interest_hypothesis_does_not_close_difference(self):
        r = json.loads((E / 'reconciliacao.json').read_text())
        self.assertEqual(r['header']['discount_cents'], 1332534)
        self.assertEqual(r['header']['interest_late_fee_cents'], 132528)
        self.assertEqual(r['conditional_gross_net_check']['lines_less_discount_plus_interest_cents'], 1369882626)
        self.assertEqual(r['conditional_gross_net_check']['hypothetical_net_minus_header_cents'], 13758927)


if __name__ == '__main__':
    unittest.main(verbosity=2)
