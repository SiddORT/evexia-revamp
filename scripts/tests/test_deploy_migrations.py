"""Pure graph/runner tests: no database, Docker, Alembic upgrade or network."""
from contextlib import redirect_stdout
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("deployment_migrations", ROOT / "deploy-migrations.py")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)
R = runner.Revision


class MigrationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.graph = {"base": R("base"), "safe": R("safe", ("base",)),
                      "tip": R("tip", ("safe",))}
        self.policy = {key: "automatic" for key in self.graph}

    def test_completely_automatic_path(self):
        result = runner.plan(self.graph, self.policy, ["base"], "tip")
        self.assertEqual(result["pending"], ["safe", "tip"])
        self.assertEqual(result["result"], "READY")

    def test_protected_anywhere_blocks_whole_path(self):
        self.policy["tip"] = "operator_only"
        result = runner.plan(self.graph, self.policy, ["base"], "tip")
        self.assertEqual(result["operator_only"], ["tip"])
        self.assertEqual(result["migrations_applied"], 0)
        with patch.object(runner, "applied_revisions", return_value=["base"]), \
                patch.object(runner.subprocess, "run") as execute:
            checked = runner.execute_plan(object(), self.graph, self.policy, ROOT, "tip", True)
        self.assertEqual(checked["result"], "OPERATOR_MIGRATION_REQUIRED")
        execute.assert_not_called()

    def test_missing_classification_fails_closed_even_if_applied(self):
        del self.policy["base"]
        with self.assertRaisesRegex(runner.PolicyError, "UNCLASSIFIED"):
            runner.plan(self.graph, self.policy, ["safe"], "tip")

    def test_unknown_database_revision(self):
        with self.assertRaisesRegex(runner.PolicyError, "DATABASE_REVISION"):
            runner.plan(self.graph, self.policy, ["unknown"], "tip")

    def test_unknown_dependency(self):
        self.graph["tip"] = R("tip", ("safe",), ("missing",))
        with self.assertRaisesRegex(runner.PolicyError, "UNKNOWN_REVISION"):
            runner.plan(self.graph, self.policy, ["base"], "tip")

    def test_depends_on_and_merge_both_traversed(self):
        graph = {"base": R("base"), "left": R("left", ("base",)),
                 "right": R("right", ("base",), ("left",)),
                 "merge": R("merge", ("left", "right"))}
        policy = {key: "automatic" for key in graph}
        policy["left"] = "operator_only"
        result = runner.plan(graph, policy, ["base"], "merge")
        self.assertEqual(result["pending"], ["left", "right", "merge"])
        self.assertEqual(result["operator_only"], ["left"])
        # Alembic's explicit dependency is part of the applied closure too.
        # Ignoring depends_on would incorrectly rediscover left as pending.
        resumed = runner.plan(graph, policy, ["right"], "merge")
        self.assertEqual(resumed["pending"], ["merge"])
        self.assertEqual(resumed["operator_only"], [])

    def test_protected_dependency_not_down_parent(self):
        # left is only an explicit dependency of right, not its down_revision.
        graph = {"base": R("base"), "left": R("left", ("base",)),
                 "right": R("right", ("base",), ("left",)),
                 "tip": R("tip", ("left", "right"))}
        policy = {key: "automatic" for key in graph}
        policy["left"] = "operator_only"
        self.assertIn("left", runner.plan(graph, policy, ["base"], "tip")["operator_only"])

    def test_already_applied_protected_revision_does_not_block(self):
        self.policy["safe"] = "operator_only"
        result = runner.plan(self.graph, self.policy, ["safe"], "tip")
        self.assertEqual(result["operator_only"], [])
        self.assertEqual(result["pending"], ["tip"])

    def test_multiple_source_heads(self):
        self.graph["other"] = R("other", ("base",))
        with self.assertRaisesRegex(runner.PolicyError, "SOURCE_HEADS"):
            runner.plan(self.graph, self.policy, ["base"], "tip")

    def test_multiple_empty_duplicate_database_states(self):
        for current in ([], ["base", "safe"], ["safe", "safe"]):
            with self.subTest(current=current), self.assertRaises(runner.PolicyError):
                runner.plan(self.graph, self.policy, current, "tip")

    def test_requirement_must_match_source_head(self):
        with self.assertRaisesRegex(runner.PolicyError, "REQUIREMENT"):
            runner.plan(self.graph, self.policy, ["base"], "safe")

    def test_cycle_rejected(self):
        self.graph["base"] = R("base", (), ("safe",))
        with self.assertRaisesRegex(runner.PolicyError, "CYCLIC"):
            runner.plan(self.graph, self.policy, ["base"], "tip")

    def test_execute_only_explicit_target_and_verify(self):
        with patch.object(runner, "applied_revisions", side_effect=[["base"], ["tip"]]), \
                patch.object(runner.subprocess, "run",
                             return_value=subprocess.CompletedProcess([], 0)) as execute:
            result = runner.execute_plan(object(), self.graph, self.policy, ROOT, "tip", True)
        self.assertEqual(result["migrations_applied"], 2)
        command = execute.call_args.args[0]
        self.assertEqual(command[-2:], ["upgrade", "tip"])
        self.assertNotIn("-x", command)
        self.assertNotIn("head", command)
        self.assertNotIn("stamp", command)

    def test_plan_only_and_noop_never_execute(self):
        for current, apply in ((["base"], False), (["tip"], True)):
            with patch.object(runner, "applied_revisions", return_value=current), \
                    patch.object(runner.subprocess, "run") as execute:
                runner.execute_plan(object(), self.graph, self.policy, ROOT, "tip", apply)
            execute.assert_not_called()

    def test_execution_failure_and_postcheck_mismatch(self):
        with patch.object(runner, "applied_revisions", return_value=["base"]), \
                patch.object(runner.subprocess, "run",
                             return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(runner.PolicyError, "EXECUTION_FAILED"):
                runner.execute_plan(object(), self.graph, self.policy, ROOT, "tip", True)
        with patch.object(runner, "applied_revisions", return_value=["base"]), \
                patch.object(runner.subprocess, "run",
                             return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(runner.PolicyError, "MISMATCH"):
                runner.execute_plan(object(), self.graph, self.policy, ROOT, "tip", True)

    def test_revision_ids_not_filenames(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "9999_misleading_filename.py"
            path.write_text("revision='actual'\ndown_revision=None\nbranch_labels=depends_on=None\n")
            self.assertEqual(set(runner.load_graph(Path(directory))), {"actual"})

    def test_metadata_is_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "migration.py"
            path.write_text("raise RuntimeError('must not import')\nrevision='a'\ndown_revision=None\n")
            self.assertEqual(set(runner.load_graph(Path(directory))), {"a"})
            path.write_text("revision=get_revision()\ndown_revision=None\n")
            with self.assertRaises(runner.PolicyError):
                runner.load_graph(Path(directory))

    def test_symbolic_targets_rejected(self):
        for value in ("head", "heads", "base"):
            with self.subTest(value=value), self.assertRaises(runner.PolicyError):
                runner.identifiers(value)

    def test_duplicate_policy_keys_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            path.write_text('{"version":1,"revisions":{"a":"automatic","a":"operator_only"}}')
            with self.assertRaises(runner.PolicyError):
                runner.load_policy(path)

    def test_exit_codes_and_offline_execution_refused(self):
        for classification, current, expected in (
                ("automatic", "base", 0), ("operator_only", "base", 42),
                ("automatic", "unknown", 1)):
            self.policy["tip"] = classification
            output = io.StringIO()
            with patch.object(runner, "load_graph", return_value=self.graph), \
                    patch.object(runner, "load_policy", return_value=self.policy), \
                    patch.object(runner, "literal_assignments", return_value={"SCHEMA_REVISION": "tip"}), \
                    patch.object(runner, "production_connection") as connect, redirect_stdout(output):
                code = runner.main(["--offline-current", current])
            self.assertEqual(code, expected)
            connect.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["migrations_applied"], 0)
        with redirect_stdout(io.StringIO()), patch.object(runner, "production_connection") as connect:
            self.assertEqual(runner.main(["--offline-current", "base", "--execute"]), 1)
        connect.assert_not_called()

    def test_approval_arguments_are_not_accepted_by_automatic_cli(self):
        with redirect_stdout(io.StringIO()), patch.object(runner, "production_connection") as connect:
            self.assertEqual(runner.main(["-x", "organization_removal_approved=yes"]), 1)
        connect.assert_not_called()

    def test_live_mode_requires_production_before_connecting(self):
        with patch.dict(runner.os.environ, {"APP_ENV": "development"}):
            with self.assertRaisesRegex(runner.PolicyError, "PRODUCTION"):
                with runner.production_connection(ROOT):
                    self.fail("Must reject before opening a database connection")

    def test_real_repository_policy_and_graph(self):
        backend = ROOT.parent / "artifacts/api-server/backend"
        graph = runner.load_graph(backend / "alembic/versions")
        policy = runner.load_policy(ROOT / "migration-policy.json")
        target = runner.literal_assignments(backend / "app/core/schema.py", {"SCHEMA_REVISION"})["SCHEMA_REVISION"]
        blocked = runner.plan(graph, policy, ["0030_directory_crypto_retirement"], target)
        self.assertEqual(blocked["operator_only"],
                         ["0031_remove_organizations", "0034_shared_phone_countries"])
        ready = runner.plan(graph, policy, [target], target)
        self.assertEqual(ready["pending"], [])

    def test_ci_barrier_precedes_every_promotion_and_legacy_script_not_invoked(self):
        workflow = (ROOT.parent / ".github/workflows/deploy.yml").read_text()
        self.assertLess(workflow.index("if run_policy;"), workflow.index("up -d --no-build"))
        self.assertLess(workflow.index("if run_policy --execute;"), workflow.index("up -d --no-build"))
        self.assertNotIn("/deploy-scripts/deploy.sh", workflow)
        self.assertNotIn("upgrade head", workflow)
        self.assertIn('exit "$CODE"', workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("git reset", workflow)


class DeploymentShellTests(unittest.TestCase):
    """Execute the actual CI Bash with stub tools in a disposable directory."""

    def run_workflow(self, plan_exit=0, execute_exit=0, maintenance=False):
        workflow = (ROOT.parent / ".github/workflows/deploy.yml").read_text()
        script = textwrap.dedent(
            workflow.split("          script: |\n", 1)[1]
            .split("\n      - name: Report deployment outcome", 1)[0])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active, source, tools = root / "active", root / "source", root / "tools"
            for path in (active, source, tools):
                path.mkdir()
            (active / ".env").write_text("# synthetic placeholder, no real secrets\n")
            (active / ".deployed-release").write_text("previous-release\n")
            (active / "docker-compose.yml").write_text("services: {}\n")
            (source / "docker-compose.yml").write_text("services: {}\n")
            if maintenance:
                (active / ".operator-maintenance").touch()
            log = root / "calls.jsonl"
            adapter = """\
#!/usr/bin/env python3
import json, os, sys, tarfile
tool, args = os.path.basename(sys.argv[0]), sys.argv[1:]
with open(os.environ['FAKE_LOG'], 'a') as f:
    f.write(json.dumps([tool, *args])+'\\n')
if tool == 'git':
    if 'rev-parse' in args:
        print(os.environ['DEPLOY_SHA'])
    elif 'archive' in args:
        with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as archive:
            archive.add(os.environ['FAKE_SOURCE'], arcname='.')
elif tool == 'docker':
    if args[0] == 'inspect':
        fmt=args[args.index('--format')+1]
        print('fixture-project' if 'compose.project' in fmt else
              'fixture-network' if 'Networks' in fmt else 'sha256:previous-image')
    elif args[0] == 'run':
        code=int(os.environ['EXECUTE_EXIT' if '--execute' in args else 'PLAN_EXIT'])
        print(json.dumps({'result':'OPERATOR_MIGRATION_REQUIRED' if code==42 else 'READY'}))
        sys.exit(code)
"""
            for name in ("git", "docker"):
                path = tools / name
                path.write_text(adapter)
                path.chmod(0o700)
            env = os.environ.copy()
            env.update(PATH=str(tools) + os.pathsep + env["PATH"],
                       DEPLOY_SHA="a" * 40, FAKE_LOG=str(log), FAKE_SOURCE=str(source),
                       PLAN_EXIT=str(plan_exit), EXECUTE_EXIT=str(execute_exit))
            script = script.replace("ACTIVE=/var/www/newuat.allergyevexia.in",
                                    "ACTIVE=" + str(active))
            completed = subprocess.run(["bash"], input=script, text=True, env=env,
                                       capture_output=True, timeout=15)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            release = (active / ".deployed-release").read_text().strip()
            return completed, calls, release

    def test_protected_barrier_keeps_active_release_and_never_executes_migrations(self):
        completed, calls, release = self.run_workflow(plan_exit=42)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("EVEXIA_DEPLOY_EXIT_CODE=42", completed.stdout)
        self.assertIn("EVEXIA_DEPLOY_STATUS=blocked", completed.stdout)
        self.assertEqual(release, "previous-release")
        self.assertIn("active application unchanged", completed.stdout)
        self.assertFalse(any(call[0] == "docker" and "--execute" in call for call in calls))
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))

    def test_execute_recheck_barrier_also_prevents_promotion(self):
        completed, calls, release = self.run_workflow(execute_exit=42)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("EVEXIA_DEPLOY_EXIT_CODE=42", completed.stdout)
        self.assertIn("EVEXIA_DEPLOY_STATUS=blocked", completed.stdout)
        self.assertEqual(release, "previous-release")
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))

    def test_automatic_path_promotes_only_after_execution_check(self):
        completed, calls, release = self.run_workflow()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("EVEXIA_DEPLOY_EXIT_CODE=0", completed.stdout)
        self.assertIn("EVEXIA_DEPLOY_STATUS=promoted", completed.stdout)
        self.assertEqual(release, "a" * 40)
        execute = next(i for i, call in enumerate(calls) if call[:2] == ["docker", "run"] and "--execute" in call)
        promote = next(i for i, call in enumerate(calls) if call[:2] == ["docker", "compose"])
        self.assertLess(execute, promote)
        self.assertIn("--no-deps", calls[promote])

    def test_maintenance_and_policy_errors_do_not_touch_release(self):
        for kwargs, expected in (({"maintenance": True}, 0), ({"plan_exit": 1}, 1)):
            with self.subTest(kwargs=kwargs):
                completed, calls, release = self.run_workflow(**kwargs)
                self.assertEqual(completed.returncode, expected, completed.stderr)
                self.assertEqual(release, "previous-release")
                self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))


class GitHubDeploymentResultTests(unittest.TestCase):
    def report(self, stdout, outcome="success"):
        workflow = (ROOT.parent / ".github/workflows/deploy.yml").read_text()
        step = workflow.split("      - name: Report deployment outcome\n", 1)[1]
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            output, summary = Path(directory) / "output", Path(directory) / "summary"
            env = os.environ.copy()
            env.update(DEPLOY_STDOUT=stdout, SSH_OUTCOME=outcome,
                       GITHUB_OUTPUT=str(output), GITHUB_STEP_SUMMARY=str(summary))
            result = subprocess.run(["bash"], input=script, text=True, env=env,
                                    capture_output=True, timeout=10)
            return result, output.read_text(), summary.read_text()

    def test_exit_42_is_explicitly_blocked_not_promoted(self):
        remote, calls, release = DeploymentShellTests().run_workflow(plan_exit=42)
        result, output, summary = self.report(remote.stdout)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "status=blocked\n")
        self.assertIn("DEPLOYMENT BLOCKED — OPERATOR MIGRATION REQUIRED", summary)
        self.assertIn("Candidate not promoted; active application unchanged", summary)
        self.assertIn("::warning::", result.stdout)
        self.assertNotIn("DEPLOYMENT PROMOTED", summary)
        self.assertEqual(release, "previous-release")
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))

    def test_zero_is_promoted_only_with_matching_success_marker(self):
        remote, _, _ = DeploymentShellTests().run_workflow()
        result, output, summary = self.report(remote.stdout)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "status=promoted\n")
        self.assertIn("DEPLOYMENT PROMOTED", summary)

    def test_other_nonzero_and_ssh_failures_remain_failures(self):
        for code in (1, 2, 125, 255):
            with self.subTest(code=code):
                result, output, summary = self.report(
                    f"EVEXIA_DEPLOY_EXIT_CODE={code}\n", outcome="failure")
                self.assertEqual(result.returncode, 1)
                self.assertEqual(output, "status=failed\n")
                self.assertIn("DEPLOYMENT FAILED", summary)
        result, output, _ = self.report(
            "EVEXIA_DEPLOY_EXIT_CODE=42\nEVEXIA_DEPLOY_STATUS=blocked\n",
            outcome="failure")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(output, "status=failed\n")

    def test_missing_mismatched_duplicate_or_unclassified_results_fail_closed(self):
        for stdout in (
                "",
                "EVEXIA_DEPLOY_EXIT_CODE=0\n",
                "EVEXIA_DEPLOY_EXIT_CODE=42\n",
                "EVEXIA_DEPLOY_EXIT_CODE=0\nEVEXIA_DEPLOY_STATUS=blocked\n",
                "EVEXIA_DEPLOY_EXIT_CODE=42\nEVEXIA_DEPLOY_STATUS=promoted\n",
                "EVEXIA_DEPLOY_EXIT_CODE=42\nEVEXIA_DEPLOY_EXIT_CODE=42\nEVEXIA_DEPLOY_STATUS=blocked\n"):
            with self.subTest(stdout=stdout):
                result, output, _ = self.report(stdout)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(output, "status=failed\n")

    def test_workflow_does_not_blanket_ignore_errors(self):
        workflow = (ROOT.parent / ".github/workflows/deploy.yml").read_text()
        self.assertNotIn("continue-on-error", workflow)
        self.assertIn("capture_stdout: true", workflow)
        self.assertIn("deployment_status: ${{ steps.deployment_result.outputs.status }}", workflow)
        self.assertIn("cancel-in-progress: false", workflow)


class OperatorSafetyTests(unittest.TestCase):
    """Real Linux FD/lock checks on temporary files; backend body is stubbed."""

    def exercise(self, mode="exclusive", changes=None, attest=True, restore=True,
                 restored_digest=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts, active = root / "scripts", root / "active"
            scripts.mkdir()
            active.mkdir()
            (root / "artifacts/api-server/backend").mkdir(parents=True)
            lock, marker = active / ".deploy.lock", active / ".operator-maintenance"
            lock.touch()
            marker.touch()
            backup = root / "synthetic-backup.json"
            backup.write_text('{"synthetic": true}\n')
            source = (ROOT / "operator-retirement.sh").read_text()
            # Relocate ONLY the fixed constant in a disposable script copy.
            # Production code has no path-override/testing environment escape.
            source = source.replace(
                "DEPLOY_LOCK=/var/www/newuat.allergyevexia.in/.deploy.lock",
                "DEPLOY_LOCK=" + str(lock))
            script = scripts / "operator-retirement.sh"
            script.write_text(source)
            sentinel = root / "backend-entered"
            interpreter = root / "guard-python"
            interpreter.write_text(
                "#!" + sys.executable + "\n"
                "import os, sys\n"
                "sys.argv = sys.argv[1:]\n"
                "body = sys.stdin.read()\n"
                "if 'import importlib.util' in body:\n"
                "    open(os.environ['TEST_SENTINEL'], 'w').write('backend body stubbed')\n"
                "else:\n"
                "    exec(compile(body, '<operator-lock-check>', 'exec'))\n")
            interpreter.chmod(0o700)
            fd = os.open(lock, os.O_RDWR)
            try:
                if mode == "exclusive":
                    fcntl.flock(fd, fcntl.LOCK_EX)
                elif mode == "shared":
                    fcntl.flock(fd, fcntl.LOCK_SH)
                elif mode == "posix":
                    fcntl.lockf(fd, fcntl.LOCK_EX)
                env = os.environ.copy()
                env.update(APP_ENV="production", EVEXIA_DEPLOY_LOCK=str(lock),
                           EVEXIA_DEPLOY_LOCK_FD=str(fd),
                           EVEXIA_OPERATOR_PYTHON=str(interpreter),
                           TEST_SENTINEL=str(sentinel))
                if changes:
                    changes(root, lock, marker, env)
                digest = "a" * 64
                args = ["bash", str(script), "--backup", str(backup), "--sha256", digest,
                        "--approve-retirement", "--writers-stopped",
                        "--external-consumers-reviewed", "--backup-durable",
                        "--retention-resolved", "--approve-phone-continuation"]
                if restore:
                    args += ["--restore-verified", restored_digest or digest]
                if attest:
                    args += ["--attest-restoration-rehearsal"]
                result = subprocess.run(args, env=env, pass_fds=(fd,), text=True,
                                        capture_output=True, timeout=10)
                entered = sentinel.exists()
                # For the valid unchanged path, prove the guard did not release
                # or silently acquire/upgrade the supervisor's lock.
                if not changes:
                    probe = os.open(lock, os.O_RDWR)
                    try:
                        if mode == "exclusive":
                            with self.assertRaises(BlockingIOError):
                                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        elif mode == "unlocked":
                            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        elif mode == "shared":
                            fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
                    finally:
                        os.close(probe)
                return result, entered, marker.is_file()
            finally:
                os.close(fd)

    def assert_rejected(self, **kwargs):
        result, entered, _ = self.exercise(**kwargs)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(entered, "Rejected prerequisites must not reach backend/database code")
        return result

    def test_fixed_operator_path_matches_unchanged_ci_path(self):
        operator = (ROOT / "operator-retirement.sh").read_text()
        ci = (ROOT.parent / ".github/workflows/deploy.yml").read_text()
        path = "/var/www/newuat.allergyevexia.in"
        self.assertIn("DEPLOY_LOCK=" + path + "/.deploy.lock", operator)
        self.assertIn("ACTIVE=" + path, ci)
        self.assertNotIn('flock -n "$EVEXIA_DEPLOY_LOCK_FD"', operator)

    def test_canonical_already_exclusively_locked_descriptor_accepted(self):
        result, entered, marker = self.exercise()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(entered)
        self.assertTrue(marker, "Operator completion must not clear maintenance automatically")

    def test_unlocked_shared_and_posix_descriptors_rejected(self):
        for mode in ("unlocked", "shared", "posix"):
            with self.subTest(mode=mode):
                self.assert_rejected(mode=mode)

    def test_alternate_or_alias_lock_path_rejected(self):
        for path in ("other", "alias"):
            def change(root, lock, marker, env):
                env["EVEXIA_DEPLOY_LOCK"] = (
                    str(root / ".deploy.lock") if path == "other"
                    else str(lock.parent / "child") + "/../.deploy.lock")
                (root / ".operator-maintenance").touch()
            with self.subTest(path=path):
                self.assert_rejected(changes=change)

    def test_lock_descriptor_inode_replacement_rejected(self):
        def change(root, lock, marker, env):
            lock.unlink()
            lock.touch()
        self.assert_rejected(changes=change)

    def test_symlink_lock_and_ancestor_rejected(self):
        for ancestor in (False, True):
            def change(root, lock, marker, env):
                if ancestor:
                    active = lock.parent
                    active.rename(root / "real-active")
                    active.symlink_to(root / "real-active", target_is_directory=True)
                else:
                    target = root / "real-lock"
                    lock.rename(target)
                    lock.symlink_to(target)
            with self.subTest(ancestor=ancestor):
                self.assert_rejected(changes=change)

    def test_missing_symlink_or_directory_marker_rejected(self):
        for kind in ("missing", "symlink", "dangling", "directory"):
            def change(root, lock, marker, env):
                marker.unlink()
                if kind == "directory":
                    marker.mkdir()
                elif kind in ("symlink", "dangling"):
                    target = root / "other-marker"
                    if kind == "symlink":
                        target.touch()
                    marker.symlink_to(target)
            with self.subTest(kind=kind):
                self.assert_rejected(changes=change)

    def test_wrong_missing_or_standard_stream_descriptor_rejected(self):
        for value in ("999999", "0", "not-a-descriptor", None):
            def change(root, lock, marker, env):
                if value is None:
                    env.pop("EVEXIA_DEPLOY_LOCK_FD")
                else:
                    env["EVEXIA_DEPLOY_LOCK_FD"] = value
            with self.subTest(value=value):
                self.assert_rejected(changes=change)

    def test_integrity_and_matching_digest_without_separate_attestation_rejected(self):
        result = self.assert_rejected(attest=False)
        self.assertIn("backup integrity is not rehearsal evidence", result.stderr)

    def test_restoration_attestation_does_not_replace_matching_backup_digest(self):
        self.assert_rejected(restore=False)
        self.assert_rejected(restored_digest="b" * 64)

    def test_attestation_and_legacy_migration_evidence_gates_preserved(self):
        source = (ROOT / "operator-retirement.sh").read_text()
        self.assertIn("RESTORATION_ATTESTED=no", source)
        self.assertIn("organization_retirement.load_backup(backup, digest)", source)
        self.assertIn("organization_restore_verified={attested_backup_digest}", source)
        for gate in ("organization_removal_approved", "organization_writers_stopped",
                     "organization_external_consumers_reviewed", "organization_backup_durable",
                     "organization_retention_resolved"):
            self.assertIn(gate + "=yes", source)


if __name__ == "__main__":
    unittest.main()
