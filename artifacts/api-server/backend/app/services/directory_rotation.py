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
from app.services.directory_inventory import FIELDS as PHONE_FIELDS, RUNTIME_FIELDS as FIELDS, LEGACY_FIELDS, INDEX_COLUMNS, PRIVACY_REVISION, REFERENCE_FIELDS, STAFF_MANAGER_REVISION
from app.services import directory_staging as staging

REVISION = "0030_directory_crypto_retirement"
PHONE_REVISION = "0034_shared_phone_countries"
# Geography adds no encrypted directory fields or maintenance anchors.
RUNTIME_REVISIONS = frozenset({PRIVACY_REVISION, "0037_domain_admission", "0038_purchase_orders",
    "0039_communication", "0040_po_tax_basis", "0041_location_geography", "0042_rate_hundredths",
    # Email templates and receipts/settings add no fields to encrypted directories.
    "0043_email_templates", "0044_purchase_received", "0045_pr_batch_numbers",
    # Inventory uses independent receipt payloads; encrypted directory contracts
    # and maintenance anchors are unchanged.
    "0046_live_inventory",
    # Languages and its Unicode indexes are independent of directory ciphertext.
    "0047_languages", "0048_language_unicode",
    # Stock products extend the independent inventory ledger, not directories.
    "0047_stock_products", "0049_product_language_merge", "0050_opening_stock",
    # HQ zone/area metadata leaves encrypted directory fields unchanged.
    "0051_headquarter_areas", "0051_mr_zones", "0052_hq_mr_zones_merge",
    "0053_email_invitations", "0054_modern_email_tests", STAFF_MANAGER_REVISION,
    "0056_staff_business_roles", "0057_staff_employee_code", "0058_master_numbers", "0059_staff_unified_access",
    "0060_staff_account_numbers", "0061_immunotherapy_orders", "0062_kits_orders",
    "0063_spt_orders", "0064_procurement_documents", "0065_lupin_orders",
    "0066_spt_registration_owner", "0067_inventory_adjustments", "0068_category_description", "0069_workspace_permissions",
    "0070_mr_account_numbers"})
SUPPORTED_REVISIONS = frozenset({REVISION, "0031_role_hostnames", "0031_remove_organizations",
    "0033_merge_directory_branches", PHONE_REVISION, "0035_account_identifiers"}) | RUNTIME_REVISIONS
COMPATIBLE_REVISIONS = SUPPORTED_REVISIONS


class RotationError(Exception):
    def __init__(self):
        super().__init__("Directory rotation failed; leave writers paused and verify state.")


def _fields(db):
    # Reviewed predecessors retain their exact old inventory so paused
    # maintenance can finish before the separately approved phone migration.
    revision = db.scalar(text("SELECT version_num FROM alembic_version"))
    if revision not in SUPPORTED_REVISIONS:
        raise RotationError()
    if revision in (STAFF_MANAGER_REVISION, "0056_staff_business_roles", "0057_staff_employee_code",
                    "0058_master_numbers", "0059_staff_unified_access", "0060_staff_account_numbers",
                    "0061_immunotherapy_orders", "0062_kits_orders", "0063_spt_orders",
                    "0064_procurement_documents", "0065_lupin_orders", "0066_spt_registration_owner",
                    "0067_inventory_adjustments", "0068_category_description", "0069_workspace_permissions",
                    "0070_mr_account_numbers"):
        return FIELDS
    if revision in RUNTIME_REVISIONS:
        return REFERENCE_FIELDS
    return PHONE_FIELDS if revision in (PHONE_REVISION, "0035_account_identifiers") else LEGACY_FIELDS


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
    if len(revisions) != 1 or revisions[0] not in SUPPORTED_REVISIONS:
        raise RotationError()
    if revisions[0] in RUNTIME_REVISIONS:
        db.execute(text(f"LOCK TABLE vendors IN {mode} MODE NOWAIT"))
    if revisions in (["0061_immunotherapy_orders"], ["0062_kits_orders"], ["0063_spt_orders"], ["0064_procurement_documents"], ["0065_lupin_orders"], ["0066_spt_registration_owner"], ["0067_inventory_adjustments"], ["0068_category_description"], ["0069_workspace_permissions"], ["0070_mr_account_numbers"]):
        db.execute(text(f"LOCK TABLE immunotherapy_orders,immunotherapy_requests IN {mode} MODE NOWAIT"))
    if revisions in (["0062_kits_orders"], ["0063_spt_orders"], ["0064_procurement_documents"], ["0065_lupin_orders"], ["0066_spt_registration_owner"], ["0067_inventory_adjustments"], ["0068_category_description"], ["0069_workspace_permissions"], ["0070_mr_account_numbers"]):
        db.execute(text(f"LOCK TABLE kits_orders,kits_requests,files IN {mode} MODE NOWAIT"))
    if revisions in (["0063_spt_orders"], ["0064_procurement_documents"], ["0065_lupin_orders"], ["0066_spt_registration_owner"], ["0067_inventory_adjustments"], ["0068_category_description"], ["0069_workspace_permissions"], ["0070_mr_account_numbers"]):
        db.execute(text(f"LOCK TABLE spt_orders,spt_patients,spt_requests IN {mode} MODE NOWAIT"))
    if revisions in (["0065_lupin_orders"], ["0066_spt_registration_owner"], ["0067_inventory_adjustments"], ["0068_category_description"], ["0069_workspace_permissions"], ["0070_mr_account_numbers"]):
        db.execute(text(f"LOCK TABLE lupin_orders,lupin_requests IN {mode} MODE NOWAIT"))
    # Organization retirement changes no encrypted directory storage. Verify
    # that required final projections still exist and plaintext did not return;
    # never accept an arbitrary newer head merely because it is newer.
    for name, fields in _fields(db).items():
        actual = set(db.scalars(text("""SELECT attname FROM pg_catalog.pg_attribute
          WHERE attrelid=to_regclass(:name) AND attnum>0 AND NOT attisdropped"""), {"name": name}))
        if (not {f + "_ciphertext" for f in fields}.issubset(actual)
                or not set(INDEX_COLUMNS[name]).issubset(actual)
                or set(fields) & actual):
            raise RotationError()


def _equal(a, b):
    return isinstance(a, str) and isinstance(b, str) and hmac.compare_digest(a, b)


def _tables(db):
    tables = staging._tables(db)
    if "vendors" in _fields(db):
        tables["vendors"] = Table("vendors", MetaData(), autoload_with=db.connection(), resolve_fks=False)
    return tables


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


def _values(crypto, name, row, normalized, fields):
    values = {f: crypto.decrypt(name, row["id"], f, row[f + "_ciphertext"]) for f in fields}
    if name in ("mr_directory", "patient_directory"):
        values["_normalized_name"] = normalized[row["id"]]
    indexes = staging._indexes(crypto, name, values) if name != "vendors" else {}
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
    tables = _tables(db)
    fields = _fields(db)
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
                    values = _values(crypto, name, row, normalized, fields[name])
                    for field in fields[name]:
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
    if db.scalar(text("SELECT version_num FROM alembic_version")) in ("0061_immunotherapy_orders", "0062_kits_orders", "0063_spt_orders", "0064_procurement_documents", "0065_lupin_orders", "0066_spt_registration_owner"):
        for name, (model, pk, field, domain) in _order_payloads(db).items():
            _, unseal = _order_crypto(name)
            cursor, count = None, 0
            while True:
                staging._deadline(start, 120)
                query = select(model).where(model.c[field].is_not(None)).order_by(pk).limit(staging.BATCH_LIMIT)
                if cursor is not None:
                    query = query.where(pk > cursor)
                rows = list(db.execute(query).mappings())
                if not rows:
                    break
                for row in rows:
                    stored = row[field]
                    usage[stored.split(":")[1]] += 1
                    logical = dict(row)
                    logical[field] = unseal(crypto, domain, row[pk.name], stored)
                    for digest, payload in ((mac, logical), (raw, dict(row))):
                        encoded = canonical([name, _encoded(payload)])
                        digest.update(len(encoded).to_bytes(8, "big"))
                        digest.update(encoded)
                count += len(rows)
                cursor = rows[-1][pk.name]
            counts[name] = count
    return dict(counts=counts, key_usage=dict(sorted(usage.items())),
                content_digest=mac.hexdigest(), storage_digest=raw.hexdigest())


def _order_payloads(db):
    from app.db.immunotherapy_models import ImmunotherapyOrder, ImmunotherapyRequest
    orders, requests = ImmunotherapyOrder.__table__, ImmunotherapyRequest.__table__
    result = {
        "immunotherapy_orders": (orders, orders.c.id, "snapshot_ciphertext", "orders"),
        "immunotherapy_requests": (requests, requests.c.key, "response_ciphertext", "requests"),
    }
    revision = db.scalar(text("SELECT version_num FROM alembic_version"))
    if revision in ("0062_kits_orders", "0063_spt_orders", "0064_procurement_documents", "0065_lupin_orders", "0066_spt_registration_owner"):
        from app.db.kits_models import KitsOrder, KitsRequest
        from app.db.file_models import FileRecord
        orders, requests, files = KitsOrder.__table__, KitsRequest.__table__, FileRecord.__table__
        # Preserve the predecessor filename inventory's exact field contract.
        files = Table("files", MetaData(), autoload_with=db.connection(),
            include_columns=[c.name for c in FileRecord.__table__.columns if not c.name.startswith("lupin_")])
        result.update({
            "kits_orders": (orders, orders.c.id, "snapshot_ciphertext", "orders"),
            "kits_requests": (requests, requests.c.key, "response_ciphertext", "requests"),
            "kits_file_names": (files, files.c.id, "kits_name_ciphertext", "file_names"),
        })
    if revision in ("0063_spt_orders", "0064_procurement_documents", "0065_lupin_orders", "0066_spt_registration_owner"):
        from app.db.spt_models import SptOrder, SptPatient, SptRequest
        orders, patients, requests = SptOrder.__table__, SptPatient.__table__, SptRequest.__table__
        # Registration ownership is operational metadata, not a new encrypted
        # payload. Freeze this rotation inventory across the additive boundary
        # so historical schemas never select the new ORM column and a paused
        # ciphertext rotation retains its original digest contract.
        patients = Table("spt_patients", MetaData(), autoload_with=db.connection(),
            include_columns=[c.name for c in patients.columns if c.name != "owner_mr_id"])
        result.update({
            "spt_orders": (orders, orders.c.id, "snapshot_ciphertext", "orders"),
            "spt_patients": (patients, patients.c.id, "snapshot_ciphertext", "patients"),
            "spt_requests": (requests, requests.c.key, "response_ciphertext", "requests"),
        })
    if revision in ("0065_lupin_orders", "0066_spt_registration_owner"):
        from app.db.lupin_models import LupinOrder, LupinRequest
        orders, requests = LupinOrder.__table__, LupinRequest.__table__
        # Separate filename domains must not include each other's ciphertext.
        files = Table("files", MetaData(), autoload_with=db.connection(),
            include_columns=["id", "lupin_owner_id", "lupin_name_ciphertext"])
        result.update({
            "lupin_orders": (orders, orders.c.id, "snapshot_ciphertext", "orders"),
            "lupin_requests": (requests, requests.c.key, "response_ciphertext", "requests"),
            "lupin_file_names": (files, files.c.id, "lupin_name_ciphertext", "file_names"),
        })
    return result


def _order_crypto(table):
    if table.startswith("lupin_"):
        from app.services.lupin import seal, unseal
    elif table.startswith("spt_"):
        from app.services.spt import seal, unseal
    elif table.startswith("kits_"):
        from app.services.kits import seal, unseal
    else:
        from app.services.immunotherapy import seal, unseal
    return seal, unseal


def _order_batch(db, settings, table, limit):
    seal, unseal = _order_crypto(table)
    current = DirectoryCrypto(settings)
    _lock(db, True)
    if table not in _order_payloads(db):
        raise RotationError()
    _stage(db, current, "frozen")
    model, pk, field, domain = _order_payloads(db)[table]
    pending = func.split_part(model.c[field], ":", 2) != current.active
    rows = list(db.execute(select(model).where(pending).order_by(pk).limit(limit)).mappings())
    for row in rows:
        logical = unseal(current, domain, row[pk.name], row[field])
        replacement = seal(current, domain, row[pk.name], logical)
        if unseal(current, domain, row[pk.name], replacement) != logical:
            raise RotationError()
        replacements = {field: replacement}
        if "updated_at" in model.c:
            replacements["updated_at"] = row["updated_at"]
        db.execute(model.update().where(pk == row[pk.name]).values(**replacements))
    remaining = db.scalar(select(func.count()).select_from(model).where(pending))
    db.commit()
    return dict(status="batch-committed", table=table, processed=len(rows), remaining=remaining)


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
        result = {**inventory, "approval": plan, "schema": db.scalar(text("SELECT version_num FROM alembic_version")),
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
            for name, table in _tables(db).items():
                if name == "vendors":
                    continue  # No sensitive Vendor equality indexes to rekey.
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
                        values = _values(source, name, row, normalized, _fields(db)[name])
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
        if table in ("immunotherapy_orders", "immunotherapy_requests", "kits_orders", "kits_requests", "kits_file_names", "spt_orders", "spt_patients", "spt_requests", "lupin_orders", "lupin_requests", "lupin_file_names"):
            if type(limit) is not int or not 1 <= limit <= staging.BATCH_LIMIT:
                raise RotationError()
            return _order_batch(db, settings, table, limit)
        if table not in FIELDS or type(limit) is not int or not 1 <= limit <= staging.BATCH_LIMIT:
            raise RotationError()
        current = DirectoryCrypto(settings)
        _lock(db, True)
        fields = _fields(db)[table]
        _stage(db, current, "frozen")
        model = _tables(db)[table]
        # Envelope key IDs identify pending rows. Full verification authenticates
        # every skipped envelope before writers can resume.
        pending = or_(*[func.split_part(model.c[f + "_ciphertext"], ":", 2) != current.active
                        for f in fields])
        rows = list(db.execute(select(model).where(pending).order_by(model.c.id).limit(limit)).mappings())
        start = time.monotonic()
        normalized = _normalizations(db, current, table, rows)
        for row in rows:
            staging._deadline(start, 30)
            values = _values(current, table, row, normalized, fields)
            replacements = {}
            for field in fields:
                old = row[field + "_ciphertext"]
                if old is not None and old.split(":")[1] != current.active:
                    replacements[field + "_ciphertext"] = current.encrypt(table, row["id"], field, values[field])
            db.execute(model.update().where(model.c.id == row["id"]).values(**replacements))
            saved = db.execute(select(model).where(model.c.id == row["id"])).mappings().one()
            if _values(current, table, saved, normalized, fields) != values or any(
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
        schema_revision = db.scalar(text("SELECT version_num FROM alembic_version"))
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
        return {**result, "schema": schema_revision,
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
    parser.add_argument("--table", choices=(*FIELDS, "immunotherapy_orders", "immunotherapy_requests", "kits_orders", "kits_requests", "kits_file_names", "spt_orders", "spt_patients", "spt_requests", "lupin_orders", "lupin_requests", "lupin_file_names"))
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
