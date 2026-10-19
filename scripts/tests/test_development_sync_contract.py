"""Source review and actual transactional synchronization on private socket PostgreSQL.

Never reads settings or connects to the configured workspace database.
"""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "artifacts/api-server/backend"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


review = load("sync_contract_review", ROOT / "scripts/review-development-schema.py")
sync = load("sync_contract_runner", ROOT / "scripts/development-sync.py")


def copy_source(root):
    backend = root / "artifacts/api-server/backend"
    for filename in (*review.EXECUTION_SOURCES, "development-contract.json",
                     "scripts/migration-policy.json", "scripts/development-schema-review.json",
                     "artifacts/api-server/backend/app/core/schema.py"):
        dest = root / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / filename, dest)
    shutil.copytree(ROOT / "artifacts/api-server/backend/alembic/versions",
                    backend / "alembic/versions", dirs_exist_ok=True)
    return backend


class SourceContractTests(unittest.TestCase):
    def test_staged_unknown_dependencies_and_unclassified_revisions_fail_offline(self):
        for classify, dependency in ((False, None), (True, "missing_dependency")):
            with self.subTest(classify=classify, dependency=dependency), \
                    tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                backend = copy_source(root)
                runner, _, _, _, _ = review.source(root)
                full_graph = runner.load_graph(backend / "alembic/versions")
                head, = set(full_graph) - {
                    p for node in full_graph.values() for p in node.down_revision}
                (backend / "alembic/versions/staged.py").write_text(
                    f"revision='staged'\ndown_revision={head!r}\n"
                    f"depends_on={dependency!r}\n")
                if classify:
                    path = root / "scripts/migration-policy.json"
                    policy = json.loads(path.read_text())
                    policy["revisions"]["staged"] = "operator_only"
                    path.write_text(json.dumps(policy))
                with patch("sqlalchemy.create_engine",
                           side_effect=AssertionError("must stay offline")) as connect:
                    expected_error = ("UNKNOWN_REVISION_OR_DEPENDENCY" if classify
                                      else "UNKNOWN_OR_UNCLASSIFIED_MIGRATION")
                    # refresh reloads the planner; its exception class is distinct.
                    with self.assertRaisesRegex(Exception, f"^{expected_error}$"):
                        review.refresh(root)
                connect.assert_not_called()

    def test_staged_operator_revision_is_reviewed_but_never_planned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backend = copy_source(root)
            runner, _, _, target, _ = review.source(root)
            full_graph = runner.load_graph(backend / "alembic/versions")
            head, = set(full_graph) - {
                p for node in full_graph.values() for p in node.down_revision}
            staged = backend / "alembic/versions/staged.py"
            staged.write_text(
                f"revision='staged'\ndown_revision={head!r}\ndepends_on=None\n")
            policy_path = root / "scripts/migration-policy.json"
            policy_data = json.loads(policy_path.read_text())
            policy_data["revisions"]["staged"] = "operator_only"
            policy_path.write_text(json.dumps(policy_data))
            # Source updates still require explicit offline integrity review.
            with self.assertRaises(review.ReviewBlocked):
                review.review(root)
            review.refresh(root)
            runner, graph, policy, same_target, reviewed_paths = review.review(root)
            self.assertEqual(same_target, target)
            self.assertIn("staged", reviewed_paths)
            self.assertNotIn("staged", graph)
            self.assertNotIn("staged", policy)
            plan = runner.plan(graph, policy, [target], target)
            self.assertEqual(plan["result"], "READY")
            self.assertEqual(plan["pending"], [])
            with self.assertRaises(runner.PolicyError):
                runner.plan(graph, policy, ["staged"], target)
            # Production still refuses the same staged repository/application
            # mismatch; development scoping never changes that planner.
            with self.assertRaises(runner.PolicyError):
                runner.plan(runner.load_graph(backend / "alembic/versions"),
                            runner.load_policy(policy_path), [target], target)
            # Even changes beyond the contract must invalidate the review.
            staged.write_text(staged.read_text() + "\n# changed\n")
            with self.assertRaises(review.ReviewBlocked):
                review.review(root)

    def test_current_head_and_protected_path_ignore_stale_production_review(self):
        runner, graph, policy, target, _ = review.review()
        self.assertEqual(target, "0044_purchase_received")
        result = runner.plan(graph, policy, ["0040_po_tax_basis"], target)
        expected = ["0041_location_geography", "0042_rate_hundredths",
                    "0043_email_templates", "0044_purchase_received"]
        self.assertEqual(result["pending"], expected)
        self.assertEqual(result["operator_only"], expected)
        # Stale production approval must never be consulted by development.
        # Do not make the regression depend on production remaining stale forever.
        from app.fresh_install import FreshInstallBlocked
        with patch("app.fresh_install.reviewed_graph",
                   side_effect=FreshInstallBlocked("synthetic stale production review")) as production:
            review.review()
        production.assert_not_called()

    def test_metadata_drift_and_unreviewed_bytes_fail_offline(self):
        mutations = [
            ("development-contract.json", lambda p: p.write_text(p.read_text().replace(
                "0044_purchase_received", "0043_email_templates"))),
            ("artifacts/api-server/backend/app/core/schema.py", lambda p: p.write_text("SCHEMA_REVISION='0043_email_templates'")),
            ("scripts/migration-policy.json", lambda p: p.write_text(p.read_text().replace('"0042_rate_hundredths": "operator_only"', '"0042_rate_hundredths": "automatic"'))),
            ("artifacts/api-server/backend/alembic/versions/0044_purchase_received.py", lambda p: p.write_text(p.read_text() + "\n# tampered\n")),
            ("scripts/development-database.json", lambda p: p.write_text(p.read_text() + " ")),
            ("artifacts/api-server/backend/alembic/env.py", lambda p: p.write_text(p.read_text() + "\n# changed\n")),
            ("scripts/development-schema-review.json", lambda p: p.write_text('{"version":1}')),
        ]
        for filename, mutate in mutations:
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                copy_source(root)
                mutate(root / filename)
                with patch("sqlalchemy.create_engine", side_effect=AssertionError("must stay offline")):
                    with self.assertRaises(Exception) as caught:
                        sync.synchronize(root=root)
                    self.assertNotIsInstance(caught.exception, AssertionError)

    def test_unclassified_revision_and_unknown_ancestry_rejected(self):
        for extra in ("revision='future'\ndown_revision='0044_purchase_received'\n",
                      "revision='future'\ndown_revision='not_supported'\n"):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                backend = copy_source(root)
                (backend / "alembic/versions/future.py").write_text(extra)
                with self.assertRaises(Exception):
                    review.review(root)

    def test_tampered_planner_rejected_before_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            copy_source(root)
            marker = root / "executed"
            (root / "scripts/deploy-migrations.py").write_text(
                f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
            with self.assertRaises(review.ReviewBlocked):
                review.review(root)
            self.assertFalse(marker.exists())

    def test_both_lifecycle_entrypoints_keep_one_sync_and_no_compatibility_probe(self):
        for name in ("start-development-api.sh", "post-merge.sh"):
            text = (ROOT / "scripts" / name).read_text()
            self.assertEqual(text.count('python -B "$ROOT/scripts/development-sync.py"'), 1)
            self.assertNotIn('python -B "$ROOT/scripts/development-preflight', text)
            self.assertNotIn("review-schema-release.py", text)

    def test_ci_source_step_stays_offline_before_postgres_toolchain(self):
        workflow = (ROOT / ".github/workflows/release-validation.yml").read_text()
        early = workflow.split("Verify development schema coordination without database access", 1)[1]
        early = early.split("Verify separately reviewed production fresh-install target", 1)[0]
        self.assertIn("run: python -B scripts/review-development-schema.py", early)
        self.assertNotIn("unittest discover", early)
        gate = (ROOT / "scripts/validate-template-preferences.sh").read_text()
        self.assertIn("test_development_sync*.py", gate)
        self.assertIn("nix-shell -p postgresql_17", workflow)


class TransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="development-sync-tests-")
        cls.socket = Path(cls.tmp.name)
        cls.data = cls.socket / "pg"
        subprocess.run(["initdb", "-D", str(cls.data), "-U", "fixture", "-A", "trust",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run(["pg_ctl", "-D", str(cls.data), "-l", str(cls.socket / "pg.log"),
                        "-o", f"-F -k {cls.socket} -c listen_addresses='' -p 55431",
                        "-w", "start"], check=True, capture_output=True)
        cls.engine = create_engine(
            f"postgresql+psycopg://fixture@/postgres?host={cls.socket}&port=55431",
            hide_parameters=True)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        subprocess.run(["pg_ctl", "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
                       check=True, capture_output=True)
        cls.tmp.cleanup()

    def setUp(self):
        self.source_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.source_tmp.cleanup)
        self.root = Path(self.source_tmp.name)
        self.backend = copy_source(self.root)
        versions = self.backend / "alembic/versions"
        shutil.rmtree(versions)
        versions.mkdir()
        (versions / "base.py").write_text(
            "revision='previous'\ndown_revision=None\ndef upgrade():\n    pass\n")
        (versions / "next.py").write_text(
            "from alembic import op\nimport sqlalchemy as sa\nrevision='next'\n"
            "down_revision='previous'\nbranch_labels=depends_on=None\n"
            "def upgrade():\n    op.create_table('notes',sa.Column('id',sa.Integer(),primary_key=True))\n"
            "def downgrade():\n    pass\n")
        (self.backend / "alembic/env.py").write_text(
            "from alembic import context\n"
            "context.configure(connection=context.config.attributes['connection'])\n"
            "with context.begin_transaction():\n    context.run_migrations()\n")
        (self.backend / "alembic.ini").write_text("[alembic]\n")
        (self.root / "development-contract.json").write_text('{"format":1,"contract":"synthetic","schema":"next"}')
        (self.root / "scripts/migration-policy.json").write_text(
            '{"version":1,"revisions":{"previous":"operator_only","next":"automatic"}}')
        with self.engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS notes")
            conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
            conn.exec_driver_sql("CREATE TABLE alembic_version (version_num varchar(64) PRIMARY KEY)")
            conn.exec_driver_sql("INSERT INTO alembic_version VALUES ('previous')")
            row = conn.exec_driver_sql(
                "SELECT current_database(), (SELECT system_identifier::text FROM pg_control_system()), "
                "(SELECT oid FROM pg_database WHERE datname=current_database())").one()
            info = conn.connection.driver_connection.info
            self.binding = dict(version=1, host=info.host, port=info.port,
                                database=row[0], cluster=row[1], oid=row[2])
        (self.root / "scripts/development-database.json").write_text(json.dumps(self.binding))
        review.refresh(self.root)
        self.settings = SimpleNamespace(app_env="development")

    def run_sync(self, check=lambda conn: None):
        return sync.synchronize(root=self.root, settings=self.settings,
                                engine=self.engine, readiness_check=check)

    def state(self):
        with self.engine.connect() as conn:
            return (conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one(),
                    conn.exec_driver_sql("SELECT to_regclass('public.notes')").scalar_one())

    def test_additive_actual_alembic_then_repeat_noop(self):
        with patch("app.fresh_install.reviewed_graph", side_effect=AssertionError(
                "stale production approval must not be consulted")) as production:
            self.assertEqual(self.run_sync(), 0)
        production.assert_not_called()
        self.assertEqual(self.state(), ("next", "notes"))
        self.assertEqual(self.run_sync(lambda _: self.fail("no-op must not run diagnostics")), 0)

    def test_postcondition_failure_rolls_back_ddl_and_revision(self):
        def fail(_):
            raise ValueError("synthetic postcondition")
        with self.assertRaises(ValueError):
            self.run_sync(fail)
        self.assertEqual(self.state(), ("previous", None))

    def test_execution_failure_rolls_back_first_ddl(self):
        path = self.backend / "alembic/versions/next.py"
        path.write_text(path.read_text().replace("def downgrade():",
            "    op.create_index('bad','absent_table',['id'])\ndef downgrade():"))
        review.refresh(self.root)
        with self.assertRaises(Exception):
            self.run_sync()
        self.assertEqual(self.state(), ("previous", None))

    def test_concurrent_startup_and_postmerge_never_double_apply(self):
        entered, release = threading.Event(), threading.Event()
        def pause(_):
            entered.set()
            if not release.wait(10):
                raise AssertionError("test coordination timeout")
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.run_sync, pause)
            try:
                self.assertTrue(entered.wait(10))
                second = pool.submit(self.run_sync)
                with self.assertRaisesRegex(sync.Blocked, "OTHER_OPERATOR_ACTIVE"):
                    second.result(timeout=10)
            finally:
                release.set()
            self.assertEqual(first.result(timeout=10), 0)
        self.assertEqual(self.run_sync(), 0)
        self.assertEqual(self.state(), ("next", "notes"))

    def test_wrong_independent_target_and_non_development_rejected(self):
        for key in ("host", "port", "database", "cluster", "oid"):
            wrong = dict(self.binding)
            wrong[key] = 1 if key in ("port", "oid") else "different"
            (self.root / "scripts/development-database.json").write_text(json.dumps(wrong))
            review.refresh(self.root)
            with self.assertRaisesRegex(sync.Blocked, "WRONG_DEVELOPMENT_DATABASE"):
                self.run_sync()
        self.settings.app_env = "production"
        with self.assertRaisesRegex(sync.Blocked, "DEVELOPMENT_ONLY"):
            self.run_sync()
        self.assertEqual(self.state(), ("previous", None))

    def test_tampered_unreviewed_or_misclassified_never_execute(self):
        path = self.backend / "alembic/versions/next.py"
        path.write_text(path.read_text().replace("op.create_table(", "op.drop_table("))
        with self.assertRaises(Exception):
            self.run_sync()
        review.refresh(self.root)  # Hash review alone is not additive permission.
        with self.assertRaises(sync.Blocked):
            self.run_sync()
        self.assertEqual(self.state(), ("previous", None))

    def test_actual_protected_path_report_without_executing_any_revision(self):
        # Real full source; only DB fixture revision/target binding are synthetic.
        shutil.rmtree(self.root)
        self.root.mkdir()
        copy_source(self.root)
        (self.root / "scripts/fresh-install-review.json").write_text('{"status":"stale"}')
        (self.root / "scripts/development-database.json").write_text(json.dumps(self.binding))
        review.refresh(self.root)
        with self.engine.begin() as conn:
            conn.exec_driver_sql("UPDATE alembic_version SET version_num='0040_po_tax_basis'")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(self.run_sync(), 42)
        report = json.loads(output.getvalue())
        self.assertEqual(report["current"], ["0040_po_tax_basis"])
        self.assertEqual(report["required"], "0044_purchase_received")
        self.assertEqual(report["pending"], report["operator_only"])
        self.assertEqual(len(report["pending"]), 4)
        self.assertEqual(report["migrations_applied"], 0)
        self.assertIn("docs/development-schema-activation.md", report["action"])
        self.assertEqual(self.state(), ("0040_po_tax_basis", None))


if __name__ == "__main__":
    unittest.main()
