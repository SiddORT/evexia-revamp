"""Host supervisor tests: fake Docker, no network/database/services."""
import fcntl
from contextlib import redirect_stderr
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "initialize-production.py"
SPEC = importlib.util.spec_from_file_location("initialize_production", PATH)
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
ARGS = ["--expected-database", "synthetic", "--expected-system-identifier", "1",
        "--expected-host", "postgres"]


class InitializationSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("# synthetic fixture; no credentials")
        (self.root / "docker-compose.yml").write_text("services: {}")
        active = patch.object(tool, "ACTIVE", self.root)
        source = patch.object(tool, "__file__", str(self.root / "scripts/initialize-production.py"))
        active.start()
        source.start()
        self.addCleanup(active.stop)
        self.addCleanup(source.stop)
        inspect = patch.object(tool.subprocess, "check_output", return_value="existing-project\n")
        inspect.start()
        self.addCleanup(inspect.stop)

    def test_success_keeps_host_lock_during_docker_and_removes_only_own_marker(self):
        def docker(command, **kwargs):
            self.assertTrue((self.root / ".operator-maintenance").is_file())
            with (self.root / ".deploy.lock").open("r") as competing:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(tool.subprocess, "run", side_effect=docker) as run:
            self.assertEqual(tool.run(ARGS), 0)
        self.assertFalse((self.root / ".operator-maintenance").exists())
        command = run.call_args.args[0]
        self.assertIn("--no-deps", command)
        self.assertEqual(command[command.index("--workdir") + 1], "/release-source")
        self.assertEqual(command[command.index("--project-name") + 1], "existing-project")
        self.assertIn("app.initialize_database", command)
        self.assertNotIn("up", command)
        self.assertNotIn("down", command)
        self.assertNotIn("restart", command)

    def test_failure_and_interruption_retain_maintenance(self):
        for failure in ("build", "initialize", "interrupt"):
            marker = self.root / ".operator-maintenance"
            def docker(command, **kwargs):
                if failure == "build":
                    raise subprocess.CalledProcessError(1, command)
                if "run" in command and failure == "interrupt":
                    raise KeyboardInterrupt()
                return subprocess.CompletedProcess(command, 1 if "run" in command else 0)
            with patch.object(tool.subprocess, "run", side_effect=docker):
                if failure == "build":
                    with self.assertRaises(subprocess.CalledProcessError):
                        tool.run(ARGS)
                elif failure == "interrupt":
                    with self.assertRaises(KeyboardInterrupt):
                        tool.run(ARGS)
                else:
                    self.assertEqual(tool.run(ARGS), 1)
            self.assertTrue(marker.is_file())
            marker.unlink()  # disposable fixture only

    def test_existing_or_symlink_maintenance_and_lock_are_never_replaced(self):
        for name in (".operator-maintenance", ".deploy.lock"):
            path = self.root / name
            path.unlink(missing_ok=True)
            path.symlink_to(self.root / "missing")
            with patch.object(tool.subprocess, "run") as docker:
                with self.assertRaises(OSError):
                    tool.run(ARGS)
                docker.assert_not_called()
            self.assertTrue(path.is_symlink())
            path.unlink()
        marker = self.root / ".operator-maintenance"
        marker.write_text("existing operator")
        with self.assertRaises(FileExistsError):
            tool.run(ARGS)
        self.assertEqual(marker.read_text(), "existing operator")

    def test_marker_replacement_during_run_is_not_cleared(self):
        def docker(command, **kwargs):
            if "run" in command:
                marker = self.root / ".operator-maintenance"
                marker.rename(self.root / "old-marker")
                marker.write_text("different operator")
            return subprocess.CompletedProcess(command, 0)
        with patch.object(tool.subprocess, "run", side_effect=docker):
            with self.assertRaises(ValueError):
                tool.run(ARGS)
        self.assertEqual((self.root / ".operator-maintenance").read_text(), "different operator")

    def test_unidentified_running_compose_project_never_builds_or_runs(self):
        for value in ("", "<no value>", "bad project"):
            marker = self.root / ".operator-maintenance"
            marker.unlink(missing_ok=True)
            with patch.object(tool.subprocess, "check_output", return_value=value), \
                 patch.object(tool.subprocess, "run") as docker:
                with self.assertRaises(ValueError):
                    tool.run(ARGS)
                docker.assert_not_called()
            self.assertTrue(marker.is_file())

    def test_main_reports_sanitized_build_failure_and_keeps_maintenance(self):
        errors = io.StringIO()
        failure = subprocess.CalledProcessError(
            19, ["docker", "private-command-value"], stderr="private-stderr-value")
        with patch.object(tool.subprocess, "run", side_effect=failure), \
                patch.dict(os.environ, {}, clear=True), redirect_stderr(errors):
            self.assertEqual(tool.main(ARGS), 1)
        self.assertTrue((self.root / ".operator-maintenance").is_file())
        self.assertIn("CalledProcessError", errors.getvalue())
        self.assertIn("status 19", errors.getvalue())
        self.assertIn("never cleared on failure", errors.getvalue())
        self.assertNotIn("private", errors.getvalue())

    def test_main_reports_existing_marker_without_clearing_it(self):
        marker = self.root / ".operator-maintenance"
        marker.write_text("existing operator")
        errors = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(errors):
            self.assertEqual(tool.main(ARGS), 1)
        self.assertEqual(marker.read_text(), "existing operator")
        self.assertIn("FileExistsError", errors.getvalue())
