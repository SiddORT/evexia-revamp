"""Machine release evidence is not permission to migrate an existing database.

Trust and recovery attestations live outside the release. Release validation
and recovery use distinct Ed25519 authorities. A fresh origin is recorded only
after this process proved a pristine database and committed preparation.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from app.core.schema import SCHEMA_REVISION


class AuthorizationBlocked(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AuthorizationBlocked("Duplicate evidence key.")
        result[key] = value
    return result


def private_path(path, root, *, missing=False):
    path = Path(path)
    if not path.is_absolute() or path != path.resolve():
        raise AuthorizationBlocked("Canonical external evidence path required.")
    if path.is_relative_to(root.resolve()):
        raise AuthorizationBlocked("Evidence/trust must be external to the release.")
    parent = path.parent.stat()
    if parent.st_uid not in (0, os.getuid()) or parent.st_mode & 0o022:
        raise AuthorizationBlocked("Trusted non-writable evidence directory required.")
    if missing and not path.exists():
        return path
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.getuid())
            or info.st_mode & 0o077):
        raise AuthorizationBlocked("Restricted regular evidence file required.")
    return path


def read_private(path, root):
    path = private_path(path, root)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.getuid())
                or info.st_mode & 0o077):
            raise AuthorizationBlocked("Unsafe evidence descriptor.")
        raw = stream.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise AuthorizationBlocked("Oversized evidence.")
    return json.loads(raw, object_pairs_hook=unique)


def trust(path, root):
    result = read_private(path, root)
    if (result.get("format") != 1
            or result.get("release_public_key") == result.get("recovery_public_key")):
        raise AuthorizationBlocked("Independent release/recovery authorities required.")
    if (not isinstance(result.get("database"), str) or not result["database"]
            or type(result.get("cluster")) is not int or not 0 < result["cluster"] < 2**64
            or not isinstance(result.get("database_host"), str) or not result["database_host"]
            or type(result.get("database_port")) is not int
            or not 0 < result["database_port"] < 65536):
        raise AuthorizationBlocked("Independently configured database/cluster endpoint required.")
    for name in ("release_public_key", "recovery_public_key"):
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(result[name]))
    return result


def signed(path, key, root):
    envelope = read_private(path, root)
    if set(envelope) != {"payload", "signature"}:
        raise AuthorizationBlocked("Signed evidence required.")
    Ed25519PublicKey.from_public_bytes(bytes.fromhex(key)).verify(
        base64.b64decode(envelope["signature"], validate=True),
        canonical(envelope["payload"]),
    )
    return envelope["payload"]


def policy(root):
    value = json.loads((root / "scripts/release-authorization-policy.json").read_text(),
                       object_pairs_hook=unique)
    expected = {
        "version": 1,
        "automatic_migrations": "classified_automatic_only",
        "fresh_install": "validated_release_and_independent_recovery_and_pristine_origin",
        "existing_database": "operator_approval_for_protected_revisions_and_bootstrap",
        "prepare_target": "0031_role_hostnames",
        "retirement_cap": "0034_shared_phone_countries",
        "final_target": SCHEMA_REVISION,
        "validation_commands": [
            ["pnpm", "run", "validate:release"],
            ["sh", "scripts/test-fresh-install.sh"],
            ["python", "-B", "-m", "unittest", "discover", "-s", "scripts/tests", "-v"],
        ],
    }
    if value != expected:
        raise AuthorizationBlocked("Unknown release authorization policy.")
    return value


def release(root, receipt, trust_file):
    config = trust(trust_file, root)
    proof = signed(receipt, config["release_public_key"], root)
    rules = policy(root)
    if (proof.get("purpose") != "evexia-release-validation-v1"
            or proof.get("target") != rules["final_target"]
            or proof.get("review_sha256") != sha(root / "scripts/fresh-install-review.json")
            or proof.get("commands") != rules["validation_commands"]
            or proof.get("results") != [0] * len(rules["validation_commands"])
            or any(type(code) is not int for code in proof["results"])
            or not isinstance(proof.get("files"), dict) or not proof["files"]
            or not re.fullmatch(r"[0-9a-f]{40}", proof.get("commit", ""))):
        raise AuthorizationBlocked("Complete successful release validation required.")
    review = json.loads((root / "scripts/fresh-install-review.json").read_text())
    required = {"scripts/fresh-install-review.json", "scripts/migration-policy.json",
                "scripts/release-authorization-policy.json", *review["release_sources"]}
    required.update("artifacts/api-server/backend/" + name for name in review["guard_sources"])
    required.update(str(path.relative_to(root)) for path in
                    (root / "artifacts/api-server/backend/alembic/versions").glob("*.py"))
    if not required.issubset(proof["files"]):
        raise AuthorizationBlocked("Incomplete release artifact inventory.")
    for name, digest in proof["files"].items():
        path = root / name
        if (not isinstance(name, str) or Path(name).is_absolute()
                or ".." in Path(name).parts or path.resolve() != path
                or not path.is_file() or sha(path) != digest):
            raise AuthorizationBlocked("Release artifact integrity failure.")
    # Extra executable source must not be injected into an otherwise valid tree.
    for directory in ("artifacts/api-server/backend/app",
                      "artifacts/api-server/backend/alembic/versions", "scripts"):
        for path in (root / directory).rglob("*.py"):
            if str(path.relative_to(root)) not in proof["files"]:
                raise AuthorizationBlocked("Unvalidated executable source.")
    return config


def key_fingerprint(settings):
    names = ("staff_encryption_keys", "staff_email_index_key",
             "directory_encryption_keys", "directory_index_key",
             "communication_encryption_keys")
    values = {name: getattr(settings, name).get_secret_value() for name in names}
    values.update(
        signing=settings.signing_key,
        staff_id=settings.staff_encryption_key_id,
        directory_id=settings.directory_encryption_key_id,
        communication_id=settings.communication_encryption_key_id,
    )
    return hashlib.sha256(canonical(values)).hexdigest()


def recovery(root, config, receipt, settings):
    proof = signed(receipt, config["recovery_public_key"], root)
    if (proof.get("purpose") != "evexia-fresh-recovery-v1"
            or proof.get("database") != config.get("database")
            or proof.get("cluster") != config.get("cluster")
            or not isinstance(proof.get("restored_cluster"), int)
            or proof["restored_cluster"] == config["cluster"]
            or proof.get("key_fingerprint") != key_fingerprint(settings)
            or type(proof.get("observed_at")) is not int
            or not time.time() - 86400 <= proof["observed_at"] <= time.time() + 60
            or any(proof.get(name) is not True for name in (
                "durable_custody_verified", "restoration_rehearsal_verified",
                "independent_key_recovery_verified", "external_consumers_reviewed",
                "retention_resolved", "source_pristine_verified"))
            or not proof.get("restoration_reference")
            or not proof.get("key_recovery_reference")):
        raise AuthorizationBlocked("Independent restoration/key recovery evidence required.")
    # Integrity supplements, and NEVER replaces, the separate signed rehearsal.
    for prefix in ("backup", "restoration_report", "organization_recovery", "source_inventory"):
        path = private_path(proof[prefix + "_path"], root)
        if sha(path) != proof[prefix + "_sha256"]:
            raise AuthorizationBlocked("Recovery artifact integrity failure.")
    return proof


def origin_payload(root, config, receipt, recovery_receipt):
    return {
        "purpose": "evexia-pristine-origin-v1",
        "review_sha256": sha(root / "scripts/fresh-install-review.json"),
        "release_sha256": sha(receipt), "recovery_sha256": sha(recovery_receipt),
        "database": config["database"], "cluster": config["cluster"],
        "database_host": config["database_host"],
        "database_port": config["database_port"],
        "admin_hostname": config.get("admin_hostname"),
        "allow_initial_bootstrap": config.get("allow_initial_bootstrap"),
    }


def origin_mac(settings, payload):
    # Purpose-separated MAC; no new secret, no reuse of encryption/index keys.
    key = hmac.digest(settings.signing_key.encode(), b"evexia-pristine-origin-v1", "sha256")
    return hmac.digest(key, canonical(payload), "sha256").hex()


def write_origin(path, root, settings, payload):
    path = private_path(path, root, missing=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(canonical({"payload": payload, "mac": origin_mac(settings, payload)}))
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def verify_origin(path, root, settings, expected):
    proof = read_private(path, root)
    actual = proof.get("payload", {})
    if (set(proof) != {"payload", "mac"}
            or set(actual) != set(expected) | {"prepared_snapshot_sha256"}
            or any(actual.get(name) != value for name, value in expected.items())
            or not isinstance(actual.get("prepared_snapshot_sha256"), str)
            or not hmac.compare_digest(str(proof["mac"]), origin_mac(settings, actual))):
        raise AuthorizationBlocked("Authentic pristine preparation origin required.")
    return actual


def authorize_fresh(root, connection, settings, *, receipt, trust_file,
                    recovery_receipt, state_file, phase, hostname=None):
    from sqlalchemy import text
    from sqlalchemy.engine import make_url
    from app import fresh_install as fresh
    config = release(root, receipt, trust_file)
    recovery(root, config, recovery_receipt, settings)
    fresh.verify_database_target(connection, config["database"], config["cluster"])
    url = make_url(settings.database_url)
    host = url.query.get("host") or url.host
    if (host != config["database_host"] or (url.port or 5432) != config["database_port"]
            or connection.scalar(text("SELECT pg_is_in_recovery()")) is not False):
        raise AuthorizationBlocked("Configured independent primary target mismatch.")
    payload = origin_payload(root, config, receipt, recovery_receipt)
    if phase == "prepare":
        if hostname is not None:
            raise AuthorizationBlocked("Hostname is a finalization-only operation.")
        if private_path(state_file, root, missing=True).exists():
            raise AuthorizationBlocked("Origin already exists; inspect interrupted installation.")
        fresh.pristine(connection)
    else:
        observed = verify_origin(state_file, root, settings, payload)
        if phase == "retirement":
            revisions = list(connection.scalars(text("SELECT version_num FROM alembic_version")))
            if revisions == [fresh.PREPARE_TARGET]:
                from app.services.fresh_recovery import snapshot
                digest = hashlib.sha256(canonical(snapshot(connection))).hexdigest()
                if digest != observed["prepared_snapshot_sha256"]:
                    raise AuthorizationBlocked("Fresh predecessor changed after preparation.")
            elif revisions != ["0034_shared_phone_countries"]:
                raise AuthorizationBlocked("Unexpected fresh retirement state; operator recovery required.")
        if phase == "finalize" and (
                config.get("allow_initial_bootstrap") is not True
                or hostname != config.get("admin_hostname")):
            raise AuthorizationBlocked("Explicit initial bootstrap/hostname policy required.")
    return payload
