"""Synthetic signed receipts only; never emits real release/recovery approval."""
import base64
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import SecretStr

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "authorization_under_test",
    ROOT / "artifacts/api-server/backend/app/services/release_authorization.py")
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


def private_json(path, value):
    path.write_text(json.dumps(value))
    path.chmod(0o600)
    return path


def sign(path, payload, key):
    return private_json(path, {
        "payload": payload,
        "signature": base64.b64encode(key.sign(auth.canonical(payload))).decode(),
    })


def evidence(root, custody, settings=None, database="fixture", cluster=123):
    """Explicit test double for authorities; NOT a validation implementation."""
    release_key, recovery_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    config = {
        "format": 1, "release_public_key": release_key.public_key().public_bytes_raw().hex(),
        "recovery_public_key": recovery_key.public_key().public_bytes_raw().hex(),
        "database": database, "cluster": cluster, "database_host": "fixture-host",
        "database_port": 5432, "allow_initial_bootstrap": True, "admin_hostname": None,
    }
    trust_file = private_json(custody / "trust.json", config)
    review = json.loads((root / "scripts/fresh-install-review.json").read_text())
    names = {"scripts/fresh-install-review.json", "scripts/migration-policy.json",
             "scripts/release-authorization-policy.json", *review["release_sources"]}
    names.update("artifacts/api-server/backend/" + name for name in review["guard_sources"])
    for directory in ("artifacts/api-server/backend/app",
                      "artifacts/api-server/backend/alembic/versions", "scripts"):
        names.update(str(path.relative_to(root)) for path in (root / directory).rglob("*.py"))
    payload = {
        "purpose": "evexia-release-validation-v1", "commit": "a" * 40,
        "target": json.loads((root / "scripts/release-authorization-policy.json").read_text())["final_target"],
        "review_sha256": auth.sha(root / "scripts/fresh-install-review.json"),
        "commands": auth.policy(root)["validation_commands"], "results": [0, 0, 0],
        "files": {name: auth.sha(root / name) for name in names},
    }
    receipt = sign(custody / "release.json", payload, release_key)
    if settings is None:
        settings = SimpleNamespace(
            signing_key="synthetic-only-signing-material-for-policy-tests",
            staff_encryption_keys=SecretStr("synthetic-staff"),
            staff_email_index_key=SecretStr("synthetic-staff-index"),
            directory_encryption_keys=SecretStr("synthetic-directory"),
            directory_index_key=SecretStr("synthetic-directory-index"),
            communication_encryption_keys=SecretStr("synthetic-communication"),
            staff_encryption_key_id="primary", directory_encryption_key_id="primary",
            communication_encryption_key_id="primary",
        )
    recovery = {
        "purpose": "evexia-fresh-recovery-v1", "database": database, "cluster": cluster,
        "restored_cluster": cluster + 1, "key_fingerprint": auth.key_fingerprint(settings),
        "durable_custody_verified": True, "restoration_rehearsal_verified": True,
        "independent_key_recovery_verified": True, "external_consumers_reviewed": True,
        "retention_resolved": True, "restoration_reference": "synthetic-isolated-rehearsal",
        "key_recovery_reference": "synthetic-independent-key-recovery",
        "source_pristine_verified": True, "observed_at": int(time.time()),
    }
    for prefix in ("backup", "restoration_report", "organization_recovery", "source_inventory"):
        path = custody / (prefix + ".json")
        path.write_bytes(b"synthetic-test-evidence-not-a-real-backup")
        path.chmod(0o600)
        recovery[prefix + "_path"] = str(path)
        recovery[prefix + "_sha256"] = auth.sha(path)
    recovery_receipt = sign(custody / "recovery.json", recovery, recovery_key)
    return SimpleNamespace(config=config, trust_file=trust_file, receipt=receipt,
        payload=payload, release_key=release_key, recovery_key=recovery_key,
        recovery=recovery, recovery_receipt=recovery_receipt, settings=settings)


class ReleaseAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.custody = Path(self.temp.name)
        self.root = self.custody / "release"
        for directory in ("scripts", "artifacts/api-server/backend/app",
                          "artifacts/api-server/backend/alembic/versions"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        (self.root / "scripts/release-authorization-policy.json").write_bytes(
            (ROOT / "scripts/release-authorization-policy.json").read_bytes())
        (self.root / "scripts/migration-policy.json").write_text("{}")
        (self.root / "scripts/fresh-install-review.json").write_text(json.dumps({
            "release_sources": {}, "guard_sources": {},
        }))
        self.e = evidence(self.root, self.custody)

    def test_valid_machine_release_passes(self):
        self.assertEqual(auth.release(self.root, self.e.receipt, self.e.trust_file), self.e.config)

    def test_ci_result_requires_complete_checks_exact_commit_and_artifact(self):
        receipt = self.custody / "ci.json"
        payload = dict(self.e.payload, purpose="evexia-ci-validation-v1")
        private_json(receipt, payload)
        auth.ci_report(self.root, receipt, payload["commit"])
        for changed in (dict(payload, results=[0, 1, 0]),
                        dict(payload, files={}), dict(payload, commit="b" * 40),
                        dict(payload, target="unreviewed")):
            private_json(receipt, changed)
            with self.assertRaises(Exception):
                auth.ci_report(self.root, receipt, payload["commit"])
        private_json(receipt, payload)
        (self.root / "scripts/migration-policy.json").write_text('{"tampered":true}')
        with self.assertRaises(Exception):
            auth.ci_report(self.root, receipt, payload["commit"])

    def test_ci_result_is_never_signed_recovery_or_legacy_release_authority(self):
        receipt = self.custody / "ci.json"
        private_json(receipt, dict(self.e.payload, purpose="evexia-ci-validation-v1"))
        with self.assertRaises(Exception):
            auth.release(self.root, receipt, self.e.trust_file)

    def test_unsigned_ci_generator_runs_all_commands_and_never_issues_after_failure(self):
        spec = importlib.util.spec_from_file_location("ci_validator", ROOT / "scripts/validate-release-artifact.py")
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        names = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*") if p.is_file())
        def synthetic_git(*args):
            if args[0] == "status":
                return b""
            if args[0] == "ls-files":
                return ("\0".join(names) + "\0").encode()
            return b"a" * 40
        for code in (0, 1):
            output = self.custody / f"ci-result-{code}.json"
            with patch.object(validator, "ROOT", self.root), \
                 patch.object(validator, "git", synthetic_git), \
                 patch.object(validator.subprocess, "run", return_value=SimpleNamespace(returncode=code)) as run, \
                 patch("sys.argv", ["validator", "--ci-report", "--output", str(output)]):
                self.assertEqual(validator.main(), 0 if code == 0 else 1)
            if code == 0:
                self.assertEqual(run.call_count, 3)
                auth.ci_report(self.root, output, "a" * 40)
                self.assertNotIn("signature", json.loads(output.read_text()))
            else:
                self.assertFalse(output.exists())

    def test_automatic_cli_accepts_ci_result_without_signing_or_trust_files(self):
        spec = importlib.util.spec_from_file_location("ci_deployer", ROOT / "scripts/deploy-migrations.py")
        deployer = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = deployer
        spec.loader.exec_module(deployer)
        receipt = self.custody / "ci-result.json"
        payload = dict(self.e.payload, purpose="evexia-ci-validation-v1")
        private_json(receipt, payload)
        args = ["--backend-dir", str(self.root / "artifacts/api-server/backend"),
                "--policy", str(self.root / "scripts/migration-policy.json"),
                "--release-root", str(self.root), "--execute", "--ci-report", str(receipt),
                "--expected-commit", payload["commit"]]
        with patch.object(deployer, "load_graph"), patch.object(deployer, "load_policy"), \
             patch.object(deployer, "literal_assignments", return_value={"SCHEMA_REVISION": "target"}), \
             patch.object(deployer, "production_connection") as connect, \
             patch.object(deployer, "execute_plan", return_value={"operator_only": []}) as execute:
            self.assertEqual(deployer.main(args), 0)
            execute.assert_called_once()
            connect.reset_mock()
            private_json(receipt, dict(payload, results=[0, 1, 0]))
            self.assertEqual(deployer.main(args), 1)
            connect.assert_not_called()

    def test_failed_or_incomplete_release_validation_never_authorizes(self):
        for results in ([0, 1, 0], [0], [], [True, True, True], [False, False, False]):
            payload = dict(self.e.payload, results=results)
            # bool is numerically equal to 1, never to the required zero.
            sign(self.e.receipt, payload, self.e.release_key)
            with self.assertRaises(Exception):
                auth.release(self.root, self.e.receipt, self.e.trust_file)

    def test_signature_and_manifest_tampering_fail(self):
        envelope = json.loads(self.e.receipt.read_text())
        envelope["payload"]["target"] = "other"
        private_json(self.e.receipt, envelope)
        with self.assertRaises(Exception):
            auth.release(self.root, self.e.receipt, self.e.trust_file)
        sign(self.e.receipt, self.e.payload, self.e.release_key)
        (self.root / "scripts/fresh-install-review.json").write_text("{}")
        with self.assertRaises(Exception):
            auth.release(self.root, self.e.receipt, self.e.trust_file)

    def test_untracked_executable_source_fails(self):
        (self.root / "artifacts/api-server/backend/app/unreviewed.py").write_text("x=1")
        with self.assertRaises(Exception):
            auth.release(self.root, self.e.receipt, self.e.trust_file)

    def test_incomplete_file_inventory_fails(self):
        payload = dict(self.e.payload, files={})
        sign(self.e.receipt, payload, self.e.release_key)
        with self.assertRaises(Exception):
            auth.release(self.root, self.e.receipt, self.e.trust_file)

    def test_same_release_and_recovery_authority_is_rejected(self):
        config = dict(self.e.config, recovery_public_key=self.e.config["release_public_key"])
        private_json(self.e.trust_file, config)
        with self.assertRaises(Exception):
            auth.trust(self.e.trust_file, self.root)

    def test_no_recovery_claim_is_inferred_from_backup_integrity(self):
        for name in ("restoration_rehearsal_verified", "independent_key_recovery_verified",
                     "restoration_reference", "key_recovery_reference", "source_pristine_verified"):
            payload = dict(self.e.recovery)
            payload.pop(name)
            sign(self.e.recovery_receipt, payload, self.e.recovery_key)
            with self.assertRaises(Exception):
                auth.recovery(self.root, self.e.config, self.e.recovery_receipt, self.e.settings)

    def test_real_independent_evidence_contract_and_integrity(self):
        self.assertEqual(auth.recovery(self.root, self.e.config,
                         self.e.recovery_receipt, self.e.settings), self.e.recovery)
        Path(self.e.recovery["backup_path"]).write_bytes(b"changed")
        with self.assertRaises(Exception):
            auth.recovery(self.root, self.e.config, self.e.recovery_receipt, self.e.settings)

    def test_same_cluster_rehearsal_and_wrong_target_fail(self):
        for changes in ({"restored_cluster": 123}, {"database": "other"},
                        {"cluster": 999}, {"key_fingerprint": "0" * 64},
                        {"observed_at": 1}, {"observed_at": int(time.time()) + 3600}):
            sign(self.e.recovery_receipt, dict(self.e.recovery, **changes), self.e.recovery_key)
            with self.assertRaises(Exception):
                auth.recovery(self.root, self.e.config, self.e.recovery_receipt, self.e.settings)

    def test_origin_cannot_be_fabricated_reused_for_another_target_or_overwritten(self):
        expected = auth.origin_payload(self.root, self.e.config, self.e.receipt,
                                       self.e.recovery_receipt)
        actual = dict(expected, prepared_snapshot_sha256="b" * 64)
        state = self.custody / "origin.json"
        auth.write_origin(state, self.root, self.e.settings, actual)
        self.assertEqual(auth.verify_origin(state, self.root, self.e.settings, expected), actual)
        with self.assertRaises(Exception):
            auth.write_origin(state, self.root, self.e.settings, actual)
        with self.assertRaises(Exception):
            auth.verify_origin(state, self.root, self.e.settings, dict(expected, cluster=999))
        private_json(state, {"payload": actual, "mac": "0" * 64})
        with self.assertRaises(Exception):
            auth.verify_origin(state, self.root, self.e.settings, expected)

    def test_evidence_inside_release_or_with_unsafe_permissions_or_symlink_fails(self):
        for path in (self.root / "evidence.json", self.custody / "public.json"):
            private_json(path, self.e.config)
            if path.name == "public.json":
                path.chmod(0o644)
            with self.assertRaises(Exception):
                auth.trust(path, self.root)
        link = self.custody / "alias.json"
        link.symlink_to(self.e.trust_file)
        with self.assertRaises(Exception):
            auth.trust(link, self.root)

    def test_failed_validation_command_cannot_issue_a_release_certificate(self):
        from cryptography.hazmat.primitives import serialization
        validator_spec = importlib.util.spec_from_file_location(
            "release_validator_under_test", ROOT / "scripts/validate-release-artifact.py")
        validator = importlib.util.module_from_spec(validator_spec)
        validator_spec.loader.exec_module(validator)
        key = self.custody / "signing.pem"
        key.write_bytes(self.e.release_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        key.chmod(0o600)
        output = self.custody / "must-not-be-issued.json"
        def synthetic_git(*args):
            if args[0] == "status":
                return b""
            if args[0] == "ls-files":
                return b"scripts/release-authorization-policy.json\0"
            return b"a" * 40
        with patch.object(validator, "ROOT", self.root), patch.object(validator, "git", synthetic_git), \
             patch.object(validator.subprocess, "run", return_value=SimpleNamespace(returncode=1)), \
             patch("sys.argv", ["validator", "--signing-key", str(key), "--output", str(output)]):
            self.assertEqual(validator.main(), 1)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
