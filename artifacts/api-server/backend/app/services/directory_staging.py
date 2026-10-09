"""Offline additive maintenance only. Never imported by startup or HTTP routes.

No command thaws writers, cuts over APIs or removes plaintext. Resume after
interruption by authenticating already-staged values, not by repairing from source.
"""
import argparse
import hashlib
import hmac
import json
import logging
import sys
import time
import uuid

from sqlalchemy import MetaData, Table, and_, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.session import session_factory
from app.services.directory_crypto import DirectoryCrypto, canonical
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS, NULLABLE_FIELDS

BATCH_LIMIT = 500
STAGE_REVISION = "0029_directory_crypto_additive"


class StagingError(Exception):
    def __init__(self):
        super().__init__("Directory staging failed; leave writers paused and verify state.")


def _lock(db, mode):
    # Even hidden parameters do not hide DEBUG result-row logging. Refuse
    # maintenance with enabled SQL/result diagnostics, rather than leaking PII.
    engine = db.get_bind().engine
    if (engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO)
            or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO)):
        raise StagingError()
    db.execute(text("SET LOCAL lock_timeout = '1s'"))
    db.execute(text("SET LOCAL statement_timeout = '10s'"))
    db.execute(text(f"LOCK TABLE directory_crypto_stage, mr_directory, doctor_directory, "
                    f"patient_directory, patients IN {mode} MODE NOWAIT"))
    if db.scalar(text("SELECT version_num FROM alembic_version")) != STAGE_REVISION:
        raise StagingError()


def _tables(db):
    meta = MetaData()
    return {name: Table(name, meta, autoload_with=db.connection(), resolve_fks=False)
            for name in FIELDS}


def _stage(db):
    stage = db.execute(text("SELECT * FROM directory_crypto_stage WHERE id=1")).mappings().one()
    return dict(stage)


def _operator(db, runtime_role):
    # session_user, not SET ROLE, is the guard's identity boundary.
    role = db.scalar(text("SELECT session_user"))
    if not runtime_role or role == runtime_role:
        raise StagingError()
    runtime = db.execute(text(
        "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls "
        "FROM pg_roles WHERE rolname=:role"), {"role": runtime_role}).mappings().one_or_none()
    if runtime is None or any(runtime[k] for k in (
            "rolsuper", "rolcreaterole", "rolcreatedb", "rolreplication", "rolbypassrls")):
        raise StagingError()
    if db.scalar(text("SELECT pg_has_role(:runtime, :operator, 'MEMBER')"),
                 {"runtime": runtime_role, "operator": role}):
        raise StagingError()
    # Runtime cannot own scoped tables/evidence or inherit any owning role.
    owners = db.scalars(text(
        "SELECT pg_get_userbyid(relowner) FROM pg_class "
        "WHERE relnamespace=current_schema()::regnamespace "
        "AND relname IN ('directory_crypto_stage','doctor_directory','mr_directory','patient_directory','patients')"))
    if any(db.scalar(text("SELECT pg_has_role(:runtime, :owner, 'MEMBER')"),
                     {"runtime": runtime_role, "owner": owner}) for owner in owners):
        raise StagingError()
    if db.scalar(text(
            "SELECT has_table_privilege(:runtime,'directory_crypto_stage','INSERT,UPDATE,DELETE,TRUNCATE')"),
            {"runtime": runtime_role}):
        raise StagingError()
    return role


def _row_query(table):
    query = select(table)
    if table.name == "mr_directory":
        query = query.add_columns(func.lower(table.c.name).label("_normalized_name"))
    elif table.name == "patient_directory":
        query = query.add_columns(func.lower(func.btrim(table.c.name)).label("_normalized_name"))
    return query


def _deadline(start, seconds):
    if time.monotonic() - start > seconds:
        raise StagingError()


def _indexes(crypto, table, row):
    if table == "doctor_directory":
        return {"state_index": crypto.doctor_state_index(row["state"])}
    # Match the *existing PostgreSQL* normalization, not Python Unicode casefold.
    name = row["_normalized_name"]
    if table == "mr_directory":
        return {"name_index": crypto.mr_name_index(name)}
    return {"duplicate_identity_index": crypto.patient_identity_index(
        name, row["dialCountry"], row["phone"], row["dateOfBirth"])}


def _configuration_digest(crypto):
    keys = {key: hmac.new(value, b"directory-key-inventory", hashlib.sha256).hexdigest()
            for key, value in sorted(crypto.keys.items())}
    return hmac.new(crypto.index_key, b"evexia:directory:staging-configuration:v1\0" +
                    canonical([crypto.active, keys]), hashlib.sha256).hexdigest()


def _frozen_operator(db, crypto):
    stage = _stage(db)
    if (stage["phase"] != "frozen"
            or _operator(db, stage["runtime_role"]) != stage["maintenance_role"]
            or not stage["configuration_digest"]
            or not hmac.compare_digest(stage["configuration_digest"], _configuration_digest(crypto))):
        raise StagingError()
    return stage


def _checked_values(db, crypto, table, row, *, complete):
    replacements = {}
    for field in FIELDS[table]:
        column, source = field + "_ciphertext", row[field]
        stored = row[column]
        if stored is None:
            if source is None and (table, field) in NULLABLE_FIELDS:
                continue
            if complete:
                raise StagingError()
            replacement = crypto.encrypt(table, row["id"], field, source)
            if crypto.decrypt(table, row["id"], field, replacement) != source:
                raise StagingError()
            replacements[column] = replacement
        elif crypto.decrypt(table, row["id"], field, stored) != source:
            # NEVER repair authenticated mismatch or unreadable ciphertext from
            # legacy plaintext; backup/approved reconciliation is required.
            raise StagingError()
    for column, expected in _indexes(crypto, table, row).items():
        stored = row[column]
        if stored is None and not complete:
            replacements[column] = expected
        elif stored is None or not hmac.compare_digest(stored, expected):
            raise StagingError()
    return replacements


def _inventory(db, crypto, tables, *, complete, digest=False):
    counts = {}
    start = time.monotonic()
    mac = hmac.new(crypto.index_key, b"evexia:directory:staging-inventory:v1\0", hashlib.sha256)
    # No plaintext/ciphertext manifests or persistent match caches. Full rows
    # enter only this streaming keyed digest inside restricted operator memory.
    for name, table in tables.items():
        cursor, count = None, 0
        while True:
            _deadline(start, 120)
            query = _row_query(table).order_by(table.c.id).limit(BATCH_LIMIT)
            if cursor is not None:
                query = query.where(table.c.id > cursor)
            rows = list(db.execute(query).mappings())
            if not rows:
                break
            for row in rows:
                _deadline(start, 120)
                if complete:
                    _checked_values(db, crypto, name, row, complete=True)
                if digest:
                    encoded = canonical([name, {k: str(v) if isinstance(v, (uuid.UUID,)) else
                                         v.isoformat() if hasattr(v, "isoformat") else
                                         str(v) if not isinstance(v, (str, int, bool, type(None))) else v
                                         for k, v in row.items()
                                         if not k.endswith("_ciphertext") and k not in INDEX_COLUMNS[name]
                                         and k != "_normalized_name"}])
                    mac.update(len(encoded).to_bytes(8, "big"))
                    mac.update(encoded)
            count += len(rows)
            cursor = rows[-1]["id"]
        counts[name] = count
    # Keep owners in the approval snapshot too; changes invalidate the freeze plan.
    owners = Table("patients", MetaData(), autoload_with=db.connection(), resolve_fks=False)
    cursor = None
    owner_count = 0
    while True:
        _deadline(start, 120)
        query = select(owners).order_by(owners.c.id).limit(BATCH_LIMIT)
        if cursor is not None:
            query = query.where(owners.c.id > cursor)
        rows = list(db.execute(query).mappings())
        if not rows:
            break
        if digest:
            for row in rows:
                encoded = canonical(["patients", [str(v) if v is not None else None for v in row.values()]])
                mac.update(len(encoded).to_bytes(8, "big"))
                mac.update(encoded)
        owner_count += len(rows)
        cursor = rows[-1]["id"]
    counts["patients"] = owner_count
    if complete:
        # Current legacy uniqueness is still installed. Explicitly validate
        # staged index parity across *all* rows, including tombstones.
        p = tables["patient_directory"]
        if db.execute(select(p.c.duplicate_identity_index).group_by(p.c.duplicate_identity_index)
                      .having(func.count() > 1).limit(1)).first():
            raise StagingError()
    return counts, mac.hexdigest()


def freeze(db, settings, *, runtime_role, execute=False, approval=None,
           backup_ref=None, change_ref=None, writes_paused=False,
           recovery_verified=False, production_approved=False):
    """Dry-run approval binds exact rows, schema/location, roles and all keys."""
    try:
        if db.in_transaction():
            raise StagingError()
        crypto = DirectoryCrypto(settings)
        _lock(db, "ACCESS EXCLUSIVE" if execute else "SHARE")
        role = _operator(db, runtime_role)
        stage = _stage(db)
        if stage["phase"] != "additive":
            raise StagingError()
        tables = _tables(db)
        counts, content = _inventory(db, crypto, tables, complete=False, digest=True)
        config = [STAGE_REVISION, list(db.execute(text(
            "SELECT current_database(), current_schema()")).one()), role, runtime_role, content,
            _configuration_digest(crypto)]
        plan = hmac.new(crypto.index_key, b"evexia:directory:freeze-plan:v1\0" +
                        canonical(config), hashlib.sha256).hexdigest()
        result = dict(status="dry-run", schema=STAGE_REVISION, counts=counts, approval=plan)
        if not execute:
            db.rollback()
            return result
        if not (writes_paused and recovery_verified and approval and hmac.compare_digest(plan, approval)):
            raise StagingError()
        if settings.app_env == "production" and not production_approved:
            raise StagingError()
        backup, change = uuid.UUID(str(backup_ref)), uuid.UUID(str(change_ref))
        db.execute(text(
            "UPDATE directory_crypto_stage SET phase='frozen', maintenance_role=:role, "
            "runtime_role=:runtime, backup_ref=:backup, change_ref=:change, "
            "configuration_digest=:configuration, source_digest=:content WHERE id=1"),
            {"role": role, "runtime": runtime_role, "backup": backup, "change": change,
             "configuration": _configuration_digest(crypto), "content": content})
        db.commit()
        return {**result, "status": "frozen"}
    except Exception:
        db.rollback()
        raise StagingError() from None


def batch(db, settings, *, table, limit=BATCH_LIMIT):
    """One bounded restartable batch; caller must have an armed outage boundary."""
    try:
        start = time.monotonic()
        if db.in_transaction() or table not in FIELDS or type(limit) is not int or not 1 <= limit <= BATCH_LIMIT:
            raise StagingError()
        crypto = DirectoryCrypto(settings)
        _lock(db, "ACCESS EXCLUSIVE")
        _frozen_operator(db, crypto)
        model = _tables(db)[table]
        missing = [model.c[field + "_ciphertext"].is_(None) for field in FIELDS[table]
                   if (table, field) not in NULLABLE_FIELDS]
        missing.extend(model.c[column].is_(None) for column in INDEX_COLUMNS[table])
        # A NULL joining date is complete only if its legacy source is NULL.
        for name, field in NULLABLE_FIELDS:
            if name == table:
                missing.append(and_(model.c[field].is_not(None), model.c[field + "_ciphertext"].is_(None)))
        rows = list(db.execute(_row_query(model).where(or_(*missing)).order_by(model.c.id).limit(limit)).mappings())
        for row in rows:
            _deadline(start, 30)
            replacements = _checked_values(db, crypto, table, row, complete=False)
            if replacements:
                db.execute(model.update().where(model.c.id == row["id"]).values(**replacements))
            saved = db.execute(_row_query(model).where(model.c.id == row["id"])).mappings().one()
            _checked_values(db, crypto, table, saved, complete=True)
            for key, value in row.items():
                if key not in replacements and saved[key] != value:
                    raise StagingError()
        remaining = db.scalar(select(func.count()).select_from(model).where(or_(*missing)))
        _deadline(start, 30)
        db.commit()
        return dict(status="batch-committed", table=table, processed=len(rows), remaining=remaining)
    except Exception:
        db.rollback()
        raise StagingError() from None


def verify(db, settings):
    """Full streaming verification; no certificate permits a later retirement."""
    try:
        if db.in_transaction():
            raise StagingError()
        crypto = DirectoryCrypto(settings)
        _lock(db, "SHARE")
        stage = _frozen_operator(db, crypto)
        counts, source = _inventory(db, crypto, _tables(db), complete=True, digest=True)
        if not stage["source_digest"] or not hmac.compare_digest(stage["source_digest"], source):
            raise StagingError()
        db.rollback()
        return dict(status="verified-current-transaction-only", counts=counts, schema=STAGE_REVISION)
    except Exception:
        db.rollback()
        raise StagingError() from None


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline additive directory staging; no cutover/retirement")
    parser.add_argument("operation", choices=("freeze", "batch", "verify"))
    parser.add_argument("--runtime-role")
    parser.add_argument("--table", choices=tuple(FIELDS))
    parser.add_argument("--limit", type=int, default=BATCH_LIMIT)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approval")
    parser.add_argument("--backup-ref")
    parser.add_argument("--change-ref")
    parser.add_argument("--writes-paused", action="store_true")
    parser.add_argument("--recovery-verified", action="store_true")
    parser.add_argument("--production-approved", action="store_true")
    args = parser.parse_args(argv)
    try:
        settings = Settings()
        with session_factory()() as db:
            if args.operation == "freeze":
                result = freeze(db, settings, runtime_role=args.runtime_role, execute=args.execute,
                                approval=args.approval, backup_ref=args.backup_ref, change_ref=args.change_ref,
                                writes_paused=args.writes_paused, recovery_verified=args.recovery_verified,
                                production_approved=args.production_approved)
            elif args.operation == "batch":
                if not args.execute:
                    raise StagingError()
                result = batch(db, settings, table=args.table, limit=args.limit)
            else:
                result = verify(db, settings)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(str(StagingError()), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
