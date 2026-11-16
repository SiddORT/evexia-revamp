"""Focused, database-free checks for the replacement pricing path."""
import unittest
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch
from sqlalchemy.dialects import postgresql
from app.services import combination_order_pricing as pricing
from app.services.pricing_rules import PricingRuleError


class ExactCombinationLookup(unittest.TestCase):
    def setUp(self):
        self.category = uuid.uuid4()
        self.members = sorted([str(uuid.uuid4()), str(uuid.uuid4())])
        self.items = [{"allergenId": i} for i in reversed(self.members)]
        self.day = date(2026, 11, 16)
        self.db = Mock()
        self.crypto = object()

    def lookup(self):
        return pricing.applicable(self.db, self.crypto, self.category, "B2", self.items, self.day)

    def test_exact_members_dosage_category_and_date(self):
        row = object()
        self.db.scalar.side_effect = [SimpleNamespace(status="active", version=4), row]
        with patch.object(pricing, "project", return_value={"totalMrp": "123.45"}) as project:
            self.assertEqual(self.lookup(), {"totalMrp": "123.45", "statusVersion": 4})
            project.assert_called_once_with(row, self.crypto)
        status, tariff = [c.args[0].compile(dialect=postgresql.dialect()) for c in self.db.scalar.call_args_list]
        for query in (status, tariff):
            self.assertIn(self.category, query.params.values())
            self.assertIn("B2", query.params.values())
            self.assertIn(",".join(self.members), query.params.values())
        self.assertIn(self.day, tariff.params.values())
        self.assertIn("effective_from <=", str(tariff))
        self.assertIn("effective_from DESC", str(tariff))
        self.db.commit.assert_not_called()

    def test_missing_status_blocks_without_tariff_fallback(self):
        self.db.scalar.return_value = None
        with self.assertRaises(PricingRuleError) as raised:
            self.lookup()
        self.assertEqual(raised.exception.code, "combination_missing")
        self.assertEqual(self.db.scalar.call_count, 1)

    def test_inactive_combination_blocks(self):
        self.db.scalar.return_value = SimpleNamespace(status="inactive", version=2)
        with self.assertRaises(PricingRuleError) as raised:
            self.lookup()
        self.assertEqual(raised.exception.code, "combination_inactive")
        self.assertEqual(self.db.scalar.call_count, 1)

    def test_no_effective_price_blocks_without_count_or_singleton_fallback(self):
        self.db.scalar.side_effect = [SimpleNamespace(status="active", version=1), None]
        with self.assertRaises(PricingRuleError) as raised:
            self.lookup()
        self.assertEqual(raised.exception.code, "combination_missing")
        self.assertEqual(self.db.scalar.call_count, 2)

    def test_explicit_zero_is_valid(self):
        self.db.scalar.side_effect = [SimpleNamespace(status="active", version=1), object()]
        with patch.object(pricing, "project", return_value={"totalMrp": "0.00"}):
            self.assertEqual(self.lookup()["totalMrp"], "0.00")

    def test_duplicate_members_are_rejected_before_query(self):
        self.items = [self.items[0], self.items[0]]
        with self.assertRaises(PricingRuleError):
            self.lookup()
        self.db.scalar.assert_not_called()

    def test_unreadable_saved_price_is_not_replaced(self):
        self.db.scalar.side_effect = [SimpleNamespace(status="active", version=1), object()]
        with patch.object(pricing, "project", side_effect=PricingRuleError(code="combination_unreadable")):
            with self.assertRaises(PricingRuleError) as raised:
                self.lookup()
        self.assertEqual(raised.exception.code, "combination_unreadable")


if __name__ == "__main__":
    unittest.main()
