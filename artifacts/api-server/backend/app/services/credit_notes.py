"""Protected non-cash credits under the same lock as every financial writer."""
import uuid
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select, text
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.credit_note_models import CreditNote as Note, CreditReversal as Reversal, CreditRequest as Request
from app.services import settlements as ledger
from app.services.immunotherapy import ImmError, encode
from app.services.settlement_crypto import seal, unseal
from app.services.capability_policy import is_super_admin


def ready(db):
    db.execute(text("SELECT id,sequence,kind,order_id,mr_id,actor_id,date,created_at,payload_ciphertext FROM settlement_credit_notes LIMIT 0"))
    db.execute(text("SELECT id,note_id,actor_id,created_at,payload_ciphertext FROM settlement_credit_reversals LIMIT 0"))
    db.execute(text("SELECT id,actor_id,created_at,payload_ciphertext FROM settlement_credit_requests LIMIT 0"))
    if not db.scalar(text("SELECT to_regclass('settlement_credit_number_seq') IS NOT NULL")):
        raise RuntimeError("Credit number sequence required")
    for table in ("settlement_credit_notes", "settlement_credit_reversals", "settlement_credit_requests"):
        if not db.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
              WHERE t.tgrelid=to_regclass(:table) AND t.tgname=:guard
                AND t.tgenabled='O' AND t.tgtype=27 AND p.proname='guard_settlement_immutable')
        """), {"table": table, "guard": table + "_immutable"}):
            raise RuntimeError("Credit append-only guards required")


def protect(current):
    if not is_super_admin(current):
        ledger.fail("Only the protected Super Admin may manage credit notes.", 403, "access_denied")


def number(kind, date, sequence):
    start = date.year if date.month >= 4 else date.year - 1
    token = {"IT": "IMT", "Kit": "KIT", "SPT": "SPT", "Lupin": "LPN"}[kind]
    return f"CN/{token}/{start % 100:02d}-{(start + 1) % 100:02d}/{sequence}"


def saved_invoice(kind, row, saved):
    from app.services.order_invoice_references import saved_reference
    return saved_reference(kind, row, saved)


def project(keys, note, reversal=None, *, mr_scope=False):
    from app.schemas.credit_notes import CreditRecord, CreditInput
    try:
        data = unseal(keys, "credit_notes", note.id, note.payload_ciphertext)
        result = CreditRecord.model_validate(data).model_dump()
        amount = ledger.exact(result["amount"])
        CreditInput.invoice(result["invoiceReference"])
        if (amount <= 0 or result["id"] != str(note.id) or result["kind"] != note.kind
                or result["orderId"] != str(note.order_id) or result["actorId"] != str(note.actor_id)
                or result["date"] != note.date.isoformat() or result["createdAt"] != note.created_at.isoformat()
                or result["number"] != number(note.kind, note.date, note.sequence)
                or result["status"] != "Active" or result["revertedAt"] or result["revertedBy"]
                or (result["mr"] or {}).get("id") != (str(note.mr_id) if note.mr_id else None)):
            raise ValueError()
        if reversal:
            evidence = unseal(keys, "credit_reversals", reversal.id, reversal.payload_ciphertext)
            if evidence != dict(noteId=str(note.id), actorId=str(reversal.actor_id),
                                createdAt=reversal.created_at.isoformat()):
                raise ValueError()
            result.update(status="Reverted", revertedAt=evidence["createdAt"], revertedBy=evidence["actorId"])
        if mr_scope:
            result["doctor"] = ledger.person(result["doctor"], mask_contacts=True)
        result["canRevert"] = False  # Requires a current, authorized financial read.
        return result
    except (ValueError, KeyError, TypeError):
        ledger.fail("Saved credit evidence is inconsistent. No estimated balance is available.",
                    503, "settlement_credit_history")


def history(db, keys, candidates, *, mr_scope=False):
    output, count = defaultdict(list), 0
    for kind, identities in candidates.items():
        if not identities:
            continue
        rows = db.execute(select(Note, Reversal).outerjoin(Reversal, Reversal.note_id == Note.id)
                          .where(Note.kind == kind, Note.order_id.in_(identities))
                          .order_by(Note.sequence).limit(ledger.HISTORY_LIMIT + 1))
        for note, reversal in rows:
            count += 1
            if count > ledger.HISTORY_LIMIT:
                ledger.fail("Credit history exceeds the safe search size. Narrow the order filters.",
                            422, "settlement_history_limit")
            output[(kind, note.order_id)].append(project(keys, note, reversal, mr_scope=mr_scope))
    return output


def active_total(notes):
    return sum((ledger.exact(n["amount"]) for n in notes if n["status"] == "Active"), ledger.ZERO)


def revision(db, keys, mr_id):
    from app.services.shipments import SOURCES
    rows = []
    # A saved note retains its issue-time MR, but exposure follows its order's
    # current saved owner. Bind review revisions to those same current orders.
    for kind, source in SOURCES.items():
        rows.extend(db.execute(select(Note.id, Reversal.id)
                               .join(source.Order, source.Order.id == Note.order_id)
                               .outerjoin(Reversal, Reversal.note_id == Note.id)
                               .where(Note.kind == kind, source.Order.mr_id == mr_id)
                               .order_by(Note.sequence).limit(ledger.HISTORY_LIMIT + 1)))
        if len(rows) > ledger.HISTORY_LIMIT:
            ledger.fail("Credit history exceeds the safe financial-review size.", 422, "settlement_history_limit")
    return keys._index("credit-review:v1", [[str(a), str(b) if b else None] for a, b in rows])


def current_record(db, keys, kind, identity, *, mr_scope=False, lock=False):
    source, row = ledger.owned_order(db, kind, identity, lock=lock)
    saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
    receipts = ledger.history(db, keys, {kind: [row.id]})
    return row, saved, ledger.projection(kind, row, saved, receipts[(kind, row.id)],
                                         credits=receipts.credits[(kind, row.id)], mr_scope=mr_scope)


def detail_in_transaction(db, keys, identity):
    note = db.get(Note, identity)
    if not note:
        ledger.fail("Credit note not found.", 404, "settlement_credit_not_found")
    _, _, record = current_record(db, keys, note.kind, note.order_id)
    return next(n for n in record["credits"] if n["id"] == str(identity))


def detail(db, actor, identity):
    def work(current, keys):
        protect(current)
        return detail_in_transaction(db, keys, identity)
    return ledger.transaction(db, actor, work)


def request_data(current, keys, row):
    if row.actor_id != current.user.id:
        ledger.fail("This credit request belongs to another identity.", 403, "access_denied")
    return unseal(keys, "credit_requests", row.id, row.payload_ciphertext)


def reconcile(db, actor, key):
    def work(current, keys):
        protect(current)
        row = db.get(Request, key)
        if not row:
            return dict(status="absent", note=None, rejection=None)
        data = request_data(current, keys, row)
        return dict(status="rejected" if data.get("failure") else "committed",
                    note=None if data.get("failure") else detail_in_transaction(db, keys, uuid.UUID(data["noteId"])),
                    rejection={k: data["failure"][k] for k in ("message", "code")} if data.get("failure") else None)
    return ledger.transaction(db, actor, work)


def mutation(db, actor, key, request, attempt):
    def work(current, keys):
        protect(current)
        prior = db.get(Request, key)
        if prior:
            data = request_data(current, keys, prior)
            if encode(data["request"]) != encode(request):
                ledger.fail("Retry the exact unchanged credit request with its original key.", 409, "settlement_credit_retry")
        else:
            try:
                # Failed attempts must not leave a note, reversal or audit behind.
                with db.begin_nested():
                    identity = attempt(current, keys)
                    db.flush()
                data = dict(request=request, noteId=str(identity))
            except ImmError as error:
                if error.status >= 500:
                    raise
                data = dict(request=request, failure=dict(message=error.message, status=error.status, code=error.code))
            db.add(Request(id=key, actor_id=current.user.id, created_at=utcnow(),
                           payload_ciphertext=seal(keys, "credit_requests", key, data)))
            db.flush()
        if data.get("failure"):
            return ledger.RejectedSettlement(data["failure"])
        return detail_in_transaction(db, keys, uuid.UUID(data["noteId"]))
    result = ledger.transaction(db, actor, work)
    if isinstance(result, ledger.RejectedSettlement):
        raise result.error
    return result


def audit(db, current, identity, action, now):
    db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id, action=action,
                      resource_type="settlement_credit_note", resource_id=identity, outcome="success",
                      request_id=db.info.get("request_id"), created_at=now))


def create(db, actor, body):
    def attempt(current, keys):
        row, saved, record = current_record(db, keys, body.kind, body.id, lock=True)
        from app.services.free_kits import protect_financial
        protect_financial(body.kind, saved)
        if (row.version != body.expected_version or record["paid"] != body.expected_paid
                or record["credited"] != body.expected_credited):
            ledger.fail("The order's financial position changed. Refresh before preparing a new credit.",
                        409, "settlement_stale")
        if not record["payable"]:
            ledger.fail("Credits require an approved order with a known positive unpaid balance.",
                        409, "settlement_credit_ineligible")
        if ledger.exact(body.amount) > ledger.exact(record["balance"]):
            ledger.fail("Credit exceeds the current unpaid balance.", 422, "settlement_overcredit")
        authoritative = saved_invoice(body.kind, row, saved)
        if authoritative is None:
            ledger.fail("The saved order invoice reference is unavailable. Ask an administrator to review its authority before creating a credit.",
                        409, "settlement_credit_invoice_unavailable")
        if authoritative != body.invoice_reference:
            ledger.fail("Use the authoritative saved invoice reference.", 409, "settlement_credit_invoice")
        now = utcnow()
        date = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        sequence = db.scalar(text("SELECT nextval('settlement_credit_number_seq')"))
        identity = uuid.uuid4()
        data = dict(id=str(identity), number=number(body.kind, date, sequence), date=date.isoformat(),
                    createdAt=now.isoformat(), actorId=str(current.user.id), kind=body.kind,
                    orderId=str(row.id), orderNumber=row.number, orderDate=row.date.isoformat(),
                    doctor=record["doctor"], mr=record["mr"], invoiceReference=authoritative,
                    amount=body.amount, status="Active", revertedAt=None, revertedBy=None, canRevert=False)
        db.add(Note(id=identity, sequence=sequence, kind=body.kind, order_id=row.id, mr_id=row.mr_id,
                    actor_id=current.user.id, date=date, created_at=now,
                    payload_ciphertext=seal(keys, "credit_notes", identity, data)))
        audit(db, current, identity, "settlement_credit_created", now)
        return identity
    return mutation(db, actor, body.idempotency_key, dict(operation="create", **body.model_dump(mode="json")), attempt)


def revert(db, actor, identity, body):
    def attempt(current, keys):
        note = db.get(Note, identity)
        if not note:
            ledger.fail("Credit note not found.", 404, "settlement_credit_not_found")
        _, _, record = current_record(db, keys, note.kind, note.order_id, lock=True)
        if db.scalar(select(Reversal.id).where(Reversal.note_id == identity)):
            ledger.fail("This credit note has already been reverted.", 409, "settlement_credit_reverted")
        if record["balance"] is None or ledger.exact(record["balance"]) == 0:
            ledger.fail("A credit cannot be reverted after the order is fully settled.", 409, "settlement_credit_settled")
        now, reversal_id = utcnow(), uuid.uuid4()
        data = dict(noteId=str(identity), actorId=str(current.user.id), createdAt=now.isoformat())
        db.add(Reversal(id=reversal_id, note_id=identity, actor_id=current.user.id, created_at=now,
                        payload_ciphertext=seal(keys, "credit_reversals", reversal_id, data)))
        audit(db, current, identity, "settlement_credit_reverted", now)
        return identity
    return mutation(db, actor, body.idempotency_key,
                    dict(operation="revert", id=str(identity), **body.model_dump(mode="json")), attempt)


def listing(db, actor, *, date_from=None, date_to=None, mr_id=None, search="", offset=0, limit=25):
    def work(current, keys):
        protect(current)
        if date_from and date_to and date_from > date_to:
            ledger.fail("Credit date From must be on or before To.", 422, "settlement_dates")
        clauses = []
        if date_from:
            clauses.append(Note.date >= date_from)
        if date_to:
            clauses.append(Note.date <= date_to)
        if mr_id:
            clauses.append(Note.mr_id == mr_id)
        rows = list(db.execute(select(Note, Reversal).outerjoin(Reversal, Reversal.note_id == Note.id)
                               .where(*clauses).order_by(Note.date.desc(), Note.sequence.desc())
                               .limit(ledger.SCAN_LIMIT + 1)))
        if len(rows) > ledger.SCAN_LIMIT:
            ledger.fail("Credit search exceeds 20,000 notes. Narrow the credit dates or MR.",
                        422, "settlement_scan_limit")
        items = []
        for note, reversal in rows:
            item = project(keys, note, reversal)
            values = [item[k] for k in ("number", "invoiceReference", "orderNumber", "kind", "status", "date")]
            values.extend((item[p] or {}).get(k) or "" for p in ("doctor", "mr") for k in ("name", "code"))
            if search.strip().casefold() in " ".join(values).casefold():
                items.append(item)
        page = items[offset:offset + limit]
        # Bounded page only, grouped by order, with the same fail-closed position
        # as mutations. No stale "paid" flag determines reversal eligibility.
        positions = {}
        for item in page:
            key = (item["kind"], item["orderId"])
            if key not in positions:
                positions[key] = current_record(db, keys, key[0], uuid.UUID(key[1]))[2]
            item["canRevert"] = item["status"] == "Active" and ledger.exact(positions[key]["balance"]) > 0
        return dict(items=page, total=len(items), offset=offset, limit=limit)
    return ledger.transaction(db, actor, work)
