"""Append-only concentrate entry snapshots; movements use separate postings."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, text, func, or_
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.in_house_stock_models import InHouseStock as Reserve, InHouseStockRequest as Retry
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.services.inventory import InventoryCrypto, bounded
from app.services.purchase_received import transaction as protected_transaction
from app.services.purchase_received_crypto import PRError
from app.services.zones import label

# Entry/read serialization; mixed movements take inventory then this lock.
LOCK = 145579
INPUT_FIELDS = ("allergenId", "concentration", "quantity", "unit", "expiryDate", "locationId", "batch", "notes", "actualUnitCost", "costProvenance")


def transaction(db, actor, work):
    def run(current, _):
        from app.services.inventory import lock
        lock(db)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
        from app.core.config import get_settings
        return work(current, InventoryCrypto(get_settings(), db))
    # No capability argument: retain protected singleton Super Admin authorization.
    return protected_transaction(db, actor, run)


def expired(data):
    from app.services.expiry_policy import usable
    return {**data, "expired": not usable(data)}


def references(db, actor, kind, query="", offset=0, limit=25, include_inactive=False):
    def work(_, crypto):
        term = query.strip()
        model = AllergenProduct if kind == "allergens" else StorageLocation
        stmt = select(model)
        if not include_inactive:
            stmt = stmt.where(model.deleted_at.is_(None), model.status == "active")
        if term:
            stmt = stmt.where(model.name.ilike("%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.scalars(stmt.order_by(model.name, model.id).offset(offset).limit(limit))
        items = []
        for row in rows:
            item = dict(id=str(row.id), name=row.name, version=row.version)
            if kind == "allergens":
                cat = db.get(ProductCategory, row.category_id)
                item.update(categoryId=str(cat.id), categoryName=cat.name)
            items.append(item)
        return dict(items=items, filtered=total, offset=offset, limit=limit)
    return transaction(db, actor, work)


def snapshot(db, body):
    item = db.scalar(select(AllergenProduct).where(AllergenProduct.id == body.allergenId).with_for_update())
    location = db.scalar(select(StorageLocation).where(StorageLocation.id == body.locationId).with_for_update())
    if not item or item.deleted_at or item.status != "active":
        raise PRError("Select an existing active allergen.", 409, "reserve_allergen")
    if not location or location.deleted_at or location.status != "active":
        raise PRError("Select an existing active storage location.", 409, "reserve_location")
    category = db.scalar(select(ProductCategory).where(ProductCategory.id == item.category_id).with_for_update())
    if not category:
        raise PRError("Allergen category is unavailable.", 409, "reserve_category")
    return {**{k: body.model_dump(mode="json")[k] for k in INPUT_FIELDS},
            "allergenName": item.name, "categoryId": str(category.id), "categoryName": category.name,
            "locationName": location.name, "allergenVersion": item.version,
            "categoryVersion": category.version, "locationVersion": location.version, "reserveOnly": True}


def tokens(crypto, current, data):
    return crypto.digests(["in-house-review:v1", str(current.user.id), data])


def preview(db, actor, body):
    def work(current, crypto):
        record = snapshot(db, body)
        return dict(record=expired(record), reviewToken=tokens(crypto, current, record)[crypto.active])
    return transaction(db, actor, work)


def create(db, actor, body):
    def work(current, crypto):
        hashes = crypto.digests(["in-house-request:v1", body.model_dump(mode="json")])
        retry = db.get(Retry, body.idempotencyKey)
        if retry:
            if retry.actor_id != current.user.id or retry.digest not in hashes.values():
                raise PRError("Request identity is closed or conflicts. Check its outcome.", 409, "reserve_retry")
            return expired(crypto.open(retry.key, "in_house_retry", retry.payload_ciphertext))
        data = snapshot(db, body)
        if body.reviewToken not in tokens(crypto, current, data).values():
            raise PRError("References changed. Review your preserved draft again.", 409, "reserve_review_stale")
        now, rid = utcnow(), uuid.uuid4()
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="in_house_stock_created", resource_type="in_house_stock", resource_id=rid,
            outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        data.update(id=str(rid), actorId=str(current.user.id), actor=label(db, current.user.id), createdAt=now.isoformat())
        db.add(Reserve(id=rid, actor_id=current.user.id, event_id=event.id, created_at=now,
            payload_ciphertext=crypto.seal(rid, "in_house_reserve", data)))
        db.flush()
        if body.actualUnitCost is not None:
            from app.services.inventory_expiry import record_cost
            record_cost(db, crypto, current, "reserve", rid, body.actualUnitCost,
                        body.costProvenance, origin="manufacturing_entry")
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
            payload_ciphertext=crypto.seal(body.idempotencyKey, "in_house_retry", data)))
        db.flush()
        return expired(data)
    return transaction(db, actor, work)


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(Retry, key)
        if row and row.actor_id != current.user.id:
            raise PRError("Request belongs to another actor.", 403, "reserve_retry_owner")
        if not row:
            db.add(Retry(key=key, actor_id=current.user.id, digest="cancelled",
                payload_ciphertext=crypto.seal(key, "in_house_retry", None)))
        committed = row is not None and row.digest != "cancelled"
        return dict(state="committed" if committed else "not_committed",
            result=expired(crypto.open(key, "in_house_retry", row.payload_ciphertext)) if committed else None)
    return transaction(db, actor, work)


def listing(db, actor, query="", offset=0, limit=25, allergen_id=None,
            from_date=None, to_date=None, date_field="recorded"):
    if from_date and to_date and from_date > to_date:
        raise PRError("From date must be on or before To date.", 422, "reserve_date_range")
    def work(_, crypto):
        # Explicit finite encrypted scan; never return a misleading partial result.
        rows = bounded(db, select(Reserve).order_by(Reserve.created_at.desc(), Reserve.id))
        from app.services.reserve_movements import availability
        data = []
        for row in rows:
            record = expired(crypto.open(row.id, "in_house_reserve", row.payload_ciphertext))
            data.append({**record, **availability(db, record)})
        term = query.strip().casefold()
        def matches_filters(record):
            day = record["expiryDate"] if date_field == "expiry" else record["createdAt"][:10]
            return (
                (not allergen_id or str(record["allergenId"]) == str(allergen_id))
                and (not from_date or day >= from_date.isoformat())
                and (not to_date or day <= to_date.isoformat())
                and term in " ".join(str(record[k]) for k in
                    ("allergenName", "categoryName", "concentration", "unit", "locationName", "batch", "actor", "expiryDate", "id")).casefold()
            )
        matches = [r for r in data if matches_filters(r)]
        return dict(items=matches[offset:offset + limit], filtered=len(matches), total=len(data), offset=offset, limit=limit)
    return transaction(db, actor, work)


def detail(db, actor, record_id):
    def work(_, crypto):
        row = db.get(Reserve, record_id)
        if not row:
            raise PRError("Concentrate reserve not found.", 404, "reserve_not_found")
        from app.services.reserve_movements import availability
        record = expired(crypto.open(row.id, "in_house_reserve", row.payload_ciphertext))
        return {**record, **availability(db, record)}
    return transaction(db, actor, work)
