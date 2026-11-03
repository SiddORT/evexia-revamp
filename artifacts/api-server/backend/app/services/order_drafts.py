"""Creator-private drafts. No number issuance or operational side effects on save."""
import uuid
from pydantic import ValidationError
from sqlalchemy import select, delete, text
from app.core.security import utcnow
from app.db.order_draft_models import OrderDraft, OrderDraftAttachment, OrderDraftRequest
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError, eligible, seal, unseal
from app.services.mr_orders import authorize, scope_identity


def protect_attachments(db, identities):
    """Normal creation/edit/import cannot steal a file retained by a draft."""
    if not identities:
        return
    links = list(db.scalars(select(OrderDraftAttachment).where(
        OrderDraftAttachment.file_id.in_(identities))))
    if any(link.draft_id != db.info.get("submitting_order_draft") for link in links):
        raise ImmError("Attachment is retained by an incomplete draft. Submit that draft or save it without this file first.", 409, "draft_attachment")


def project(keys, row, actor=None):
    result = dict(id=str(row.id), kind=row.kind, version=row.version,
                updatedAt=row.updated_at.isoformat(),
                payload=unseal(keys, "entry_drafts", row.id, row.payload_ciphertext)["payload"])
    if actor:
        from app.services.order_capabilities import public_result
        result = public_result(actor, row.kind, result)
    return result


def owned(db, actor, kind):
    # Admin capability is necessary, not authority over another creator's draft.
    return (OrderDraft.created_by == actor.user.id, OrderDraft.kind == kind,
            OrderDraft.mr_scope == scope_identity(db))


def find(db, actor, kind, identity):
    row = db.scalar(select(OrderDraft).where(OrderDraft.id == identity, *owned(db, actor, kind)).with_for_update())
    if not row:
        raise ImmError("Draft unavailable for this account.", 404, "draft_not_found")
    return row


def read(db, actor, kind, identity=None, cursor=None, limit=25):
    actor = authorize(db, actor, kind, "add")
    with crypto_scope(db) as keys:
        if identity:
            row = find(db, actor, kind, identity)
            if row.submitted_order_id:
                raise ImmError("This draft has already been submitted. Return to saved orders.", 409, "draft_submitted")
            return project(keys, row, actor)
        query = select(OrderDraft).where(*owned(db, actor, kind), OrderDraft.submitted_order_id.is_(None))
        if cursor:
            query = query.where(OrderDraft.id < cursor)
        rows = list(db.scalars(query.order_by(OrderDraft.id.desc()).limit(limit + 1)))
        return dict(items=[project(keys, r, actor) for r in rows[:limit]],
                    nextCursor=str(rows[limit - 1].id) if len(rows) > limit else None)


def references_and_files(db, actor, kind, payload, identity):
    value = payload.get("values")
    if not isinstance(value, dict):
        raise ImmError("Draft values are required.", 422, "draft_payload")
    allowed = {
        "immunotherapy": {"patientId", "doctorId", "mrId", "dosage", "histamine", "saline", "groups", "remarks", "attachments", "shipping", "status", "poNumber", "pricingBasis"},
        "kits": {"orderFor", "doctorId", "mrId", "patientId", "kit", "lancets", "applicators", "tray", "shipping", "remarks", "other", "status", "paymentStatus", "attachments"},
        "lupin": {"doctorId", "mrId", "patientCount", "price", "patientIds", "remarks", "attachments", "status", "paymentStatus"},
    }
    if set(value) - allowed[kind] or set(payload) - {"values", "allergenEntries", "linked"}:
        raise ImmError("Unsupported draft entry fields.", 422, "draft_payload")
    # Blank/invalid entry text is allowed. Container/type validation is not
    # clinical completeness: it keeps a saved document safely reopenable.
    containers = {"groups", "attachments", "kit", "other", "patientIds"}
    if any(not isinstance(item, str) for key, item in value.items() if key not in containers):
        raise ImmError("Draft input fields must contain text, including empty text for unfinished values.", 422, "draft_payload")
    required = {
        "immunotherapy": {"patientId", "doctorId", "mrId", "dosage", "histamine", "saline", "groups", "remarks", "attachments", "shipping", "poNumber", "pricingBasis"},
        "kits": {"orderFor", "doctorId", "mrId", "patientId", "kit", "lancets", "applicators", "tray", "shipping", "remarks", "other", "attachments"},
        "lupin": {"doctorId", "mrId", "patientCount", "price", "patientIds", "remarks", "attachments"},
    }
    if not required[kind].issubset(value):
        raise ImmError("Supply the editor's entry fields; unfinished values may be empty.", 422, "draft_payload")
    if kind == "kits":
        kit, other = value.get("kit"), value.get("other")
        if (not isinstance(kit, dict) or not {"product", "custom", "volume", "quantity"}.issubset(kit)
                or any(not isinstance(v, str) for v in kit.values())
                or not isinstance(other, dict) or not isinstance(other.get("name"), str)
                or not isinstance(other.get("phone"), str) or not isinstance(other.get("address"), dict)
                or any(not isinstance(v, str) for v in other["address"].values())):
            raise ImmError("Invalid draft kit or recipient entry structure.", 422, "draft_payload")
    def reference(group, raw):
        if not raw:
            return
        try:
            identifier = uuid.UUID(str(raw))
        except ValueError:
            raise ImmError("Invalid selected reference.", 422, "draft_reference") from None
        eligible(db, group, identifier)
    for field in ("patientId", "doctorId", "mrId"):
        if value.get(field) is not None and not isinstance(value.get(field), str):
            raise ImmError("Invalid selected reference.", 422, "draft_reference")
    for group, field in (("patients", "patientId"), ("doctors", "doctorId"), ("mrs", "mrId")):
        reference(group, value.get(field))
    if scope_identity(db) and value.get("mrId") != str(scope_identity(db)):
        raise ImmError("Draft MR must be your authenticated MR.", 422, "draft_owner")
    patients = value.get("patientIds", [])
    groups = value.get("groups", [])
    entries = payload.get("allergenEntries", {})
    if (not isinstance(patients, list) or len(patients) > 200
            or not isinstance(groups, list) or len(groups) > (1000 if kind == "immunotherapy" and scope_identity(db) else 100)
            or not isinstance(entries, dict)):
        raise ImmError("Invalid draft rows.", 422, "draft_payload")
    for patient in patients:
        reference("patients", patient)
    count = 0
    for group in groups:
        if (not isinstance(group, dict) or not isinstance(group.get("id"), str)
                or not isinstance(group.get("items"), list) or len(group["items"]) > 100):
            raise ImmError("Invalid draft allergen rows.", 422, "draft_payload")
        count += len(group["items"])
        if count > 1000:
            raise ImmError("Use at most 1,000 allergen rows.", 422, "draft_payload")
        for item in group["items"]:
            if not isinstance(item, dict):
                raise ImmError("Invalid draft allergen row.", 422, "draft_payload")
            reference("allergens", item.get("allergenId"))
    for entry in entries.values():
        if not isinstance(entry, dict):
            raise ImmError("Invalid pending allergen row.", 422, "draft_payload")
        reference("allergens", entry.get("allergenId"))
    linked = payload.get("linked", [])
    if not isinstance(linked, list) or len(linked) > 200:
        raise ImmError("Invalid linked patients.", 422, "draft_reference")
    for patient in linked:
        if not isinstance(patient, dict) or patient.get("id") not in patients:
            raise ImmError("Invalid linked patient.", 422, "draft_reference")
    files = value.get("attachments", [])
    if not isinstance(files, list) or len(files) > 10:
        raise ImmError("Use at most ten verified attachments.", 422, "draft_attachment")
    ids = []
    for file in files:
        try:
            file_id = uuid.UUID(file["id"])
        except (KeyError, TypeError, ValueError):
            raise ImmError("Upload and verify selected files before saving a draft.", 422, "draft_attachment") from None
        if (not isinstance(file.get("name"), str) or not isinstance(file.get("size"), int)
                or not isinstance(file.get("type"), str) or file.get("state") != "verified"):
            raise ImmError("Verified attachment metadata is required.", 422, "draft_attachment")
        from app.services.files import get_record
        row = get_record(db, actor, file_id, "read", lock=True, readable=True)
        if row.uploader_id != actor.user.id or row.state != "verified" or row.scanner_status != "clean" or row.category != "documents" or not 0 < row.size <= 10485760:
            raise ImmError("Use your own clean verified upload.", 403, "draft_attachment")
        if (kind == "immunotherapy" and (not value.get("patientId") or str(row.patient_id) != value["patientId"])
                or kind == "kits" and row.kits_owner_id != actor.user.id
                or kind == "lupin" and row.lupin_owner_id != actor.user.id):
            raise ImmError("Attachment does not belong to this draft's type/patient.", 403, "draft_attachment")
        from app.db.immunotherapy_models import ImmunotherapyAttachment
        from app.db.kits_models import KitsAttachment
        from app.db.lupin_models import LupinAttachment
        for association in (ImmunotherapyAttachment, KitsAttachment, LupinAttachment):
            if db.scalar(select(association.file_id).where(association.file_id == file_id).limit(1)):
                raise ImmError("Submitted-order attachments cannot be moved into drafts.", 409, "draft_attachment")
        other = db.scalar(select(OrderDraftAttachment).where(OrderDraftAttachment.file_id == file_id))
        if other and other.draft_id != identity:
            raise ImmError("File is retained by another draft.", 409, "draft_attachment")
        ids.append(file_id)
    if len(set(ids)) != len(ids):
        raise ImmError("Duplicate attachment.", 422, "draft_attachment")
    return ids


def save(db, actor, kind, identity, body):
    try:
        actor = authorize(db, actor, kind, "add")
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": identity.int % (2**63 - 1)})
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": body.idempotencyKey.int % (2**63 - 1)})
        with crypto_scope(db) as keys:
            row = db.scalar(select(OrderDraft).where(OrderDraft.id == identity).with_for_update())
            prior = db.get(OrderDraftRequest, body.idempotencyKey)
            if prior:
                if not row or prior.actor_id != actor.user.id or prior.draft_id != identity:
                    raise ImmError("Draft retry belongs to another request.", 409, "draft_retry")
                row = find(db, actor, kind, identity)
                saved = unseal(keys, "draft_requests", prior.key, prior.response_ciphertext)
                if saved["request"] != body.model_dump(mode="json"):
                    raise ImmError("Retry the original unchanged draft save.", 409, "draft_retry")
                if row.submitted_order_id:
                    raise ImmError("Draft already submitted. Return to saved orders.", 409, "draft_submitted")
                from app.services.order_capabilities import public_result
                return public_result(actor, kind, saved["result"])
            if row:
                row = find(db, actor, kind, identity)
                if row.submitted_order_id:
                    raise ImmError("Draft already submitted; no changes saved.", 409, "draft_submitted")
                if row.version != body.expected_version:
                    raise ImmError("A newer draft was saved in another tab. Your entries remain here; reopen the saved draft separately to compare.", 409, "draft_stale")
            elif body.expected_version is not None:
                raise ImmError("Draft unavailable.", 404, "draft_not_found")
            files = references_and_files(db, actor, kind, body.payload, identity)
            if not row:
                row = OrderDraft(id=identity, kind=kind, created_by=actor.user.id,
                    mr_scope=scope_identity(db), version=0)
                db.add(row)
            row.version += 1
            row.last_request = body.idempotencyKey
            row.updated_at = utcnow()
            row.payload_ciphertext = seal(keys, "entry_drafts", identity, {"payload": body.payload})
            db.flush()
            db.execute(delete(OrderDraftAttachment).where(OrderDraftAttachment.draft_id == identity))
            for file_id in files:
                db.add(OrderDraftAttachment(draft_id=identity, file_id=file_id))
            db.flush()
            result = project(keys, row)
            db.add(OrderDraftRequest(key=body.idempotencyKey, draft_id=identity, actor_id=actor.user.id,
                response_ciphertext=seal(keys, "draft_requests", body.idempotencyKey,
                    {"request": body.model_dump(mode="json"), "result": result})))
        db.commit()
        from app.services.order_capabilities import public_result
        return public_result(actor, kind, result)
    except Exception:
        db.rollback()
        raise


def submit(db, actor, kind, identity, body):
    try:
        actor = authorize(db, actor, kind, "add")
        row = find(db, actor, kind, identity)
        with crypto_scope(db) as keys:
            document = unseal(keys, "entry_drafts", row.id, row.payload_ciphertext)
        from app.services import immunotherapy, kits, lupin
        from app.schemas.immunotherapy import ImmWrite
        from app.schemas.kits import KitsWrite
        from app.schemas.lupin import LupinWrite
        service, schema = {"immunotherapy": (immunotherapy, ImmWrite), "kits": (kits, KitsWrite), "lupin": (lupin, LupinWrite)}[kind]
        if row.submitted_order_id:
            if row.submitted_version != body.expected_version or document.get("submission") != body.order:
                raise ImmError("Draft was already submitted. Return to saved orders.", 409, "draft_submitted")
            return service.detail(db, actor, row.submitted_order_id)
        if row.version != body.expected_version:
            raise ImmError("Draft changed in another tab. Reopen its current saved version before submitting.", 409, "draft_stale")
        # Namespace each explicit attempt to this draft. A normal-order key
        # cannot be replayed here to consume an unrelated order as this draft.
        values = dict(body.order)
        values.pop("idempotencyKey", None)
        values.pop("expected_version", None)
        try:
            request_key = uuid.UUID(str(body.order.get("idempotencyKey")))
        except ValueError:
            raise ImmError("A submission request identity is required.", 422, "draft_request") from None
        values["idempotencyKey"] = uuid.uuid5(identity, str(request_key))
        try:
            submitted = schema.model_validate(values)
        except ValidationError as exc:
            labels = {
                "patientId": "Patient", "doctorId": "Doctor", "mrId": "MR",
                "dosage": "Dosage", "histamine": "Histamine result", "saline": "Saline result",
                "groups": "Allergen rows and pricing", "kit": "Kit configuration",
                "patientCount": "Patient count", "price": "Price", "patientIds": "Linked patients",
                "attachmentIds": "Verified attachments", "shipping": "Shipping",
                "other": "Recipient details", "remarks": "Remarks",
            }
            fields = list(dict.fromkeys(
                labels.get(str(error["loc"][0]), str(error["loc"][0]))
                if error["loc"] else "required order configuration"
                for error in exc.errors(include_url=False, include_input=False)
            ))[:8]
            raise ImmError(f"Complete or correct: {', '.join(fields)}. Use valid quantities/prices and verified required attachments. The saved draft is unchanged.", 422, "draft_incomplete") from None
        def complete(result):
            # Called inside the normal order transaction, before its commit.
            with crypto_scope(db) as keys:
                row.submitted_order_id = uuid.UUID(result["id"])
                row.submitted_version = row.version
                document["submission"] = body.order
                row.payload_ciphertext = seal(keys, "entry_drafts", row.id, document)
                row.updated_at = utcnow()
                db.execute(delete(OrderDraftAttachment).where(OrderDraftAttachment.draft_id == identity))
                db.flush()
        db.info["submitting_order_draft"] = identity
        return service.save(db, actor, submitted, before_commit=complete)
    except Exception:
        db.rollback()
        raise
    finally:
        db.info.pop("submitting_order_draft", None)
