"""Reviewed append-only corrections under the shared inventory writer lock."""
import uuid
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.opening_stock_models import OpeningStock as Opening, OpeningStockRevision as Revision, OpeningStockRequest as Retry
from app.db.expiry_models import BatchCost, ExpiryDisposal, ExpirySeparation
from app.schemas.opening_stock import OpeningRow
from app.services import inventory as inv, opening_stock as openings
from app.services.expiry_policy import state as expiry_state
from app.services.retry_capabilities import envelope, result as retry_result
from app.services.quantity_precision import verify_chain, checkpoints
from app.services.zones import label


def eligible(db, crypto, opening, current):
    """Check lifetime activity, not merely net balances. Never rewrite any lot."""
    lots = inv.bounded(db, select(inv.Lot).where(inv.Lot.opening_id == opening.id).order_by(inv.Lot.opening_revision))
    if len(lots) != current.get("version", 1):
        raise inv.PRError("Opening revision evidence is incomplete; correction is blocked.", 409, "opening_history")
    active = next((l for l in lots if str(l.id) == current["lotId"]), None)
    if not active or active.opening_revision != current["version"]:
        raise inv.PRError("Opening lot evidence is unavailable.", 409, "opening_history")
    for lot in lots:
        postings = inv.bounded(db, select(inv.Posting).where(inv.Posting.lot_id == lot.id).order_by(inv.Posting.created_at, inv.Posting.id))
        balances = inv.bounded(db, select(inv.Balance).where(inv.Balance.lot_id == lot.id).order_by(inv.Balance.id))
        version = lot.opening_revision
        credit = f"opening:{opening.id}" + (f":{version}" if version > 1 else "")
        reversal = f"opening-reversal:{opening.id}:{version + 1}"
        if any(p.movement_id or p.source_key not in {credit, reversal} for p in postings):
            raise inv.PRError("This opening has downstream allocation, transfer, adjustment, consumption or disposal activity. It cannot be edited, even if stock was later returned.", 409, "opening_used")
        retained = (db.get(ExpirySeparation, ("lot", lot.id))
            or db.scalar(select(ExpiryDisposal.id).where(ExpiryDisposal.source_kind == "lot", ExpiryDisposal.batch_id == lot.id).limit(1))
            or db.scalar(select(BatchCost.id).where(BatchCost.source_kind == "lot", BatchCost.batch_id == lot.id).limit(1)))
        if retained:
            raise inv.PRError("This opening has retained expiry, disposal or actual-cost evidence. Editing would rewrite dependent history and is blocked.", 409, "opening_used")
        verify_chain(postings, balances, checkpoints(db, "inventory", [lot.id]))
        expected = inv.quantity(current["quantity"]) if lot == active else Decimal(0)
        if sum((b.quantity for b in balances), Decimal(0)) != expected or any(
                b.quantity and (lot != active or str(b.location_id) != str(lot.origin_id)) for b in balances):
            raise inv.PRError("Opening balances do not reconcile to the current revision; correction is blocked.", 409, "opening_history")
        if lot == active:
            meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
            if (str(lot.combo_id or lot.product_id) != current["itemId"]
                    or bool(lot.combo_id) != (current["itemKind"] == "combo")
                    or (str(lot.origin_id) if lot.origin_id else None) != current["locationId"]
                    or inv.quantity(str(lot.accepted)) != expected
                    or meta.get("expiryDate") != current.get("expiryDate")):
                raise inv.PRError("Opening item, location or expiry evidence is inconsistent; correction is blocked.", 409, "opening_history")
    return active


def review_data(db, crypto, record_id, body):
    opening = db.get(Opening, record_id)
    if not opening:
        raise inv.PRError("Opening stock record not found.", 404, "opening_not_found")
    before = openings.projection(db, crypto, opening)
    if before["version"] != body.expectedVersion:
        raise inv.PRError("A newer correction was saved. Your draft is preserved; open the latest record before reviewing again.", 409, "opening_edit_stale")
    eligible(db, crypto, opening, before)
    row = OpeningRow(sourceId=opening.source_id, rowId=opening.row_id,
        **body.model_dump(include={"itemKind", "itemId", "quantity", "unitRate", "locationId", "expiryDate"}))
    after = openings.review_row(db, crypto, row, body.recordedDate, correction=True)
    if expiry_state(before.get("expiryDate")) in ("expired", "today") and (
            before["itemId"] != after["itemId"] or before["itemKind"] != after["itemKind"]
            or before.get("expiryDate") != after["expiryDate"]):
        raise inv.PRError("A dated expired or expiry-today opening cannot be revived by changing its item or expiry.", 409, "opening_expiry_retained")
    snapshot = dict(before=before, after=after, recordedDate=body.recordedDate.isoformat(), expectedVersion=body.expectedVersion,
        inventoryEffect=f"Reverse {before['quantity']} {before['unit']} from {before['productName']} / {before['location']['name']}; "
                        f"post {after['quantity']} {after['unit']} to {after['productName']} / {after['location']['name']}. "
                        "Usability still follows the saved expiry and Unallocated policy; no dependent history is changed.")
    return {**snapshot, "reviewToken": crypto.digests(["opening-edit-review:v1", snapshot])[crypto.active]}


def preview(db, actor, record_id, body):
    return inv.transaction(db, actor, lambda _, c: review_data(db, c, record_id, body), capability=("opening_stock", "edit"))


def commit(db, actor, record_id, body):
    def work(current, crypto):
        hashes = crypto.digests(["opening-edit-request:v1", str(record_id), body.model_dump(mode="json")])
        retry = db.get(Retry, body.idempotencyKey)
        if retry:
            if retry.actor_id != current.user.id or retry.digest not in hashes.values():
                raise inv.PRError("Request identity is closed or conflicts. Check its outcome before saving again.", 409, "opening_retry")
            return retry_result(current, "opening_stock", crypto.open(retry.key, "opening_retry", retry.payload_ciphertext))
        reviewed = review_data(db, crypto, record_id, body)
        snapshot = {k: v for k, v in reviewed.items() if k != "reviewToken"}
        if body.reviewToken not in crypto.digests(["opening-edit-review:v1", snapshot]).values():
            raise inv.PRError("The reviewed values or references changed. Your draft is preserved; review again.", 409, "opening_review_stale")
        before, after = reviewed["before"], reviewed["after"]
        opening = db.get(Opening, record_id)
        old_lot = db.get(inv.Lot, uuid.UUID(before["lotId"]))
        version, now, rid, lid = body.expectedVersion + 1, utcnow(), uuid.uuid4(), uuid.uuid4()
        editor = label(db, current.user.id)
        activity = dict(action="opening_stock_corrected", at=now.isoformat(), actor=editor, requestId=db.info.get("request_id"))
        saved = {**before, **after, "lotId": str(lid), "recordedDate": body.recordedDate.isoformat(),
            "version": version, "updatedAt": now.isoformat(), "updatedBy": editor,
            "before": "0.00", "after": after["quantity"], "revisions": [], "activity": [],
            "historicalData": ("Expiry explicitly retained in a reviewed opening correction; pre-system batch, receipt and assembly history unavailable; no historical values inferred."
                if after["expiryDate"] else openings.HISTORY)}
        # Creator/creation time and import identity always come from the original.
        previous = {k: v for k, v in before.items() if k not in {"revisions", "activity"}}
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="opening_stock_corrected", resource_type="opening_stock", resource_id=record_id,
            outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        db.add(Revision(id=rid, opening_id=record_id, version=version, actor_id=current.user.id,
            event_id=event.id, created_at=now, payload_ciphertext=crypto.seal(rid, "opening_revision",
                dict(before=previous, after=saved, activity=activity, version=version))))
        inv.post(db, old_lot, old_lot.origin_id, -Decimal(before["quantity"]),
            f"opening-reversal:{record_id}:{version}", current)
        meta = dict(itemKind=after["itemKind"], source="opening", openingId=str(record_id), openingRevision=version,
            productId=after["itemId"], productName=after["productName"], unit=after["unit"],
            unitRate=after["unitRate"], openingValue=after["openingValue"], openingLocation=after["location"],
            recordedDate=saved["recordedDate"], batchNo=None, expiryDate=after["expiryDate"],
            receiptId=None, receiptNumber=None, lineId=None, receivedDate=None,
            originalCreatedAt=before["createdAt"], historicalData=saved["historicalData"],
            originLocationId=after["locationId"], originLocationName=after["location"]["name"])
        lot = inv.Lot(id=lid, opening_id=record_id, opening_revision=version,
            product_id=uuid.UUID(after["itemId"]) if after["itemKind"] == "allergen" else None,
            combo_id=uuid.UUID(after["itemId"]) if after["itemKind"] == "combo" else None,
            origin_id=body.locationId, accepted=Decimal(after["quantity"]),
            payload_ciphertext=crypto.seal(lid, "lot", meta))
        db.add(lot)
        db.flush()
        inv.post(db, lot, body.locationId, Decimal(after["quantity"]), f"opening:{record_id}:{version}", current)
        saved = openings.projection(db, crypto, opening)
        result = dict(records=[saved], summary=openings.summary([saved]), postedCount=1, alreadyImportedCount=0)
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
            payload_ciphertext=crypto.seal(body.idempotencyKey, "opening_retry", envelope("opening_stock", "edit", result))))
        return result
    return inv.transaction(db, actor, work, capability=("opening_stock", "edit"))
