"""Protected count-priced orders. Never infer patients, payment or clinical work."""
import base64
import hashlib
import json
import secrets
import time
import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, delete, func, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.lupin_models import LupinOrder as Order, LupinPatient as Patient, LupinAttachment as Attachment, LupinRequest as Retry
from app.db.file_models import FileRecord
from app.db.models import AuditEvent
from app.services.immunotherapy import ImmError, encode, eligible
from app.services.mr_orders import authorize as shared_order_authorize, scope, require_assignment, retry_scope, check_retry_scope, scope_identity
from app.services.kits import references as supply_references
from app.services.directory_runtime import crypto_scope
from app.services.directory_inventory import DirectoryCryptoError
from app.core.security import utcnow


def person(row):
    # Minimal order identity only: no contact addresses, DOB or clinical history.
    return dict(id=str(row.id), name=row.name)


def authorize(db, actor, action=None):
    return shared_order_authorize(db, actor, "lupin", action)


def references(db, actor, kind, search="", cursor=None, limit=25, selected=None):
    actor = authorize(db, actor)
    result = supply_references(db, actor, kind, search, cursor, limit, selected, resource="lupin")
    result["items"] = [{k: p[k] for k in ("id", "name", "doctorId", "mrId") if k in p}
                       for p in result["items"]]
    return result


def seal(keys, table, identity, value):
    nonce = secrets.token_bytes(12)
    aad = f"evexia:lupin:v1:{table}:{identity}".encode()
    encrypted = AESGCM(keys.keys[keys.active]).encrypt(nonce, encode(value).encode(), aad)
    return f"v1:{keys.active}:{base64.b64encode(nonce + encrypted).decode()}"


def unseal(keys, table, identity, value):
    try:
        version, key, raw = value.split(":")
        if version != "v1":
            raise ValueError()
        raw = base64.b64decode(raw, validate=True)
        return json.loads(AESGCM(keys.keys[key]).decrypt(raw[:12], raw[12:], f"evexia:lupin:v1:{table}:{identity}".encode()))
    except Exception:
        raise DirectoryCryptoError() from None


def transaction(db, actor, work, *, action=None):
    try:
        current = authorize(db, actor, action)
        with crypto_scope(db) as keys:
            result = work(current, keys)
        from app.services.order_capabilities import public_result
        from app.services.order_audit import present
        result = present(db, current, result)
        result = public_result(current, "lupin", result)
        from app.services.person_contacts import order_result
        result = order_result(current, result)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Lupin orders unavailable. Your draft is preserved; retry.", code="lupin_unavailable") from None
    except Exception:
        db.rollback()
        raise


def find(db, identity):
    row = db.scalar(select(Order).where(Order.id == identity, *scope(db, Order)).with_for_update())
    if not row:
        raise ImmError("Lupin order not found.", 404, "lupin_not_found")
    return row


def project(keys, row):
    from app.services.order_audit import metadata
    return {**unseal(keys, "orders", row.id, row.snapshot_ciphertext), "id": str(row.id),
            "audit": metadata(row),
            "number": row.number, "date": row.date.isoformat(), "version": row.version}


def resolved(db, actor, keys, body, previous=None):
    require_assignment(db, body.mrId)
    value = body.model_dump(mode="json", exclude={"idempotencyKey", "orderDate", "attachmentIds"})
    changed = not previous or previous["doctorId"] != str(body.doctorId) or previous["mrId"] != str(body.mrId)
    old_patients = {p["id"]: p for p in previous["patients"]} if previous else {}
    new_patients = [p for p in body.patientIds if str(p) not in old_patients]
    if changed or new_patients:
        doctor = eligible(db, "doctors", body.doctorId)
        eligible(db, "mrs", body.mrId)
        if doctor.mrId != body.mrId:
            raise ImmError("MR must match the Doctor's current assignment.", 422, "lupin_relationship")
        for identity in body.patientIds if changed else new_patients:
            if eligible(db, "patients", identity).doctorId != body.doctorId:
                raise ImmError("Linked Patients must belong to this Doctor.", 422, "lupin_relationship")
    for kind, field, key in (("doctors", "doctorId", "doctor"), ("mrs", "mrId", "mr")):
        identity = getattr(body, field)
        value[key] = previous[key] if previous and previous[field] == str(identity) else person(eligible(db, kind, identity))
    value["patients"] = [old_patients.get(str(p)) or person(eligible(db, "patients", p)) for p in body.patientIds]
    value["price"] = format(Decimal(body.price), ".2f")
    value["total"] = format(Decimal(body.patientCount) * Decimal(body.price), ".2f")
    previous_files = {a["id"]: a for a in previous["attachments"]} if previous else {}
    value["attachments"] = []
    for identity in sorted(body.attachmentIds):
        f = db.scalar(select(FileRecord).where(FileRecord.id == identity).with_for_update())
        attached = db.scalar(select(Attachment.order_id).where(Attachment.file_id == identity))
        if (not f or not f.lupin_owner_id or f.category != "documents" or f.state != "verified"
            or f.scanner_status != "clean" or not 0 < f.size <= 10485760
            or (str(identity) not in previous_files and (f.uploader_id != actor.user.id or f.lupin_owner_id != actor.user.id or attached))):
            raise ImmError("Use your verified private Lupin upload, not a file already attached elsewhere.", 409, "lupin_attachment")
        if scope_identity(db) and str(identity) not in previous_files:
            from app.services.files import get_record
            get_record(db, actor, identity, "read", readable=True)
        # Ownership (or an existing authorized historical association) precedes
        # decryption of any upload retry state or original filename.
        upload_retry = db.get(Retry, identity)
        if upload_retry and unseal(keys, "requests", identity, upload_retry.response_ciphertext).get("result", {}).get("cancelled"):
            raise ImmError("Upload unavailable.", 409, "lupin_attachment")
        value["attachments"].append(previous_files.get(str(identity)) or dict(
            id=str(f.id), name=unseal(keys, "file_names", f.id, f.lupin_name_ciphertext),
            size=f.size, type=f.content_type, state="verified"))
    return value


def apply(db, actor, keys, body, identity=None, expected=None):
    row = find(db, identity) if identity else None
    if row and row.version != expected:
        raise ImmError("Order changed. Export and review current values again.", 409, "lupin_stale")
    if row and body.orderDate and row.date != body.orderDate:
        raise ImmError("Saved order date is immutable.", 422, "lupin_date")
    previous = project(keys, row) if row else None
    from app.services.order_capabilities import attachment_changes
    attachment_changes(actor, "lupin", body.attachmentIds, previous)
    data = resolved(db, actor, keys, body, previous)
    if not row:
        number = db.scalar(text("SELECT nextval('lupin_order_number_seq')"))
        row = Order(id=uuid.uuid4(), number=f"LUP-{number:08d}", version=1,
            date=body.orderDate or datetime.now(ZoneInfo("Asia/Kolkata")).date(), created_by=actor.user.id)
        db.add(row)
    else:
        row.version += 1
    row.doctor_id, row.mr_id = body.doctorId, body.mrId
    row.status, row.payment_status = body.status, body.paymentStatus
    row.updated_by = actor.user.id
    row.snapshot_ciphertext = seal(keys, "orders", row.id, data)
    db.flush()
    db.execute(delete(Patient).where(Patient.order_id == row.id))
    db.execute(delete(Attachment).where(Attachment.order_id == row.id))
    db.flush()
    for position, identity in enumerate(body.patientIds):
        db.add(Patient(order_id=row.id, position=position, patient_id=identity))
    for identity in body.attachmentIds:
        db.add(Attachment(order_id=row.id, file_id=identity))
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
        action="lupin_updated" if previous else "lupin_created", resource_type="lupin_order",
        resource_id=row.id, outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
    db.flush()
    return project(keys, row)


def idempotent(db, actor, keys, key, payload, work):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
    prior = db.get(Retry, key)
    if prior:
        if prior.actor_id != actor.user.id:
            raise ImmError("Retry identity does not match.", 409, "lupin_retry")
        saved = unseal(keys, "requests", key, prior.response_ciphertext)
        check_retry_scope(db, saved)
        if encode(saved["request"]) != encode(payload):
            raise ImmError("Retry the original unchanged submission.", 409, "lupin_retry")
        result = saved["result"]
        if payload.get("kind") != "lupin_upload":
            for order in result.get("orders", [result]):
                find(db, uuid.UUID(order["id"]))
        elif not result.get("cancelled"):
            from app.services.files import get_record
            get_record(db, actor, uuid.UUID(result["id"]), "read")
        return result
    result = work()
    db.add(Retry(key=key, actor_id=actor.user.id,
        response_ciphertext=seal(keys, "requests", key,
            {"request": payload, "result": result, "mrScope": retry_scope(db)})))
    return result


def save(db, actor, body):
    if body.orderDate or body.status != "Confirmed" or body.paymentStatus != "Unpaid" or not body.attachmentIds:
        raise ImmError("New orders require attachments and start Confirmed / Unpaid with a server date.", 422, "lupin_create")
    return transaction(db, actor, lambda a, k: idempotent(db, a, k, body.idempotencyKey,
        body.model_dump(mode="json"), lambda: apply(db, a, k, body)), action="add")


def detail(db, actor, identity):
    return transaction(db, actor, lambda a, k: project(k, find(db, identity)))


def upload_digest(stream, maximum):
    from app.services.file_policy import FileError
    digest, size = hashlib.sha256(), 0
    stream.seek(0)
    while chunk := stream.read(65536):
        size += len(chunk)
        if size > maximum:
            raise FileError(413, "lupin_upload_size", "File exceeds the upload limit")
        digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest(), size


def reserve_upload(db, actor, body, content_type, settings, request_id, upload_id, digest, size):
    from app.services import files
    payload = dict(kind="lupin_upload", name=body.filename, type=content_type, size=size, checksum=digest)
    def work(a, keys):
        def reserve():
            files.reserve(db, a, body, content_type, settings, request_id, reservation_id=upload_id,
                          commit=False, lupin_reservation=True)
            return dict(id=str(upload_id), cancelled=False)
        result = idempotent(db, a, keys, upload_id, payload, reserve)
        if result.get("cancelled"):
            raise ImmError("This upload was cancelled. Choose the file again explicitly.", 409, "lupin_upload_cancelled")
        return upload_id
    return transaction(db, actor, work, action="upload_attachment")


def cancel_upload(db, actor, identity):
    """A durable tombstone also prevents a delayed original upload reservation."""
    def work(a, keys):
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": identity.int % (2**63 - 1)})
        prior = db.get(Retry, identity)
        if prior:
            if prior.actor_id != a.user.id:
                raise ImmError("Upload unavailable.", 404, "lupin_upload")
            saved = unseal(keys, "requests", identity, prior.response_ciphertext)
            check_retry_scope(db, saved)
            if saved["request"].get("kind") != "lupin_upload":
                raise ImmError("Not an upload reservation.", 409, "lupin_upload")
        else:
            saved = dict(request=dict(kind="lupin_upload"), result={}, mrScope=retry_scope(db))
        row = db.scalar(select(FileRecord).where(FileRecord.id == identity).with_for_update())
        if row:
            if row.lupin_owner_id != a.user.id or row.uploader_id != a.user.id:
                raise ImmError("Upload unavailable.", 404, "lupin_upload")
            if db.scalar(select(Attachment.file_id).where(Attachment.file_id == identity)):
                raise ImmError("Saved order files cannot be discarded.", 409, "lupin_attachment")
        saved["result"] = dict(id=str(identity), cancelled=True)
        if not prior:
            prior = Retry(key=identity, actor_id=a.user.id)
            db.add(prior)
        prior.response_ciphertext = seal(keys, "requests", identity, saved)
        return row is not None
    return transaction(db, actor, work, action="upload_attachment")


def listing(db, actor, *, search="", status=None, payment_status=None,
            doctor_id=None, mr_id=None, patient_id=None, from_date=None, to_date=None,
            cursor=None, limit=25, complete=False):
    def work(a, keys):
        if from_date and to_date and from_date > to_date:
            raise ImmError("From date must not follow To date.", 422, "lupin_dates")
        clauses = scope(db, Order) + [getattr(Order, field) == val for field, val in (
            ("status", status), ("payment_status", payment_status),
            ("doctor_id", doctor_id), ("mr_id", mr_id)) if val]
        if patient_id:
            clauses.append(Order.id.in_(select(Patient.order_id).where(Patient.patient_id == patient_id)))
        if from_date:
            clauses.append(Order.date >= from_date)
        if to_date:
            clauses.append(Order.date <= to_date)
        query = select(Order).where(*clauses).order_by(Order.id)
        if cursor and not complete:
            query = query.where(Order.id > cursor)
        cap = 10000 if complete else 500
        rows = db.scalars(query.limit(cap + 1).execution_options(yield_per=25))
        found, last, more, size = [], None, False, 0
        started = time.monotonic()
        try:
            for n, row in enumerate(rows):
                if n == cap:
                    if complete:
                        raise ImmError("Export exceeds 10,000 candidates; narrow filters. No partial export.", 409, "lupin_bound")
                    more = True
                    break
                if time.monotonic() - started > (30 if complete else 5):
                    raise ImmError("Secure search budget exceeded. Narrow filters and retry.", 409, "lupin_bound")
                data = project(keys, row)
                last = row.id
                searchable = [data["number"], data["remarks"], encode(data["doctor"]), encode(data["mr"]), encode(data["patients"])]
                if not search.strip() or search.strip().casefold() in " ".join(searchable).casefold():
                    size += len(encode(data).encode())
                    if complete and size > 8_000_000:
                        raise ImmError("Export exceeds 8 MB; narrow filters. No partial export.", 409, "lupin_bound")
                    # File contents, usable URLs and credentials never leave an export.
                    found.append({**data, "attachments": [], "attachmentIds": []} if complete else data)
                if not complete and len(found) == limit:
                    more = next(rows, None) is not None
                    break
        finally:
            rows.close()
        counts = dict(db.execute(select(Order.status, func.count()).where(*scope(db, Order)).group_by(Order.status)).all())
        return dict(items=found, total=sum(counts.values()), counts=counts,
            filtered=len(found) if complete else (None if search else db.scalar(select(func.count()).select_from(Order).where(*clauses))),
            nextCursor=str(last) if more and not complete else None)
    return transaction(db, actor, work, action="export" if complete else None)


def batch(db, actor, body, commit=False):
    def work(a, keys):
        ids = [e.id for e in body.entries if e.id]
        if len(ids) != len(set(ids)):
            raise ImmError("Duplicate matching order in import.", 422, "lupin_import")
        # Serialize retry before locking orders, consistently with create.
        def prepare():
            for identity in sorted(ids):
                find(db, identity)
            entries, resolved_values = [], []
            for index, entry in enumerate(body.entries):
                previous = project(keys, find(db, entry.id)) if entry.id else None
                if previous:
                    if previous["number"] != entry.number or previous["version"] != entry.expected_version:
                        raise ImmError("Updates require the current ID, number and version.", 409, "lupin_stale")
                    if entry.values.orderDate and previous["date"] != entry.values.orderDate.isoformat():
                        raise ImmError("Saved order date is immutable.", 422, "lupin_date")
                elif entry.number or entry.expected_version:
                    raise ImmError("Leave new order number and version empty.", 422, "lupin_import")
                elif entry.values.status != "Confirmed" or entry.values.paymentStatus != "Unpaid":
                    raise ImmError("Imported new orders start Confirmed / Unpaid.", 422, "lupin_import")
                if previous and (entry.values.status != previous["status"] or entry.values.paymentStatus != previous["paymentStatus"]):
                    raise ImmError("Transfers cannot change order or payment classification.", 422, "lupin_import")
                expected_files = [f["id"] for f in previous["attachments"]] if previous else []
                if set(map(str, entry.values.attachmentIds)) != set(expected_files):
                    raise ImmError("Imports retain existing files; new orders import without files.", 422, "lupin_import")
                values = resolved(db, a, keys, entry.values, previous)
                resolved_values.append(values)
                changes = [k for k in values if previous and previous.get(k) != values[k]]
                entries.append(dict(line=index + 2, action=("update" if changes else "unchanged") if previous else "add",
                    order={**values, "number": entry.number or "Assigned on save"}, previous=previous,
                    changed=changes, errors=[], patients=[]))
            token = keys._index("lupin:review:v1", [str(a.user.id),
                body.model_dump(mode="json", exclude={"idempotencyKey", "reviewToken", "confirmUpdates"}), resolved_values])
            return token, entries
        def write():
            token, reviewed = prepare()
            if token != body.reviewToken or (any(e["action"] == "update" for e in reviewed) and not body.confirmUpdates):
                raise ImmError("Review changed or updates were not confirmed. Review again.", 409, "lupin_review")
            orders = [apply(db, a, keys, e.values, e.id, e.expected_version) if r["action"] != "unchanged"
                else project(keys, find(db, e.id)) for e, r in zip(body.entries, reviewed)]
            return dict(imported=len(orders), orders=orders)
        if commit:
            return idempotent(db, a, keys, body.idempotencyKey, body.model_dump(mode="json"), write)
        token, entries = prepare()
        return dict(valid=True, entries=entries, reviewToken=token, rejected=0, patientAdditions=0,
            additions=sum(e["action"] == "add" for e in entries), updates=sum(e["action"] == "update" for e in entries),
            unchanged=sum(e["action"] == "unchanged" for e in entries))
    return transaction(db, actor, work, action="import")
