"""Scope, recovery and real inherited host-lock tests; no managed DB/network."""
from contextlib import contextmanager, redirect_stdout
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import hostname_recovery as recovery

SPEC = importlib.util.spec_from_file_location("operator_hostnames", SCRIPTS / "operator-hostnames.py")
scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope)


def evidence(plan, dump):
    return {
        "format": 1, "migration": scope.TARGET, "predecessor_revision": scope.PREDECESSOR,
        "plan_sha256": recovery.canonical_digest(plan),
        "backup_sha256": hashlib.sha256(dump).hexdigest(),
        "restored_backup_sha256": hashlib.sha256(dump).hexdigest(),
        "backup_format": "postgresql_custom", "backup_scope": "full_database_all_schemas",
        **{key: True for key in (
            "backup_durable", "backup_after_writer_exclusion", "archive_list_verified",
            "restoration_rehearsal_passed", "full_restore_checks_passed", "matching_keys_recoverable",
        )},
        **{key: str(uuid.uuid4()) for key in ("backup_ref", "rehearsal_ref", "key_inventory_ref", "change_ref")},
    }


class FixedScopeTests(unittest.TestCase):
    def setUp(self):
        self.runner = scope.runner_module()
        self.plan = {"only_migration": scope.TARGET, "current": [scope.PREDECESSOR]}
        self.args = SimpleNamespace(approve_hostnames=True, writers_stopped=True, recovery_reviewed=True,
                                    approval=recovery.canonical_digest(self.plan), release_sha="a" * 40,
                                    backup="private-backup", recovery_evidence="private-evidence")

    def test_full_policy_is_still_blocked_but_scoped_validation_is_additive_only(self):
        with self.reviewed_snapshot():
            protected = scope.verify_scope(self.runner, [scope.PREDECESSOR])
        self.assertEqual(protected, ["0031_remove_organizations", "0034_shared_phone_countries"])
        self.assertEqual(scope.migration_command()[-2:], ["upgrade", "0031_role_hostnames"])
        self.assertNotIn("head", scope.migration_command())

    @contextmanager
    def reviewed_snapshot(self):
        """Historical unit fixture only; never approve the live post-review head."""
        graph = self.runner.load_graph(scope.BACKEND / "alembic/versions")
        policy = self.runner.load_policy(scope.ROOT / "scripts/migration-policy.json")
        retained, pending = set(), [scope.REVIEWED_HEAD]
        while pending:
            revision = pending.pop()
            if revision not in retained:
                retained.add(revision)
                pending.extend(graph[revision].down_revision + graph[revision].depends_on)
        with patch.object(self.runner, "load_graph",
                          return_value={key: graph[key] for key in retained}), \
                patch.object(self.runner, "load_policy",
                             return_value={key: policy[key] for key in retained}), \
                patch.object(self.runner, "literal_assignments",
                             return_value={"SCHEMA_REVISION": scope.REVIEWED_HEAD}):
            yield

    def test_actual_current_release_requires_new_operator_review(self):
        current = self.runner.literal_assignments(
            scope.BACKEND / "app/core/schema.py", {"SCHEMA_REVISION"})["SCHEMA_REVISION"]
        self.assertNotEqual(current, scope.REVIEWED_HEAD)
        with self.assertRaisesRegex(recovery.ScopeError, "CHANGED_RELEASE_REQUIRES_NEW_OPERATOR_REVIEW"):
            scope.verify_scope(self.runner, [scope.PREDECESSOR])

    def test_all_other_revisions_multiple_heads_and_replays_are_rejected(self):
        for current in ([], [scope.TARGET], ["0031_remove_organizations"],
                        ["0033_merge_directory_branches"], ["0034_shared_phone_countries"],
                        ["unknown"], [scope.PREDECESSOR, scope.TARGET]):
            with self.assertRaises(recovery.ScopeError):
                scope.verify_scope(self.runner, current)

    def test_dependency_or_policy_changes_never_enable_a_later_migration(self):
        with self.reviewed_snapshot():
            graph = self.runner.load_graph(scope.BACKEND / "alembic/versions")
            policy = self.runner.load_policy(scope.ROOT / "scripts/migration-policy.json")
            original = graph[scope.TARGET]
            for node in (
                self.runner.Revision(scope.TARGET, ("0031_remove_organizations",)),
                self.runner.Revision(scope.TARGET, (scope.PREDECESSOR,), ("0034_shared_phone_countries",)),
            ):
                altered = {**graph, scope.TARGET: node}
                with patch.object(self.runner, "load_graph", return_value=altered):
                    with self.assertRaises(Exception):
                        scope.verify_scope(self.runner, [scope.PREDECESSOR])
            with patch.object(self.runner, "load_policy", return_value={**policy, scope.TARGET: "operator_only"}):
                with self.assertRaises(recovery.ScopeError):
                    scope.verify_scope(self.runner, [scope.PREDECESSOR])
        self.assertEqual(graph[scope.TARGET], original)

    def test_cli_has_no_target_head_retirement_or_shortcut_arguments(self):
        for options in (["--target", "head"], ["--target", "0034_shared_phone_countries"],
                        ["--approve-retirement"], ["--approve-phone-continuation"], ["--exec"],
                        ["--execute", "--inspect"], ["-x", "organization_removal_approved=yes"]):
            with self.assertRaises(recovery.ScopeError):
                scope.parser().parse_args(["--inspect", "--release-sha", "a" * 40, *options])

    def test_changed_source_environment_revision_and_unclassified_graph_fail(self):
        graph = self.runner.load_graph(scope.BACKEND / "alembic/versions")
        for target in ("0035_future", None):
            with patch.object(self.runner, "load_graph", return_value=graph), \
                    patch.object(self.runner, "literal_assignments", return_value={"SCHEMA_REVISION": target}):
                with self.assertRaises(recovery.ScopeError):
                    scope.verify_scope(self.runner, [scope.PREDECESSOR])
        policy = self.runner.load_policy(scope.ROOT / "scripts/migration-policy.json")
        with patch.object(self.runner, "load_policy", return_value={k: v for k, v in policy.items() if k != scope.TARGET}):
            with self.assertRaises(Exception):
                scope.verify_scope(self.runner, [scope.PREDECESSOR])

    def test_pinned_clean_source_and_fixed_migration_environment_hashes(self):
        outputs = [
            SimpleNamespace(stdout="a" * 40 + "\n", returncode=0),
            SimpleNamespace(returncode=0), SimpleNamespace(stdout="", returncode=0),
        ]
        with patch.object(scope.subprocess, "run", side_effect=outputs), \
                patch.object(scope, "file_digest", side_effect=[scope.MIGRATION_SHA, scope.ENV_SHA]):
            scope.verify_source("a" * 40)
        for bad_outputs, digests in (
            ([SimpleNamespace(stdout="b" * 40, returncode=0), *outputs[1:]], [scope.MIGRATION_SHA, scope.ENV_SHA]),
            ([outputs[0], SimpleNamespace(returncode=1), outputs[2]], [scope.MIGRATION_SHA, scope.ENV_SHA]),
            ([*outputs[:2], SimpleNamespace(stdout="alembic/extra.py\n", returncode=0)], [scope.MIGRATION_SHA, scope.ENV_SHA]),
            (outputs, ["b" * 64, scope.ENV_SHA]), (outputs, [scope.MIGRATION_SHA, "b" * 64]),
        ):
            with patch.object(scope.subprocess, "run", side_effect=bad_outputs), \
                    patch.object(scope, "file_digest", side_effect=digests):
                with self.assertRaises(recovery.ScopeError):
                    scope.verify_source("a" * 40)

    def test_success_executes_exactly_one_command_and_verifies_result(self):
        progress = {"attempted": False}
        @contextmanager
        def valid(*args):
            yield {}
        with patch.object(scope, "verified_recovery", valid), \
                patch.object(scope, "require_host_interlock"), patch.object(scope, "verify_source"), \
                patch.object(scope, "inspect_database", return_value=self.plan), \
                patch.object(scope, "verify_result") as verified, \
                patch.object(scope.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            result = scope.execute_scoped(object(), self.runner, self.args, self.plan, progress)
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0], scope.migration_command())
            self.assertEqual(run.call_args.args[0][-1], scope.TARGET)
            self.assertEqual(run.call_args.kwargs["env"]["PYTHONPATH"], str(scope.BACKEND))
            self.assertEqual(run.call_args.kwargs["stderr"], subprocess.DEVNULL)
            verified.assert_called_once()
        self.assertTrue(progress["attempted"])
        self.assertEqual(result["migrations_applied"], 1)

    def test_every_missing_approval_and_stale_plan_blocks_before_subprocess(self):
        for key in ("approve_hostnames", "writers_stopped", "recovery_reviewed", "backup", "recovery_evidence", "approval"):
            args = SimpleNamespace(**vars(self.args))
            setattr(args, key, False if key in ("approve_hostnames", "writers_stopped", "recovery_reviewed") else None)
            with patch.object(scope.subprocess, "run") as run:
                with self.assertRaises(recovery.ScopeError):
                    scope.execute_scoped(object(), self.runner, args, self.plan)
                run.assert_not_called()

    def test_changed_plan_and_recovery_fail_without_a_migration(self):
        @contextmanager
        def valid(*args):
            yield {}
        for changed in (True, False):
            @contextmanager
            def bad(*args):
                raise recovery.ScopeError("RECOVERY_ATTESTATIONS_REQUIRED")
                yield
            with patch.object(scope, "verified_recovery", valid if changed else bad), \
                    patch.object(scope, "require_host_interlock"), patch.object(scope, "verify_source"), \
                    patch.object(scope, "inspect_database", return_value={**self.plan, "changed": True}), \
                    patch.object(scope.subprocess, "run") as run:
                with self.assertRaises(recovery.ScopeError):
                    scope.execute_scoped(object(), self.runner, self.args, self.plan)
                run.assert_not_called()

    def test_failure_timeout_and_verification_failure_never_continue_or_retry(self):
        @contextmanager
        def valid(*args):
            yield {}
        for effect in (SimpleNamespace(returncode=1), subprocess.TimeoutExpired("private-value", 120), "post_failure"):
            with patch.object(scope, "verified_recovery", valid), \
                    patch.object(scope, "require_host_interlock"), patch.object(scope, "verify_source"), \
                    patch.object(scope, "inspect_database", return_value=self.plan), \
                    patch.object(scope, "verify_result", side_effect=recovery.ScopeError("POST_MIGRATION_REVISION_MISMATCH")), \
                    patch.object(scope.subprocess, "run") as run:
                if isinstance(effect, Exception):
                    run.side_effect = effect
                else:
                    run.return_value = SimpleNamespace(returncode=0) if effect == "post_failure" else effect
                with self.assertRaises(Exception):
                    scope.execute_scoped(object(), self.runner, self.args, self.plan)
                run.assert_called_once()

    def test_production_and_inspect_flags_fail_without_connections_and_redact(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"APP_ENV": "test"}), patch.object(scope, "runner_module") as runner, redirect_stdout(output):
            self.assertEqual(scope.main(["--inspect", "--release-sha", "a" * 40]), 1)
            runner.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["mutation_outcome"], "not_attempted")
        output = io.StringIO()
        with patch.dict(os.environ, {"APP_ENV": "production"}), \
                patch.object(scope, "verify_source", side_effect=ValueError("SECRET_URL_MUST_NOT_APPEAR")), redirect_stdout(output):
            self.assertEqual(scope.main(["--inspect", "--release-sha", "a" * 40]), 1)
        self.assertNotIn("SECRET_URL", output.getvalue())

    def test_inspect_main_only_returns_a_read_only_plan_and_missing_execute_gates_never_connect(self):
        @contextmanager
        def connection(*args):
            yield object()
        runner = SimpleNamespace(production_connection=connection)
        output = io.StringIO()
        with patch.dict(os.environ, {"APP_ENV": "production"}), \
                patch.object(scope, "verify_source"), patch.object(scope, "runner_module", return_value=runner), \
                patch.object(scope, "inspect_database", return_value=self.plan), \
                patch.object(scope.subprocess, "run") as run, redirect_stdout(output):
            self.assertEqual(scope.main(["--inspect", "--release-sha", "a" * 40]), 0)
            run.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["result"], "READ_ONLY_HOSTNAME_PLAN")
        for options in (["--inspect", "--approve-hostnames"], ["--execute"]):
            output = io.StringIO()
            with patch.dict(os.environ, {"APP_ENV": "production"}), \
                    patch.object(scope, "verify_source"), patch.object(scope, "require_host_interlock"), \
                    patch.object(scope, "runner_module", return_value=SimpleNamespace(production_connection=None)), \
                    redirect_stdout(output):
                self.assertEqual(scope.main([*options, "--release-sha", "a" * 40]), 1)
            self.assertEqual(json.loads(output.getvalue())["mutation_outcome"], "not_attempted")


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.backup = self.private / "database.dump"
        self.dump = b"PGDMPsynthetic-archive-not-actual-restoration-evidence"
        self.backup.write_bytes(self.dump)
        self.backup.chmod(0o600)
        self.manifest = self.private / "recovery.json"
        self.plan = {"target": "synthetic-fixture", "only_migration": scope.TARGET}
        self.evidence = evidence(self.plan, self.dump)
        self.write()
        self.addCleanup(self.tmp.cleanup)

    def write(self):
        self.manifest.write_text(json.dumps(self.evidence))
        self.manifest.chmod(0o600)

    def check(self):
        return recovery.verified_recovery(str(self.backup), str(self.manifest), self.plan,
                                          self.root / "checkout", self.root / "active")

    def test_valid_matching_digest_and_actual_rehearsal_attestations(self):
        with self.check() as result:
            self.assertEqual(result["backup_sha256"], hashlib.sha256(self.dump).hexdigest())

    def test_missing_or_false_attestations_wrong_target_and_digests_block(self):
        for key, value in (
            ("backup_durable", False), ("backup_after_writer_exclusion", False),
            ("archive_list_verified", False), ("restoration_rehearsal_passed", False),
            ("full_restore_checks_passed", 1), ("matching_keys_recoverable", False),
            ("migration", "0031_remove_organizations"), ("backup_scope", "schema_only"),
            ("format", True), ("restored_backup_sha256", "a" * 64),
            ("backup_sha256", "a" * 64), ("plan_sha256", "a" * 64), ("rehearsal_ref", ""),
        ):
            altered = {**self.evidence, key: value}
            with self.assertRaises(recovery.ScopeError):
                recovery.validate_evidence(altered, self.plan, hashlib.sha256(self.dump).hexdigest())

    def test_private_file_and_directory_permissions_regular_files_external_paths(self):
        for kind in ("file", "directory", "checkout", "active", "symlink"):
            with self.subTest(kind=kind):
                if kind == "file": self.backup.chmod(0o640)
                if kind == "directory": self.private.chmod(0o755)
                target = self.backup
                if kind == "symlink":
                    target = self.private / "alias"
                    target.symlink_to(self.backup)
                try:
                    with self.assertRaises(recovery.ScopeError):
                        with recovery.verified_recovery(str(target), str(self.manifest), self.plan,
                                                        self.root if kind == "checkout" else self.root / "checkout",
                                                        self.root if kind == "active" else self.root / "active"):
                            pass
                finally:
                    self.backup.chmod(0o600)
                    self.private.chmod(0o700)

    def test_wrong_archive_duplicate_keys_oversized_evidence_and_file_change_block(self):
        self.backup.write_bytes(b"not a dump")
        with self.assertRaises(recovery.ScopeError):
            with self.check(): pass
        self.backup.write_bytes(self.dump)
        for raw in ('{"format":1,"format":1}', "x" * 65537, "{}"):
            self.manifest.write_text(raw)
            with self.assertRaises(recovery.ScopeError):
                with self.check(): pass
        self.write()
        with self.assertRaises(recovery.ScopeError):
            with self.check():
                self.backup.write_bytes(b"PGDMPchanged")

    def test_fifo_is_rejected_without_waiting_for_a_writer(self):
        self.backup.unlink()
        os.mkfifo(self.backup, mode=0o600)
        with self.assertRaises(recovery.ScopeError):
            with self.check(): pass


class HostInterlockTests(unittest.TestCase):
    def test_actual_exclusive_inherited_lock_only_and_same_inode_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock, marker = root / ".deploy.lock", root / ".operator-maintenance"
            marker.touch()
            with lock.open("a+") as held, \
                    patch.object(scope, "LOCK", lock), patch.object(scope, "MARKER", marker), \
                    patch.dict(os.environ, {"EVEXIA_DEPLOY_LOCK": str(lock), "EVEXIA_DEPLOY_LOCK_FD": str(held.fileno())}):
                with self.assertRaises(recovery.ScopeError): scope.require_host_interlock()
                fcntl.flock(held.fileno(), fcntl.LOCK_SH)
                with self.assertRaises(recovery.ScopeError): scope.require_host_interlock()
                fcntl.flock(held.fileno(), fcntl.LOCK_EX)
                scope.require_host_interlock()
                marker.unlink()
                with self.assertRaises(Exception): scope.require_host_interlock()
                marker.touch()
                lock.unlink()
                lock.touch()
                with self.assertRaises(recovery.ScopeError): scope.require_host_interlock()


if __name__ == "__main__":
    unittest.main()
