"""Authenticated, append-only INR settlements over saved order facts."""
import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.settlement_models import SettlementBatch as Batch, SettlementEntry as Entry, SettlementRejection as Rejection
from app.services import mr_orders
from app.services.shipments import SOURCES
from app.services.immunotherapy import ImmError, encode
from app.services.directory_runtime import crypto_scope
from app.services.settlement_crypto import seal, unseal

# A separate financial lock serializes reads, reconciliation and posting; source
# row locks additionally coordinate with the existing order/lifecycle writers.
LOCK = 145580
SCAN_LIMIT = 20000
HISTORY_LIMIT = 50000
ZERO = Decimal("0.00")


class RejectedSettlement:
    def __init__(self, failure):
        self.error = ImmError(failure["message"], failure["status"], failure["code"])
        self.error.settlement_terminal = True


def fail(message, status=409, code="settlement_conflict"):
    raise ImmError(message, status, code)


def transaction(db, actor, work, *, posting=False):
    try:
        current = mr_orders.authorize(db, actor)
        if posting and current.role != "mr":
            fail("Only authenticated MRs may record settlements. Admin is read-only.", 403, "access_denied")
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
        with crypto_scope(db) as keys:
            result = work(current, keys)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        fail("Settlements could not be confirmed. Retry the exact same submission; do not enter it again.",
             503, "settlements_unavailable")
    except Exception:
        db.rollback()
        raise


def exact(value):
    """Authenticate saved monetary facts, never silently round corrupt history."""
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > Decimal("999999999999.99") or amount != amount.quantize(Decimal(".01")):
            raise ValueError()
        return amount
    except (InvalidOperation, ValueError, TypeError):
        fail("A saved financial value is unreadable. No estimated total or balance is available.",
             503, "settlement_saved_value")


def fmt(value):
    return format(value, ".2f")


def saved_total(kind, saved):
    if kind == "IT":
        minor = saved.get("totalMinor")
        if minor is None:
            return None
        if isinstance(minor, bool) or not isinstance(minor, int):
            fail("The saved Immunotherapy total is unreadable.", 503, "settlement_saved_value")
        return exact(Decimal(minor) / 100)
    price = (saved.get("pricing") or {}).get("total") if kind == "Kit" else saved.get("total")
    return None if price is None else exact(price)


def person(value, *, mask_contacts=False):
    if not isinstance(value, dict):
        return None
    # Saved facts only; MR Doctor/Patient contact masking is enforced here,
    # not merely in the browser. The MR's own saved contact remains readable.
    result = {field: str(value[field]) if value.get(field) is not None else None
              for field in ("id", "name", "code", "qualification")}
    result["code"] = result["code"] or value.get("doctorNumber") or value.get("employeeCode")
    result["phone"] = str(value["phone"]) if value.get("phone") and not mask_contacts else None
    result["email"] = str(value["email"]) if value.get("email") and not mask_contacts else None
    result["contactsMasked"] = mask_contacts
    return result


def people(saved, *, mask_contacts=False):
    items = ([saved["patient"]] if isinstance(saved.get("patient"), dict) else [])
    items += saved.get("patients") if isinstance(saved.get("patients"), list) else []
    result, seen = [], set()
    for item in items:
        value = person(item, mask_contacts=mask_contacts)
        if value is not None:
            key = value["id"] or encode(value)
            if key not in seen:
                seen.add(key)
                result.append(value)
    return result


def history(db, keys, candidates):
    """One financial row per source order, never multiplied by patient joins."""
    output = defaultdict(list)
    count = 0
    for kind, identities in candidates.items():
        if not identities:
            continue
        conditions = [Entry.kind == kind, Entry.order_id.in_(identities)]
        count += db.scalar(select(func.count()).select_from(Entry).where(*conditions))
        if count > HISTORY_LIMIT:
            fail("Payment history exceeds the safe search size. Narrow the order dates or order type.",
                 422, "settlement_history_limit")
        rows = db.execute(select(Entry, Batch).join(Batch, Batch.id == Entry.batch_id)
                          .where(*conditions).order_by(Batch.date, Batch.created_at, Entry.id)
                          .limit(HISTORY_LIMIT + 1))
        for entry, batch in rows:
            receipt = unseal(keys, "entries", entry.id, entry.payload_ciphertext)
            data = unseal(keys, "batches", batch.id, batch.payload_ciphertext)
            amount = exact(receipt["amount"])
            if amount <= 0:
                fail("A saved transaction is unreadable.", 503, "settlement_saved_value")
            output[(kind, entry.order_id)].append(dict(
                id=str(entry.id), batchId=str(batch.id), date=batch.date.isoformat(),
                mode=data["result"]["mode"], amount=fmt(amount),
                verification="Verified" if entry.verified_at and entry.verified_by else "Not verified",
                createdAt=batch.created_at.isoformat(), actorId=str(batch.actor_id)))
    return output


def projection(kind, row, saved, receipts, *, mr_scope=False):
    total = saved_total(kind, saved)
    paid = sum((exact(item["amount"]) for item in receipts), ZERO)
    if total is not None and paid > total:
        fail("Recorded payments exceed the saved order total. Ask an administrator to investigate.",
             503, "settlement_inconsistent_balance")
    verification = ("No transactions" if not receipts else
                    "Verified" if all(t["verification"] == "Verified" for t in receipts) else "Not verified")
    return dict(key=f"{kind}:{row.id}", kind=kind, id=str(row.id), number=row.number,
                date=row.date.isoformat(), version=row.version,
                doctor=person(saved.get("doctor"), mask_contacts=mr_scope),
                mr=person(saved.get("mr")), patients=people(saved, mask_contacts=mr_scope),
                total=fmt(total) if total is not None else None, paid=fmt(paid),
                balance=fmt(total - paid) if total is not None else None,
                verification=verification, transactions=receipts)


def candidate_orders(db, *, kind="All", order_from=None, order_to=None):
    candidates, scanned = [], 0
    for label, source in SOURCES.items():
        if kind != "All" and label != kind:
            continue
        model = source.Order
        # Approved is the legacy persisted spelling of the same approved stage.
        clauses = [model.status.in_(["In process", "Approved"]), *mr_orders.scope(db, model)]
        if order_from:
            clauses.append(model.date >= order_from)
        if order_to:
            clauses.append(model.date <= order_to)
        scanned += db.scalar(select(func.count()).select_from(model).where(*clauses))
        if scanned > SCAN_LIMIT:
            fail("Settlement search exceeds 20,000 candidate orders. Narrow the order dates or type.",
                 422, "settlement_scan_limit")
        rows = list(db.scalars(select(model).where(*clauses)
                              .order_by(model.date.desc(), model.id.desc()).limit(SCAN_LIMIT + 1)))
        if len(candidates) + len(rows) > SCAN_LIMIT:
            fail("Settlement search grew beyond 20,000 orders. Narrow the order dates or type.",
                 422, "settlement_scan_limit")
        candidates.extend((label, source, row) for row in rows)
    return candidates


def listing(db, actor, *, kind="All", order_from=None, order_to=None,
            payment_from=None, payment_to=None, doctor_id=None, mr_id=None, patient_id=None,
            verification="All", offset=0, limit=25):
    for label, start, end in (("Order", order_from, order_to), ("Payment", payment_from, payment_to)):
        if start and end and start > end:
            fail(f"{label}-date From must be on or before To.", 422, "settlement_dates")

    def work(current, keys):
        if current.role == "mr" and mr_id and mr_id != current.mr.id:
            fail("The MR filter is fixed to your signed-in identity.", 403, "access_denied")
        candidates = candidate_orders(db, kind=kind, order_from=order_from, order_to=order_to)
        scoped = defaultdict(list)
        for label, _, row in candidates:
            scoped[label].append(row.id)
        receipts = history(db, keys, scoped)
        items = []
        for label, source, row in candidates:
            if doctor_id and row.doctor_id != doctor_id or mr_id and row.mr_id != mr_id:
                continue
            saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            record = projection(label, row, saved, receipts[(label, row.id)], mr_scope=current.role == "mr")
            if patient_id and not any(p["id"] == str(patient_id) for p in record["patients"]):
                continue
            if verification != "All" and record["verification"] != verification:
                continue
            if (payment_from or payment_to) and not any(
                (not payment_from or receipt["date"] >= payment_from.isoformat()) and
                (not payment_to or receipt["date"] <= payment_to.isoformat())
                for receipt in record["transactions"]):
                continue
            items.append(record)
        items.sort(key=lambda r: (r["date"], r["kind"], r["id"]), reverse=True)
        return dict(items=items[offset:offset + limit], total=len(items), offset=offset, limit=limit)
    return transaction(db, actor, work)


def references(db, actor, kind, *, search="", offset=0, limit=25):
    def work(current, keys):
        # No independent directory traversal: selectors are saved associations
        # of In process orders in precisely the caller's authorized scope.
        found = {}
        for label, source, row in candidate_orders(db):
            saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            values = people(saved) if kind == "patients" else [person(saved.get("doctor" if kind == "doctors" else "mr"))]
            for value in values:
                if not value or not value["id"]:
                    continue
                if kind == "mrs" and current.role == "mr" and value["id"] != str(current.mr.id):
                    continue
                name = value["name"] or "Saved name unavailable"
                if search.casefold().strip() not in f"{name} {value['id']}".casefold():
                    continue
                found.setdefault(value["id"], dict(id=value["id"], name=name))
        values = sorted(found.values(), key=lambda p: (p["name"].casefold(), p["id"]))
        return dict(items=values[offset:offset + limit], total=len(values), offset=offset, limit=limit)
    return transaction(db, actor, work)


def owned_order(db, kind, identity, *, lock=False):
    source = SOURCES[kind]
    query = select(source.Order).where(source.Order.id == identity, *mr_orders.scope(db, source.Order))
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        fail("This saved order is unavailable in your current authorized scope.", 404, "settlement_not_found")
    return source, row


def replay(db, current, keys, batch):
    if current.role != "mr" or batch.actor_id != current.user.id or batch.mr_id != current.mr.id:
        fail("This submission is unavailable for your current identity.", 403, "access_denied")
    data = unseal(keys, "batches", batch.id, batch.payload_ciphertext)
    # An actor ID or old MR assignment alone cannot unlock a historical reply.
    for entry in data["result"]["entries"]:
        owned_order(db, entry["kind"], uuid.UUID(entry["id"]))
    return data


def reconcile(db, actor, key):
    def work(current, keys):
        batch = db.get(Batch, key)
        data = replay(db, current, keys, batch) if batch else None
        rejected = db.get(Rejection, key) if not batch else None
        if rejected:
            failure = rejected_data(current, keys, rejected)["failure"]
            return dict(status="rejected", batch=None,
                        rejection=dict(message=failure["message"], code=failure["code"]))
        # Absence is not cancellation. Clients must keep the original key and
        # frozen body because an earlier request may still be waiting to run.
        return dict(status="committed" if data else "absent", batch=data["result"] if data else None, rejection=None)
    return transaction(db, actor, work, posting=True)


def order_history(db, actor, kind, identity):
    """Retains authorized history access after shipment/lifecycle changes."""
    def work(current, keys):
        source, row = owned_order(db, kind, identity)
        saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
        receipts = history(db, keys, {kind: [row.id]})
        return projection(kind, row, saved, receipts[(kind, row.id)], mr_scope=current.role == "mr")
    return transaction(db, actor, work)


def rejected_data(current, keys, rejected):
    if rejected.actor_id != current.user.id or rejected.mr_id != current.mr.id:
        fail("This submission is unavailable for your current identity.", 403, "access_denied")
    return unseal(keys, "rejections", rejected.id, rejected.payload_ciphertext)


def post(db, actor, body):
    def attempt(current, keys):
        request = body.model_dump(mode="json")
        prior = db.get(Batch, body.idempotency_key)
        if prior:
            data = replay(db, current, keys, prior)
            if encode(data["request"]) != encode(request):
                fail("Retry the exact unchanged transaction with its original key.", 409, "settlement_retry")
            return data["result"]
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        if body.date > today:
            fail("Transaction date cannot be in the future.", 422, "settlement_dates")
        chosen = []
        for item in sorted(body.entries, key=lambda v: (v.kind, str(v.id))):
            source, row = owned_order(db, item.kind, item.id, lock=True)
            if row.status not in ("In process", "Approved"):
                fail("Only In process orders may receive settlement payments.", 409, "settlement_status")
            if row.version != item.expected_version:
                fail("An order changed. Refresh the listing before preparing a new transaction.", 409, "settlement_stale")
            saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            total = saved_total(item.kind, saved)
            if total is None:
                fail("This order has no authoritative saved total and cannot receive payment.", 409, "settlement_unpriced")
            chosen.append((item, row, total))
        scoped = defaultdict(list)
        for item, row, _ in chosen:
            scoped[item.kind].append(row.id)
        receipts = history(db, keys, scoped)
        for item, row, total in chosen:
            paid = sum((exact(t["amount"]) for t in receipts[(item.kind, row.id)]), ZERO)
            if paid != Decimal(item.expected_paid):
                fail("Recorded payments changed. Refresh before preparing a new transaction.", 409, "settlement_stale")
            if Decimal(item.amount) > total - paid:
                fail("An entered amount exceeds that order's remaining balance. Nothing was posted.",
                     422, "settlement_overpayment")
        now = utcnow()
        result = dict(id=str(body.idempotency_key), date=body.date.isoformat(), mode=body.mode,
                      entries=[dict(kind=i.kind, id=str(i.id), amount=i.amount) for i in body.entries],
                      total=fmt(sum((Decimal(i.amount) for i in body.entries), ZERO)))
        db.add(Batch(id=body.idempotency_key, actor_id=current.user.id, mr_id=current.mr.id,
                     date=body.date, created_at=now,
                     payload_ciphertext=seal(keys, "batches", body.idempotency_key, dict(request=request, result=result))))
        db.flush()
        for item in body.entries:
            identity = uuid.uuid4()
            db.add(Entry(id=identity, batch_id=body.idempotency_key, kind=item.kind, order_id=item.id,
                         payload_ciphertext=seal(keys, "entries", identity, dict(amount=item.amount)),
                         verified_at=None, verified_by=None))
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action="settlement_recorded", resource_type="settlement_batch",
                         resource_id=body.idempotency_key, outcome="success",
                         request_id=db.info.get("request_id"), created_at=now))
        db.flush()
        return result

    def work(current, keys):
        request = body.model_dump(mode="json")
        rejected = db.get(Rejection, body.idempotency_key)
        if rejected:
            data = rejected_data(current, keys, rejected)
            if encode(data["request"]) != encode(request):
                fail("Retry the exact unchanged transaction with its original key.", 409, "settlement_retry")
            return RejectedSettlement(data["failure"])
        try:
            return attempt(current, keys)
        except ImmError as error:
            # Never declare a committed batch rejected merely because access
            # to its reply was lost after reassignment or account changes.
            if error.status >= 500 or db.get(Batch, body.idempotency_key):
                raise
            failure = dict(message=error.message, status=error.status, code=error.code)
            db.add(Rejection(id=body.idempotency_key, actor_id=current.user.id, mr_id=current.mr.id,
                             created_at=utcnow(),
                             payload_ciphertext=seal(keys, "rejections", body.idempotency_key,
                                                     dict(request=request, failure=failure))))
            db.flush()
            return RejectedSettlement(failure)
    result = transaction(db, actor, work, posting=True)
    if isinstance(result, RejectedSettlement):
        raise result.error
    return result
