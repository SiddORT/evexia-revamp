"""Focused, database-free checks for the requested business-label contract."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
import unittest

from app.services.business_numbers import (
    format_number, suborder_number, suborder_ordinal, align_suborders,
)
from app.services.immunotherapy_pricing import issue, prepare_suborders, SUBORDER_BASIS


class BusinessNumberTests(unittest.TestCase):
    def test_exact_prefix_case_and_padding(self):
        expected = {
            "immunotherapy": "IT-000001", "kits": "kit-000001",
            "spt": "spt-0000001", "lupin": "lup-000001",
            "staff": "ST-001", "allergen": "ALG-001",
            "patient": "PAT-001", "doctor": "DR-001", "mr": "MR-001",
        }
        for kind, label in expected.items():
            with self.subTest(kind=kind):
                self.assertEqual(format_number(kind, 1), label)
                self.assertEqual(format_number(kind, 2), label[:-1] + "2")

    def test_padding_never_truncates_or_recycles(self):
        self.assertEqual(format_number("allergen", 1000), "ALG-1000")
        self.assertEqual(format_number("staff", 1000), "ST-1000")
        self.assertEqual(format_number("kits", 1000000), "kit-1000000")

    def test_nonpositive_and_noninteger_values_fail(self):
        for value in (0, -1, True, 1.5, "1", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                format_number("immunotherapy", value)

    def test_suborders_extend_after_z(self):
        for value, label in ((1, "A"), (2, "B"), (26, "Z"), (27, "AA"),
                             (52, "AZ"), (53, "BA"), (703, "AAA")):
            with self.subTest(value=value):
                number = suborder_number("IT-000001", value)
                self.assertEqual(number, "IT-000001" + label)
                self.assertEqual(suborder_ordinal(number), value)

    def test_invalid_parent_and_saved_identity_rejected(self):
        for parent in ("KIT-000001", "IT-1", "IT-000001A", ""):
            with self.assertRaises(ValueError):
                suborder_number(parent, 1)
        for value in ("SUB000", "random", "IT-000001a"):
            with self.assertRaises(ValueError):
                suborder_ordinal(value)

    def test_historical_ordinals_remain_understood(self):
        self.assertEqual(suborder_ordinal("SUB001"), 1)
        self.assertEqual(suborder_ordinal("SUB-000027"), 27)

    def test_live_issue_uses_parent_and_retains_existing_ids(self):
        previous = {"groups": [{"id": "bottle", "items": [
            {"suborderId": "IT-000001Z"}]}], "nextSuborderNumber": 1}
        value = {"groups": [{"id": "bottle", "items": [
            {"suborderId": "IT-000001Z"}, {}]}]}
        original = deepcopy(previous)
        issue(value, previous, "IT-000001")
        self.assertEqual(value["groups"][0]["items"][1]["suborderId"], "IT-000001AA")
        self.assertEqual(value["nextSuborderNumber"], 28)
        self.assertEqual(previous, original)

    def test_canonical_removed_headers_are_not_recycled(self):
        previous = {"groups": [{"id": "IT-000001C", "items": []}],
                    "nextSuborderNumber": 4}
        value = {"pricingBasis": SUBORDER_BASIS, "groups": []}
        issue(value, previous, "IT-000001")
        self.assertEqual(value["nextSuborderNumber"], 4)

    def test_canonical_header_identity_cannot_be_invented(self):
        previous = {"pricingBasis": SUBORDER_BASIS, "groups": [
            {"id": "IT-000001A", "mrp": None, "items": []}]}

        class Rejected(Exception):
            pass

        saved = deepcopy(previous["groups"])
        self.assertEqual(prepare_suborders(saved, previous, Rejected), saved)
        with self.assertRaises(Rejected):
            prepare_suborders([{"id": "IT-000001B", "mrp": None, "items": []}],
                              previous, Rejected)

    def test_staff_allocator_skips_reserved_aliases_and_retained_codes(self):
        from app.services.staff_employee_numbers import allocate
        class FakeDatabase:
            def __init__(self):
                self.results = iter([1, "retained-owner", None, 2, None, "deleted-profile",
                                     3, None, None])
            def execute(self, *args, **kwargs):
                pass
            def scalar(self, *args, **kwargs):
                return next(self.results)
        keys = SimpleNamespace(lookup_index=lambda value: "blind:" + value)
        with patch("app.services.staff_employee_numbers.ready", return_value=keys):
            self.assertEqual(allocate(FakeDatabase()), "ST-003")

    def test_conversion_retains_clinical_values_and_immutable_history(self):
        old = {"groups": [{"id": "bottle", "items": [
            {"suborderId": "SUB001", "allergenId": "saved", "result": "3", "rate": None}]}],
            "historicalGroups": [{"id": "historical", "items": [{"suborderId": "SUB001"}]}],
            "nextSuborderNumber": 2}
        result = align_suborders(old, "IT-000001")
        self.assertEqual(result["groups"][0]["items"][0]["suborderId"], "IT-000001A")
        self.assertEqual(result["groups"][0]["items"][0]["result"], "3")
        self.assertEqual(result["historicalGroups"], old["historicalGroups"])
        self.assertEqual(old["groups"][0]["items"][0]["suborderId"], "SUB001")
        self.assertEqual(result["nextSuborderNumber"], 2)

    def test_conversion_rejects_ambiguous_duplicate_ordinals(self):
        value = {"groups": [{"id": "bottle", "items": [
            {"suborderId": "SUB001"}, {"suborderId": "SUB-000001"}]}]}
        with self.assertRaises(ValueError):
            align_suborders(value, "IT-000001")


if __name__ == "__main__":
    unittest.main()
