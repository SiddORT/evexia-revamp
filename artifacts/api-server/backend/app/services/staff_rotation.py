"""Explicit offline operator maintenance, never imported by an API/startup hook.

All-row atomic transactions deliberately trade availability for recoverability.
PostgreSQL table locks also exclude writers that do not use the service layer.
"""
import argparse
import hashlib
import hmac
import json
import re
import sys
import uuid
from collections import Counter

from pydantic import SecretStr
from sqlalchemy import select, text
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import Settings
from app.db.models import AuditEvent, User
from app.db.session import session_factory
from app.db.staff_models import StaffProfile
from app.services.staff_crypto import StaffCrypto

FIELDS = ("name", "email", "phone")


class RotationError(Exception):
    """Fixed safe errors only: never include SQL, ciphertext, secrets or PII."""


def _mac(key, domain, value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hmac.new(key, domain.encode() + b"\0" + encoded, hashlib.sha256).hexdigest()


def _columns(row):
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def _inventory(db, crypto, target, operation):
    rows = list(db.scalars(select(StaffProfile).order_by(StaffProfile.id)
                           .execution_options(populate_existing=True)))
    counts, seen, target_seen, source, logical = Counter(), set(), set(), [], []
    for row in rows:
        values = {}
        for field in FIELDS:
            encrypted = getattr(row, f"{field}_ciphertext")
            values[field] = crypto.decrypt(row.id, field, encrypted)
            counts[encrypted.split(":")[1]] += 1
        index = crypto.email_index(values["email"])
        if not hmac.compare_digest(index, row.email_index) or index in seen:
            raise RotationError("Staff integrity verification failed")
        seen.add(index)
        target_index = target.email_index(values["email"])
        if target_index in target_seen:
            raise RotationError("Duplicate target email indexes")
        target_seen.add(target_index)
        user = db.get(User, row.user_id, populate_existing=True)
        if user is None or user.email is not None or user.system_role is not None or not user.username:
            raise RotationError("Staff integrity verification failed")
        stored = _columns(row)
        source.append({"profile": stored, "user": _columns(user)})
        # Stable across rotation and restore; passwords stay inside this keyed digest.
        content = {k: v for k, v in stored.items()
                   if k not in {"version", "email_index", *[f"{f}_ciphertext" for f in FIELDS]}}
        logical.append({"profile": content, "fields": values, "user": _columns(user)})
    key = target.keys[target.active]
    schema = db.scalar(text("SELECT version_num FROM alembic_version"))
    location = db.execute(text("SELECT current_database(), current_schema()")).one()
    config = {"operation": operation, "schema": schema, "location": list(location),
              "active": target.active,
              "keys": {k: _mac(v, "key-inventory", k) for k, v in sorted(crypto.keys.items())},
              "source_index": _mac(crypto.index_key, "index-key", ""),
              "target_index": _mac(target.index_key, "index-key", "")}
    return rows, {
        "operation": operation, "schema": schema, "records": len(rows),
        "key_usage": dict(sorted(counts.items())), "target_key_id": target.active,
        "approval": _mac(key, "staff-rotation-plan-v1", {"config": config, "rows": source}),
        "content_digest": _mac(key, "staff-rotation-content-v1", logical),
    }


def rotate(db, settings, *, operation="encrypt", target_key_id=None, next_index_key=None,
           execute=False, approval=None, backup_ref=None, operator_ref=None,
           recovery_verified=False, writes_paused=False, production_approved=False,
           expected_content_digest=None):
    """Owns the transaction. Rerun dry-run after every commit/failure/config change.

    Caller must be an offline operator with DB access; no application permission
    grants access to this entry point. References are opaque change-record UUIDs.
    """
    try:
        if db.in_transaction():
            raise RotationError("A fresh operator transaction is required")
        if operation not in {"encrypt", "email-index"}:
            raise RotationError("Unsupported rotation operation")
        crypto = StaffCrypto(settings)
        if operation == "encrypt":
            if next_index_key is not None or target_key_id not in crypto.keys:
                raise RotationError("Invalid rotation target")
            target = StaffCrypto(settings.model_copy(update={"staff_encryption_key_id": target_key_id}))
        else:
            if target_key_id is not None or next_index_key is None:
                raise RotationError("Invalid rotation target")
            target = StaffCrypto(settings.model_copy(update={"staff_email_index_key": next_index_key}))
            if hmac.compare_digest(crypto.index_key, target.index_key):
                raise RotationError("Email index target must be a new independent key")
        if execute:
            if not (recovery_verified and writes_paused and approval
                    and re.fullmatch(r"[a-f0-9]{64}", approval)):
                raise RotationError("Approved plan, paused writes and verified recovery are required")
            try:
                backup_ref, operator_ref = uuid.UUID(str(backup_ref)), uuid.UUID(str(operator_ref))
            except (ValueError, TypeError):
                raise RotationError("Opaque backup and operator change references are required") from None
            if settings.app_env == "production" and not production_approved:
                raise RotationError("Separate production approval is required")
        # Lock acquisition fails immediately if ANY existing transaction has
        # accessed staff. Do not wait behind or race normal editing.
        mode = "ACCESS EXCLUSIVE" if execute else "SHARE"
        db.execute(text(f"LOCK TABLE staff_profiles IN {mode} MODE NOWAIT"))
        rows, plan = _inventory(db, crypto, target, operation)
        if expected_content_digest is not None and (
                not re.fullmatch(r"[a-f0-9]{64}", expected_content_digest)
                or not hmac.compare_digest(plan["content_digest"], expected_content_digest)):
            raise RotationError("Recovered staff content does not match the verified inventory")
        if not execute:
            db.rollback()
            return {**plan, "status": "dry-run"}
        if not hmac.compare_digest(plan["approval"], approval):
            raise RotationError("Plan changed; run and approve a new dry-run")
        changed = 0
        if operation == "encrypt":
            for row in rows:
                dirty = False
                for field in FIELDS:
                    original = getattr(row, f"{field}_ciphertext")
                    if original.split(":")[1] == target.active:
                        continue
                    value = crypto.decrypt(row.id, field, original)
                    replacement = target.encrypt(row.id, field, value)
                    if target.decrypt(row.id, field, replacement) != value:
                        raise RotationError("Staff integrity verification failed")
                    setattr(row, f"{field}_ciphertext", replacement)
                    dirty = True
                if dirty:
                    row.version += 1
                    flag_modified(row, "updated_at")
                    changed += 1
        else:
            replacements = [(row, target.email_index(
                crypto.decrypt(row.id, "email", row.email_ciphertext))) for row in rows]
            indexes = [value for _, value in replacements]
            if len(set(indexes)) != len(indexes):
                raise RotationError("Duplicate target email indexes")
            # The existing unique constraint is immediate. Even a (very unlikely)
            # old/new cross-collision aborts atomically; never use plaintext or
            # temporarily drop the uniqueness constraint.
            for row, value in replacements:
                row.email_index = value
                row.version += 1
                flag_modified(row, "updated_at")
                changed += 1
        db.flush()
        _, verified = _inventory(db, target, target, operation)
        if not hmac.compare_digest(plan["content_digest"], verified["content_digest"]):
            raise RotationError("Staff integrity verification failed")
        if operation == "encrypt" and any(k != target.active for k in verified["key_usage"]):
            raise RotationError("Staff integrity verification failed")
        if changed:
            db.add(AuditEvent(action="staff_key_rotation" if operation == "encrypt" else "staff_index_rekey",
                              resource_type="staff_maintenance", resource_id=backup_ref,
                              request_id=approval, reason="operator_approved", outcome="success",
                              actor_id=None))
            # A separate safe opaque change reference, not an invented login identity.
            db.add(AuditEvent(action="staff_rotation_approval", resource_type="operator_change",
                              resource_id=operator_ref, request_id=approval, outcome="success"))
        db.commit()
        return {**verified, "status": "committed", "changed": changed}
    except RotationError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise RotationError("Staff rotation unavailable; no success is confirmed") from None


class OperatorSettings(Settings):
    # Only this offline command consumes the replacement secret.
    staff_email_index_next_key: SecretStr | None = None


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline atomic staff key maintenance")
    parser.add_argument("operation", choices=["encrypt", "email-index"])
    parser.add_argument("--target-key-id")
    parser.add_argument("--execute", action="store_true", help="Default is dry-run")
    parser.add_argument("--approval")
    parser.add_argument("--backup-ref", help="Opaque coordinated-backup inventory UUID")
    parser.add_argument("--operator-ref", help="Opaque approved change-record UUID")
    parser.add_argument("--recovery-verified", action="store_true")
    parser.add_argument("--writes-paused", action="store_true")
    parser.add_argument("--production-approved", action="store_true")
    parser.add_argument("--expected-content-digest", help="Verify an isolated restore against saved inventory")
    args = parser.parse_args(argv)
    try:
        settings = OperatorSettings()
        # Build an independent engine from the same settings used to validate the
        # keyring. No automatic initialization or DDL is performed.
        with session_factory()() as db:
            result = rotate(db, settings, operation=args.operation, target_key_id=args.target_key_id,
                            next_index_key=(settings.staff_email_index_next_key
                                            if args.operation == "email-index" else None),
                            execute=args.execute, approval=args.approval, backup_ref=args.backup_ref,
                            operator_ref=args.operator_ref, recovery_verified=args.recovery_verified,
                            writes_paused=args.writes_paused, production_approved=args.production_approved,
                            expected_content_digest=args.expected_content_digest)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print("Staff rotation failed; no success is confirmed. Verify state with a new dry-run.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
