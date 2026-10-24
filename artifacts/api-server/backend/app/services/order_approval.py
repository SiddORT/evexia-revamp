"""Server-owned approval evidence inside existing encrypted order snapshots.

Historical decisions are never synthesized from status alone.
All callers run within the service transaction and hold the order row lock.
"""
from app.core.security import utcnow
from app.services.immunotherapy import ImmError


def editable(kind, previous):
    if not previous:
        return previous is None
    if previous.get("approval"):
        return False
    if previous["status"] == "Rejected":
        return True
    pending = {"Draft", "Saved"} if kind == "spt" else {"Confirmed"}
    return previous["status"] in pending and not previous.get("rejection") and not previous.get("reviewDecision")


def pending(kind, previous):
    return bool(previous and editable(kind, previous) and previous["status"] == ("Saved" if kind == "spt" else "Confirmed"))


def protect(db, kind, body, previous):
    from app.services.mr_orders import scope_identity
    if not scope_identity(db):
        return
    if previous and not editable(kind, previous):
        raise ImmError("This order is approved or closed and can no longer be edited. Your draft is preserved.", 409, "order_edit_closed")
    if previous and str(body.mrId) != previous.get("mrId"):
        raise ImmError("Order ownership cannot be changed.", 403, "mr_order_assignment")
    if kind != "spt":
        if body.status != (previous["status"] if previous else "Confirmed"):
            raise ImmError("Only Admin can change order decisions.", 403, "order_decision")
        if hasattr(body, "paymentStatus") and body.paymentStatus != (previous["paymentStatus"] if previous else "Unpaid"):
            raise ImmError("Only Admin can change payment decisions.", 403, "order_decision")
    elif previous and body.status != previous["status"] and previous["status"] in {"Saved", "Rejected"}:
        raise ImmError("Submitted orders cannot return to Draft.", 409, "order_edit_closed")
    if kind == "lupin" and previous:
        retained = {f["id"] for f in previous["attachments"]}
        if not retained.issubset(set(map(str, body.attachmentIds))):
            raise ImmError("Saved attachments must be retained.", 403, "mr_order_attachment")


def evidence(actor):
    return {"approvedBy": str(actor.user.id), "approvedAt": utcnow().isoformat()}


def preserve(actor, kind, data, previous):
    data["approval"] = previous.get("approval") if previous else None
    data["rejection"] = previous.get("rejection") if previous else None
    data["reviewHistory"] = list(previous.get("reviewHistory", [])) if previous else []
    data["reviewDecision"] = previous.get("reviewDecision") if previous else None
    data["correctionSaved"] = bool(previous and previous["status"] == "Rejected" and actor.role == "mr")
    if actor.role == "mr" and previous:
        fields = {"kits": ("kit", "lancets", "applicators", "tray"),
                  "lupin": ("patientCount", "patientIds"),
                  "spt": ("patients",), "immunotherapy": ("groups", "dosage", "histamine", "saline")}
        data["pricingNeedsReview"] = previous.get("pricingNeedsReview", False) or any(
            data.get(key) != previous.get(key) for key in fields[kind])
    else:
        data["pricingNeedsReview"] = False


def record_decision(snapshot, actor, decision, version, reason=None):
    entry = {"decision": decision, "version": version, "actor": str(actor.user.id), "at": utcnow().isoformat()}
    if decision == "reject":
        entry["reason"] = reason
        snapshot["rejection"] = {"rejectedBy": entry["actor"], "rejectedAt": entry["at"], "reason": reason}
        snapshot["approval"] = None
    else:
        snapshot["approval"] = {"approvedBy": entry["actor"], "approvedAt": entry["at"]}
        snapshot["rejection"] = None
    snapshot["reviewDecision"] = "Approved" if decision == "approve" else "Rejected"
    snapshot["reviewHistory"] = [*snapshot.get("reviewHistory", []), entry]
    snapshot["correctionSaved"] = False


def export_safe(value):
    """Reasons/history are private detail data, never implicit transfer fields."""
    return {k: v for k, v in value.items() if k not in {
        "rejection", "reviewHistory", "correctionSaved", "pricingNeedsReview"}}


def imm_values(previous):
    from app.schemas.immunotherapy import ImmInput, ImmBottle, ImmItem
    values = {k: previous[k] for k in ImmInput.model_fields if k in previous}
    values["attachmentIds"] = [f["id"] for f in previous["attachments"]]
    values["groups"] = [{k: v for k, v in g.items() if k in ImmBottle.model_fields and k != "items"}
        | {"items": [{k: v for k, v in i.items() if k in ImmItem.model_fields} for i in g["items"]]}
        for g in previous["groups"]]
    return values


def saved_pricing(kind, previous):
    """Validate persisted amounts against the persisted basis; zero is not missing."""
    from decimal import Decimal
    if previous.get("pricingNeedsReview"):
        raise ValueError("Changed pricing basis requires Admin review")
    if kind == "immunotherapy":
        from app.schemas.immunotherapy import ImmInput
        from app.services.immunotherapy_pricing import RATE_BASIS
        if previous.get("pricingBasis") != RATE_BASIS or any(
            i.get("rate") is None for g in previous["groups"] for i in g["items"]
        ):
            raise ValueError("Missing saved rates")
        ImmInput.model_validate(imm_values(previous))
        if not previous["attachments"]:
            raise ValueError("Missing prescription")
        total = sum((Decimal(i["rate"]) for g in previous["groups"] for i in g["items"]), Decimal(0))
        if total * 100 != previous.get("totalMinor") or total > Decimal("100000000"):
            raise ValueError("Stale saved total")
        return
    if kind == "spt":
        from app.schemas.spt import SptInput
        SptInput.model_validate({key: previous[key] for key in ("doctorId", "mrId", "remarks", "status")}
            | {"patients": [{k: p[k] for k in ("id", "source", "amount")} for p in previous["patients"]]})
        if Decimal(previous["total"]) != sum((Decimal(p["amount"]) for p in previous["patients"]), Decimal(0)):
            raise ValueError("Stale patient total")
        return
    from app.schemas.kits import KitsInput
    from app.schemas.lupin import LupinInput
    contract = KitsInput if kind == "kits" else LupinInput
    values = {key: previous[key] for key in contract.model_fields
        if key in previous and key not in {"pricing", "businessParking", "poNumber"}}
    values["attachmentIds"] = [f["id"] for f in previous["attachments"]]
    body = contract.model_validate(values)
    if kind == "kits":
        from app.schemas.kits_pricing import KitsPricingInput, calculate
        raw = previous.get("pricing")
        if not raw:
            raise ValueError("No saved pricing")
        price = KitsPricingInput.model_validate({k: raw[k] for k in KitsPricingInput.model_fields if k in raw})
        if calculate(body, price, raw["taxPercentage"]) != raw:
            raise ValueError("Stale supply pricing")
    else:
        if Decimal(previous["total"]) != Decimal(body.patientCount) * Decimal(body.price):
            raise ValueError("Stale count pricing")
        if not values["attachmentIds"]:
            raise ValueError("Missing verified attachment")


def eligibility(kind, previous):
    reviewable = pending(kind, previous)
    reason = ""
    if reviewable:
        try:
            saved_pricing(kind, previous)
        except (ValueError, KeyError, TypeError, ArithmeticError):
            reason = "Save complete, valid pricing for the current saved items/patients before approving. Reopen Edit order to review pricing."
        if kind == "lupin" and not previous.get("attachments"):
            reason = "Attach a verified Lupin document and save the order before approving. Reopen Edit order."
    else:
        reason = "Submit this draft before review." if previous["status"] == "Draft" else "This order has already been decided or is closed."
    return {"canApprove": reviewable and not reason, "canReject": reviewable, "approvalUnavailable": reason}


def approve(db, actor, identity, body, kind, *, decision="approve"):
    from app.services import kits, spt, lupin, immunotherapy
    from app.services.capability_policy import is_super_admin
    from app.db.models import AuditEvent
    service = {"kits": kits, "spt": spt, "lupin": lupin, "immunotherapy": immunotherapy}[kind]
    def work(current, keys):
        if current.role == "mr" or (kind == "kits" and not is_super_admin(current)):
            raise ImmError("Admin approval access is required.", 403, "access_denied")
        def write():
            row = service.find(db, identity)
            previous = service.project(keys, row)
            if row.version != body.expected_version:
                raise ImmError("Order changed. Your entries are preserved. Reopen the saved order separately before deciding.", 409, "order_stale")
            available = eligibility(kind, previous)
            if not available["canReject"]:
                raise ImmError(available["approvalUnavailable"], 409, "order_approval")
            if decision == "approve" and not available["canApprove"]:
                raise ImmError(available["approvalUnavailable"], 422, "order_pricing")
            # Validate the complete saved submission, not Admin-supplied replacements.
            if decision == "approve" and kind == "immunotherapy":
                from app.schemas.immunotherapy import ImmInput
                values = imm_values(previous)
                db.info["imm_actor"] = current.user.id
                service.resolved(db, ImmInput.model_validate(values), previous)
            elif decision == "approve" and kind == "spt":
                from app.schemas.spt import SptInput
                SptInput.model_validate({key: previous[key] for key in ("doctorId", "mrId", "patients", "remarks", "status")}
                    | {"patients": [{k: p[k] for k in ("id", "source", "amount")} for p in previous["patients"]]})
            elif decision == "approve":
                from app.schemas.kits import KitsInput
                from app.schemas.lupin import LupinInput
                contract = KitsInput if kind == "kits" else LupinInput
                values = {key: previous[key] for key in contract.model_fields
                    if key in previous and key not in {"pricing", "businessParking", "poNumber"}}
                values["attachmentIds"] = [f["id"] for f in previous["attachments"]]
                if kind == "lupin" and not values["attachmentIds"]:
                    raise ImmError("A verified attachment is required before approval.", 422, "order_approval")
                # Retained historical identities remain valid, but revoked or
                # unverified file records cannot become new approval evidence.
                service.resolved(db, current, keys, contract.model_validate(values), previous)
            snapshot = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            if decision == "reject":
                from app.schemas.order_approval import OrderRejection
                body_reason = OrderRejection.model_validate(body.model_dump()).reason
            else:
                body_reason = None
            record_decision(snapshot, current, decision, row.version + 1, body_reason)
            snapshot["status"] = row.status = "In process" if decision == "approve" else "Rejected"
            row.version += 1
            row.updated_by, row.updated_at = current.user.id, utcnow()
            row.snapshot_ciphertext = service.seal(keys, "orders", row.id, snapshot)
            db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                action=f"{kind}_{'approved' if decision == 'approve' else 'rejected'}", resource_type=f"{kind}_order", resource_id=row.id,
                outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
            db.flush()
            return service.project(keys, row)
        return service.idempotent(db, current, keys, body.idempotencyKey,
            {"operation": decision, "id": str(identity), "body": body.model_dump(mode="json")}, write)
    return service.transaction(db, actor, work, action="edit")


def resubmit(db, actor, identity, body, kind):
    from app.services import kits, spt, lupin, immunotherapy
    from app.services.mr_orders import scope_identity
    from app.db.models import AuditEvent
    service = {"kits": kits, "spt": spt, "lupin": lupin, "immunotherapy": immunotherapy}[kind]

    def work(current, keys):
        if current.role != "mr" or not scope_identity(db):
            raise ImmError("Only the owning MR can resubmit a rejected order.", 403, "access_denied")

        def write():
            row = service.find(db, identity)
            previous = service.project(keys, row)
            if row.version != body.expected_version:
                raise ImmError("Order changed. Your draft is preserved.", 409, "order_stale")
            if previous["status"] != "Rejected" or not editable(kind, previous) or not previous.get("correctionSaved"):
                raise ImmError("Save corrections to this rejected order before explicitly resubmitting.", 409, "order_resubmit")
            from app.schemas.immunotherapy import ImmInput
            from app.schemas.spt import SptInput
            from app.schemas.lupin import LupinInput
            from app.schemas.kits import KitsInput
            contract = {"immunotherapy": ImmInput, "spt": SptInput, "lupin": LupinInput, "kits": KitsInput}[kind]
            target = "Saved" if kind == "spt" else "Confirmed"
            values = {k: previous[k] for k in contract.model_fields if k in previous
                      and k not in {"pricing", "businessParking", "poNumber"}}
            values["status"] = target
            if kind == "spt":
                values["patients"] = [{k: p[k] for k in ("id", "source", "amount")} for p in previous["patients"]]
            else:
                values["attachmentIds"] = [f["id"] for f in previous["attachments"]]
            if kind == "immunotherapy":
                values = imm_values(previous)
                values["status"] = target
                values["poNumber"] = None
                values["groups"] = [{**g, "mrp": None, "items": [{k: v for k, v in i.items() if k != "allergen"} | {"rate": None} for i in g["items"]]} for g in previous["groups"]]
            submission = contract.model_validate(values)
            # Validate with the normal ownership, reference and verified-file rules,
            # using a pending validation snapshot only; no ordinary status bypass.
            validation_previous = {**previous, "status": target, "approval": None, "rejection": None, "reviewDecision": None}
            if kind == "immunotherapy":
                db.info["imm_actor"] = current.user.id
                service.resolved(db, submission, validation_previous)
            elif kind == "spt":
                service.resolve(db, keys, submission, validation_previous, row.date)
            else:
                service.resolved(db, current, keys, submission, validation_previous)
            if kind == "lupin" and not previous["attachments"]:
                raise ImmError("A verified attachment is required.", 422, "order_resubmit")
            snapshot = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            history = list(snapshot.get("reviewHistory", []))
            if not history and snapshot.get("rejection"):
                history.append({"decision": "reject", "legacy": True, **snapshot["rejection"]})
            history.append({"decision": "resubmit", "actor": str(current.user.id), "at": utcnow().isoformat(), "version": row.version + 1})
            snapshot.update(status=target, approval=None, rejection=None, reviewDecision=None,
                            correctionSaved=False, reviewHistory=history)
            row.status = target
            row.version += 1
            row.updated_by, row.updated_at = current.user.id, utcnow()
            row.snapshot_ciphertext = service.seal(keys, "orders", row.id, snapshot)
            db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id, action=f"{kind}_resubmitted",
                resource_type=f"{kind}_order", resource_id=row.id, outcome="success",
                request_id=db.info.get("request_id"), created_at=utcnow()))
            db.flush()
            return service.project(keys, row)
        return service.idempotent(db, current, keys, body.idempotencyKey,
            {"operation": "resubmit", "id": str(identity), "body": body.model_dump(mode="json")}, write)
    return service.transaction(db, actor, work, action="edit")
