"""Frozen account migration preflight. No identifier repair or account deletion."""
import hashlib
import hmac
import json
import os
import re
import stat

import sqlalchemy as sa
from sqlalchemy.orm import Session
from pydantic import EmailStr, TypeAdapter, ValidationError
from app.core.config import Settings
from app.services.account_crypto import AccountCrypto, AccountCryptoError
from app.services.organization_retirement import restricted_path

MAX_ACCOUNTS = 10000
MAX_RESERVATIONS = 50000


def inventory(db, current):
    # Do not silently drop operator/custom indexes along with plaintext columns.
    for item in sa.inspect(db).get_indexes("users"):
        expressions = " ".join(str(value) for value in item.get("expressions", ()))
        predicate = str(item.get("dialect_options", {}).get("postgresql_where", ""))
        references_identifiers = (
            set(item.get("column_names") or ()) & {"email", "username"}
            or re.search(r"\b(email|username)\b", expressions + " " + predicate, re.I)
        )
        if (references_identifiers
                and item["name"] not in {"ix_users_email", "ix_users_username",
                                       "uq_users_lower_email", "uq_users_lower_username"}):
            raise AccountCryptoError("Unreviewed account identifier index; no changes applied.")
    users = db.execute(sa.text("SELECT * FROM users ORDER BY id LIMIT 10001")).mappings().all()
    reservations = db.execute(sa.text(
        "SELECT * FROM account_identifier_reservations ORDER BY identifier LIMIT 50001"
    )).mappings().all()
    if len(users) > MAX_ACCOUNTS or len(reservations) > MAX_RESERVATIONS:
        raise AccountCryptoError("Account inventory exceeds the reviewed migration bound.")
    issues, current_ids, history = [], {}, {}
    owners = {row["id"] for row in users}
    for row in users:
        for field in ("email", "username"):
            value = row[field]
            if value is None:
                continue
            try:
                current.validate(field, value)
                if field == "email":
                    TypeAdapter(EmailStr).validate_python(value)
                normalized = db.scalar(sa.select(sa.func.lower(value)))
                if normalized != value.lower():
                    raise ValueError()
                digest = current.lookup_index(normalized)
                if digest in current_ids:
                    issues.append({"user_id": str(row["id"]), "field": field, "problem": "duplicate_namespace"})
                current_ids[digest] = row["id"]
            except (AccountCryptoError, ValueError, ValidationError):
                issues.append({"user_id": str(row["id"]), "field": field, "problem": "invalid_identifier"})
        if row["is_protected_system_admin"] and (
                row["email"] != "crm-admin@allergyevexia.in"
                or row["system_role"] != "super_admin" or not row["is_active"]):
            issues.append({"user_id": str(row["id"]), "problem": "protected_identity_conflict"})
    for row in reservations:
        try:
            value = row["identifier"]
            current.validate("email", value)
            normalized = db.scalar(sa.select(sa.func.lower(value)))
            if normalized != value or normalized != value.lower():
                raise ValueError()
            digest = current.lookup_index(normalized)
            if (row["user_id"] not in owners or digest in history
                    or digest in current_ids and current_ids[digest] != row["user_id"]):
                raise ValueError()
            history[digest] = row["user_id"]
        except (AccountCryptoError, ValueError):
            issues.append({"user_id": str(row["user_id"]), "problem": "invalid_reservation"})
    for digest, owner in current_ids.items():
        if history.get(digest) != owner:
            issues.append({"user_id": str(owner), "problem": "missing_or_conflicting_reservation"})
    if issues:
        # Only references/problem codes, never identifiers or credentials.
        raise AccountCryptoError("Account reconciliation required; no changes applied: " +
                                 json.dumps(issues[:50], sort_keys=True))
    return users, reservations


def require_evidence(db, args, populated):
    # No test-mode exemption and no automatic approval/evidence defaults.
    if not populated:
        return
    for flag in ("account_crypto_approved", "account_writers_stopped",
                 "account_backup_durable", "account_restoration_rehearsal",
                 "account_external_consumers_reviewed"):
        if args.get(flag) != "yes":
            raise AccountCryptoError("Explicit account migration approval/evidence required: " + flag)
    name, identifier = db.execute(sa.text(
        "SELECT current_database(), system_identifier FROM pg_catalog.pg_control_system()"
    )).one()
    if (args.get("account_expected_database") != name
            or args.get("account_expected_system_identifier") != str(identifier)):
        raise AccountCryptoError("Explicit independently approved database/cluster identity required.")
    try:
        path = restricted_path(args["account_backup"])
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
                raise ValueError()
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if not hmac.compare_digest(digest, args["account_backup_sha256"]):
            raise ValueError()
    except Exception:
        raise AccountCryptoError("Restricted durable backup integrity verification failed.") from None
    # A digest validates bytes, NOT a restoration rehearsal. The separate yes
    # flag above is an explicit operator attestation, with independent retained
    # rehearsal evidence required by the runbook.


def prepare(db, args):
    # Lock before inventory/evidence, and retain exclusion until commit/rollback.
    db.execute(sa.text(
        "LOCK TABLE users, account_identifier_reservations, staff_profiles, mr_profiles, "
        "mr_directory, auth_sessions, refresh_sessions, audit_events IN ACCESS EXCLUSIVE MODE NOWAIT"
    ))
    from app.services.directory_runtime import ready as directory_ready
    with Session(bind=db) as session:
        directory_ready(session)
    current = AccountCrypto(Settings())
    users, reservations = inventory(db, current)
    populated = bool(users or reservations)
    if not populated:
        # The no-data exception is only for genuinely unused installations, not
        # merely an empty users table in an existing business database.
        quote = db.dialect.identifier_preparer.quote
        tables = sa.inspect(db).get_table_names()
        db.execute(sa.text("LOCK TABLE " + ", ".join(quote(t) for t in sorted(tables)) +
                           " IN ACCESS EXCLUSIVE MODE NOWAIT"))
        for table in tables:
            if table in {"alembic_version", "directory_crypto_stage"}:
                continue
            if db.scalar(sa.text(f"SELECT EXISTS(SELECT 1 FROM {quote(table)})")):
                populated = True
                break
    require_evidence(db, args, populated)
    return current, users, reservations
