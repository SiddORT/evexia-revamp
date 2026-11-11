"""Shared Super Admin configuration, applied only to new governed placement."""
from copy import deepcopy
from decimal import Decimal
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.immunotherapy_extract_models import ImmunotherapyExtractSettings as Settings
from app.db.product_category_models import ProductCategory
from app.db.models import AuditEvent
from app.core.security import utcnow
from pydantic import TypeAdapter
from app.schemas.immunotherapy_extract import (
    DOSAGES, POLICY, POSITIONS, ImmExtractPair, ImmExtractPayload, ImmExtractView,
)
from app.services.immunotherapy import ImmError, seal, unseal
from app.services.directory_runtime import crypto_scope

# Writers and final placements share this lock. A placement sees one coherent
# committed configuration across all categories, including absent rows.
POLICY_LOCK = 5310047


def require_schema(db):
    if not db.scalar(text("SELECT to_regclass('public.immunotherapy_extract_settings') IS NOT NULL")):
        raise ImmError("Extract & Dilution settings schema is unavailable. Your changes have not been confirmed.",
                       503, "imm_extract_schema")


def category(db, category_id):
    row = db.get(ProductCategory, category_id)
    if row is None or row.deleted_at is not None:
        raise ImmError("Saved category is unavailable. Choose a current saved category.", 409, "imm_extract_category")
    return row


def configuration(db, keys, category_id):
    category_id = UUID(str(category_id))
    row = db.get(Settings, category_id)
    if row is None:
        return dict(schemaVersion=2, dosages={dose: None for dose in DOSAGES},
                    legacyRows=None, legacyVersion=None)
    try:
        payload = unseal(keys, "extract-settings", category_id, row.payload_ciphertext)
        if isinstance(payload, list):
            legacy = TypeAdapter(list[ImmExtractPair]).validate_python(payload)
            if len(legacy) != 3:
                raise ValueError()
            payload = dict(schemaVersion=2, dosages={dose: None for dose in DOSAGES},
                           legacyRows=[p.model_dump() for p in legacy], legacyVersion=row.version)
        return ImmExtractPayload.model_validate(payload).model_dump(mode="json")
    except (ValueError, TypeError):
        raise ImmError("Saved Extract & Dilution configuration is unreadable. No defaults have been assumed.",
                       503, "imm_extract_configuration") from None


def view(db, keys, category_id, dosage):
    payload = configuration(db, keys, category_id)
    block = payload["dosages"][dosage]
    return ImmExtractView.model_validate(dict(
        categoryId=category_id, policy=POLICY, dosage=dosage,
        version=block["version"] if block else 0,
        rows=block["rows"] if block else [
            dict(compositionSize=size, rank=rank, extract=None, dilution=None) for size, rank in POSITIONS],
        legacyRows=payload["legacyRows"], legacyVersion=payload["legacyVersion"],
    )).model_dump(mode="json")


def transaction(db, actor, work):
    try:
        # Same protected operational-settings boundary as shared batch settings.
        from app.services.allergens import authorize
        current = authorize(db, actor)
        require_schema(db)
        with crypto_scope(db) as keys:
            result = work(current, keys)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Extract & Dilution settings storage is unavailable. Your changes have not been confirmed.",
                       503, "imm_extract_storage") from None
    except Exception:
        db.rollback()
        raise


def categories(db, actor, query, offset, limit):
    def work(current, keys):
        statement = select(ProductCategory).where(ProductCategory.deleted_at.is_(None))
        if query.strip():
            statement = statement.where(ProductCategory.name.icontains(query.strip(), autoescape=True))
        rows = list(db.scalars(statement.order_by(ProductCategory.name, ProductCategory.id).offset(offset).limit(limit + 1)))
        return dict(items=[dict(id=str(row.id), name=row.name, status=row.status) for row in rows[:limit]],
                    nextOffset=offset + limit if len(rows) > limit else None)
    return transaction(db, actor, work)


def read(db, actor, category_id, dosage):
    def work(current, keys):
        category(db, category_id)
        return view(db, keys, category_id, dosage)
    return transaction(db, actor, work)


def write(db, actor, category_id, body):
    def work(current, keys):
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": POLICY_LOCK})
        category(db, category_id)
        saved = view(db, keys, category_id, body.dosage)
        if saved["version"] != body.expected_version:
            raise ImmError("Settings changed. Load the saved version and compare it with your kept edits before saving.",
                           409, "imm_extract_stale")
        payload = configuration(db, keys, category_id)
        row = db.get(Settings, category_id)
        if row is None:
            row = Settings(category_id=category_id, version=0)
            db.add(row)
        payload["dosages"][body.dosage] = dict(
            version=saved["version"] + 1, rows=[pair.model_dump() for pair in body.rows])
        row.version += 1
        row.payload_ciphertext = seal(keys, "extract-settings", category_id, payload)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="immunotherapy_extract_settings_updated", resource_type="product_category",
            resource_id=category_id, outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
        db.flush()
        return view(db, keys, category_id, body.dosage)
    return transaction(db, actor, work)


def assign(db, keys, groups, dosage):
    """No grouping, identities, pricing, formulas or approval changes here."""
    require_schema(db)
    db.execute(text("SELECT pg_advisory_xact_lock_shared(:key)"), {"key": POLICY_LOCK})
    configurations = {}
    for group in groups:
        category_id = group["items"][0]["groupingBasis"]["categoryId"]
        if category_id not in configurations:
            configurations[category_id] = view(db, keys, category_id, dosage)
        config = configurations[category_id]
        # Python sort is stable; Decimal avoids floating point and lexical order.
        group["items"].sort(key=lambda item: Decimal(item["result"]), reverse=True)
        for rank, item in enumerate(group["items"], 1):
            entry = next(r for r in config["rows"] if r["compositionSize"] == len(group["items"]) and r["rank"] == rank)
            pair = {field: entry[field] for field in ("extract", "dilution")}
            item.update(deepcopy(pair))
            item["clinicalAssignment"] = dict(
                policy=POLICY, categoryId=category_id, dosage=dosage, compositionSize=len(group["items"]),
                configurationVersion=config["version"], rank=rank,
                extract=pair["extract"], dilution=pair["dilution"])
