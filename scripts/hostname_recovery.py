"""Restricted recovery evidence for the additive hostname-only operator path."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid


class ScopeError(Exception):
    """Fixed safe operational labels only; never include underlying exceptions."""


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def sha256(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ScopeError("INVALID_EVIDENCE_DIGEST")
    return value


@contextmanager
def restricted_file(value, checkout, active):
    path = Path(value)
    if (not path.is_absolute() or path != path.resolve()
            or any(path.is_relative_to(root) for root in (checkout.resolve(), active.resolve()))):
        raise ScopeError("EXTERNAL_CANONICAL_RECOVERY_PATH_REQUIRED")
    parent = path.parent.stat()
    if parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        raise ScopeError("PRIVATE_OPERATOR_OWNED_RECOVERY_DIRECTORY_REQUIRED")
    # Nonblocking open prevents a misplaced FIFO from hanging the supervisor
    # before the regular-file check. Regular files are unaffected.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_mode & 0o077 or info.st_size == 0):
            raise ScopeError("RESTRICTED_REGULAR_RECOVERY_FILE_REQUIRED")
        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            yield source
        after = os.fstat(descriptor)
        named = path.stat(follow_symlinks=False)
        if ((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
                or (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino)):
            raise ScopeError("RECOVERY_FILE_CHANGED")
    finally:
        os.close(descriptor)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ScopeError("DUPLICATE_RECOVERY_EVIDENCE_KEY")
        result[key] = value
    return result


def validate_evidence(evidence, plan, dump_digest):
    required = {
        "format", "migration", "predecessor_revision", "plan_sha256",
        "backup_sha256", "restored_backup_sha256", "backup_format", "backup_scope",
        "backup_durable", "backup_after_writer_exclusion", "archive_list_verified",
        "restoration_rehearsal_passed", "full_restore_checks_passed",
        "matching_keys_recoverable", "backup_ref", "rehearsal_ref",
        "key_inventory_ref", "change_ref",
    }
    if not isinstance(evidence, dict) or set(evidence) != required:
        raise ScopeError("EXACT_RECOVERY_EVIDENCE_CONTRACT_REQUIRED")
    if (type(evidence["format"]) is not int or evidence["format"] != 1
            or evidence["migration"] != "0031_role_hostnames"
            or evidence["predecessor_revision"] != "0030_directory_crypto_retirement"
            or evidence["backup_format"] != "postgresql_custom"
            or evidence["backup_scope"] != "full_database_all_schemas"):
        raise ScopeError("WRONG_RECOVERY_SCOPE")
    for field in (
        "backup_durable", "backup_after_writer_exclusion", "archive_list_verified",
        "restoration_rehearsal_passed", "full_restore_checks_passed", "matching_keys_recoverable",
    ):
        if evidence[field] is not True:
            raise ScopeError("RECOVERY_ATTESTATIONS_REQUIRED")
    for field in ("backup_ref", "rehearsal_ref", "key_inventory_ref", "change_ref"):
        value = evidence[field]
        if not isinstance(value, str):
            raise ScopeError("OPAQUE_REVIEW_REFERENCES_REQUIRED")
        try:
            parsed = uuid.UUID(value)
        except ValueError:
            raise ScopeError("OPAQUE_REVIEW_REFERENCES_REQUIRED") from None
        if str(parsed) != value or parsed.int == 0:
            raise ScopeError("OPAQUE_REVIEW_REFERENCES_REQUIRED")
    if (sha256(evidence["plan_sha256"]) != canonical_digest(plan)
            or sha256(evidence["backup_sha256"]) != dump_digest
            or sha256(evidence["restored_backup_sha256"]) != dump_digest):
        raise ScopeError("RECOVERY_PLAN_OR_DIGEST_MISMATCH")
    return evidence


@contextmanager
def verified_recovery(backup, evidence_path, plan, checkout, active):
    # Hold the restricted descriptors and shared file locks through execution.
    with restricted_file(backup, checkout, active) as source, \
            restricted_file(evidence_path, checkout, active) as evidence_file:
        if source.read(5) != b"PGDMP":
            raise ScopeError("POSTGRESQL_CUSTOM_ARCHIVE_REQUIRED")
        source.seek(0)
        digest = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
        raw = evidence_file.read(65537)
        if len(raw) > 65536:
            raise ScopeError("RECOVERY_EVIDENCE_TOO_LARGE")
        try:
            evidence = json.loads(raw, object_pairs_hook=unique_object)
        except (ValueError, UnicodeError):
            raise ScopeError("INVALID_RECOVERY_EVIDENCE_JSON") from None
        yield validate_evidence(evidence, plan, digest.hexdigest())
