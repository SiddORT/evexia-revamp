"""Reviewed, actor-bound adjustments; no parallel balances or backdated posting."""
import uuid
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.inventory_models import InventoryAdjustment as Adjustment, InventoryAdjustmentRequest as Retry
from app.db.allergen_models import AllergenProduct
from app.db.location_models import StorageLocation
from app.services import inventory as inv
from app.services.zones import label


def product(db, key):
    row = db.scalar(select(AllergenProduct).where(AllergenProduct.id == key).with_for_update())
    if not row:
        raise inv.PRError("Individual allergen is unavailable.", 404, "inventory_product")
    return row


def identity(row):
    return dict(productId=str(row.id), name=row.name, concentration=row.concentration,
                unit="procurement quantity units")


def choices(db, actor, key):
    def work(_, crypto):
        inv.require_complete(db)
        item = product(db, key)
        locations = inv.bounded(db, select(StorageLocation).where(
            StorageLocation.status == "active", StorageLocation.deleted_at.is_(None)).order_by(StorageLocation.id))
        lots = inv.bounded(db, select(inv.Lot).where(inv.Lot.product_id == key).order_by(inv.Lot.id))
        balances = inv.bounded(db, select(inv.Balance).join(inv.Lot).where(
            inv.Lot.product_id == key, inv.Balance.quantity > 0).order_by(inv.Balance.id))
        by_id = {lot.id: lot for lot in lots}
        result = []
        for bal in balances:
            lot = by_id[bal.lot_id]
            meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
            location = db.get(StorageLocation, bal.location_id) if bal.location_id else None
            result.append(dict(lotId=str(lot.id), locationId=str(bal.location_id) if bal.location_id else None,
                locationName=location.name if location else "Unallocated", available=inv.q(bal.quantity),
                batchNo=meta.get("batchNo"), source=meta.get("source") or "receipt"))
        return dict(product=identity(item), locations=[dict(id=str(l.id), name=l.name) for l in locations],
                    lots=result, asOf=utcnow().isoformat())
    return inv.transaction(db, actor, work)


def review(db, crypto, body):
    inv.require_complete(db)
    item = product(db, body.productId)
    amount = inv.quantity(body.quantity)
    if not amount:
        raise inv.PRError("Enter a positive adjustment quantity.", 422, "inventory_quantity")
    if body.correctionOf:
        prior = db.get(Adjustment, body.correctionOf)
        if not prior or prior.product_id != item.id:
            raise inv.PRError("The correction reference must be an adjustment for this allergen.", 422, "inventory_reference")
    location = db.scalar(select(StorageLocation).where(StorageLocation.id == body.locationId).with_for_update()) if body.locationId else None
    if body.direction == "add":
        if item.deleted_at or item.status != "active":
            raise inv.PRError("New stock requires an active allergen.", 409, "inventory_product")
        if not location or location.deleted_at or location.status != "active":
            raise inv.PRError("New stock requires an active location.", 409, "inventory_location")
        # This is the new adjustment-origin lot scope, not the product balance.
        before = Decimal(0)
    else:
        lot = db.get(inv.Lot, body.lotId)
        if not lot or lot.product_id != item.id or lot.combo_id:
            raise inv.PRError("Choose an existing lot for this allergen.", 422, "inventory_lot")
        balance = inv.balance_at(db, lot.id, body.locationId)
        if not balance or balance.quantity < amount:
            raise inv.PRError("Insufficient stock in this exact lot/location. Your draft is preserved.", 409, "inventory_insufficient")
        before = balance.quantity
    delta = amount if body.direction == "add" else -amount
    data = dict(**body.model_dump(mode="json"), productName=item.name, concentration=item.concentration,
        productVersion=item.version, locationVersion=location.version if location else None,
        locationName=location.name if location else "Unallocated", before=inv.q(before),
        delta=inv.q(delta), after=inv.q(before + delta), unit="procurement quantity units",
        scope="New adjustment lot" if body.direction == "add" else "Selected existing lot/location")
    return dict(adjustment=data, reviewToken=crypto.digests(data)[crypto.active])


def preview(db, actor, body):
    return inv.transaction(db, actor, lambda _, crypto: review(db, crypto, body))


def create(db, actor, body):
    def work(current, crypto):
        hashes = crypto.digests(body.model_dump(mode="json"))
        old = db.get(Retry, body.idempotencyKey)
        if old:
            if old.actor_id != current.user.id or old.digest not in hashes.values():
                raise inv.PRError("Request identity conflicts or is closed. Check its outcome.", 409, "inventory_retry")
            return crypto.open(old.key, "adjustment_retry", old.payload_ciphertext)
        # Never include commit-only fields in the preview digest.
        from app.schemas.inventory_ledger import AdjustmentInput
        checked = review(db, crypto, AdjustmentInput.model_validate(body.model_dump(exclude={"idempotencyKey", "reviewToken"})))
        if body.reviewToken != checked["reviewToken"]:
            raise inv.PRError("Stock or choices changed. Review your preserved draft again.", 409, "inventory_review_stale")
        aid, now = uuid.uuid4(), utcnow()
        data = dict(**checked["adjustment"], id=str(aid), createdAt=now.isoformat(),
                    actor=label(db, current.user.id), actorId=str(current.user.id), appendOnly=True)
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="inventory_adjusted", resource_type="inventory_adjustment", resource_id=aid,
            outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        record = Adjustment(id=aid, product_id=body.productId, location_id=body.locationId,
            direction=body.direction, quantity=inv.quantity(body.quantity), correction_of=body.correctionOf,
            actor_id=current.user.id, event_id=event.id, created_at=now,
            payload_ciphertext=crypto.seal(aid, "adjustment", data))
        db.add(record)
        db.flush()
        if body.direction == "add":
            lid = uuid.uuid4()
            meta = dict(source="adjustment", adjustmentId=str(aid), itemKind="allergen",
                receiptId=None, receiptNumber=None, lineId=None, productId=str(body.productId),
                productName=data["productName"], batchNo=body.batchNo, expiryDate=body.expiryDate.isoformat() if body.expiryDate else None,
                receivedDate=None, originalCreatedAt=now.isoformat(), unit=data["unit"],
                originLocationId=str(body.locationId), originLocationName=data["locationName"],
                historicalData="Adjustment-origin stock; not a receipt or pre-system opening.")
            lot = inv.Lot(id=lid, adjustment_id=aid, product_id=body.productId, origin_id=body.locationId,
                accepted=inv.quantity(body.quantity), payload_ciphertext=crypto.seal(lid, "lot", meta))
            db.add(lot)
            db.flush()
        else:
            lot = db.get(inv.Lot, body.lotId)
        inv.post(db, lot, body.locationId, Decimal(data["delta"]), f"adjustment:{aid}", current)
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
                     payload_ciphertext=crypto.seal(body.idempotencyKey, "adjustment_retry", data)))
        return data
    return inv.transaction(db, actor, work)


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(Retry, key)
        if row and row.actor_id != current.user.id:
            raise inv.PRError("Request belongs to another actor.", 403, "inventory_retry_owner")
        if not row:
            db.add(Retry(key=key, actor_id=current.user.id, digest="cancelled",
                payload_ciphertext=crypto.seal(key, "adjustment_retry", None)))
        return dict(state="committed" if row and row.digest != "cancelled" else "not_committed",
            adjustment=crypto.open(key, "adjustment_retry", row.payload_ciphertext) if row else None)
    return inv.transaction(db, actor, work)


def detail(db, actor, key):
    def work(_, crypto):
        row = db.get(Adjustment, key)
        if not row:
            raise inv.PRError("Adjustment is unavailable.", 404, "inventory_adjustment")
        return crypto.open(row.id, "adjustment", row.payload_ciphertext)
    return inv.transaction(db, actor, work)
