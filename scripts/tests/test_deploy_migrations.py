"""Pure graph/runner tests: no database, Docker, Alembic upgrade or network."""
from contextlib import redirect_stdout
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
        script = textwrap.dedent(workflow.split("          script: |\n", 1)[1])
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
        self.assertEqual(completed.returncode, 42, completed.stderr)
        self.assertEqual(release, "previous-release")
        self.assertIn("active application unchanged", completed.stdout)
        self.assertFalse(any(call[0] == "docker" and "--execute" in call for call in calls))
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))

    def test_execute_recheck_barrier_also_prevents_promotion(self):
        completed, calls, release = self.run_workflow(execute_exit=42)
        self.assertEqual(completed.returncode, 42, completed.stderr)
        self.assertEqual(release, "previous-release")
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))

    def test_automatic_path_promotes_only_after_execution_check(self):
        completed, calls, release = self.run_workflow()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(release, "a" * 40)
        execute = next(i for i, call in enumerate(calls) if call[:2] == ["docker", "run"] and "--execute" in call)
        promote = next(i for i, call in enumerate(calls) if call[:2] == ["docker", "compose"])
        self.assertLess(execute, promote)
        self.assertIn("--no-deps", calls[promote])

    def test_maintenance_and_policy_errors_do_not_touch_release(self):
        for kwargs, expected in (({"maintenance": True}, 42), ({"plan_exit": 1}, 1)):
            with self.subTest(kwargs=kwargs):
                completed, calls, release = self.run_workflow(**kwargs)
                self.assertEqual(completed.returncode, expected, completed.stderr)
                self.assertEqual(release, "previous-release")
                self.assertFalse(any(call[:2] == ["docker", "compose"] for call in calls))


if __name__ == "__main__":
    unittest.main()
