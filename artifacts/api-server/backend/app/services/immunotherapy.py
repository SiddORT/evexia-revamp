"""Protected Admin orders; bounded decrypt/search and atomic historical snapshots."""
import base64
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
from app.db.immunotherapy_models import ImmunotherapyOrder as Order, ImmunotherapyItem as Item, ImmunotherapyAttachment as Attachment, ImmunotherapyRequest as Retry
from app.db.patient_models import PatientDirectory
from app.db.doctor_models import DoctorDirectory
from app.db.mr_models import MRDirectory
from app.db.allergen_models import AllergenProduct
from app.db.file_models import FileRecord
from app.db.models import AuditEvent, Patient
from app.services.mr_orders import authorize as authorize_order, scope, reference_scope, assignment as mr_assignment
from app.services.directory_runtime import crypto_scope
from app.services.directory_inventory import DirectoryCryptoError
from app.core.security import utcnow
from app.services.order_audit import metadata as audit_metadata, present as present_audit

MODELS = {"patients": PatientDirectory, "doctors": DoctorDirectory, "mrs": MRDirectory, "allergens": AllergenProduct}
MAX_SCAN = 10000


class ImmError(Exception):
    def __init__(self, message="Orders unavailable. Your draft is preserved; retry.", status=503, code="imm_unavailable"):
        self.message, self.status, self.code = message, status, code


class RejectedMutation:
    """A terminal rejection stored under the original serialized request key."""
    def __init__(self, failure):
        self.error = ImmError(failure["message"], failure["status"], failure["code"])
        self.error.terminal = True


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def seal(keys, table, record_id, value):
    nonce = secrets.token_bytes(12)
    aad = f"evexia:immunotherapy:v1:{table}:{record_id}".encode()
    data = AESGCM(keys.keys[keys.active]).encrypt(nonce, encode(value).encode(), aad)
    return f"v1:{keys.active}:{base64.b64encode(nonce + data).decode()}"


def unseal(keys, table, record_id, value):
    try:
        version, key, encoded = value.split(":")
        if version != "v1":
            raise ValueError()
        data = base64.b64decode(encoded, validate=True)
        raw = AESGCM(keys.keys[key]).decrypt(data[:12], data[12:], f"evexia:immunotherapy:v1:{table}:{record_id}".encode())
        return json.loads(raw)
    except Exception:
        raise DirectoryCryptoError() from None


def authorize(db, actor, action=None):
    return authorize_order(db, actor, "immunotherapy", action)


def transaction(db, actor, work, *, action=None, resource="immunotherapy", response_model=None):
    try:
        current = authorize_order(db, actor, resource, action)
        with crypto_scope(db) as keys:
            result = work(current, keys)
        if not isinstance(result, RejectedMutation):
            from app.services.order_capabilities import public_result
            from app.services.order_lifecycle import read_result
            result = read_result(result)
            result = present_audit(db, current, result)
            result = public_result(current, resource, result)
            from app.services.person_contacts import order_result
            result = order_result(current, result)
            if response_model:
                # Validate AND serialize the actual authorized projection before
                # commit, not only in FastAPI after a write has already committed.
                result = response_model.model_validate(result).model_dump(mode="json")
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise ImmError() from None
    except Exception:
        db.rollback()
        raise
    if isinstance(result, RejectedMutation):
        raise result.error
    return result


def find(db, record_id):
    row = db.scalar(select(Order).where(Order.id == record_id, *scope(db, Order)).with_for_update())
    if not row:
        raise ImmError("Order not found.", 404, "imm_not_found")
    return row


def project(keys, row):
    from app.services.order_lifecycle import status
    return {**unseal(keys, "orders", row.id, row.snapshot_ciphertext), "status": status(row.status),
            "audit": audit_metadata(row),
            "id": str(row.id), "number": row.number, "date": row.date.isoformat(), "version": row.version}


def review_policy(db, body, previous):
    """One boundary for direct writes and import review/commit, before resolution."""
    from app.services.mr_orders import scope_identity
    from app.services.immunotherapy_pricing import basis, financials, RATE_BASIS, LEGACY_BASIS
    decision = getattr(body, "decision", None)
    if scope_identity(db):
        if decision:
            raise ImmError("Only Admin can decide orders.", 403, "imm_admin_review")
        saved_basis = previous.get("pricingBasis", LEGACY_BASIS) if previous else RATE_BASIS
        if body.pricingBasis is not None and body.pricingBasis != saved_basis:
            raise ImmError("MR cannot change an order's financial basis.", 403, "imm_admin_review")
        if body.status != "Confirmed" or body.poNumber is not None or any(
            g.mrp is not None or any(i.rate is not None for i in g.items) for g in body.groups
        ):
            raise ImmError("MR submissions must be Confirmed and omit Admin pricing and PO number.", 403, "imm_admin_review")
        from app.services.order_approval import protect
        protect(db, "immunotherapy", body, previous)
        return
    # Existing edit/import capability grants the Admin-side operation. MRs never
    # reach this branch; imports do not gain a separate review authority.
    if decision:
        from app.services.order_approval import editable
        if not previous or not editable("immunotherapy", previous) or body.status != ("In process" if decision == "approve" else "Rejected"):
            raise ImmError("Only a pending saved order can be explicitly approved or rejected.", 409, "imm_admin_review")
    elif body.status != (previous["status"] if previous else "Confirmed"):
        raise ImmError("Use the explicit Admin decision action; ordinary status edits/imports cannot decide or advance orders.", 422, "imm_admin_review")
    if body.status == "Confirmed" and previous and previous["status"] != "Confirmed":
        raise ImmError("A reviewed order cannot be reset to awaiting review.", 422, "imm_admin_review")
    proceeding = body.status in {"In process", "Shipped", "Delivered", "Returned"}
    # Unchanged historical fulfillment snapshots can retain missing legacy rates
    # and PO numbers. PO-only edits do not force historical financial conversion.
    legacy_unchanged = not decision and previous and body.status == previous["status"] and (
        basis(body, previous) == previous.get("pricingBasis", LEGACY_BASIS) and
        financials(body.model_dump(mode="json")["groups"]) == financials(previous["groups"])
    )
    if not decision and body.status in {"In process", "Shipped", "Delivered", "Returned"} and (
        not previous or previous["status"] in {"Confirmed", "Rejected"}
    ):
        raise ImmError("Approve this order explicitly before moving it to fulfillment.", 422, "imm_admin_review")
    if proceeding and not legacy_unchanged:
        if any(
            any(i.rate is None for i in g.items) for g in body.groups
        ):
            raise ImmError("Approval/fulfillment requires a rate for every suborder. PO number is optional.", 422, "imm_pricing")
    if proceeding and not legacy_unchanged and basis(body, previous) != RATE_BASIS:
        raise ImmError("Explicitly select allergen-rate pricing before approving or repricing this historical order.", 422, "imm_pricing_basis")


def eligible(db, kind, record_id):
    row = db.scalar(select(MODELS[kind]).where(
        MODELS[kind].id == record_id, *reference_scope(db, kind)).with_for_update())
    if not row or row.deleted_at or row.status != "active":
        raise ImmError(f"Selected {kind} reference is inactive, deleted or unavailable. Choose a current reference.", 409, "imm_reference")
    if kind == "patients":
        owner = db.scalar(select(Patient).where(Patient.id == row.id).with_for_update())
        if not owner or not owner.is_active:
            raise ImmError("Patient is unavailable.", 409, "imm_reference")
    return row


def person(row, kind):
    value = {key: getattr(row, key, "") for key in ("name", "phone", "dialCountry", "email")}
    value["id"] = str(row.id)
    value["address"] = {key: getattr(row, attr, "") for key, attr in (
        ("line1", "addressLine1"), ("line2", "addressLine2"), ("landmark", "landmark"),
        ("pincode", "pincode"), ("city", "city"), ("state", "state"), ("country", "country"))}
    if kind == "patients":
        dob = row.dateOfBirth
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        value.update(code=row.code, dateOfBirth=dob.isoformat(), gender=row.gender,
            age=today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day)),
            doctorId=str(row.doctorId))
    elif kind == "doctors":
        value.update(doctorNumber=row.doctorNumber, registrationNumber=row.registrationNumber, mrId=str(row.mrId))
    else:
        value["employeeCode"] = row.employeeCode
    return value


def resolved(db, body, previous=None):
    """Retain historical identities unless the corresponding relationship changes."""
    review_policy(db, body, previous)
    mr_assignment(db, body, previous)
    # This is shared by direct writes and both import review and commit.
    # Read projections deliberately remain compatible with historic fileless orders.
    if not body.attachmentIds:
        raise ImmError("Attach at least one verified prescription for the selected patient before saving or importing this order.",
                       422, "imm_prescription_required")
    value = body.model_dump(mode="json", exclude={"idempotencyKey", "expected_version"})
    value.pop("attachmentIds")
    value.pop("orderDate", None)
    from app.services.immunotherapy_pricing import prepare, RATE_BASIS
    from app.services.mr_orders import scope_identity
    value["pricingBasis"], value["groups"] = prepare(body, previous, ImmError, mr=bool(scope_identity(db)))
    if scope_identity(db) and previous:
        value["poNumber"] = previous.get("poNumber")
    changed = {}
    for kind, field, key in (("patients", "patientId", "patient"), ("doctors", "doctorId", "doctor"), ("mrs", "mrId", "mr")):
        changed[key] = not previous or previous[field] != str(getattr(body, field))
        value[key] = person(eligible(db, kind, getattr(body, field)), kind) if changed[key] else previous[key]
    if any(changed.values()):
        # New combinations must be current real assignments; retained relationships
        # remain historical even after a master is changed or deactivated.
        p = eligible(db, "patients", body.patientId)
        d = eligible(db, "doctors", body.doctorId)
        eligible(db, "mrs", body.mrId)
        from app.services.patients import assignment
        assignment(db, body.doctorId)
        owner = db.get(Patient, p.id)
        if p.doctorId != d.id or d.mrId != body.mrId or owner.assigned_mr_id != body.mrId:
            raise ImmError("Patient, Doctor and MR must match current master assignments.", 422, "imm_relationship")
    recipient_key = value["shipping"]
    if previous and previous["shipping"] == body.shipping and not changed[recipient_key]:
        value["recipient"] = previous["recipient"]
    elif previous and previous["shipping"] != body.shipping:
        recipient_kind, recipient_id = (("patients", body.patientId) if body.shipping == "patient" else ("doctors", body.doctorId))
        value["recipient"] = person(eligible(db, recipient_kind, recipient_id), recipient_kind)
    else:
        value["recipient"] = value[recipient_key]
    retained = {item["allergenId"]: item["allergen"] for group in previous["groups"] for item in group["items"]} if previous else {}
    current = {}
    for aid in sorted({item.allergenId for g in body.groups for item in g.items}):
        if str(aid) not in retained:
            a = eligible(db, "allergens", aid)
            current[str(aid)] = dict(id=str(a.id), name=a.name, concentration=a.concentration)
    total = 0
    priced = True
    for group in value["groups"]:
        if group["mrp"] is not None:
            group["mrp"] = format(Decimal(group["mrp"]), ".2f")
        for item in group["items"]:
            if item.get("rate") is not None:
                item["rate"] = format(Decimal(item["rate"]), ".2f")
                if value["pricingBasis"] == RATE_BASIS:
                    total += int(Decimal(item["rate"]) * 100)
            elif value["pricingBasis"] == RATE_BASIS:
                priced = False
            item["allergen"] = retained.get(item["allergenId"]) or current[item["allergenId"]]
    if total > 10000000000:
        raise ImmError("Order value exceeds ₹10 crore.", 422, "imm_total")
    value["totalMinor"] = (total if priced else None) if value["pricingBasis"] == RATE_BASIS else previous["totalMinor"]
    if previous:
        value["nextSuborderNumber"] = previous.get("nextSuborderNumber", 1)
    value.pop("decision", None)
    value["reviewDecision"] = (("Approved" if body.decision == "approve" else "Rejected") if getattr(body, "decision", None)
                               else previous.get("reviewDecision") if previous else None)
    value["attachments"] = []
    previous_files = {a["id"] for a in previous["attachments"]} if previous else set()
    for file_id in sorted(body.attachmentIds):
        f = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
        if (not f or f.patient_id != body.patientId or f.category != "documents"
            or f.state != "verified" or f.scanner_status != "clean"
            or not f.size or f.size > 10 * 1024 * 1024
            or (str(f.id) not in previous_files and f.uploader_id != db.info["imm_actor"])):
            raise ImmError("Prescription is not a verified private upload owned by this patient and uploader. Quarantined or incomplete files cannot be attached.", 409, "imm_attachment")
        value["attachments"].append(dict(id=str(f.id), name=f.display_name, size=f.size, type=f.content_type, state=f.state))
    return value


def apply(db, actor, keys, body, record_id=None, expected=None):
    row = find(db, record_id) if record_id else None
    if row and expected != row.version:
        raise ImmError("This order changed. Your draft is preserved. Reopen the saved order in another tab and reconcile before retrying.", 409, "imm_stale")
    previous = project(keys, row) if row else None
    from app.services.order_capabilities import attachment_changes
    attachment_changes(actor, "immunotherapy", body.attachmentIds, previous)
    if row and body.orderDate is not None and body.orderDate != row.date:
        raise ImmError("Saved order date is immutable.", 422, "imm_date")
    db.info["imm_actor"] = actor.user.id
    data = resolved(db, body, previous)
    from app.services.order_approval import evidence
    data["approval"] = previous.get("approval") if previous else None
    data["rejection"] = previous.get("rejection") if previous else None
    if getattr(body, "decision", None) == "approve":
        data["approval"] = evidence(actor)
    elif getattr(body, "decision", None) == "reject":
        data["rejection"] = {"rejectedBy": str(actor.user.id), "rejectedAt": utcnow().isoformat()}
    from app.services.immunotherapy_pricing import issue
    issue(data, previous)
    now = utcnow()
    if not row:
        sequence = db.scalar(text("SELECT nextval('immunotherapy_order_number_seq')"))
        row = Order(id=uuid.uuid4(), number=f"IT-{sequence:08d}",
            date=body.orderDate or datetime.now(ZoneInfo("Asia/Kolkata")).date(), version=1, created_by=actor.user.id, created_at=now)
        db.add(row)
    else:
        row.version += 1
    row.patient_id, row.doctor_id, row.mr_id = body.patientId, body.doctorId, body.mrId
    row.status, row.updated_by = body.status, actor.user.id
    row.updated_at = now
    row.snapshot_ciphertext = seal(keys, "orders", row.id, data)
    db.flush()
    db.execute(delete(Item).where(Item.order_id == row.id))
    db.execute(delete(Attachment).where(Attachment.order_id == row.id))
    for pos, group in enumerate(body.groups):
        for item in group.items:
            db.add(Item(order_id=row.id, bottle=pos, allergen_id=item.allergenId))
    for file_id in body.attachmentIds:
        db.add(Attachment(order_id=row.id, file_id=file_id))
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
        action="immunotherapy_updated" if previous else "immunotherapy_created",
        resource_type="immunotherapy_order", resource_id=row.id, outcome="success",
        request_id=db.info.get("request_id"), created_at=utcnow()))
    db.flush()
    return project(keys, row)


def idempotent(db, actor, keys, key, payload, work, *, terminal_rejections=False):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
    prior = db.get(Retry, key)
    if prior:
        if prior.actor_id != actor.user.id:
            raise ImmError("Retry identity belongs to a different request. Retry the original unchanged submission.", 409, "imm_retry")
        saved = unseal(keys, "requests", key, prior.response_ciphertext)
        from app.services.immunotherapy_pricing import retry_payload
        if encode(retry_payload(saved["request"])) != encode(retry_payload(payload)):
            raise ImmError("Retry identity belongs to a different request. Retry the original unchanged submission.", 409, "imm_retry")
        if saved.get("failure"):
            return RejectedMutation(saved["failure"])
        result = saved["result"]
        # Recover the same mutation without replaying it or returning a stale
        # Confirmed snapshot after an administrator has reviewed the order.
        current = [project(keys, find(db, uuid.UUID(order["id"])))
                   for order in result.get("orders", [result])]
        if "orders" in result:
            result = {**result, "orders": current}
        else:
            result = current[0]
        return result
    if terminal_rejections:
        try:
            # The advisory lock predates this savepoint. Roll back attempted
            # changes, but retain the lock until the rejection tombstone commits.
            with db.begin_nested():
                result = work()
        except ImmError as error:
            if not 400 <= error.status < 500:
                raise
            failure = dict(message=error.message, status=error.status, code=error.code)
            db.add(Retry(key=key, actor_id=actor.user.id, response_ciphertext=seal(
                keys, "requests", key, {"request": payload, "failure": failure})))
            return RejectedMutation(failure)
    else:
        result = work()
    db.add(Retry(key=key, actor_id=actor.user.id, response_ciphertext=seal(keys, "requests", key, {"request": payload, "result": result})))
    return result


def save(db, actor, body, record_id=None):
    from app.schemas.immunotherapy import ImmRecord
    return transaction(db, actor, lambda a, k: idempotent(db, a, k, body.idempotencyKey,
        [str(record_id), body.model_dump(mode="json")],
        lambda: apply(db, a, k, body, record_id, body.expected_version), terminal_rejections=True),
        action="edit" if record_id else "add", response_model=ImmRecord)


def detail(db, actor, record_id):
    return transaction(db, actor, lambda a, k: project(k, find(db, record_id)))


def listing(db, actor, *, search="", status="", from_date=None, to_date=None, cursor=None, limit=25, complete=False):
    def work(a, keys):
        started = time.monotonic()
        if from_date and to_date and from_date > to_date:
            raise ImmError("From date must not be after To date.", 422, "imm_dates")
        clauses = scope(db, Order)
        if status:
            from app.services.order_lifecycle import filter_status
            clauses.append(filter_status(Order.status, status))
        if from_date:
            clauses.append(Order.date >= from_date)
        if to_date:
            clauses.append(Order.date <= to_date)
        query = select(Order).where(*clauses).order_by(Order.id)
        if cursor and not complete:
            query = query.where(Order.id > cursor)
        cap = MAX_SCAN if complete else 500
        # Stream finite candidates so a large historical directory never requires
        # materializing thousands of encrypted documents before applying limits.
        rows = db.scalars(query.limit(cap + 1).execution_options(yield_per=25))
        found, last, examined, size, more = [], None, 0, 0, False
        try:
            for row in rows:
                if examined == cap:
                    if complete:
                        raise ImmError("Export exceeds 10,000 candidates. Narrow filters; no partial file produced.", 409, "imm_export_limit")
                    more = True
                    break
                examined += 1
                if time.monotonic() - started > (30 if complete else 5):
                    raise ImmError("Secure search/export budget exceeded. Narrow filters and retry; no partial export produced.", 409, "imm_scan_limit")
                data = project(keys, row)
                last = row.id
                if not search.strip() or search.strip().lower() in " ".join(str(s) for s in (
                    data["number"], data["patient"]["name"], data["patient"]["phone"], data["doctor"]["name"], data["mr"]["name"])).lower():
                    size += len(encode(data).encode("utf-8"))
                    if complete and size > 8_000_000:
                        raise ImmError("Export exceeds 8 MB of saved order data. Narrow filters; no partial file produced.", 409, "imm_export_limit")
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


def references(db, actor, kind, search="", cursor=None, limit=25, selected=None, *, resource="immunotherapy"):
    if kind not in MODELS:
        raise ImmError("Unknown reference kind.", 404, "imm_reference")
    def work(a, keys):
        started = time.monotonic()
        model = MODELS[kind]
        query = select(model).where(model.deleted_at.is_(None), model.status == "active",
                                    *reference_scope(db, kind)).order_by(model.id)
        if cursor:
            query = query.where(model.id > cursor)
        rows = list(db.scalars(query.limit(501)))
        items, last = [], None
        def choice(row):
            if kind == "allergens":
                return dict(id=str(row.id), name=row.name, concentration=row.concentration)
            data = person(row, kind)
            if kind == "patients":
                owner = db.get(Patient, row.id)
                if not owner or not owner.is_active:
                    return None
                doctor = db.get(DoctorDirectory, row.doctorId)
                data["mrId"] = str(doctor.mrId) if doctor else ""
            return data
        for row in rows[:500]:
            if time.monotonic() - started > 5:
                raise ImmError("Reference search budget exceeded. Narrow the search and retry.", 409, "imm_scan_limit")
            last = row.id
            data = choice(row)
            if data is None:
                continue
            if not search.strip() or search.lower().strip() in encode(data).lower():
                items.append(data)
            if len(items) == limit:
                break
        more = bool(last and (len(rows) > 500 or last != rows[-1].id))
        # Hydrate one selected eligible UUID, never traverse the directory.
        if selected and not any(i["id"] == str(selected) for i in items):
            chosen = db.scalar(select(model).where(model.id == selected, *reference_scope(db, kind)))
            if chosen and not chosen.deleted_at and chosen.status == "active":
                data = choice(chosen)
                if data:
                    items.append(data)
        if a.role == "mr" and kind in {"doctors", "patients"}:
            from app.services.person_contacts import person as masked_person
            items = [masked_person(item) for item in items]
        return dict(items=items, nextCursor=str(last) if more else None, limit=limit)
    return transaction(db, actor, work, resource=resource)


def batch(db, actor, body, commit=False):
    def work(a, keys):
        # Deterministic order of locks prevents batches deadlocking each other.
        ids = [entry.id for entry in body.entries if entry.id]
        if len(ids) != len(set(ids)):
            raise ImmError("Duplicate matching order in import.", 422, "imm_import")
        for record_id in sorted(ids):
            find(db, record_id)
        db.info["imm_actor"] = a.user.id
        def prepare():
            resolved_values, entries = [], []
            for index, entry in enumerate(body.entries):
                previous = project(keys, find(db, entry.id)) if entry.id else None
                if previous and previous["version"] != entry.expected_version:
                    raise ImmError("Import contains a stale matching order. Export/review current data again.", 409, "imm_stale")
                if previous and entry.values.orderDate and previous["date"] != entry.values.orderDate.isoformat():
                    raise ImmError("Saved order date is immutable.", 422, "imm_date")
                values = resolved(db, entry.values, previous)
                resolved_values.append(values)
                changes = [key for key in values if previous and values[key] != previous.get(key)]
                # An explicit import commit may issue missing historical IDs too;
                # review must flag that write rather than skip it as unchanged.
                if previous and "groups" not in changes and any(
                    not item.get("suborderId") for group in values["groups"] for item in group["items"]
                ):
                    changes.append("groups")
                entries.append(dict(line=index + 2, action=("update" if changes else "unchanged") if previous else "add",
                    order={**values, "number": previous["number"] if previous else "Assigned on save"},
                    previous=previous, errors=[], changed=changes, patients=[]))
            token = keys._index("immunotherapy:review", [str(a.user.id), body.model_dump(mode="json", exclude={"reviewToken", "confirmUpdates", "idempotencyKey"}), resolved_values])
            return token, entries
        def write():
            token, reviewed = prepare()
            if token != body.reviewToken or (any(e["action"] == "update" for e in reviewed) and not body.confirmUpdates):
                raise ImmError("Import review changed or matching updates were not confirmed. Review again.", 409, "imm_import_review")
            orders = [apply(db, a, keys, e.values, e.id, e.expected_version) if r["action"] != "unchanged"
                      else project(keys, find(db, e.id)) for e, r in zip(body.entries, reviewed)]
            return dict(imported=len(orders), orders=orders)
        if commit:
            return idempotent(db, a, keys, body.idempotencyKey, body.model_dump(mode="json"), write)
        token, entries = prepare()
        return dict(valid=True, entries=entries, reviewToken=token, additions=sum(e["action"] == "add" for e in entries),
            updates=sum(e["action"] == "update" for e in entries), unchanged=sum(e["action"] == "unchanged" for e in entries), rejected=0, patientAdditions=0)
    return transaction(db, actor, work, action="import")
