"""Database-free checks. The actual full restored predecessor is rehearsed by the operator tool."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "batch_activation_tests", ROOT / "scripts/activate-development-0045.py")
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


def approvals():
    return SimpleNamespace(approve_0044_to_0045=True,
                           attest_key_recovery=True, writers_stopped=True)


class ActivationTests(unittest.TestCase):
    def test_each_approval_is_required(self):
        for field in vars(approvals()):
            args = approvals()
            setattr(args, field, False)
            with self.subTest(field=field), patch.dict(os.environ, REPL_ID=activation.WORKSPACE):
                with self.assertRaisesRegex(RuntimeError, "Exact path approval"):
                    activation.check_approval(args, SimpleNamespace(app_env="development"))

    def test_only_original_development_is_allowed(self):
        for env, workspace in (("production", activation.WORKSPACE),
                               ("test", activation.WORKSPACE), ("development", "task-copy")):
            with self.subTest(env=env, workspace=workspace), patch.dict(os.environ, REPL_ID=workspace):
                with self.assertRaisesRegex(RuntimeError, "original development"):
                    activation.check_approval(approvals(), SimpleNamespace(app_env=env))
        with patch.dict(os.environ, REPL_ID=activation.WORKSPACE):
            activation.check_approval(approvals(), SimpleNamespace(app_env="development"))

    def test_cli_is_fixed_and_has_no_target_override(self):
        flags = ["--approve-0044-to-0045", "--attest-key-recovery", "--writers-stopped"]
        args = activation.parser().parse_args(flags)
        self.assertEqual(set(vars(args)), set(vars(approvals())))
        for extra in (["--target", "head"], ["--skip-backup"], ["--database", "other"]):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    activation.parser().parse_args(flags + extra)
        self.assertEqual(activation.PREDECESSOR, "0044_purchase_received")
        self.assertEqual(activation.TARGET, "0045_pr_batch_numbers")

    def test_review_requires_exact_single_operator_path(self):
        for target, pending, protected in (
            ("future", [activation.TARGET], [activation.TARGET]),
            (activation.TARGET, ["other", activation.TARGET], [activation.TARGET]),
            (activation.TARGET, [activation.TARGET], []),
        ):
            runner = SimpleNamespace(plan=Mock(return_value={"pending": pending, "operator_only": protected}))
            sync = SimpleNamespace(source_review=Mock(return_value=(runner, {}, {}, target, {})))
            with self.subTest(target=target, pending=pending, protected=protected):
                with self.assertRaises(RuntimeError):
                    activation.reviewed_plan(sync)

    def test_review_keeps_protected_classification_and_binding(self):
        runner = SimpleNamespace(plan=Mock(return_value={
            "pending": [activation.TARGET], "operator_only": [activation.TARGET]}))
        sync = SimpleNamespace(source_review=Mock(
            return_value=(runner, {}, {}, activation.TARGET, {})))
        activation.reviewed_plan(sync)
        runner.plan.assert_called_with({}, {}, [activation.PREDECESSOR], activation.TARGET)
        with patch.object(activation, "BINDING", {**activation.BINDING, "oid": 1}):
            with self.assertRaisesRegex(RuntimeError, "binding changed"):
                activation.reviewed_plan(sync)

    def test_inventory_has_no_business_row_exclusions(self):
        state = {"public.users": {"rows": 1, "sha256": "original"},
                 "public.product_categories": {"rows": 3, "sha256": "all-columns"},
                 "public.purchase_receipts": {"rows": 1, "sha256": "history"},
                 "public.alembic_version": {"rows": 1, "sha256": "revision"},
                 **{f"public.{t}": {"rows": 0, "sha256": "new"} for t in activation.NEW_TABLES}}
        helpers = SimpleNamespace(inventory=lambda _: state)
        self.assertEqual(activation.original_inventory(None, helpers),
                         {k: v for k, v in state.items()
                          if k in ("public.users", "public.product_categories", "public.purchase_receipts")})

    def check_postconditions(self, *, revision=None, seed=None, counter=0, allocation=0, changed=False):
        before = {"public.users": {"rows": 1, "sha256": "all-original-columns"}}
        helpers = SimpleNamespace(inventory=lambda _: {} if changed else before)

        def execute(sql):
            if "alembic_version" in sql:
                return SimpleNamespace(fetchall=lambda: [(revision or activation.TARGET,)])
            if "payload_ciphertext FROM" in sql:
                return SimpleNamespace(fetchall=lambda: seed if seed is not None else [(1, 1, None)])
            if "pr_batch_counters" in sql:
                return SimpleNamespace(fetchone=lambda: (counter,))
            if "pr_batch_allocations" in sql:
                return SimpleNamespace(fetchone=lambda: (allocation,))
            self.fail("Unexpected verification query")

        activation.postconditions(SimpleNamespace(execute=execute), helpers, before)

    def test_postconditions_accept_exact_manual_initial_state(self):
        self.check_postconditions()

    def test_postconditions_reject_any_original_data_change(self):
        with self.assertRaisesRegex(RuntimeError, "Existing table contents changed"):
            self.check_postconditions(changed=True)

    def test_postconditions_reject_wrong_revision_and_changed_defaults(self):
        for changes in ({"revision": activation.PREDECESSOR}, {"seed": []},
                        {"seed": [(1, 2, "v1:changed")]}, {"counter": 1}, {"allocation": 1}):
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                self.check_postconditions(**changes)

    def test_backup_namespace_remains_restricted(self):
        helpers = activation.module("batch_recovery_scope_tests",
                                    ROOT / "scripts/activate-purchase-orders-development.py")
        with self.assertRaisesRegex(RuntimeError, "Unknown recovery scope"):
            helpers.PrivateRecovery(scope="../development-0045")

    def test_backup_and_rehearsal_are_before_live_upgrade(self):
        source = (ROOT / "scripts/activate-development-0045.py").read_text()
        for guard in ('with connection.begin():', 'pg_try_advisory_xact_lock(145002)',
                      'sync.target_matches(settings, connection, BINDING)',
                      '"--exit-on-error"', '"ON_ERROR_STOP=1"',
                      'recovery_checks.schema_digest(restored_schema)',
                      'helpers.inventory(restored_raw) == original',
                      '!= BINDING["cluster"]', 'postconditions(restored_raw, helpers, before)',
                      'postconditions(raw, helpers, before)', 'command.upgrade(config, TARGET)'):
            self.assertIn(guard, source)
        self.assertLess(source.index("storage.retain(backup, recovery.name)"),
                        source.index("upgrade(restored)"))
        self.assertLess(source.index("storage.retain(evidence, recovery.name)"),
                        source.index("\n                upgrade(connection)\n"))
        self.assertLess(source.index("RESTORATION_AND_REHEARSAL_PASSED"),
                        source.index("\n                upgrade(connection)\n"))
        self.assertNotIn("command.stamp(", source)
        self.assertNotIn('upgrade(config, "head")', source)
        self.assertNotIn("APP_ENV=test", source)


if __name__ == "__main__":
    unittest.main()
