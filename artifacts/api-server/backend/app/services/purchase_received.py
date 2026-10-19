"""Authoritative receiving. No local data, stock posting or financial mutations."""
import uuid
from decimal import Decimal
from sqlalchemy import select, text, func
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.purchase_order_models import PurchaseOrder as PO
from app.db.purchase_received_models import PurchaseReceipt as PR, ReceiptSource, ReceiptHistory, ReceiptRetry
from app.db.staff_models import StaffProfile
from app.db.vendor_models import Vendor
from app.services.allergens import authorize
from app.services.staff_crypto import StaffCrypto
from app.services.zones import label
from app.services import purchase_orders as orders
from app.services.purchase_received_crypto import PRError, ReceiptCrypto

SCAN_LIMIT = 2000


def transaction(db, actor, work):
    try:
        current = authorize(db, actor)
        import logging
        engine = db.get_bind().engine
        if engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO) or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO):
            raise PRError()
        crypto = ReceiptCrypto(get_settings())
        result = work(current, crypto)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise PRError("Purchase Received schema or storage is unavailable. Contact the operator; your draft is preserved.") from None
    except Exception:
        db.rollback()
        raise


def bounded(db, statement):
    rows = list(db.scalars(statement.limit(SCAN_LIMIT + 1)))
    if len(rows) > SCAN_LIMIT:
        raise PRError(f"This authorized scope exceeds {SCAN_LIMIT} records. Narrow the date/PO scope; no partial result or export was returned.", 422, "pr_scope_limit")
    return rows


def projection(row, crypto):
    return crypto.open(row.id, "receipt", row.payload_ciphertext)


def source_receipts(db, po_id, crypto):
    return [projection(row, crypto) for row in bounded(db, select(PR).where(PR.po_id == po_id).order_by(PR.id))]


def balances(po, receipts, exclude=None):
    return {line["id"]: Decimal(line["quantity"]) - sum(
        (Decimal(l["acceptedQty"]) for r in receipts if r["status"] == "active" and r["id"] != exclude
         for l in r["lines"] if l["lineId"] == line["id"]), Decimal(0)) for line in po["lines"]}


def fulfillment(po, receipts):
    remaining = balances(po, receipts)
    if all(v == 0 for v in remaining.values()):
        return "Closed"
    return "Partially Received" if any(remaining[l["id"]] < Decimal(l["quantity"]) for l in po["lines"]) else "Open"


def source(db, po_id, crypto, exclude=None):
    row = orders.find(db, po_id)  # transaction-held PO lock, shared by PO mutations
    po = orders.projection(db, row)
    receipts = source_receipts(db, po_id, crypto)
    return {**po, "balances": {k: str(v) for k, v in balances(po, receipts, exclude).items()},
            "fulfillment": fulfillment(po, receipts), "receipts": receipts}


def get_row(db, record_id):
    row = db.get(PR, record_id)
    if not row:
        raise PRError("Receipt not found.", 404, "pr_not_found")
    return row


def review_data(db, crypto, body, existing=None):
    po = source(db, body.poId, crypto, str(existing.id) if existing else None)
    if po["status"] != "open" or (existing and existing.po_id != body.poId):
        raise PRError("Choose an open server PO. The source of a saved receipt cannot change.", 409, "pr_source")
    old = projection(existing, crypto) if existing else None
    if body.receivedDate.isoformat() < po["poDate"]:
        raise PRError("Received date cannot be before the PO date.", 422, "pr_date")
    if body.receiverMode == "staff":
        retained = old and old["receiverMode"] == "staff" and old["staffId"] == str(body.staffId)
        staff = db.scalar(select(StaffProfile).where(StaffProfile.id == body.staffId).with_for_update())
        if not retained and (not staff or staff.status != "active" or staff.deleted_at):
            raise PRError("Select available active staff or Others.", 409, "pr_receiver")
        name = old["receivedBy"] if retained else StaffCrypto(get_settings()).decrypt(staff.id, "name", staff.name_ciphertext)
        receiver_version = None if retained else staff.version
    else:
        name, receiver_version = body.otherName.strip(), None
    lines, seen = [], set()
    for line in body.lines:
        line_id = str(line.lineId)
        src = next((l for l in po["lines"] if l["id"] == line_id), None)
        if not src or line_id in seen:
            raise PRError("Each source PO line must be present at most once.", 422, "pr_line")
        seen.add(line_id)
        received, accepted = Decimal(line.receivedQty), Decimal(line.acceptedQty)
        available = Decimal(po["balances"][line_id])
        prior = next((l for l in old["lines"] if l["lineId"] == line_id), None) if old else None
        historical_received = Decimal(prior["receivedQty"]) if prior else Decimal(0)
        if not (0 < received <= 1000000 and 0 <= accepted <= received and accepted <= available and received <= max(available, historical_received)):
            raise PRError("Received quantity must be positive and within available/historical allowance; accepted must be between zero and received and within current remaining capacity.", 422, "pr_quantity")
        if not line.batchNo.strip() or line.expiryDate < body.receivedDate:
            raise PRError("Batch is required and expiry cannot be before receiving.", 422, "pr_batch_expiry")
        # Never reconstruct historical availability from today's other receipts.
        historic = (Decimal(prior["balanceAfterQty"]) + Decimal(prior["acceptedQty"]) - accepted
                    if prior and prior.get("balanceAfterQty") is not None else None)
        after = available - accepted if not old else historic
        lines.append(dict(lineId=line_id, productId=src["productId"], productName=prior["productName"] if prior else src["productName"],
            orderedQty=prior["orderedQty"] if prior else src["quantity"], receivedQty=str(received), acceptedQty=str(accepted),
            rejectedQty=str(received - accepted), batchNo=line.batchNo, expiryDate=line.expiryDate.isoformat(),
            balanceAfterQty=str(after) if after is not None and after >= 0 else None))
    if old:
        data = {k: old[k] for k in ("poId", "poNumber", "poDate", "vendorId", "vendorName", "vendorPhone", "vendorAddress", "vendorGstNo", "locationId", "locationName")}
    else:
        vendor = db.get(Vendor, body_vendor := uuid.UUID(po["vendorId"]))
        data = dict(poId=str(body.poId), poNumber=po["number"], poDate=po["poDate"], vendorId=str(body_vendor),
            vendorName=po["vendorName"], vendorPhone=vendor.phoneNo or "", vendorAddress=vendor.registeredAddress or "",
            vendorGstNo=vendor.gstNo or "", locationId=po["locationId"], locationName=po["locationName"])
    data.update(receivedDate=body.receivedDate.isoformat(), receiverMode=body.receiverMode,
                staffId=str(body.staffId) if body.staffId else None, receivedBy=name, lines=lines)
    token_data = [data, po["version"], po["balances"], existing.version if existing else None, receiver_version]
    return dict(receipt=data, reviewToken=crypto.digests(token_data)[crypto.active])


def preview(db, actor, body, record_id=None):
    return transaction(db, actor, lambda _, c: review_data(db, c, body, get_row(db, record_id) if record_id else None))


def mutation(db, actor, body, record_id=None, operation="created"):
    def work(current, crypto):
        digest_data = [operation, str(record_id), body.model_dump(mode="json")]
        hashes = crypto.digests(digest_data)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": body.idempotencyKey.int % (2**63 - 1)})
        retry = db.get(ReceiptRetry, body.idempotencyKey)
        if retry:
            if retry.actor_id == current.user.id and retry.digest == "cancelled":
                raise PRError("This request was reconciled as not committed and closed. Review again with a new request identity.", 409, "pr_request_closed")
            if retry.actor_id != current.user.id or retry.digest not in hashes.values():
                raise PRError("Retry identity conflicts with another request.", 409, "pr_retry_conflict")
            return crypto.open(retry.key, "retry", retry.payload_ciphertext)
        row = get_row(db, record_id) if record_id else None
        orders.find(db, row.po_id if row else body.poId)
        if row and (row.version != body.expected_version or row.status != "active"):
            raise PRError("This receipt changed or was deleted. Reload before making a new edit.", 409, "pr_stale")
        before = projection(row, crypto) if row else None
        now = utcnow()
        if operation == "deleted":
            data = {**before, "status": "deleted", "deletedAt": now.isoformat()}
        else:
            reviewed = review_data(db, crypto, body, row)
            if reviewed["reviewToken"] != body.reviewToken:
                raise PRError("Source, staff or available quantities changed. Your draft is kept; review again.", 409, "pr_review_stale")
            data = reviewed["receipt"]
            if not row:
                sequence = db.scalar(text("SELECT nextval('purchase_receipt_number_seq')"))
                row = PR(id=uuid.uuid4(), number=f"PR-{body.receivedDate:%Y%m%d}-{sequence:08d}", po_id=body.poId,
                         vendor_id=uuid.UUID(data["vendorId"]), location_id=uuid.UUID(data["locationId"]), version=0)
                db.add(row)
            row.staff_id, row.receiver_mode, row.received_date = body.staffId, body.receiverMode, body.receivedDate
            data.update(status="active", deletedAt=None)
        row.version += 1
        row.status, row.updated_at = data["status"], now
        data.update(id=str(row.id), number=row.number, version=row.version,
                    source="server", createdAt=before["createdAt"] if before else now.isoformat(), updatedAt=now.isoformat())
        row.payload_ciphertext = crypto.seal(row.id, "receipt", data)
        db.flush()
        # References are retained, including removed/deleted receipt lines.
        for line in data["lines"]:
            if not db.get(ReceiptSource, (row.id, uuid.UUID(line["lineId"]))):
                db.add(ReceiptSource(receipt_id=row.id, line_id=uuid.UUID(line["lineId"]), product_id=uuid.UUID(line["productId"])))
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id, action=f"purchase_received_{operation}",
            resource_type="purchase_received", resource_id=row.id, outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        history = dict(id=str(event.id), receiptId=str(row.id), number=row.number, action=operation, at=now.isoformat(),
                       actor=label(db, current.user.id), summary=f"Receipt {operation}; {len(data['lines'])} saved lines", receipt=data)
        db.add(ReceiptHistory(event_id=event.id, receipt_id=row.id, payload_ciphertext=crypto.seal(event.id, "history", history)))
        db.add(ReceiptRetry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
                           payload_ciphertext=crypto.seal(body.idempotencyKey, "retry", data)))
        return data
    return transaction(db, actor, work)


def query_data(db, crypto, params):
    statement = select(PR)
    for key, column in (("po_id", PR.po_id), ("vendor_id", PR.vendor_id)):
        if params.get(key):
            statement = statement.where(column == params[key])
    if params.get("receipt_id"):
        statement = statement.where(PR.id == params["receipt_id"])
    if params.get("from_date"):
        statement = statement.where(PR.received_date >= params["from_date"])
    if params.get("to_date"):
        statement = statement.where(PR.received_date <= params["to_date"])
    rows = bounded(db, statement.order_by(PR.received_date.desc(), PR.created_at.desc(), PR.id.desc()))
    data = [projection(row, crypto) for row in rows]
    po_ids = {row.po_id for row in rows}
    sources = {str(key): source(db, key, crypto) for key in sorted(po_ids)}
    for r in data:
        r["fulfillment"] = sources[r["poId"]]["fulfillment"]
    total = len(data)
    status = params.get("status", "active")
    if status != "all":
        data = [r for r in data if r["status"] == status]
    if params.get("receiver"):
        data = [r for r in data if ("staff:" + r["staffId"] if r["staffId"] else "other") == params["receiver"]]
    if params.get("fulfillment"):
        data = [r for r in data if r["fulfillment"] == params["fulfillment"]]
    if params.get("query", "").strip():
        query = params["query"].strip().casefold()
        data = [r for r in data if query in " ".join([r["number"], r["poNumber"], r["vendorName"], r["receivedBy"],
                   *[l["productName"] for l in r["lines"]]]).casefold()]
    if params.get("sort") == "oldest":
        data.reverse()
    elif params.get("sort") == "number":
        data.sort(key=lambda r: r["number"])
    linked_ids = {r["poId"] for r in data}
    return data, total, {key: value for key, value in sources.items() if key in linked_ids}


def listing(db, actor, params, export=False):
    def work(_, crypto):
        data, total, sources = query_data(db, crypto, params)
        offset, limit = params.get("offset", 0), params.get("limit", 10)
        return dict(items=data if export else data[offset:offset + limit], filtered=len(data), total=total,
                    limit=len(data) if export else limit, offset=0 if export else offset)
    return transaction(db, actor, work)


def reporting(db, actor, params, analytics=False):
    def work(_, crypto):
        data, total, sources = query_data(db, crypto, params)
        ids = {r["id"] for r in data}
        history_rows = bounded(db, select(ReceiptHistory).where(ReceiptHistory.receipt_id.in_([uuid.UUID(i) for i in ids]))
                               .order_by(ReceiptHistory.event_id))
        events = [crypto.open(row.event_id, "history", row.payload_ciphertext) for row in history_rows]
        for e in events:
            e.pop("receipt", None)
        events.sort(key=lambda e: (e["at"], e["id"]), reverse=True)
        if not analytics:
            query = params.get("activity_query", "").strip().casefold()
            visible = [e for e in events if query in " ".join([e["number"], e["summary"], e["actor"], e["action"]]).casefold()]
            offset, limit = params.get("offset", 0), params.get("limit", 10)
            return dict(items=visible[offset:offset + limit], total=len(events), filtered=len(visible), offset=offset, limit=limit)
        lines = [l for r in data for l in r["lines"]]
        counts = {k: sum(e["action"] == k for e in events) for k in ("created", "updated", "deleted")}
        fulfillment_counts = {k: sum(s["fulfillment"] == k for s in sources.values()) for k in ("Open", "Partially Received", "Closed")}
        return dict(scope="All matching server receipts; current fulfillment uses active acceptance only. Quantities are not summed across products.",
            counts=counts, fulfillment=fulfillment_counts, receipts=len(data), active=sum(r["status"] == "active" for r in data),
            deleted=sum(r["status"] == "deleted" for r in data), lines=len(lines),
            acceptedAny=sum(Decimal(l["acceptedQty"]) > 0 for l in lines),
            fullyAccepted=sum(Decimal(l["acceptedQty"]) > 0 and Decimal(l["rejectedQty"]) == 0 for l in lines),
            anyRejected=sum(Decimal(l["rejectedQty"]) > 0 for l in lines),
            allRejected=sum(Decimal(l["acceptedQty"]) == 0 for l in lines))
    return transaction(db, actor, work)


def references(db, actor, kind, query="", selected_id=None, offset=0, limit=25):
    def work(_, crypto):
        if kind == "staff":
            statement = select(StaffProfile).where(StaffProfile.status == "active", StaffProfile.deleted_at.is_(None))
            if selected_id:
                statement = statement.where(StaffProfile.id == selected_id)
            rows = bounded(db, statement.order_by(StaffProfile.id))
            staff_crypto = StaffCrypto(get_settings())
            data = [dict(id=str(r.id), name=staff_crypto.decrypt(r.id, "name", r.name_ciphertext)) for r in rows]
        else:
            statement = select(PO).where(PO.status == "open")
            if selected_id:
                statement = statement.where(PO.id == selected_id)
            rows = bounded(db, statement.order_by(PO.id))
            data = []
            for r in rows:
                po = source(db, r.id, crypto)
                if po["fulfillment"] != "Closed":
                    data.append(dict(id=str(r.id), name=f"{r.number} · {r.vendor_name} · {po['fulfillment']}"))
        total = len(data)
        data = sorted([r for r in data if query.strip().casefold() in r["name"].casefold()], key=lambda r: (r["name"], r["id"]))
        return dict(items=data[offset:offset + limit], total=total, filtered=len(data), limit=limit, offset=offset)
    return transaction(db, actor, work)


def reconcile(db, actor, key):
    def work(current, crypto):
        # Same lock as mutations: "not committed" is never inferred mid-commit.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
        row = db.get(ReceiptRetry, key)
        if not row:
            # A late original HTTP request cannot commit after this answer.
            db.add(ReceiptRetry(key=key, actor_id=current.user.id, digest="cancelled",
                               payload_ciphertext=crypto.seal(key, "retry", None)))
            return dict(state="not_committed", receipt=None)
        if row.actor_id != current.user.id:
            raise PRError("Retry identity belongs to a different account.", 403, "pr_retry_owner")
        return dict(state="not_committed" if row.digest == "cancelled" else "committed",
                    receipt=crypto.open(key, "retry", row.payload_ciphertext))
    return transaction(db, actor, work)
