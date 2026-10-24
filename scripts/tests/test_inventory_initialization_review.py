"""Database-free operator guard checks; never import backend configuration or connect.

Compile the actual operator function nodes without its backend imports. Only
settings/SQL/session boundaries are replaced; no migration or recovery is run.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/initialize-inventory.py"
TREE = ast.parse(SOURCE.read_text())
REVISION = next(ast.literal_eval(n.value) for n in TREE.body
                if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "REVISION" for t in n.targets))


def functions():
    namespace = dict(argparse=argparse, ast=ast, hashlib=hashlib, json=json,
                     os=os, Path=Path, uuid=uuid, ROOT=ROOT, REVISION=REVISION,
                     SCHEMA_REVISION=REVISION, text=lambda value: value, __doc__="")
    nodes = [n for n in TREE.body if isinstance(n, ast.FunctionDef)]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


class SourceReviewTests(unittest.TestCase):
    def setUp(self):
        self.fn = functions()

    def test_older_operator_scope_refuses_the_newer_source_pin(self):
        self.assertEqual(REVISION, "0055_mr_staff_managers")
        schema = ast.parse((ROOT / "artifacts/api-server/backend/app/core/schema.py").read_text())
        self.fn["SCHEMA_REVISION"] = next(ast.literal_eval(n.value) for n in schema.body
                                         if isinstance(n, ast.Assign)
                                         and any(isinstance(t, ast.Name) and t.id == "SCHEMA_REVISION"
                                                 for t in n.targets))
        with self.assertRaisesRegex(RuntimeError, "Inventory source review is still pending"):
            self.fn["source_review"]()

    def fixture(self, root):
        versions = root / "artifacts/api-server/backend/alembic/versions"
        versions.mkdir(parents=True)
        (root / "scripts").mkdir()
        # Deliberately unlike the revision name, as in historical migrations.
        migration = versions / "0001_different_filename.py"
        migration.write_text("revision = '0001_identity'\n")
        (root / "development-contract.json").write_text(json.dumps({"schema": REVISION}))
        self.review = dict(target=REVISION, revisions={
            "0001_identity": hashlib.sha256(migration.read_bytes()).hexdigest()})
        self.fn["ROOT"] = root
        self.save_review()
        return versions, migration

    def save_review(self):
        (self.fn["ROOT"] / "scripts/development-schema-review.json").write_text(json.dumps(self.review))

    def test_historical_filename_is_checked_not_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            _, migration = self.fixture(Path(directory))
            self.fn["source_review"]()
            migration.write_text("revision = '0001_identity'\n# changed\n")
            with self.assertRaisesRegex(RuntimeError, "inventory changed"):
                self.fn["source_review"]()

    def test_missing_extra_and_duplicate_migrations_block(self):
        for change in ("missing", "future", "duplicate"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                versions, migration = self.fixture(Path(directory))
                if change == "missing":
                    migration.unlink()
                else:
                    (versions / "extra.py").write_text(
                        "revision = " + repr("0055_future" if change == "future" else "0001_identity"))
                with self.assertRaises(RuntimeError):
                    self.fn["source_review"]()

    def test_contract_manifest_and_api_cannot_widen_fixed_revision(self):
        for field in ("manifest", "contract", "api", "all"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fn = functions()
                self.fixture(root)
                if field in ("manifest", "all"):
                    self.review["target"] = "0055_future"
                    self.save_review()
                if field in ("contract", "all"):
                    (root / "development-contract.json").write_text('{"schema":"0055_future"}')
                if field in ("api", "all"):
                    self.fn["SCHEMA_REVISION"] = "0055_future"
                with self.assertRaisesRegex(RuntimeError, "review is still pending"):
                    self.fn["source_review"]()


class TargetAndApprovalTests(unittest.TestCase):
    def setUp(self):
        self.fn = functions()
        self.target = dict(workspace="approved-workspace", host="approved-host", port=5432,
                           database="approved-db", cluster="12345", oid=42)
        self.settings = SimpleNamespace(app_env="development", database_url="unused")
        self.fn["get_settings"] = lambda: self.settings
        self.fn["make_url"] = lambda _: SimpleNamespace(host="approved-host", port=5432,
                                                       database="approved-db")
        self.db = Mock()
        self.db.execute.return_value.one.return_value = ("approved-db", 42, "12345")
        self.db.scalars.return_value = [REVISION]

    def check_target(self):
        with patch.dict(os.environ, REPL_ID="approved-workspace"):
            self.fn["target_matches"](self.db, self.target)

    def test_exact_target_and_single_revision_succeed(self):
        self.check_target()

    def test_old_future_empty_and_multiple_heads_block(self):
        for versions in ([], ["0046_live_inventory"], ["0053_email_invitations"],
                         ["0055_future"], [REVISION, "0055_future"]):
            with self.subTest(versions=versions):
                self.db.scalars.return_value = versions
                with self.assertRaisesRegex(RuntimeError, "Exact automatically synchronized"):
                    self.check_target()

    def test_each_independent_target_field_is_required(self):
        for key in self.target:
            with self.subTest(key=key):
                original = self.target
                self.target = {**original, key: "not-approved"}
                with self.assertRaises(RuntimeError):
                    self.check_target()
                self.target = original
        self.target["extra"] = "not-allowed"
        with self.assertRaisesRegex(RuntimeError, "exactly workspace"):
            self.check_target()

    def test_production_is_blocked_before_database_read(self):
        self.settings.app_env = "production"
        with self.assertRaisesRegex(RuntimeError, "Only development"):
            self.check_target()
        self.db.execute.assert_not_called()

    def main(self, review, flags=()):
        self.fn["source_review"] = Mock()
        self.fn["json_file"] = lambda path: self.target if path.name == "target.json" else review
        self.fn["session_factory"] = Mock(side_effect=AssertionError("Must not connect"))
        with tempfile.TemporaryDirectory() as directory:
            argv = ["initialize-inventory.py", "--apply-reviewed", "review.json",
                    "--target-confirmation", "target.json", "--output", directory + "/new.json", *flags]
            with patch("sys.argv", argv):
                self.fn["main"]()

    def test_every_approval_is_required_before_connection(self):
        approvals = ["--approve-initialization", "--attest-restored-private-backup",
                     "--attest-key-recovery", "--writers-stopped"]
        for missing in approvals:
            with self.subTest(missing=missing), self.assertRaisesRegex(RuntimeError, "Exact operation approval"):
                self.main({}, [flag for flag in approvals if flag != missing])
            self.fn["session_factory"].assert_not_called()

    def test_old_report_or_changed_target_cannot_be_applied(self):
        flags = ["--approve-initialization", "--attest-restored-private-backup",
                 "--attest-key-recovery", "--writers-stopped"]
        for review in (dict(schema="0053_email_invitations", target=self.target),
                       dict(schema=REVISION, target={**self.target, "host": "other"})):
            with self.assertRaisesRegex(RuntimeError, "Reviewed target differs"):
                self.main(review, flags)
            self.fn["session_factory"].assert_not_called()

    def test_private_reports_do_not_overwrite_or_print_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review.json"
            self.fn["write_private"](path, {"reviewToken": "synthetic-private-token"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                self.fn["write_private"](path, {})
            self.assertEqual(json.loads(path.read_text()), {"reviewToken": "synthetic-private-token"})


if __name__ == "__main__":
    unittest.main()
