"""Expiry/loss projections and reviewed append-only mutations under stock locks."""
import uuid
from decimal import Decimal, localcontext
from sqlalchemy import select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.expiry_models import BatchCost, ExpiryDisposal, ExpiryRequest, ExpiryDigest
from app.db.in_house_stock_models import InHouseStock, InHousePosting
from app.db.location_models import StorageLocation
from app.db.allergen_models import AllergenProduct
from app.services import inventory as inv, reserve_movements
from app.services.expiry_policy import state, today
from app.services.zones import label


def transaction(db, actor, work):
    def run(current, crypto):
        reserve_movements.acquire(db, current)
        with localcontext() as ctx:
            ctx.prec = 60
            return work(current, crypto)
    # Costs/reserves/disposal intentionally retain protected singleton access.
    return inv.transaction(db, actor, run)


def decimal_text(value):
    return format(value, "f")


def cost(db, crypto, kind, key):
    row = db.scalar(select(BatchCost).where(BatchCost.source_kind == kind, BatchCost.batch_id == key))
    return crypto.open(row.id, "batch_cost", row.payload_ciphertext) if row else None


def cost_basis(db, crypto, kind, key, meta):
    if kind == "lot" and meta.get("source") == "in_house_dilution":
        # Input cost is conserved: quantity grows by factor, unit cost falls
        # by that exact factor. Later explicit source costs also cover output.
        source = cost(db, crypto, "reserve", uuid.UUID(meta["reserveId"]))
        if source:
            return {**source, "unitCost": decimal_text(Decimal(source["unitCost"]) / Decimal(meta["dilutionFactor"])),
                    "provenance": source["provenance"] + " (allocated from source reserve; no added diluent/overhead inferred)"}
        return None
    return cost(db, crypto, kind, key)


def record_cost(db, crypto, actor, kind, key, rate, provenance, *, origin):
    if cost(db, crypto, kind, key):
        raise inv.PRError("Actual cost is already recorded and cannot be overwritten.", 409, "expiry_cost_known")
    if len(provenance.strip()) < 3:
        raise inv.PRError("Record actual cost provenance and reason.", 422, "expiry_cost_provenance")
    identity, now = uuid.uuid4(), utcnow()
    data = dict(id=str(identity), sourceKind=kind, batchId=str(key),
        unitCost=rate, provenance=provenance.strip(), basis="actual_purchase" if kind == "lot" else "actual_manufacturing",
        currency="INR", origin=origin, actorId=str(actor.user.id), actor=label(db, actor.user.id), at=now.isoformat())
    db.add(BatchCost(id=identity, source_kind=kind, batch_id=key, actor_id=actor.user.id,
        created_at=now, payload_ciphertext=crypto.seal(identity, "batch_cost", data)))
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
        action="inventory_actual_cost_recorded", resource_type="inventory_batch_cost", resource_id=identity,
        outcome="success", request_id=db.info.get("request_id"), created_at=now))
    db.flush()
    return data


def batch(db, crypto, kind, key):
    row = db.get(inv.Lot if kind == "lot" else InHouseStock, key)
    if not row or (kind == "lot" and (row.combo_id or not row.product_id)):
        raise inv.PRError("Allergen batch is unavailable.", 404, "expiry_batch_missing")
    meta = crypto.open(key, "lot" if kind == "lot" else "in_house_reserve", row.payload_ciphertext)
    return row, meta


def projection(db, crypto, kind, row, meta, location_id, amount, day):
    product = db.get(AllergenProduct, row.product_id if kind == "lot" else uuid.UUID(meta["allergenId"]))
    location = db.get(StorageLocation, location_id) if location_id else None
    evidence = cost_basis(db, crypto, kind, row.id, meta)
    rate = evidence["unitCost"] if evidence else None
    derived = kind == "lot" and meta.get("source") == "in_house_dilution"
    return dict(sourceKind=kind, batchId=str(row.id),
        locationId=str(location_id) if location_id else None, locationName=location.name if location else "Unallocated",
        productName=meta.get("productName") or meta.get("allergenName"),
        category=meta.get("categoryName") or (product.category_name if product else "Category unavailable"),
        batchNo=meta.get("batchNo") or meta.get("batch") or "Batch unavailable",
        expiryDate=meta.get("expiryDate"), status=state(meta.get("expiryDate"), day),
        quantity=inv.q(amount), unit=meta.get("unit") or ("ml" if kind == "reserve" else "procurement quantity units"),
        unitCost=rate, expiredValue=decimal_text(amount * Decimal(rate)) if rate is not None else None,
        costProvenance=evidence["provenance"] if evidence else None,
        costTargetKind="reserve" if derived else kind,
        costTargetId=meta["reserveId"] if derived else str(row.id),
        costTargetUnit="source reserve unit" if derived else (meta.get("unit") or "ml"),
        costSnapshot=evidence)


def current_rows(db, crypto, day=None):
    """All-or-explicit-failure bounded encrypted scan, no misleading truncation."""
    day = day or today()
    inv.require_complete(db)
    result = []
    lots = inv.bounded(db, select(inv.Lot).where(inv.Lot.product_id.is_not(None), inv.Lot.combo_id.is_(None)).order_by(inv.Lot.id))
    balances = inv.bounded(db, select(inv.Balance).join(inv.Lot).where(
        inv.Lot.product_id.is_not(None), inv.Lot.combo_id.is_(None), inv.Balance.quantity > 0).order_by(inv.Balance.id))
    by_lot = {}
    for bal in balances:
        by_lot.setdefault(bal.lot_id, []).append(bal)
    for lot in lots:
        if lot.id not in by_lot:
            continue
        meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
        for bal in by_lot[lot.id]:
            result.append(projection(db, crypto, "lot", lot, meta, bal.location_id, bal.quantity, day))
    for reserve in inv.bounded(db, select(InHouseStock).order_by(InHouseStock.id)):
        meta = crypto.open(reserve.id, "in_house_reserve", reserve.payload_ciphertext)
        for location, amount in reserve_movements.balances(db, meta).items():
            if amount > 0:
                result.append(projection(db, crypto, "reserve", reserve, meta, uuid.UUID(location), amount, day))
    if len(result) > inv.LIMIT:
        raise inv.PRError("Expiry scope exceeds the finite 2000 batch/location limit; no partial list, totals or digest was returned.", 422, "expiry_scope")
    return sorted(result, key=lambda r: (r["expiryDate"] or "9999-12-31", r["productName"], r["batchId"], r["locationId"] or ""))


def matches(row, query):
    return query in " ".join(str(row.get(k) or "") for k in (
        "productName", "category", "batchNo", "locationName", "expiryDate", "batchId", "unit", "actor", "reason")).casefold()


def summary(pending, history):
    missing = [r for r in pending if r["unitCost"] is None]
    units = {}
    for row in missing:
        units[row["unit"]] = units.get(row["unit"], Decimal(0)) + Decimal(row["quantity"])
    disposed_units = {}
    for row in history:
        if row["unitCost"] is None:
            disposed_units[row["unit"]] = disposed_units.get(row["unit"], Decimal(0)) + Decimal(row["quantity"])
    return dict(pendingValue=decimal_text(sum((Decimal(r["expiredValue"]) for r in pending if r["expiredValue"] is not None), Decimal(0))),
        disposedValue=decimal_text(sum((Decimal(r["expiredValue"]) for r in history if r["expiredValue"] is not None), Decimal(0))),
        uncostedBatches=len({(r["sourceKind"], r["batchId"]) for r in missing}),
        uncostedQuantities=[dict(unit=unit, quantity=inv.q(amount)) for unit, amount in sorted(units.items())],
        disposedUncostedBatches=len({(r["sourceKind"], r["batchId"]) for r in history if r["unitCost"] is None}),
        disposedUncostedQuantities=[dict(unit=unit, quantity=inv.q(amount)) for unit, amount in sorted(disposed_units.items())],
        scope="All search-matching expired batches and immutable disposal records, never page subtotals; incomplete loss where cost is unavailable.")


def listing(db, actor, view="expired", group="all", query="", offset=0, limit=25):
    def work(_, crypto):
        day = today()
        term = query.strip().casefold()
        rows = [r for r in current_rows(db, crypto, day) if matches(r, term)]
        history = [crypto.open(r.id, "expiry_disposal", r.payload_ciphertext) for r in inv.bounded(
            db, select(ExpiryDisposal).order_by(ExpiryDisposal.created_at.desc(), ExpiryDisposal.id))]
        history = [r for r in history if matches(r, term)]
        pending = [r for r in rows if r["status"] in ("today", "expired")]
        selected = history if view == "history" else pending if view == "expired" else [
            r for r in rows if r["status"] in ("today", "next15") and (group == "all" or r["status"] == group)]
        digest = db.get(ExpiryDigest, day)
        return dict(items=selected[offset:offset + limit], filtered=len(selected), offset=offset, limit=limit,
            summary={**summary(pending, history),
                "unknownExpiryBatches": len({(r["sourceKind"], r["batchId"]) for r in rows if r["status"] == "unknown"})},
            digest=dict(day=day.isoformat(), status=digest.status, category=digest.category) if digest else None,
            asOf=utcnow().isoformat())
    return transaction(db, actor, work)


def review(db, crypto, body):
    row, meta = batch(db, crypto, body.sourceKind, body.batchId)
    if body.sourceKind == "lot":
        balance = inv.balance_at(db, row.id, body.locationId)
        amount = balance.quantity if balance else Decimal(0)
    else:
        amount = reserve_movements.balances(db, meta).get(str(body.locationId), Decimal(0))
    selected = inv.quantity(body.quantity)
    # Only the exact displayed remaining quantity may be confirmed. Competing
    # operations invalidate the review, rather than disposing an unseen amount.
    if not selected or selected != amount:
        raise inv.PRError("Remaining quantity changed. Refresh and review the exact batch/location again.", 409, "expiry_quantity_changed")
    data = projection(db, crypto, body.sourceKind, row, meta, body.locationId, amount, today())
    if data["status"] not in ("today", "expired"):
        raise inv.PRError("Only stock with a known expiry date on or before today can be disposed.", 409, "expiry_not_expired")
    if len(body.reason.strip()) < 3:
        raise inv.PRError("Record a disposal reason.", 422, "expiry_reason")
    data["reason"] = body.reason.strip()
    return dict(batch=data, reviewToken=crypto.digests(["expiry-disposal-review", data])[crypto.active])


def preview(db, actor, body):
    return transaction(db, actor, lambda _, crypto: review(db, crypto, body))


def retry(db, crypto, actor, key, command):
    hashes = crypto.digests(command)
    row = db.get(ExpiryRequest, key)
    if row:
        if row.actor_id != actor.user.id or row.digest not in hashes.values():
            raise inv.PRError("Request is closed or conflicts. Check its outcome before another save.", 409, "expiry_retry")
        return True, crypto.open(key, "expiry_retry", row.payload_ciphertext), hashes
    return False, None, hashes


def remember(db, crypto, actor, key, hashes, data):
    db.add(ExpiryRequest(key=key, actor_id=actor.user.id, digest=hashes[crypto.active],
        payload_ciphertext=crypto.seal(key, "expiry_retry", data)))


def supply_cost(db, actor, body):
    def work(current, crypto):
        found, result, hashes = retry(db, crypto, current, body.idempotencyKey, ["cost", body.model_dump(mode="json")])
        if found:
            return result
        _, meta = batch(db, crypto, body.sourceKind, body.batchId)
        if body.sourceKind == "lot" and meta.get("source") == "in_house_dilution":
            raise inv.PRError("Record manufacturing cost on the original reserve; diluted stock inherits the exact allocated cost.", 422, "expiry_source_cost")
        data = record_cost(db, crypto, current, body.sourceKind, body.batchId, body.unitCost, body.provenance, origin="explicit_missing_cost")
        remember(db, crypto, current, body.idempotencyKey, hashes, data)
        return data
    return transaction(db, actor, work)


def dispose(db, actor, body):
    def work(current, crypto):
        found, result, hashes = retry(db, crypto, current, body.idempotencyKey, ["disposal", body.model_dump(mode="json")])
        if found:
            return result
        checked = review(db, crypto, body)
        if checked["reviewToken"] != body.reviewToken:
            raise inv.PRError("Expiry, quantity or cost changed. Review the batch again.", 409, "expiry_review_stale")
        identity, now = uuid.uuid4(), utcnow()
        data = dict(**checked["batch"], id=str(identity), at=now.isoformat(),
            actor=label(db, current.user.id), actorId=str(current.user.id), appendOnly=True)
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="expired_stock_disposed", resource_type="expiry_disposal", resource_id=identity,
            outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        db.add(ExpiryDisposal(id=identity, source_kind=body.sourceKind, batch_id=body.batchId,
            actor_id=current.user.id, event_id=event.id, created_at=now,
            payload_ciphertext=crypto.seal(identity, "expiry_disposal", data)))
        db.flush()
        amount = Decimal(data["quantity"])
        if body.sourceKind == "lot":
            inv.post(db, db.get(inv.Lot, body.batchId), body.locationId, -amount, f"disposal:{identity}", current)
        else:
            db.add(InHousePosting(reserve_id=body.batchId, disposal_id=identity, movement_id=None,
                location_id=body.locationId, delta=-amount, before=amount, after=Decimal(0)))
        remember(db, crypto, current, body.idempotencyKey, hashes, data)
        return data
    return transaction(db, actor, work)


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(ExpiryRequest, key)
        if row and row.actor_id != current.user.id:
            raise inv.PRError("This request belongs to another actor.", 403, "expiry_retry_owner")
        if not row:
            db.add(ExpiryRequest(key=key, actor_id=current.user.id, digest="cancelled",
                payload_ciphertext=crypto.seal(key, "expiry_retry", None)))
        committed = row is not None and row.digest != "cancelled"
        return dict(state="committed" if committed else "not_committed",
            result=crypto.open(key, "expiry_retry", row.payload_ciphertext) if committed else None)
    return transaction(db, actor, work)
