"""Database-free release alignment checks; never connects or runs migrations."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "artifacts/api-server/backend"
sys.path.insert(0, str(BACKEND))

from app import fresh_install as fresh
from app.services import fresh_catalog

SPEC = importlib.util.spec_from_file_location("alignment_runner", ROOT / "scripts/deploy-migrations.py")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


class FreshInstallAlignmentTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((ROOT / "scripts/fresh-install-catalog.json").read_text())
        self.stage = self.catalog["0041_location_geography"]
        self.graph = runner.load_graph(BACKEND / "alembic/versions")
        self.policy = runner.load_policy(ROOT / "scripts/migration-policy.json")

    def test_reviewed_single_head_matches_application_and_release_target(self):
        self.assertEqual(fresh.FINAL_TARGET, "0041_location_geography")
        self.assertEqual(fresh.PREPARE_TARGET, "0031_role_hostnames")
        self.assertEqual({key: vars(value) for key, value in fresh.reviewed_graph().items()},
                         {key: vars(value) for key, value in self.graph.items()})
        self.assertEqual(self.graph[fresh.FINAL_TARGET].down_revision, ("0040_po_tax_basis",))
        self.assertEqual(
            json.loads((ROOT / "scripts/release-authorization-policy.json").read_text())["final_target"],
            fresh.FINAL_TARGET)

    def test_existing_0040_upgrade_stays_blocked_and_executes_nothing(self):
        self.assertEqual(self.policy[fresh.FINAL_TARGET], "operator_only")
        # Reclassifying the revision is not a safe shortcut: its non-null
        # additions, loop and check constraint are outside the automatic DDL allowlist.
        with self.assertRaises(runner.PolicyError):
            runner.validate_additive(BACKEND, [fresh.FINAL_TARGET])
        with patch.object(runner, "applied_revisions", return_value=["0040_po_tax_basis"]), \
                patch.object(runner.subprocess, "run") as execute:
            result = runner.execute_plan(object(), self.graph, self.policy, BACKEND,
                                         fresh.FINAL_TARGET, True)
        self.assertEqual(result["result"], "OPERATOR_MIGRATION_REQUIRED")
        self.assertEqual(result["operator_only"], [fresh.FINAL_TARGET])
        self.assertEqual(result["migrations_applied"], 0)
        execute.assert_not_called()
        self.assertEqual(runner.plan(self.graph, self.policy, [fresh.FINAL_TARGET],
                                     fresh.FINAL_TARGET)["result"], "READY")

    def test_catalog_extends_0040_without_changing_predecessor_tables(self):
        self.assertEqual(self.stage["base_revision"], "0040_po_tax_basis")
        self.assertEqual(self.stage["tables"], self.catalog["0040_po_tax_basis"]["tables"])
        self.assertEqual(set(self.stage["additions"]), {"columns", "constraints"})
        columns = self.stage["additions"]["columns"]
        self.assertEqual([row[1] for row in columns], ["pincode", "country_code", "state", "city"])
        self.assertEqual([row[2] for row in columns],
                         ["character varying(20)", "character varying(2)",
                          "character varying(100)", "character varying(100)"])
        for row in columns:
            self.assertEqual(row[0], "storage_locations")
            self.assertEqual(row[3:], [True, "", "", "''::character varying", None])
        constraint, = self.stage["additions"]["constraints"]
        self.assertEqual(constraint[0:2], ["storage_locations", "ck_location_country_code"])
        self.assertTrue(constraint[3])
        self.assertIn("'^[A-Z]{2}$'::text", constraint[2])

    def test_exact_additive_catalog_rejects_missing_or_changed_rows_and_extra_ddl(self):
        # Synthetic projection only: this checks fail-closed comparison, not a
        # claim that a PostgreSQL installation/rehearsal has been performed.
        base = {"columns": [["predecessor"]], "constraints": []}
        extended = {section: base[section] + copy.deepcopy(rows)
                    for section, rows in self.stage["additions"].items()}
        with patch.object(fresh_catalog, "projection", return_value=copy.deepcopy(base)):
            baseline = fresh_catalog.digest(None)
        with patch.object(fresh_catalog, "projection", return_value=copy.deepcopy(extended)):
            self.assertEqual(fresh_catalog.digest(None, additions=self.stage["additions"]), baseline)
        for section, rows in self.stage["additions"].items():
            for row in rows:
                changed = copy.deepcopy(extended)
                changed[section].remove(row)
                with self.subTest(section=section, row=row[1]), \
                        patch.object(fresh_catalog, "projection", return_value=changed):
                    with self.assertRaisesRegex(ValueError, "absent or changed"):
                        fresh_catalog.digest(None, additions=self.stage["additions"])
        changed = copy.deepcopy(extended)
        changed["columns"][1][6] = "'unexpected'::character varying"
        with patch.object(fresh_catalog, "projection", return_value=changed):
            with self.assertRaisesRegex(ValueError, "absent or changed"):
                fresh_catalog.digest(None, additions=self.stage["additions"])
        changed = copy.deepcopy(extended)
        changed["columns"].append(["unreviewed column"])
        with patch.object(fresh_catalog, "projection", return_value=changed):
            self.assertNotEqual(fresh_catalog.digest(None, additions=self.stage["additions"]), baseline)

    def test_new_revision_is_included_in_exact_source_hash_review(self):
        # The source review includes the original downgrade guard as well.
        path = BACKEND / "alembic/versions/0041_location_geography.py"
        review = json.loads((ROOT / "scripts/fresh-install-review.json").read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                         review["revisions"][fresh.FINAL_TARGET])


if __name__ == "__main__":
    unittest.main()
