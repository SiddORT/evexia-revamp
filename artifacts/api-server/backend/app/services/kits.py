"""Shared supply orders, bounded encrypted search and atomic reviewed imports."""
import base64
import json
import secrets
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, func, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.kits_models import KitsOrder as Order, KitsAttachment as Attachment, KitsRequest as Retry
from app.db.file_models import FileRecord
from app.db.models import AuditEvent
from app.services.immunotherapy import ImmError, encode, eligible, person as master_person, references as master_references
from app.services.mr_orders import authorize as authorize_order
from app.services.mr_orders import scope, assignment as mr_assignment
from app.services.directory_runtime import crypto_scope
from app.services.directory_inventory import DirectoryCryptoError
from app.core.security import utcnow
from app.services.capability_policy import is_super_admin
from app.schemas.kits_pricing import KitsPricingInput, calculate

FINANCIAL_FIELDS = {"pricing", "businessParking", "poNumber"}


def finances(actor, body, previous):
    """Omission preserves history; explicit financial writes require singleton authority."""
    supplied = FINANCIAL_FIELDS & body.model_fields_set
    if supplied and not is_super_admin(actor):
        raise ImmError("Only the protected Super Admin may submit Kits pricing or PO fields.", 403, "access_denied")
    values = {key: previous[key] for key in FINANCIAL_FIELDS if previous and key in previous}
    if "pricing" in supplied:
        if body.pricing is None:
            if values.get("pricing") is not None:
                raise ImmError("Saved pricing cannot be cleared.", 422, "kits_pricing")
            values["pricing"] = None
        else:
            values["pricing"] = body.pricing.model_dump()
    for key in ("businessParking", "poNumber"):
        if key in supplied:
            values[key] = getattr(body, key)
    if values.get("pricing") is not None:
        if actor.role == "mr" and previous and (
            previous["kit"] != body.kit.model_dump(mode="json") or any(
                previous[key] != getattr(body, key) for key in ("lancets", "applicators", "tray"))):
            # A changed pending supply basis needs explicit Admin repricing;
            # MR never submits replacement rates or implicitly reprices history.
            values["pricing"] = None
            return values
        try:
            raw = values["pricing"]
            price = KitsPricingInput.model_validate({k: raw[k] for k in KitsPricingInput.model_fields if k in raw})
            tax = (previous or {}).get("pricing") or {}
            values["pricing"] = calculate(body, price, tax.get("taxPercentage", "5.00"))
        except ValueError:
            raise ImmError("Enter valid unit rates for included items and a discount not exceeding gross.", 422, "kits_pricing") from None
    return values


def person(row, kind):
    data = master_person(row, kind)
    # Supply orders do not require birth dates, age, gender or clinical history.
    return {k: data[k] for k in ("id", "name", "phone", "dialCountry", "email", "address")}


def authorize(db, actor, action=None):
    return authorize_order(db, actor, "kits", action)


def references(db, actor, kind, search="", cursor=None, limit=25, selected=None, *, resource="kits"):
    result = master_references(db, actor, kind, search, cursor, limit, selected, resource=resource)
    result["items"] = [{k: p[k] for k in ("id", "name", "phone", "address", "doctorId", "mrId") if k in p}
                       for p in result["items"]]
    return result


def seal(keys, table, identity, value):
    nonce = secrets.token_bytes(12)
    aad = f"evexia:kits:v1:{table}:{identity}".encode()
    encrypted = AESGCM(keys.keys[keys.active]).encrypt(nonce, encode(value).encode(), aad)
    return f"v1:{keys.active}:{base64.b64encode(nonce + encrypted).decode()}"


def unseal(keys, table, identity, value):
    try:
        version, key, raw = value.split(":")
        if version != "v1":
            raise ValueError()
        raw = base64.b64decode(raw, validate=True)
        return json.loads(AESGCM(keys.keys[key]).decrypt(raw[:12], raw[12:], f"evexia:kits:v1:{table}:{identity}".encode()))
    except Exception:
        raise DirectoryCryptoError() from None


def transaction(db, actor, work, *, action=None):
    try:
        current = authorize(db, actor, action)
        with crypto_scope(db) as keys:
            result = work(current, keys)
        from app.services.order_capabilities import public_result
        from app.services.order_audit import present
        from app.services.order_lifecycle import read_result
        result = read_result(result)
        result = present(db, current, result)
        result = public_result(current, "kits", result)
        from app.services.person_contacts import order_result
        result = order_result(current, result)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Kits orders unavailable. Your draft is preserved; retry.", code="kits_unavailable") from None
    except Exception:
        db.rollback()
        raise


def find(db, identity):
    row = db.scalar(select(Order).where(Order.id == identity, *scope(db, Order)).with_for_update())
    if not row:
        raise ImmError("Kits order not found.", 404, "kits_not_found")
    return row


def project(keys, row):
    from app.services.order_audit import metadata
    from app.services.order_approval import editable
    value = unseal(keys, "orders", row.id, row.snapshot_ciphertext)
    from app.services.order_lifecycle import status
    from app.services.order_approval import eligibility
    value["status"] = status(row.status)
    value["decisionEligibility"] = eligibility("kits", value)
    return {**value, "approval": value.get("approval"), "mrEditable": editable("kits", value), "id": str(row.id),
            "audit": metadata(row),
            "number": row.number, "date": row.date.isoformat(), "version": row.version}


def resolved(db, actor, keys, body, previous=None):
    if body.status != (previous["status"] if previous else "Confirmed"):
        raise ImmError("Use the explicit Approve order or Reject order action; ordinary saves/imports cannot change decisions.", 422, "kits_decision")
    from app.services.order_approval import protect
    protect(db, "kits", body, previous)
    mr_assignment(db, body, previous)
    financial = finances(actor, body, previous)
    value = body.model_dump(mode="json", exclude={"idempotencyKey", "expected_version", "orderDate", "attachmentIds", *FINANCIAL_FIELDS})
    value.update(financial)
    changed = {}
    for kind, field, key in (("doctors", "doctorId", "doctor"), ("mrs", "mrId", "mr"), ("patients", "patientId", "patient")):
        identity = getattr(body, field)
        changed[key] = not previous or previous[field] != (str(identity) if identity else None)
        value[key] = (person(eligible(db, kind, identity), kind) if identity else None) if changed[key] else previous[key]
    if any(changed.values()):
        doctor = eligible(db, "doctors", body.doctorId)
        if body.mrId:
            eligible(db, "mrs", body.mrId)
            if doctor.mrId != body.mrId:
                raise ImmError("Selected MR must match the Doctor's current MR assignment.", 422, "kits_relationship")
        if body.patientId:
            patient = eligible(db, "patients", body.patientId)
            if patient.doctorId != body.doctorId:
                raise ImmError("Selected Patient must belong to the selected Doctor.", 422, "kits_relationship")
    value["billing"] = previous["billing"] if previous and not changed["doctor"] else value["doctor"]
    if body.shipping == "other":
        value["recipient"] = (previous["recipient"] if previous and previous["shipping"] == "other"
                              and previous["other"] == value["other"] else value["other"])
    elif previous and previous["shipping"] == body.shipping and not changed[body.shipping]:
        value["recipient"] = previous["recipient"]
    else:
        kind = "doctors" if body.shipping == "doctor" else "mrs"
        identity = body.doctorId if body.shipping == "doctor" else body.mrId
        value["recipient"] = person(eligible(db, kind, identity), kind)
    previous_files = {a["id"]: a for a in previous["attachments"]} if previous else {}
    if not set(previous_files).issubset(set(map(str, body.attachmentIds))):
        raise ImmError("Saved attachments must be retained; replacement and removal are not supported.", 422, "kits_attachment")
    value["attachments"] = []
    for identity in sorted(body.attachmentIds):
        f = db.scalar(select(FileRecord).where(FileRecord.id == identity).with_for_update())
        attached = db.scalar(select(Attachment.order_id).where(Attachment.file_id == identity))
        if (not f or not f.kits_owner_id or f.category != "documents" or f.state != "verified"
            or f.scanner_status != "clean" or not 0 < f.size <= 10485760
            or (str(identity) not in previous_files and (f.uploader_id != actor.user.id or attached))):
            raise ImmError("Attachment must be your verified private Kits upload, not already attached to another order.", 409, "kits_attachment")
        # Historical encrypted display name, never a plaintext personal filename.
        value["attachments"].append(previous_files.get(str(identity)) or dict(
            id=str(f.id), name=unseal(keys, "file_names", f.id, f.kits_name_ciphertext),
            size=f.size, type=f.content_type, state="verified"))
    return value


def apply(db, actor, keys, body, identity=None, expected=None):
    row = find(db, identity) if identity else None
    if row and row.version != expected:
        raise ImmError("Order changed. Export and review current values again.", 409, "kits_stale")
    if row and body.orderDate and row.date != body.orderDate:
        raise ImmError("Saved order date is immutable.", 422, "kits_date")
    previous = project(keys, row) if row else None
    from app.services.order_capabilities import attachment_changes
    attachment_changes(actor, "kits", body.attachmentIds, previous)
    data = resolved(db, actor, keys, body, previous)
    from app.services.order_approval import preserve
    preserve(actor, "kits", data, previous)
    if not row:
        number = db.scalar(text("SELECT nextval('kits_order_number_seq')"))
        row = Order(id=uuid.uuid4(), number=f"KIT-{number:08d}", version=1,
            date=body.orderDate or datetime.now(ZoneInfo("Asia/Kolkata")).date(), created_by=actor.user.id)
        db.add(row)
    else:
        row.version += 1
    row.doctor_id, row.mr_id, row.patient_id = body.doctorId, body.mrId, body.patientId
    row.order_for, row.status, row.payment_status = body.orderFor, body.status, body.paymentStatus
    row.updated_by = actor.user.id
    row.snapshot_ciphertext = seal(keys, "orders", row.id, data)
    db.flush()
    retained = {f["id"] for f in previous["attachments"]} if previous else set()
    for identity in body.attachmentIds:
        if str(identity) not in retained:
            db.add(Attachment(order_id=row.id, file_id=identity))
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
        action="kits_updated" if previous else "kits_created", resource_type="kits_order",
        resource_id=row.id, outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
    db.flush()
    return project(keys, row)


def idempotent(db, actor, keys, key, payload, work):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
    prior = db.get(Retry, key)
    if prior:
        if prior.actor_id != actor.user.id:
            raise ImmError("Retry identity does not match this submission.", 409, "kits_retry")
        saved = unseal(keys, "requests", key, prior.response_ciphertext)
        if encode(saved["request"]) != encode(payload):
            raise ImmError("Retry the original unchanged submission.", 409, "kits_retry")
        result = saved["result"]
        for order in result.get("orders", [result]):
            find(db, uuid.UUID(order["id"]))
        return result
    result = work()
    db.add(Retry(key=key, actor_id=actor.user.id,
        response_ciphertext=seal(keys, "requests", key, {"request": payload, "result": result})))
    return result


def save(db, actor, body):
    return transaction(db, actor, lambda a, k: idempotent(db, a, k, body.idempotencyKey,
        body.model_dump(mode="json", exclude_unset=True), lambda: apply(db, a, k, body)), action="add")


def update(db, actor, identity, body):
    def work(a, keys):
        if not is_super_admin(a) and a.role != "mr":
            raise ImmError("Only the protected Super Admin may edit a saved Kits order.", 403, "access_denied")
        payload = {"operation": "kits_update", "id": str(identity), "values": body.model_dump(mode="json", exclude_unset=True)}
        return idempotent(db, a, keys, body.idempotencyKey, payload,
            lambda: apply(db, a, keys, body, identity, body.expected_version))
    return transaction(db, actor, work, action="edit")


def detail(db, actor, identity):
    return transaction(db, actor, lambda a, k: project(k, find(db, identity)))


def listing(db, actor, *, search="", status=None, payment_status=None, order_for=None,
            doctor_id=None, mr_id=None, patient_id=None, from_date=None, to_date=None,
            cursor=None, limit=25, complete=False):
    def work(a, keys):
        if from_date and to_date and from_date > to_date:
            raise ImmError("From date must not follow To date.", 422, "kits_dates")
        clauses = [getattr(Order, field) == val for field, val in (
            ("status", status), ("payment_status", payment_status), ("order_for", order_for),
            ("doctor_id", doctor_id), ("mr_id", mr_id), ("patient_id", patient_id)) if val]
        clauses.extend(scope(db, Order))
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
                        raise ImmError("Export exceeds 10,000 candidates; narrow filters. No partial export.", 409, "kits_bound")
                    more = True
                    break
                if time.monotonic() - started > (30 if complete else 5):
                    raise ImmError("Secure search budget exceeded. Narrow filters and retry.", 409, "kits_bound")
                data = project(keys, row)
                last = row.id
                searchable = [data["number"], encode(data["kit"]), data["remarks"]]
                for key in ("doctor", "mr", "patient", "recipient"):
                    searchable.append(encode(data.get(key)))
                if not search.strip() or search.strip().casefold() in " ".join(searchable).casefold():
                    size += len(encode(data).encode())
                    if complete and size > 8_000_000:
                        raise ImmError("Export exceeds 8 MB; narrow filters. No partial export.", 409, "kits_bound")
                    found.append(data)
                if not complete and len(found) == limit:
                    more = next(rows, None) is not None
                    break
        finally:
            rows.close()
        counts = dict(db.execute(select(Order.status, func.count()).where(*scope(db, Order)).group_by(Order.status)).all())
        from app.services.order_lifecycle import counts as compatible_counts
        counts = compatible_counts(counts)
        return dict(items=found, total=sum(counts.values()), counts=counts,
            filtered=len(found) if complete else (None if search else db.scalar(select(func.count()).select_from(Order).where(*clauses))),
            nextCursor=str(last) if more and not complete else None)
    return transaction(db, actor, work, action="export" if complete else None)


def batch(db, actor, body, commit=False):
    def work(a, keys):
        ids = [e.id for e in body.entries if e.id]
        if len(ids) != len(set(ids)):
            raise ImmError("Duplicate matching order in import.", 422, "kits_import")
        for identity in sorted(ids):
            find(db, identity)
        def prepare():
            entries, resolved_values = [], []
            for index, entry in enumerate(body.entries):
                previous = project(keys, find(db, entry.id)) if entry.id else None
                if previous:
                    if previous["number"] != entry.number or previous["version"] != entry.expected_version:
                        raise ImmError("Matching updates require the current ID, number and version.", 409, "kits_stale")
                    if entry.values.orderDate and previous["date"] != entry.values.orderDate.isoformat():
                        raise ImmError("Saved order date is immutable.", 422, "kits_date")
                elif entry.number or entry.expected_version:
                    raise ImmError("Leave new order number and version empty.", 422, "kits_import")
                expected_files = [f["id"] for f in previous["attachments"]] if previous else []
                if set(map(str, entry.values.attachmentIds)) != set(expected_files):
                    raise ImmError("Imports must retain saved file associations; new orders import without files.", 422, "kits_import")
                values = resolved(db, a, keys, entry.values, previous)
                resolved_values.append(values)
                changes = [k for k in values if previous and previous.get(k) != values[k]]
                entries.append(dict(line=index + 2, action=("update" if changes else "unchanged") if previous else "add",
                    order={**values, "number": entry.number or "Assigned on save"}, previous=previous,
                    changed=changes, errors=[], patients=[]))
            token = keys._index("kits:review:v1", [str(a.user.id),
                body.model_dump(mode="json", exclude_unset=True, exclude={"idempotencyKey", "reviewToken", "confirmUpdates"}), resolved_values])
            return token, entries
        def write():
            token, reviewed = prepare()
            if token != body.reviewToken or (any(e["action"] == "update" for e in reviewed) and not body.confirmUpdates):
                raise ImmError("Review changed or updates were not confirmed. Review again.", 409, "kits_review")
            orders = [apply(db, a, keys, e.values, e.id, e.expected_version) if r["action"] != "unchanged"
                else project(keys, find(db, e.id)) for e, r in zip(body.entries, reviewed)]
            return dict(imported=len(orders), orders=orders)
        if commit:
            return idempotent(db, a, keys, body.idempotencyKey, body.model_dump(mode="json", exclude_unset=True), write)
        token, entries = prepare()
        return dict(valid=True, entries=entries, reviewToken=token, rejected=0, patientAdditions=0,
            additions=sum(e["action"] == "add" for e in entries), updates=sum(e["action"] == "update" for e in entries),
            unchanged=sum(e["action"] == "unchanged" for e in entries))
    return transaction(db, actor, work, action="import")
