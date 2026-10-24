"""Bounded lifetime posting ledger, serialized with every authoritative writer.

The type filter selects visible events only. It never changes carry-forward or
running-balance arithmetic. Procurement context is informational, never additive.
"""
import uuid
from collections import defaultdict
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utcnow
from app.db.inventory_models import InventoryAdjustment
from app.db.opening_stock_models import OpeningStock
from app.db.product_models import ProductAssembly
from app.db.purchase_received_models import ReceiptHistory, PurchaseReceipt
from app.db.purchase_order_models import PurchaseOrder, PurchaseOrderLine
from app.db.location_models import StorageLocation
from app.services import inventory as inv, purchase_orders as orders
from app.services.inventory_adjustments import product, identity
from app.services.purchase_received_crypto import ReceiptCrypto
from app.core.config import get_settings

TYPES = {"opening", "receipt", "receipt_correction", "transfer", "allocation",
         "assembly_consumption", "adjustment"}


def fail(message):
    raise inv.PRError(message + " A complete ledger cannot be shown.", 409, "inventory_history_gap")


def procurement(db, product_id, receipt_crypto):
    """Retained current/removed PO lines and recorded PR versions, not an audit invented from today's catalog."""
    lines = inv.bounded(db, select(PurchaseOrderLine).where(
        PurchaseOrderLine.product_id == product_id).order_by(PurchaseOrderLine.id))
    po_ids = {l.order_id for l in lines}
    result = []
    for pid in sorted(po_ids):
        row = db.get(PurchaseOrder, pid)
        if not row:
            continue
        retained = [l for l in lines if l.order_id == pid]
        result.append(dict(kind="po", id=str(pid), number=row.number, date=row.po_date.isoformat(),
            status="Deleted" if row.status == "deleted" else "Order commitment",
            ordered=inv.q(sum((Decimal(l.snapshot["quantity"]) for l in retained), Decimal(0))),
            received="Unavailable", accepted="Unavailable", rejected="Unavailable",
            stockEffect="None — non-stock commitment", sourceAvailable=row.status != "deleted"))
    prs = inv.bounded(db, select(PurchaseReceipt).where(
        PurchaseReceipt.po_id.in_(po_ids)).order_by(PurchaseReceipt.id)) if po_ids else []
    ids = [r.id for r in prs]
    histories = inv.bounded(db, select(ReceiptHistory).where(
        ReceiptHistory.receipt_id.in_(ids)).order_by(ReceiptHistory.event_id)) if ids else []
    versions = {}
    for h in histories:
        data = receipt_crypto.open(h.event_id, "history", h.payload_ciphertext)
        receipt = data["receipt"]
        versions[(h.receipt_id, receipt["version"])] = data
    for row in prs:
        # Each retained version is explicitly context, never another stock credit.
        saved = sorted((h for (rid, _), h in versions.items() if rid == row.id),
                       key=lambda h: h["receipt"]["version"])
        if not saved:
            saved = [dict(receipt=receipt_crypto.open(row.id, "receipt", row.payload_ciphertext), action="legacy")]
        for h in saved:
            receipt = h["receipt"]
            entries = [l for l in receipt["lines"] if l["productId"] == str(product_id)]
            if not entries:
                continue
            total = lambda field: inv.q(sum((Decimal(l[field]) for l in entries), Decimal(0)))
            result.append(dict(kind="pr", id=f"{row.id}:{receipt['version']}", sourceId=str(row.id),
                number=f"{row.number} · version {receipt['version']}", date=receipt.get("receivedDate"),
                status=f"{h.get('action', 'recorded')} · {receipt['status']}",
                ordered="See related PO", received=total("receivedQty"), accepted=total("acceptedQty"),
                rejected=total("rejectedQty"), stockEffect="Counted only by authoritative postings",
                sourceAvailable=row.status == "active"))
    return dict(items=result, scope=(
        "Related retained PO lines and recorded receipt versions for this allergen, independent of ledger filters. "
        "POs are non-stock commitments with no delta. PR quantities are informational and counted once, only from postings. "
        "Removed PO line versions and earlier unretained document changes are not a complete document audit."))


def ledger(db, actor, product_id, from_date=None, to_date=None, location_id=None,
           transaction_type=None, offset=0, limit=25):
    def work(_, crypto):
        context = inv.require_complete(db)
        item = product(db, product_id)
        if transaction_type and transaction_type not in TYPES:
            raise inv.PRError("Choose a valid transaction type.", 422, "inventory_filter")
        if from_date and to_date and from_date >= to_date:
            raise inv.PRError("Choose an increasing recorded-time period.", 422, "inventory_period")
        if (from_date and from_date.tzinfo is None) or (to_date and to_date.tzinfo is None):
            raise inv.PRError("Ledger timestamps require a timezone.", 422, "inventory_period")
        selected_location = None
        if location_id and location_id != "unallocated":
            try:
                selected_location = uuid.UUID(location_id)
            except ValueError:
                raise inv.PRError("Invalid location reference.", 422, "inventory_location") from None
            if not db.get(StorageLocation, selected_location):
                raise inv.PRError("Location is unavailable.", 422, "inventory_location")
        lots = inv.bounded(db, select(inv.Lot).where(inv.Lot.product_id == product_id).order_by(inv.Lot.id))
        by_id = {l.id: l for l in lots}
        raw = inv.bounded(db, select(inv.Posting).join(inv.Lot).where(
            inv.Lot.product_id == product_id).order_by(inv.Posting.created_at, inv.Posting.id))
        balances = inv.bounded(db, select(inv.Balance).join(inv.Lot).where(
            inv.Lot.product_id == product_id).order_by(inv.Balance.id))
        location_ids = {r.location_id for r in raw} | {b.location_id for b in balances}
        locations = {key: db.get(StorageLocation, key).name for key in location_ids if key}
        loc = lambda key: locations.get(key, "Location unavailable") if key else "Unallocated"
        # A lifetime sum alone can conceal missing net-zero movements. Check each
        # retained lot/location chain, including exhausted lots, before arithmetic.
        chain = defaultdict(lambda: Decimal(0))
        for row in raw:
            key = (row.lot_id, row.location_id)
            if row.before != chain[key] or row.after != row.before + row.delta:
                fail("Recorded lot/location history has a missing or inconsistent posting.")
            chain[key] = row.after
        actual = {(b.lot_id, b.location_id): b.quantity for b in balances}
        if any(chain[k] != actual.get(k, Decimal(0)) for k in chain.keys() | actual.keys()):
            fail("Recorded postings do not reconcile to current authoritative stock.")
        for lot in lots:
            if lot.accepted <= 0:
                continue
            origin = (f"adjustment:{lot.adjustment_id}" if lot.adjustment_id else
                      f"opening:{lot.opening_id}" if lot.opening_id else None)
            credits = [p for p in raw if p.lot_id == lot.id and
                       (p.source_key == origin if origin else p.source_key.startswith(f"receipt:{lot.receipt_id}:"))]
            if sum((p.delta for p in credits), Decimal(0)) != lot.accepted:
                fail("Retained positive lot provenance has missing source postings.")
        receipt_crypto = ReceiptCrypto(get_settings())
        related = procurement(db, product_id, receipt_crypto)
        receipt_ids = {l.receipt_id for l in lots if l.receipt_id}
        history = inv.bounded(db, select(ReceiptHistory).where(
            ReceiptHistory.receipt_id.in_(receipt_ids)).order_by(ReceiptHistory.event_id)) if receipt_ids else []
        versions = {}
        for h in history:
            data = receipt_crypto.open(h.event_id, "history", h.payload_ciphertext)
            versions[(h.receipt_id, data["receipt"]["version"])] = data
        groups = defaultdict(list)
        for row in raw:
            # Transfers are one atomic event per allergen (all its lots/legs).
            groups[f"move:{row.movement_id}" if row.movement_id else str(row.id)].append(row)
        events = []
        for gid, rows in groups.items():
            first = rows[0]
            lot = by_id[first.lot_id]
            meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
            at, business, actor_name, reason = first.created_at, None, "Unavailable (legacy actor snapshot)", "Unavailable (not retained)"
            kind, sid, available = None, None, False
            reference = first.source_key
            if first.movement_id:
                movement = db.get(inv.Movement, first.movement_id)
                if not movement:
                    fail("A transfer source is missing.")
                for lid in {r.lot_id for r in rows}:
                    legs = [r for r in rows if r.lot_id == lid]
                    if (len(legs) != 2 or sum((r.delta for r in legs), Decimal(0)) != 0
                            or {r.location_id for r in legs} != {movement.source_id, movement.destination_id}):
                        fail("A transfer has incomplete retained legs.")
                data = crypto.open(movement.id, "movement", movement.payload_ciphertext)
                at, business, actor_name = movement.created_at, data.get("date"), data.get("actor", actor_name)
                tx = "allocation" if movement.source_id is None else "transfer"
                kind, sid, available = "movement", str(movement.id), True
                reference = f"{tx.title()} {str(movement.id)[:8]}"
                reason = f"Reason unavailable; delivery metadata: {data.get('deliveredBy', 'unavailable')}"
            elif first.source_key.startswith("adjustment:"):
                sid = first.source_key.split(":")[1]
                record = db.get(InventoryAdjustment, uuid.UUID(sid))
                if not record:
                    fail("An adjustment source is missing.")
                data = crypto.open(record.id, "adjustment", record.payload_ciphertext)
                tx, kind, available = "adjustment", "adjustment", True
                actor_name, reason = data["actor"], data["reason"]
                reference = f"Adjustment {sid[:8]}" + (f" · correction of {data['correctionOf']}" if data.get("correctionOf") else "")
            elif first.source_key.startswith("opening:"):
                record = db.get(OpeningStock, lot.opening_id) if lot.opening_id else None
                data = crypto.open(record.id, "opening", record.payload_ciphertext) if record else {}
                tx, kind, sid, available = "opening", "opening", str(lot.opening_id) if lot.opening_id else None, bool(record)
                business, actor_name = data.get("recordedDate"), data.get("actor", actor_name)
                reason = data.get("remarks") or data.get("reason") or reason
                reference = f"Opening stock {sid[:8]}" if sid else "Opening stock · source unavailable"
            elif first.source_key.startswith("assembly:"):
                sid = first.source_key.split(":")[1]
                record = db.get(ProductAssembly, uuid.UUID(sid))
                data = crypto.open(record.id, "assembly", record.payload_ciphertext) if record else {}
                tx, kind, available = "assembly_consumption", "assembly", bool(record)
                actor_name = data.get("actor", actor_name)
                business, reason = data.get("date"), data.get("remarks") or reason
                reference = f"Assembly {sid[:8]} · retained recipe"
            elif first.source_key.startswith("receipt:"):
                _, receipt_id, version = first.source_key.split(":")
                h = versions.get((uuid.UUID(receipt_id), int(version)))
                prior = any(r.lot_id == lot.id and r.source_key.startswith("receipt:") and
                            r.created_at < first.created_at for r in raw)
                tx = "receipt_correction" if prior else "receipt"
                kind, sid = "receipt", receipt_id
                receipt = db.get(PurchaseReceipt, uuid.UUID(sid))
                available = bool(receipt and receipt.status == "active")
                if h:
                    data = h["receipt"]
                    business, actor_name = data.get("receivedDate"), h.get("actor", actor_name)
                    reason = data.get("remarks") or (f"Reason unavailable; recorded activity: {h['summary']}" if h.get("summary") else reason)
                    reference = f"{data['number']} · {h['action']} · version {version}"
                    line = next((l for l in data["lines"] if l["lineId"] == str(lot.line_id)), None)
                    if line:
                        meta = {**meta, "batchNo": line.get("batchNo")}
                else:
                    reference = f"{meta.get('receiptNumber') or 'Receipt'} · version {version} · metadata unavailable"
                    meta = {**meta, "batchNo": None}
            else:
                fail("A posting has an unsupported source.")
            scoped = [r for r in rows if not location_id or r.location_id == selected_location]
            if not scoped:
                continue
            delta = sum((r.delta for r in scoped), Decimal(0))
            events.append(dict(id=gid, at=at, businessDate=business, type=tx, reference=reference,
                lotId=str(lot.id) if len({r.lot_id for r in rows}) == 1 else None,
                batchNo=meta.get("batchNo") if len({r.lot_id for r in rows}) == 1 else None, location=loc(selected_location) if location_id else
                    (f"{data['source']['name']} → {data['destination']['name']}" if first.movement_id else loc(first.location_id)),
                actor=actor_name, reason=reason, sourceKind=kind, sourceId=sid, sourceAvailable=available,
                legs=[dict(location=loc(r.location_id), delta=inv.q(r.delta), lotId=str(r.lot_id)) for r in rows],
                _delta=delta))
        events.sort(key=lambda r: (r["at"], r["id"]))
        running = opening = additions = reductions = Decimal(0)
        visible = []
        for event in events:
            delta = event.pop("_delta")
            running += delta
            if from_date and event["at"] < from_date:
                opening += delta
                continue
            if to_date and event["at"] >= to_date:
                continue
            additions += max(delta, Decimal(0))
            reductions += max(-delta, Decimal(0))
            event.update(at=event["at"].isoformat(), quantityIn=inv.q(max(delta, Decimal(0))),
                         quantityOut=inv.q(max(-delta, Decimal(0))), balance=inv.q(running))
            if not transaction_type or event["type"] == transaction_type:
                visible.append(event)
        current = sum((b.quantity for b in balances if not location_id or b.location_id == selected_location), Decimal(0))
        return dict(product=identity(item), asOf=utcnow().isoformat(),
            coverage=dict(complete=True, contract=context["contract"],
                earliestRecordedAt=raw[0].created_at.isoformat() if raw else None,
                limitations=["Coverage is recorded system postings only, not pre-system movements.",
                    "Missing legacy actors, reasons, document dates and pre-system batch provenance are unavailable, never reconstructed.",
                    "Sales, reservations, returns and unposted workflows are outside coverage."]),
            summary=dict(opening=inv.q(opening), additions=inv.q(additions), reductions=inv.q(reductions),
                closing=inv.q(opening + additions - reductions), current=inv.q(current),
                scope="Period opening is carried forward from earlier recorded postings, not an Opening Stock entry. "
                    "Totals include ALL transaction types in the selected date/location scope, before the display-only type filter. "
                    "All-location transfers/allocation are net zero; location views include real in/out. Recorded-time UTC ordering."),
            items=visible[offset:offset + limit], filtered=len(visible), offset=offset, limit=limit,
            locations=[dict(id=str(k), name=v) for k, v in locations.items()], procurement=related)
    return inv.transaction(db, actor, work)
