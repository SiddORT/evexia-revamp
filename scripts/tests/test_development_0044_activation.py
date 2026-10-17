"""Database-free authorization and failure-boundary tests for explicit recovery."""
import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("development_0044_activation",
                                            ROOT / "scripts/activate-development-0044.py")
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ActivationContractTests(unittest.TestCase):
    def args(self, **changes):
        values = dict(approve_0040_to_0044=True, attest_key_recovery=True, writers_stopped=True)
        return SimpleNamespace(**(values | changes))

    def test_requires_each_separate_attestation(self):
        with patch.dict(os.environ, {"REPL_ID": activation.WORKSPACE}):
            for name in ("approve_0040_to_0044", "attest_key_recovery", "writers_stopped"):
                with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "required"):
                    activation.check_approval(self.args(**{name: False}), SimpleNamespace(app_env="development"))

    def test_rejects_production_and_other_workspace(self):
        with patch.dict(os.environ, {"REPL_ID": activation.WORKSPACE}):
            with self.assertRaisesRegex(RuntimeError, "original development"):
                activation.check_approval(self.args(), SimpleNamespace(app_env="production"))
        with patch.dict(os.environ, {"REPL_ID": "task-copy"}):
            with self.assertRaisesRegex(RuntimeError, "original development"):
                activation.check_approval(self.args(), SimpleNamespace(app_env="development"))

    def test_accepts_only_approved_original_development(self):
        with patch.dict(os.environ, {"REPL_ID": activation.WORKSPACE}):
            activation.check_approval(self.args(), SimpleNamespace(app_env="development"))

    def test_parser_has_no_target_or_bypass_override(self):
        args = activation.parser().parse_args([
            "--approve-0040-to-0044", "--attest-key-recovery", "--writers-stopped"])
        self.assertEqual(set(vars(args)),
                         {"approve_0040_to_0044", "attest_key_recovery", "writers_stopped"})
        self.assertEqual(activation.PENDING, ["0041_location_geography", "0042_rate_hundredths",
                                             "0043_email_templates", "0044_purchase_received"])

    def test_schema_comparison_ignores_only_dump_wrappers(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a", Path(directory) / "b"
            a.write_text("-- server 16\n\\restrict first\nCREATE TABLE x (id int);\n\\unrestrict first\n")
            b.write_text("-- server 17\n\\restrict second\nCREATE TABLE x (id int);\n\\unrestrict second\n")
            self.assertEqual(activation.schema_digest(a), activation.schema_digest(b))
            b.write_text("CREATE TABLE x (id bigint);\n")
            self.assertNotEqual(activation.schema_digest(a), activation.schema_digest(b))

    def test_recovery_namespace_rejects_arbitrary_scope_before_network(self):
        helpers = activation.module("test_recovery_helpers",
                                    ROOT / "scripts/activate-purchase-orders-development.py")
        with self.assertRaisesRegex(RuntimeError, "Unknown recovery scope"):
            helpers.PrivateRecovery(scope="../public")

    def test_requires_matching_postgres_major_for_all_recovery_tools(self):
        with patch.object(activation.subprocess, "check_output", return_value="PostgreSQL 16.10") as output:
            activation.verify_postgres_tools(160010)
            self.assertEqual(output.call_count, 6)
        with patch.object(activation.subprocess, "check_output", return_value="PostgreSQL 17.5"):
            with self.assertRaisesRegex(RuntimeError, "match the original"):
                activation.verify_postgres_tools(160010)

    def test_source_has_fixed_transaction_and_distinct_restore(self):
        source = (ROOT / "scripts/activate-development-0044.py").read_text()
        self.assertIn("with connection.begin():", source)
        self.assertIn("pg_try_advisory_xact_lock(145002)", source)
        self.assertIn('"--exit-on-error"', source)
        self.assertIn('schema_digest(canonical_schema) == schema_digest(restored_schema)', source)
        self.assertIn('"ON_ERROR_STOP=1"', source)
        self.assertIn("!= binding[\"cluster\"]", source)
        self.assertIn('sync.target_matches(settings, connection, binding)', source)
        self.assertIn('postconditions(restored_raw, tables, expected, test_guards=True)', source)
        self.assertIn('postconditions(raw, tables, expected)', source)
        self.assertNotIn("command.stamp(", source)
        self.assertNotIn('command.upgrade(config, "head")', source)
        self.assertLess(source.index("RESTORATION_AND_REHEARSAL_PASSED"),
                        source.index("upgrade(connection)\n                postconditions"))
