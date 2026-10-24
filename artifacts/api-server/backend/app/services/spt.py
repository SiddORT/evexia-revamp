"""Protected SPT history, exact amounts and encrypted actor-bound retries."""
import base64
import json
import secrets
import time
import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, delete, func, text, union_all, literal
from sqlalchemy.exc import SQLAlchemyError
from app.db.spt_models import SptOrder as Order, SptPatient as Registered, SptMembership as Membership, SptRequest as Retry
from app.db.patient_models import PatientDirectory
from app.db.models import AuditEvent
from app.services.immunotherapy import ImmError, encode, eligible, person, references as master_references
from app.services.mr_orders import authorize as authorize_order
from app.services.mr_orders import scope, scope_identity, reference_scope, require_assignment, retry_scope, check_retry_scope
from app.services.directory_runtime import crypto_scope
from app.services.directory_inventory import DirectoryCryptoError
from app.core.security import utcnow


def seal(keys, table, identity, value):
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(keys.keys[keys.active]).encrypt(nonce, encode(value).encode(),
        f"evexia:spt:v1:{table}:{identity}".encode())
    return f"v1:{keys.active}:{base64.b64encode(nonce + encrypted).decode()}"


def unseal(keys, table, identity, value):
    try:
        version, key, raw = value.split(":")
        if version != "v1":
            raise ValueError()
        raw = base64.b64decode(raw, validate=True)
        return json.loads(AESGCM(keys.keys[key]).decrypt(raw[:12], raw[12:],
            f"evexia:spt:v1:{table}:{identity}".encode()))
    except Exception:
        raise DirectoryCryptoError() from None


def authorize(db, actor, action=None):
    return authorize_order(db, actor, "spt", action)


def transaction(db, actor, work, *, action=None):
    try:
        current = authorize(db, actor, action)
        with crypto_scope(db) as keys:
            result = work(current, keys)
        from app.services.order_audit import present
        result = present(db, current, result)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("SPT unavailable. Your entries are preserved; retry the same submission.", code="spt_unavailable") from None
    except Exception:
        db.rollback()
        raise


def find(db, identity):
    row = db.scalar(select(Order).where(Order.id == identity, *scope(db, Order)).with_for_update())
    if not row:
        raise ImmError("SPT order not found or unavailable.", 404, "spt_not_found")
    return row


def project(keys, row):
    from app.services.order_audit import metadata
    return {**unseal(keys, "orders", row.id, row.snapshot_ciphertext),
        "audit": metadata(row),
        "id": str(row.id), "sourceId": str(row.source_id), "number": row.number,
        "date": row.date.isoformat(), "version": row.version}


def registration_scope(db):
    identity = scope_identity(db)
    return [Registered.owner_mr_id == identity] if identity else []


def patient_snapshot(db, keys, identity, source, order_date):
    if source == "spt":
        row = db.scalar(select(Registered).where(
            Registered.id == identity, *registration_scope(db)).with_for_update())
        if not row:
            raise ImmError("SPT patient not found. Register or select an existing patient.", 422, "spt_patient")
        return {**unseal(keys, "patients", row.id, row.snapshot_ciphertext),
            "id": str(row.id), "code": row.code, "source": "spt"}
    row = eligible(db, "patients", identity)
    dob = row.dateOfBirth
    age = order_date.year - dob.year - ((order_date.month, order_date.day) < (dob.month, dob.day))
    if not 0 <= age <= 120:
        raise ImmError("Patient age is not valid for the order date.", 422, "spt_patient_age")
    return dict(id=str(row.id), source="master", code=row.code, name=row.name, gender=row.gender, age=age)


def resolve(db, keys, body, previous, order_date):
    require_assignment(db, body.mrId)
    value = dict(doctorId=str(body.doctorId) if body.doctorId else None,
        mrId=str(body.mrId) if body.mrId else None, status=body.status, remarks=body.remarks)
    changed = {}
    for field, key, kind in (("doctorId", "doctor", "doctors"), ("mrId", "mr", "mrs")):
        identity = getattr(body, field)
        changed[key] = not previous or previous[field] != value[field]
        value[key] = (person(eligible(db, kind, identity), kind) if identity else None) if changed[key] else previous[key]
        value[f"{key}Name"] = value[key]["name"] if value[key] else ""
    if body.doctorId and body.mrId and any(changed.values()):
        doctor = eligible(db, "doctors", body.doctorId)
        eligible(db, "mrs", body.mrId)
        if doctor.mrId != body.mrId:
            raise ImmError("Doctor and MR must match the current master assignment.", 422, "spt_relationship")
    old = {(p["source"], p["id"]): p for p in previous["patients"]} if previous else {}
    value["patients"] = []
    total = Decimal("0")
    for p in body.patients:
        retained = old.get((p.source, str(p.id)))
        data = dict(retained) if retained else patient_snapshot(db, keys, p.id, p.source, order_date)
        # Only new combinations are checked against current assignments. Retained
        # history does not become invalid when a master is edited or deactivated.
        if p.source == "master" and (not retained or changed["doctor"] or changed["mr"]):
            master = eligible(db, "patients", p.id)
            if body.doctorId and master.doctorId != body.doctorId:
                raise ImmError("Patient must belong to the selected Doctor.", 422, "spt_relationship")
            if body.mrId:
                from app.db.doctor_models import DoctorDirectory
                assigned = db.get(DoctorDirectory, master.doctorId)
                if not assigned or assigned.mrId != body.mrId:
                    raise ImmError("Patient and MR must match the current Doctor assignment.", 422, "spt_relationship")
        data["amount"] = format(Decimal(p.amount), ".2f") if p.amount else ""
        total += Decimal(p.amount or "0")
        value["patients"].append(data)
    value["total"] = format(total, ".2f")
    return value


def apply(db, actor, keys, body, identity=None, expected=None, source_id=None):
    row = find(db, identity) if identity else None
    if row:
        if row.version != expected:
            raise ImmError("This draft changed. Your entries are preserved; load the latest version separately before retrying.", 409, "spt_stale")
        if row.status == "Saved":
            raise ImmError("Saved SPT orders are read-only.", 409, "spt_readonly")
        if body.orderDate and row.date != body.orderDate:
            raise ImmError("Order date cannot be changed.", 422, "spt_date")
    previous = project(keys, row) if row else None
    order_date = row.date if row else body.orderDate or datetime.now(ZoneInfo("Asia/Kolkata")).date()
    data = resolve(db, keys, body, previous, order_date)
    if not row:
        identity = uuid.uuid4()
        number = db.scalar(text("SELECT nextval('spt_order_number_seq')"))
        row = Order(id=identity, source_id=source_id or identity, number=f"SPT-{number:08d}",
            date=order_date, version=1, created_by=actor.user.id)
        db.add(row)
    else:
        row.version += 1
    row.doctor_id, row.mr_id, row.status = body.doctorId, body.mrId, body.status
    row.updated_by = actor.user.id
    row.snapshot_ciphertext = seal(keys, "orders", row.id, data)
    db.flush()
    db.execute(delete(Membership).where(Membership.order_id == row.id))
    for position, patient in enumerate(body.patients):
        db.add(Membership(order_id=row.id, position=position,
            master_patient_id=patient.id if patient.source == "master" else None,
            spt_patient_id=patient.id if patient.source == "spt" else None))
    audit(db, actor, "spt_updated" if previous else "spt_created", row.id)
    db.flush()
    return project(keys, row)


def audit(db, actor, action, identity):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action=action,
        resource_type="spt_patient" if action == "spt_patient_registered" else "spt_order",
        resource_id=identity, outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))


def idempotent(db, actor, keys, key, payload, work):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
    prior = db.get(Retry, key)
    if prior:
        if prior.actor_id != actor.user.id:
            raise ImmError("Submission belongs to a different actor.", 409, "spt_retry")
        saved = unseal(keys, "requests", key, prior.response_ciphertext)
        check_retry_scope(db, saved)
        if encode(saved["request"]) != encode(payload):
            raise ImmError("Retry the identical submission, not changed entries.", 409, "spt_retry")
        result = saved["result"]
        if payload["operation"] != "register":
            for order in result.get("orders", [result]):
                find(db, uuid.UUID(order["id"]))
        else:
            patient_snapshot(db, keys, uuid.UUID(result["id"]), "spt",
                datetime.now(ZoneInfo("Asia/Kolkata")).date())
        return result
    result = work()
    db.add(Retry(key=key, actor_id=actor.user.id,
        response_ciphertext=seal(keys, "requests", key,
            {"request": payload, "result": result, "mrScope": retry_scope(db)})))
    return result


def save(db, actor, body, identity=None):
    return transaction(db, actor, lambda a, k: idempotent(db, a, k, body.idempotencyKey,
        {"operation": "save", "id": str(identity) if identity else None, "body": body.model_dump(mode="json")},
        lambda: apply(db, a, k, body, identity, body.expected_version)), action="edit" if identity else "add")


def register(db, actor, body):
    def work(a, keys):
        def create():
            identity = uuid.uuid4()
            number = db.scalar(text("SELECT nextval('spt_patient_number_seq')"))
            data = body.model_dump(mode="json", exclude={"idempotencyKey"})
            row = Registered(id=identity, code=f"SPT-PT-{number:08d}", created_by=a.user.id,
                owner_mr_id=scope_identity(db),
                snapshot_ciphertext=seal(keys, "patients", identity, data))
            db.add(row)
            audit(db, a, "spt_patient_registered", identity)
            return {**data, "id": str(identity), "code": row.code, "source": "spt"}
        return idempotent(db, a, keys, body.idempotencyKey,
            {"operation": "register", "body": body.model_dump(mode="json")}, create)
    return transaction(db, actor, work, action=("add", "import"))


def detail(db, actor, identity):
    return transaction(db, actor, lambda a, k: project(k, find(db, identity)))


def references(db, actor, kind, search="", cursor=None, limit=25, selected=None):
    if kind != "patients":
        result = master_references(db, actor, kind, search, cursor, limit, selected, resource="spt")
        result["items"] = [{k: p[k] for k in ("id", "name", "mrId", "doctorNumber", "employeeCode") if k in p} for p in result["items"]]
        return result
    def work(a, keys):
        # A single ordered bounded stream across both directories; no unbounded
        # hidden paging or name/equality index for personal registration details.
        master = select(PatientDirectory.id.label("id"), literal("master").label("source")).where(
            PatientDirectory.deleted_at.is_(None), PatientDirectory.status == "active",
            *reference_scope(db, "patients"))
        registered = select(Registered.id.label("id"), literal("spt").label("source")).where(*registration_scope(db))
        candidates = union_all(master, registered).subquery()
        query = select(candidates).order_by(candidates.c.id)
        if cursor:
            query = query.where(candidates.c.id > cursor)
        rows = list(db.execute(query.limit(501)).mappings())
        items, last, consumed = [], None, 0
        started = time.monotonic()
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        def choice(identity, source):
            try:
                return patient_snapshot(db, keys, identity, source, today)
            except ImmError as error:
                if error.code in ("imm_reference", "spt_patient_age", "spt_patient"):
                    return None
                raise
        for row in rows[:500]:
            if time.monotonic() - started > 5:
                raise ImmError("Patient search budget exceeded. Narrow the search.", 409, "spt_bound")
            last, consumed = row["id"], consumed + 1
            data = choice(row["id"], row["source"])
            if data and (not search.strip() or search.strip().casefold() in f'{data["code"]} {data["name"]}'.casefold()):
                items.append(data)
            if len(items) == limit:
                break
        if selected and not any(p["id"] == str(selected) for p in items):
            source = "spt" if db.scalar(select(Registered.id).where(
                Registered.id == selected, *registration_scope(db))) else "master"
            data = choice(selected, source)
            if data:
                items.append(data)
        return dict(items=items, nextCursor=str(last) if len(rows) > consumed else None, limit=limit)
    return transaction(db, actor, work)


def listing(db, actor, *, search="", status=None, doctor_id=None, mr_id=None,
            patient_id=None, from_date=None, to_date=None, cursor=None, limit=25, complete=False):
    def work(a, keys):
        if from_date and to_date and from_date > to_date:
            raise ImmError("From date must not follow To date.", 422, "spt_dates")
        clauses = scope(db, Order) + [getattr(Order, key) == value for key, value in
            (("status", status), ("doctor_id", doctor_id), ("mr_id", mr_id)) if value]
        if patient_id:
            clauses.append(select(Membership.order_id).where(Membership.order_id == Order.id,
                (Membership.master_patient_id == patient_id) | (Membership.spt_patient_id == patient_id)).exists())
        if from_date:
            clauses.append(Order.date >= from_date)
        if to_date:
            clauses.append(Order.date <= to_date)
        query = select(Order).where(*clauses).order_by(Order.id)
        if cursor and not complete:
            query = query.where(Order.id > cursor)
        cap = 10000 if complete else 500
        rows = db.scalars(query.limit(cap + 1).execution_options(yield_per=25))
        items, last, more, size = [], None, False, 0
        started = time.monotonic()
        try:
            for index, row in enumerate(rows):
                if index == cap:
                    if complete:
                        raise ImmError("Export exceeds 10,000 candidates. Narrow filters; no partial export.", 409, "spt_bound")
                    more = True
                    break
                if time.monotonic() - started > (30 if complete else 5):
                    raise ImmError("Secure search budget exceeded. Narrow filters and retry.", 409, "spt_bound")
                data, last = project(keys, row), row.id
                searchable = " ".join([data["number"], data["doctorName"], data["mrName"],
                    data["remarks"], " ".join(f'{p["code"]} {p["name"]}' for p in data["patients"])])
                if not search.strip() or search.strip().casefold() in searchable.casefold():
                    items.append(data)
                    size += len(encode(data).encode())
                    if size > 8_000_000:
                        raise ImmError("Response exceeds 8 MB. Narrow filters; no partial export.", 409, "spt_bound")
                if not complete and len(items) == limit:
                    more = next(rows, None) is not None
                    break
        finally:
            rows.close()
        return dict(items=items, total=db.scalar(select(func.count()).select_from(Order).where(*scope(db, Order))),
            filtered=len(items) if complete else None if search else db.scalar(select(func.count()).select_from(Order).where(*clauses)),
            nextCursor=str(last) if more and not complete else None)
    return transaction(db, actor, work, action="export" if complete else None)


def batch(db, actor, body, commit=False):
    def work(a, keys):
        ids = [e.id for e in body.entries if e.id]
        sources = [e.sourceId for e in body.entries]
        if len(ids) != len(set(ids)) or len(sources) != len(set(sources)):
            raise ImmError("Duplicate order or source identity in import.", 422, "spt_import")
        # Source locks serialize duplicate new identities across different batches.
        for source in sorted(sources):
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": source.int % (2**63 - 1)})
        for identity in sorted(ids):
            find(db, identity)
        def prepare():
            entries, values = [], []
            for index, entry in enumerate(body.entries):
                previous = project(keys, find(db, entry.id)) if entry.id else None
                if previous:
                    if previous["number"] != entry.number or previous["version"] != entry.expected_version or previous["sourceId"] != str(entry.sourceId):
                        raise ImmError("Matching orders require current ID, source ID, number and version.", 409, "spt_stale")
                    if not entry.values.orderDate or previous["date"] != entry.values.orderDate.isoformat():
                        raise ImmError("Keep the original order date.", 422, "spt_date")
                else:
                    if entry.number or entry.expected_version or db.scalar(select(Order.id).where(Order.source_id == entry.sourceId)):
                        raise ImmError("New order identity or numbering is unavailable. Use a fresh source identity or review an authorized export.", 409, "spt_source")
                order_date = entry.values.orderDate or datetime.now(ZoneInfo("Asia/Kolkata")).date()
                value = resolve(db, keys, entry.values, previous, order_date)
                changes = [key for key in value if previous and previous.get(key) != value[key]]
                if previous and previous["status"] == "Saved" and changes:
                    raise ImmError("Saved orders are read-only, including imports.", 409, "spt_readonly")
                values.append(value)
                entries.append(dict(line=index + 2, action=("update" if changes else "unchanged") if previous else "add",
                    order={**value, "number": entry.number or "Assigned on save"}, previous=previous, changed=changes, errors=[], patients=[]))
            token = keys._index("spt:review:v1", [str(a.user.id),
                body.model_dump(mode="json", exclude={"idempotencyKey", "reviewToken", "confirmUpdates"}), values])
            return token, entries
        def write():
            token, entries = prepare()
            if token != body.reviewToken or (any(e["action"] == "update" for e in entries) and not body.confirmUpdates):
                raise ImmError("Review changed or updates were not confirmed. Review again.", 409, "spt_review")
            orders = [project(keys, find(db, e.id)) if review["action"] == "unchanged"
                else apply(db, a, keys, e.values, e.id, e.expected_version, e.sourceId)
                for e, review in zip(body.entries, entries)]
            return dict(imported=len(orders), orders=orders)
        if commit:
            return idempotent(db, a, keys, body.idempotencyKey,
                {"operation": "import", "body": body.model_dump(mode="json")}, write)
        token, entries = prepare()
        return dict(valid=True, entries=entries, reviewToken=token, rejected=0, patientAdditions=0,
            additions=sum(e["action"] == "add" for e in entries), updates=sum(e["action"] == "update" for e in entries),
            unchanged=sum(e["action"] == "unchanged" for e in entries))
    return transaction(db, actor, work, action="import")
