"""Partition/invalidation tests; no product data or credentials are used."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("local_release_checks",
                                            ROOT / "scripts/local-release-checks.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class LocalReleaseChecksTest(unittest.TestCase):
    def test_coverage_comparison_cannot_hide_a_missing_case_or_backend_group(self):
        import copy
        coverage_spec = importlib.util.spec_from_file_location(
            "release_coverage", ROOT / "scripts/compare-release-coverage.py")
        coverage = importlib.util.module_from_spec(coverage_spec)
        coverage_spec.loader.exec_module(coverage)
        before = {"failure": False, "other_skips": [], "node_skipped": [0],
                  "groups": {"node": [5, 4], "pytest": [41], "unittest": [7, 137]},
                  "totals": {"playwright": 2}, "browser_cases": ["case-a", "case-b"],
                  "bootstrap_checks": 1}
        after = copy.deepcopy(before)
        after["groups"]["node"].append(4)
        after["bootstrap_checks"] += 1
        after["groups"]["unittest"][-1] += 9
        self.assertTrue(coverage.partitioned_equal(before, after, 9))
        after["browser_cases"][-1] = "different-case"
        self.assertFalse(coverage.partitioned_equal(before, after, 9))
        after["browser_cases"] = before["browser_cases"]
        after["groups"]["pytest"] = [40]
        self.assertFalse(coverage.partitioned_equal(before, after, 9))

    def test_preview_partition_is_an_exact_disjoint_cover(self):
        original = checks.default_specs()
        groups = checks.preview_groups(original)
        self.assertEqual(len(original), 41)
        self.assertEqual(sorted(original), sorted(s for group in groups for s in group))
        for group in groups:
            if len(group) > 1:
                self.assertLessEqual(len(group), 4)
                self.assertFalse(any(Path(s).name.split(".")[0] in checks.SEPARATE for s in group))

    def test_every_nondefault_command_and_environment_is_preserved(self):
        import shlex
        expected = []
        for line in (ROOT / "scripts/validate-template-preferences.sh").read_text().splitlines():
            if line.startswith("run ") or line.startswith("EVEXIA_TEST_DEVELOPMENT_GATE=1 run "):
                tokens = shlex.split(line)
                env = {}
                if tokens[0].startswith("EVEXIA_"):
                    key, value = tokens.pop(0).split("=", 1)
                    env[key] = value
                argv = tokens[1:]
                if argv != ["sh", checks.HARNESS]:
                    expected.append(checks.command(argv, env))
        stages = checks.plan()
        actual = [c for s in stages for c in s["commands"]]
        for entry in expected:
            self.assertEqual(actual.count(entry), 1, entry)

    def test_both_remaining_policy_commands_are_required(self):
        import json
        policy = json.loads((ROOT / "scripts/release-authorization-policy.json").read_text())
        actual = checks.plan()
        for i, argv in enumerate(policy["validation_commands"][1:], 2):
            self.assertEqual(next(s for s in actual if s["name"] == f"policy-{i:02}")["commands"],
                             [checks.command(argv)])
        with patch.object(checks.tomllib, "loads", return_value={"workflows": {"workflow": []}}):
            with self.assertRaisesRegex(ValueError, "Required validation"):
                checks.audit()
        selected = [
            {"name": "release" if s["name"] == "services" else "release-" + s["name"],
             "metadata": {"isValidation": True},
             "tasks": [{"task": "shell.exec",
                        "args": "python3 -B scripts/local-release-checks.py run " + s["name"]}]}
            for s in actual if not s["name"].startswith("browser-")]
        selected.append({"name": "release-coverage", "metadata": {"isValidation": True},
                         "tasks": [{"task": "shell.exec", "args":
                                    "python3 -B scripts/local-release-checks.py audit --without-browser"}]})
        with patch.object(checks.tomllib, "loads",
                          return_value={"workflows": {"workflow": selected}}):
            checks.audit(without_browser=True)
            with self.assertRaisesRegex(ValueError, "Required validation"):
                checks.audit()
            selected.pop(0)
            with self.assertRaisesRegex(ValueError, "Required validation"):
                checks.audit(without_browser=True)

    def test_duplicates_and_nonexistent_specs_fail(self):
        specs = checks.default_specs()
        with self.assertRaises(ValueError):
            checks.preview_groups([specs[0], specs[0]])
        with self.assertRaises(ValueError):
            checks.preview_groups(["missing.preview.spec.mjs"])

    def test_schema_dependency_or_plan_drift_rejects_receipts(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "session.json").write_text(json.dumps(
                {"source": "old", "cache": directory, "stages": checks.plan()}))
            with patch.object(checks, "STATE", state), patch.object(checks, "source_key", return_value="new"):
                with self.assertRaisesRegex(ValueError, "changed"):
                    checks.session()

    def test_missing_private_cache_fails_instead_of_reusing_results(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "session.json").write_text(json.dumps(
                {"source": "key", "cache": str(state / "absent"), "stages": checks.plan()}))
            with patch.object(checks, "STATE", state), patch.object(checks, "source_key", return_value="key"):
                with self.assertRaisesRegex(ValueError, "disappeared"):
                    checks.session()

    def test_verification_requires_every_current_successful_stage(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            data = {"source": "key", "stages": [{"name": "a"}, {"name": "b"}]}
            (state / "a.result.json").write_text(json.dumps(
                {"source": "key", "returncode": 0, "seconds": 1}))
            with patch.object(checks, "STATE", state), patch.object(checks, "session", return_value=data):
                with self.assertRaises(FileNotFoundError):
                    checks.verify()
                (state / "b.result.json").write_text(json.dumps(
                    {"source": "key", "returncode": 1, "seconds": 1}))
                with self.assertRaises(ValueError):
                    checks.verify()

    def test_failed_stage_returns_failure_and_never_runs_later_commands(self):
        import sys
        import json
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            data = {"source": "key", "cache": directory, "stages": [{"name": "fail", "commands": [
                checks.command([sys.executable, "-c", "raise SystemExit(7)"]),
                checks.command([sys.executable, "-c", "raise AssertionError('must not run')"]),
            ]}]}
            with patch.object(checks, "STATE", state), patch.object(checks, "session", return_value=data), \
                    patch.object(checks, "source_key", return_value="key"):
                self.assertEqual(checks.run("fail"), 7)
            result = json.loads((state / "fail.result.json").read_text())
            self.assertEqual(result["returncode"], 7)
            self.assertNotIn("must not run", (state / "fail.log").read_text())
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(checks, "STATE", Path(directory)), \
                    patch.object(checks, "source_key", return_value="key"), \
                    patch.object(checks, "session", side_effect=ValueError("old source")), \
                    patch.object(checks, "prepare") as prepare, \
                    patch.object(checks, "run", return_value=0) as run, \
                    patch.object(sys, "argv", ["local-release-checks.py", "run", "api-staff"]):
                self.assertEqual(checks.main(), 0)
                prepare.assert_called_once()
                run.assert_called_once_with("api-staff")
            with patch.object(checks, "STATE", Path(directory)), \
                    patch.object(checks, "source_key", side_effect=["old", "new"]), \
                    patch.object(sys, "argv", ["local-release-checks.py", "run", "api-staff"]):
                with self.assertRaisesRegex(ValueError, "while queued"):
                    checks.main()
