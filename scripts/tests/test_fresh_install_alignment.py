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
        declaration = json.loads((ROOT / "development-contract.json").read_text())
        self.assertEqual(fresh.FINAL_TARGET, declaration["schema"])
        self.assertEqual(fresh.PREPARE_TARGET, "0031_role_hostnames")
        self.assertEqual({key: vars(value) for key, value in fresh.reviewed_graph().items()},
                         {key: vars(value) for key, value in self.graph.items()})
        parents = {p for node in self.graph.values() for p in node.down_revision}
        self.assertEqual(set(self.graph) - parents, {fresh.FINAL_TARGET})
        self.assertEqual(
            json.loads((ROOT / "scripts/release-authorization-policy.json").read_text())["final_target"],
            fresh.FINAL_TARGET)

    def test_existing_0041_upgrade_is_automatic_without_additive_gate(self):
        # Keep the historical rate conversion case pinned to its own target.
        target = "0042_rate_hundredths"
        self.assertEqual(self.policy[target], "automatic")
        historical_graph = {r: self.graph[r] for r in runner.ordered_ancestors(self.graph, target)}
        historical_policy = {r: self.policy[r] for r in historical_graph}
        # Reclassifying the revision is not a safe shortcut: its locks, rewrites
        # and type/constraint replacements are outside the automatic DDL allowlist.
        with self.assertRaises(runner.PolicyError):
            runner.validate_additive(BACKEND, [target])
        with patch.object(runner, "applied_revisions",
                          side_effect=[["0041_location_geography"], [target]]), \
                patch.object(runner.subprocess, "run") as execute:
            execute.return_value.returncode = 0
            result = runner.execute_plan(object(), historical_graph, historical_policy, BACKEND,
                                         target, True)
        self.assertEqual(result["result"], "READY")
        self.assertEqual(result["operator_only"], [])
        self.assertEqual(result["migrations_applied"], 1)
        execute.assert_called_once()
        self.assertEqual(runner.plan(self.graph, self.policy, [fresh.FINAL_TARGET],
                                     fresh.FINAL_TARGET)["result"], "READY")

    def test_current_path_is_automatic_and_uses_exact_target(self):
        predecessors = set(runner.ordered_ancestors(self.graph, "0042_rate_hundredths"))
        protected = [r for r in runner.ordered_ancestors(self.graph, fresh.FINAL_TARGET) if r not in predecessors]
        for revision in protected:
            self.assertEqual(self.policy[revision], "automatic")
        with patch.object(runner, "applied_revisions",
                          side_effect=[["0042_rate_hundredths"], [fresh.FINAL_TARGET]]), \
                patch.object(runner.subprocess, "run") as execute:
            execute.return_value.returncode = 0
            result = runner.execute_plan(object(), self.graph, self.policy, BACKEND,
                                         fresh.FINAL_TARGET, True)
        self.assertEqual(result["result"], "READY")
        self.assertEqual(result["pending"], protected)
        self.assertEqual(result["operator_only"], [])
        self.assertEqual(result["migrations_applied"], len(protected))
        execute.assert_called_once()

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
        path = BACKEND / f"alembic/versions/{fresh.FINAL_TARGET}.py"
        review = json.loads((ROOT / "scripts/fresh-install-review.json").read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                         review["revisions"][fresh.FINAL_TARGET])

    def test_rate_catalog_is_a_full_snapshot_not_an_additive_exception(self):
        stage = self.catalog["0042_rate_hundredths"]
        self.assertEqual(set(stage), {"sha256", "tables"})
        self.assertRegex(stage["sha256"], r"^[0-9a-f]{64}$")
        self.assertNotEqual(stage["sha256"], self.catalog["0037_domain_admission"]["sha256"])
        self.assertEqual(stage["tables"], self.stage["tables"])
        self.assertEqual(self.policy["0041_location_geography"], "automatic")
        self.assertEqual(self.policy[fresh.FINAL_TARGET], "automatic")

    def test_current_catalog_is_a_full_snapshot_with_receipt_and_batch_tables(self):
        stage = self.catalog[fresh.FINAL_TARGET]
        self.assertEqual(set(stage), {"sha256", "tables"})
        self.assertRegex(stage["sha256"], r"^[0-9a-f]{64}$")
        self.assertNotEqual(stage["sha256"], self.catalog["0042_rate_hundredths"]["sha256"])
        self.assertEqual(set(stage["tables"]) - set(self.catalog["0042_rate_hundredths"]["tables"]),
                         {"email_templates", "purchase_receipts", "purchase_receipt_sources",
                          "purchase_receipt_history", "purchase_receipt_requests",
                      "pr_batch_settings", "pr_batch_counters", "pr_batch_allocations",
                      "inventory_lots", "inventory_balances", "inventory_receipt_states",
                      "inventory_movements", "inventory_postings", "inventory_requests",
                      "languages", "language_changes", "combo_products",
                      "combo_product_members", "combo_product_revisions",
                  "product_assemblies", "product_requests",
                  "opening_stock", "opening_stock_requests",
                  "mr_zone_assignments", "headquarter_areas", "email_attempts",
                  "staff_login_identifiers", "inventory_adjustments", "inventory_adjustment_requests",
                  "immunotherapy_orders", "immunotherapy_requests", "immunotherapy_items", "immunotherapy_attachments",
                  "kits_orders", "kits_requests", "kits_attachments"})


if __name__ == "__main__":
    unittest.main()
