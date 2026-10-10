"""Docker command tests and real export-file checks; no Docker or database."""
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("operator_recovery", ROOT / "scripts/operator-recovery.py")
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class OperatorRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.active = self.base / "active"
        self.active.mkdir()
        self.env = self.active / ".env"
        self.env.touch(mode=0o600)
        self.recovery = self.base / "recovery"
        self.recovery.mkdir(mode=0o700)

    def args(self, **changes):
        args = dict(image="evexia-backend:reviewed", network="existing_backend",
                    env_file=str(self.env), recovery_dir=str(self.recovery),
                    backup_name="recovery.json")
        args.update(changes)
        return type("Args", (), args)()

    def test_original_external_path_owner_and_deep_checkout_are_preserved(self):
        command = helper.command(self.args())
        self.assertIn(f"type=bind,src={self.recovery},dst={self.recovery}", command)
        self.assertIn(f"type=bind,src={ROOT},dst=/operator-release,readonly", command)
        self.assertEqual(command[command.index("--user") + 1],
                         f"{os.geteuid()}:{os.getegid()}")
        self.assertIn("PYTHONPATH=/operator-release/artifacts/api-server/backend", command)
        self.assertEqual(command[-5:],
                         ["-B", "-m", "app.organization_preflight", "--backup",
                          str(self.recovery / "recovery.json")])
        self.assertIn("APP_ENV=production", command)
        self.assertIn("--read-only", command)
        self.assertNotIn("alembic", command)
        self.assertNotIn("--approve-retirement", command)
        self.assertNotIn("APP_ENV=test", command)

    def test_permissive_missing_symlink_and_workspace_directories_rejected(self):
        self.recovery.chmod(0o755)
        with self.assertRaises(ValueError):
            helper.command(self.args())
        self.recovery.chmod(0o700)
        with self.assertRaises(OSError):
            helper.command(self.args(recovery_dir=str(self.base / "missing")))
        alias = self.base / "alias"
        alias.symlink_to(self.recovery)
        with self.assertRaises(ValueError):
            helper.command(self.args(recovery_dir=str(alias)))
        for directory in (ROOT, self.active):
            with self.assertRaises(ValueError):
                helper.command(self.args(recovery_dir=str(directory)))

    def test_foreign_owner_rejected(self):
        with patch.object(helper.os, "geteuid", return_value=os.geteuid() + 1):
            with self.assertRaises(ValueError):
                helper.command(self.args())

    def test_filename_traversal_existing_file_and_dangling_symlink_rejected(self):
        for name in ("", "..", ".", "../escape", "/escape"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                helper.command(self.args(backup_name=name))
        target = self.recovery / "recovery.json"
        target.touch()
        with self.assertRaises(ValueError):
            helper.command(self.args())
        target.unlink()
        target.symlink_to(self.base / "missing")
        with self.assertRaises(ValueError):
            helper.command(self.args())

    def test_invalid_paths_do_not_launch_docker_and_exit_codes_propagate(self):
        argv = ["--image", "reviewed", "--network", "existing", "--env-file", str(self.env),
                "--recovery-dir", str(self.recovery)]
        with patch.object(helper.subprocess, "run") as docker:
            docker.return_value.returncode = 2
            self.assertEqual(helper.main(argv), 2)
            docker.return_value.returncode = 0
            self.assertEqual(helper.main(argv), 0)
        self.recovery.chmod(0o755)
        with patch.object(helper.subprocess, "run") as docker, redirect_stderr(io.StringIO()):
            self.assertEqual(helper.main(argv), 1)
            docker.assert_not_called()

    def test_preflight_exports_real_restricted_file_without_database(self):
        # Exercise the original exporter/security checks; only DB access and
        # inventory/snapshot reads are mocked, not save_backup/load_backup.
        import sys
        backend = str(ROOT / "artifacts/api-server/backend")
        with patch.object(sys, "path", [backend, *sys.path]):
            from app import organization_preflight as cli
            from app.services import organization_retirement as retirement
        payload = dict(format=1, revision=retirement.PREVIOUS, database="fixture",
                       schema="public", operator_role="fixture",
                       organizations=[], memberships=[], users=[],
                       refresh_sessions=[], audit_events=[])
        target = self.recovery / "recovery.json"
        output = io.StringIO()
        settings = type("Settings", (), {"database_url": "postgresql+psycopg://unused/fixture"})()
        with patch.object(sys, "argv", ["preflight", "--backup", str(target)]), \
                patch.object(cli, "get_settings", return_value=settings), \
                patch.object(cli, "create_engine", return_value=MagicMock()), \
                patch.object(cli, "preflight", return_value={
                    "unexpected_dependency_count": 0, "revision": "0030_directory_crypto_retirement"}), \
                patch.object(retirement, "snapshot", return_value=payload), \
                redirect_stdout(output):
            self.assertEqual(cli.main(), 0)
        report = json.loads(output.getvalue())
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        self.assertEqual(report["backup_sha256"], digest)
        self.assertFalse(report["restoration_verified"])
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(retirement.load_backup(str(target), digest), payload)
        with patch.object(retirement, "snapshot", return_value=payload):
            with self.assertRaises(FileExistsError):
                retirement.save_backup(object(), str(target))
        with self.assertRaises(retirement.RetirementBlocked):
            retirement.load_backup(str(target), "0" * 64)
        target.chmod(0o640)
        with self.assertRaises(retirement.RetirementBlocked):
            retirement.load_backup(str(target), digest)
        target.chmod(0o600)
        self.recovery.chmod(0o755)
        with self.assertRaises(retirement.RetirementBlocked):
            retirement.load_backup(str(target), digest)

    def test_relative_paths_and_symlink_environment_file_rejected(self):
        with self.assertRaises(ValueError):
            helper.command(self.args(recovery_dir="relative"))
        alias = self.active / "env-alias"
        alias.symlink_to(self.env)
        with self.assertRaises(ValueError):
            helper.command(self.args(env_file=str(alias)))
        with self.assertRaises(ValueError):
            helper.command(self.args(env_file=str(self.active / "missing")))


if __name__ == "__main__":
    unittest.main()
