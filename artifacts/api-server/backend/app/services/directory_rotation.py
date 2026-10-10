"""Offline final-schema maintenance. Never called by startup or HTTP routes."""
import argparse
from collections import Counter
import hashlib
import hmac
import json
import logging
import sys
import time
import uuid

from pydantic import SecretStr
from sqlalchemy import MetaData, String, Table, Uuid, column, func, or_, select, text, values

from app.core.config import Settings
from app.db.session import session_factory
from app.services.directory_crypto import DirectoryCrypto, canonical
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS
from app.services import directory_staging as staging

REVISION = "0030_directory_crypto_retirement"
# Explicitly reviewed additive schemas; never assume arbitrary future heads
# preserve the encrypted-directory maintenance contract.
COMPATIBLE_REVISIONS = frozenset({REVISION, "0031_role_hostnames"})


class RotationError(Exception):
    def __init__(self):
        super().__init__("Directory rotation failed; leave writers paused and verify state.")


def _lock(db, exclusive=False):
    if db.in_transaction():
        raise RotationError()
    engine = db.get_bind().engine
    if (engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO)
            or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO)
            or engine.logger.isEnabledFor(logging.INFO)):
        raise RotationError()
    db.execute(text("SET LOCAL lock_timeout='1s'"))
    db.execute(text("SET LOCAL statement_timeout='10s'"))
    mode = "ACCESS EXCLUSIVE" if exclusive else "SHARE"
    db.execute(text(f"LOCK TABLE directory_crypto_stage, doctor_directory, mr_directory, "
                    f"patient_directory, patients IN {mode} MODE NOWAIT"))
    revisions = list(db.scalars(text("SELECT version_num FROM alembic_version")))
    if len(revisions) != 1 or revisions[0] not in COMPATIBLE_REVISIONS:
        raise RotationError()


def _equal(a, b):
    return isinstance(a, str) and isinstance(b, str) and hmac.compare_digest(a, b)


def _state(db):
    # A distinct explicit projection avoids reusing additive-stage prepared
    # SELECT * plans after retirement adds the final index-key anchor.
    return dict(db.execute(text(
        "SELECT id,phase,maintenance_role,runtime_role,backup_ref,change_ref,"
        "configuration_digest,source_digest,index_key_check "
        "FROM directory_crypto_stage WHERE id=1")).mappings().one())


def _stage(db, crypto, phase, runtime_role=None):
    state = _state(db)
    role = staging._operator(db, state["runtime_role"] or runtime_role)
    if (state["phase"] != phase
            or state["maintenance_role"] not in (None, role)
            or not _equal(state["configuration_digest"], staging._configuration_digest(crypto))
            or not _equal(state["index_key_check"], crypto._index("configuration", ["index-key-check"]))):
        raise RotationError()
    return state, role


def _target(settings, operation, target_key_id, next_keys, next_index_key):
    source = DirectoryCrypto(settings)
    if operation not in ("encrypt", "configuration", "index"):
        raise RotationError()
    updates = {}
    if next_keys is not None:
        updates["directory_encryption_keys"] = next_keys
    if target_key_id is not None:
        updates["directory_encryption_key_id"] = target_key_id
    if next_index_key is not None:
        updates["directory_index_key"] = next_index_key
    target = DirectoryCrypto(settings.model_copy(update=updates))
    # Historical key IDs AND bytes must survive, even when currently unused.
    if any(k not in target.keys or not hmac.compare_digest(v, target.keys[k])
           for k, v in source.keys.items()):
        raise RotationError()
    if operation == "index":
        if (next_index_key is None or target_key_id is not None or next_keys is not None
                or hmac.compare_digest(source.index_key, target.index_key)):
            raise RotationError()
    elif next_index_key is not None or not hmac.compare_digest(source.index_key, target.index_key):
        raise RotationError()
    return source, target


def _normalizations(db, crypto, name, rows):
    if name not in ("mr_directory", "patient_directory") or not rows:
        return {}
    page = values(column("id", Uuid), column("name", String), name="directory_names").data([
        (row["id"], crypto.decrypt(name, row["id"], "name", row["name_ciphertext"])) for row in rows])
    expression = func.lower(func.btrim(page.c.name)) if name == "patient_directory" else func.lower(page.c.name)
    return dict(db.execute(select(page.c.id, expression)).all())


def _values(crypto, name, row, normalized):
    values = {f: crypto.decrypt(name, row["id"], f, row[f + "_ciphertext"]) for f in FIELDS[name]}
    if name != "doctor_directory":
        values["_normalized_name"] = normalized[row["id"]]
    indexes = staging._indexes(crypto, name, values)
    if any(not _equal(row[column], expected) for column, expected in indexes.items()):
        raise RotationError()
    return values


def _encoded(value):
    if isinstance(value, dict):
        return {k: _encoded(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_encoded(v) for v in value]
    if isinstance(value, (str, int, bool, type(None))):
        return value
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _inventory(db, crypto, digest_key):
    """Full authenticated bounded traversal, including tombstones and owner metadata."""
    start = time.monotonic()
    counts, usage = {}, Counter()
    mac = hmac.new(digest_key, b"directory-final-content-v1\0", hashlib.sha256)
    raw = hmac.new(digest_key, b"directory-final-storage-v1\0", hashlib.sha256)
    tables = staging._tables(db)
    tables["patients"] = Table("patients", MetaData(), autoload_with=db.connection(), resolve_fks=False)
    for name, table in tables.items():
        count, cursor = 0, None
        while True:
            staging._deadline(start, 120)
            query = select(table).order_by(table.c.id).limit(staging.BATCH_LIMIT)
            if cursor is not None:
                query = query.where(table.c.id > cursor)
            rows = list(db.execute(query).mappings())
            if not rows:
                break
            normalized = _normalizations(db, crypto, name, rows)
            for row in rows:
                staging._deadline(start, 120)
                logical = dict(row)
                if name in FIELDS:
                    values = _values(crypto, name, row, normalized)
                    for field in FIELDS[name]:
                        stored = logical.pop(field + "_ciphertext")
                        if stored is not None:
                            usage[stored.split(":")[1]] += 1
                        logical[field] = values[field]
                    for column in INDEX_COLUMNS[name]:
                        logical.pop(column)
                for digest, payload in ((mac, logical), (raw, dict(row))):
                    encoded = canonical([name, _encoded(payload)])
                    digest.update(len(encoded).to_bytes(8, "big"))
                    digest.update(encoded)
            count += len(rows)
            cursor = rows[-1]["id"]
        counts[name] = count
    patient = tables["patient_directory"]
    if db.execute(select(patient.c.duplicate_identity_index).group_by(patient.c.duplicate_identity_index)
                  .having(func.count() > 1).limit(1)).first():
        raise RotationError()
    return dict(counts=counts, key_usage=dict(sorted(usage.items())),
                content_digest=mac.hexdigest(), storage_digest=raw.hexdigest())


def prepare(db, settings, *, operation="encrypt", target_key_id=None, next_keys=None,
            next_index_key=None, runtime_role=None, execute=False, approval=None,
            backup_ref=None, change_ref=None, writes_paused=False, recovery_verified=False,
            production_approved=False):
    """Default dry-run; encrypt arms a durable outage, other operations are atomic."""
    try:
        source, target = _target(settings, operation, target_key_id, next_keys, next_index_key)
        _lock(db, execute)
        state, role = _stage(db, source, "encrypted", runtime_role)
        inventory = _inventory(db, source, target.index_key)
        config = [operation, REVISION, list(db.execute(text(
            "SELECT current_database(),current_schema()")).one()), state, role,
            runtime_role, inventory, staging._configuration_digest(target)]
        plan = hmac.new(target.index_key, b"directory-final-plan-v1\0" +
                        canonical(_encoded(config)), hashlib.sha256).hexdigest()
        result = {**inventory, "approval": plan, "schema": REVISION,
                  "target_key_id": target.active, "operation": operation, "status": "dry-run"}
        if not execute:
            db.rollback()
            return result
        if not (writes_paused and recovery_verified and _equal(plan, approval)):
            raise RotationError()
        if settings.app_env == "production" and not production_approved:
            raise RotationError()
        backup, change = uuid.UUID(str(backup_ref)), uuid.UUID(str(change_ref))
        if operation == "index":
            start = time.monotonic()
            for name, table in staging._tables(db).items():
                cursor = None
                while True:
                    staging._deadline(start, 120)
                    query = select(table).order_by(table.c.id).limit(staging.BATCH_LIMIT)
                    if cursor is not None:
                        query = query.where(table.c.id > cursor)
                    rows = list(db.execute(query).mappings())
                    if not rows:
                        break
                    normalized = _normalizations(db, source, name, rows)
                    for row in rows:
                        staging._deadline(start, 120)
                        values = _values(source, name, row, normalized)
                        db.execute(table.update().where(table.c.id == row["id"]).values(
                            **staging._indexes(target, name, values)))
                    cursor = rows[-1]["id"]
            verified = _inventory(db, target, target.index_key)
            if not _equal(inventory["content_digest"], verified["content_digest"]):
                raise RotationError()
        phase = "frozen" if operation == "encrypt" else "encrypted"
        db.execute(text(
            "UPDATE directory_crypto_stage SET phase=:phase,maintenance_role=:role,"
            "runtime_role=:runtime,backup_ref=:backup,change_ref=:change,"
            "source_digest=:content,configuration_digest=:configuration,index_key_check=:check WHERE id=1"),
            dict(phase=phase, role=role, runtime=state["runtime_role"] or runtime_role,
                 backup=backup, change=change, content=inventory["content_digest"],
                 configuration=staging._configuration_digest(target),
                 check=target._index("configuration", ["index-key-check"])))
        db.commit()
        return {**result, "status": "frozen" if operation == "encrypt" else "committed"}
    except Exception:
        db.rollback()
        raise RotationError() from None


def batch(db, settings, *, table, limit=staging.BATCH_LIMIT):
    """Target configuration must match the durable plan; no external cursor is trusted."""
    try:
        if table not in FIELDS or type(limit) is not int or not 1 <= limit <= staging.BATCH_LIMIT:
            raise RotationError()
        current = DirectoryCrypto(settings)
        _lock(db, True)
        _stage(db, current, "frozen")
        model = staging._tables(db)[table]
        # Envelope key IDs identify pending rows. Full verification authenticates
        # every skipped envelope before writers can resume.
        pending = or_(*[func.split_part(model.c[f + "_ciphertext"], ":", 2) != current.active
                        for f in FIELDS[table]])
        rows = list(db.execute(select(model).where(pending).order_by(model.c.id).limit(limit)).mappings())
        start = time.monotonic()
        normalized = _normalizations(db, current, table, rows)
        for row in rows:
            staging._deadline(start, 30)
            values = _values(current, table, row, normalized)
            replacements = {}
            for field in FIELDS[table]:
                old = row[field + "_ciphertext"]
                if old is not None and old.split(":")[1] != current.active:
                    replacements[field + "_ciphertext"] = current.encrypt(table, row["id"], field, values[field])
            db.execute(model.update().where(model.c.id == row["id"]).values(**replacements))
            saved = db.execute(select(model).where(model.c.id == row["id"])).mappings().one()
            if _values(current, table, saved, normalized) != values or any(
                    saved[k] != v for k, v in row.items() if k not in replacements):
                raise RotationError()
        remaining = db.scalar(select(func.count()).select_from(model).where(pending))
        staging._deadline(start, 30)
        db.commit()
        return dict(status="batch-committed", table=table, processed=len(rows), remaining=remaining)
    except Exception:
        db.rollback()
        raise RotationError() from None


def verify(db, settings, *, finish=False, expected_content_digest=None):
    """Finish only after fresh full parity/authentication; no stale certificate."""
    try:
        current = DirectoryCrypto(settings)
        _lock(db, finish)
        phase = _state(db)["phase"]
        if phase not in ("encrypted", "frozen") or (finish and phase != "frozen"):
            raise RotationError()
        state, _ = _stage(db, current, phase)
        result = _inventory(db, current, current.index_key)
        if expected_content_digest is not None and not _equal(expected_content_digest, result["content_digest"]):
            raise RotationError()
        if phase == "frozen" and not _equal(state["source_digest"], result["content_digest"]):
            raise RotationError()
        if finish:
            if (not _equal(state["source_digest"], result["content_digest"])
                    or any(key != current.active for key in result["key_usage"])):
                raise RotationError()
            db.execute(text("UPDATE directory_crypto_stage SET phase='encrypted',"
                            "configuration_digest=:configuration,index_key_check=:check WHERE id=1"),
                       dict(configuration=staging._configuration_digest(current),
                            check=current._index("configuration", ["index-key-check"])))
            db.commit()
        else:
            db.rollback()
        return {**result, "schema": REVISION,
                "status": "committed" if finish else "verified-current-transaction-only"}
    except Exception:
        db.rollback()
        raise RotationError() from None


class OperatorSettings(Settings):
    directory_encryption_next_keys: SecretStr | None = None
    directory_index_next_key: SecretStr | None = None


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline final-schema Directory maintenance")
    parser.add_argument("operation", choices=("encrypt", "configuration", "index", "batch", "verify", "finish"))
    parser.add_argument("--target-key-id")
    parser.add_argument("--runtime-role")
    parser.add_argument("--table", choices=tuple(FIELDS))
    parser.add_argument("--limit", type=int, default=staging.BATCH_LIMIT)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approval")
    parser.add_argument("--backup-ref")
    parser.add_argument("--change-ref")
    parser.add_argument("--writes-paused", action="store_true")
    parser.add_argument("--recovery-verified", action="store_true")
    parser.add_argument("--production-approved", action="store_true")
    parser.add_argument("--expected-content-digest")
    args = parser.parse_args(argv)
    try:
        settings = OperatorSettings()
        with session_factory()() as db:
            if args.operation in ("encrypt", "configuration", "index"):
                result = prepare(db, settings, operation=args.operation, target_key_id=args.target_key_id,
                                 next_keys=settings.directory_encryption_next_keys,
                                 next_index_key=settings.directory_index_next_key, runtime_role=args.runtime_role,
                                 execute=args.execute, approval=args.approval, backup_ref=args.backup_ref,
                                 change_ref=args.change_ref, writes_paused=args.writes_paused,
                                 recovery_verified=args.recovery_verified, production_approved=args.production_approved)
            elif args.operation == "batch":
                if not args.execute:
                    raise RotationError()
                result = batch(db, settings, table=args.table, limit=args.limit)
            else:
                if args.operation == "finish" and not args.execute:
                    raise RotationError()
                result = verify(db, settings, finish=args.operation == "finish",
                                expected_content_digest=args.expected_content_digest)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(str(RotationError()), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
