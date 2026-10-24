"""Server-owned approval evidence inside existing encrypted order snapshots.

No schema backfill: historical status is retained, never synthesized as evidence.
All callers run within the service transaction and hold the order row lock.
"""
from app.core.security import utcnow
from app.services.immunotherapy import ImmError


def editable(kind, previous):
    if not previous or previous.get("approval"):
        return previous is None
    pending = {"Draft", "Saved"} if kind == "spt" else {"Confirmed"}
    return previous["status"] in pending and not previous.get("reviewDecision")


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
    elif previous and previous["status"] == "Saved" and body.status != "Saved":
        raise ImmError("Submitted orders cannot return to Draft.", 409, "order_edit_closed")
    if kind == "lupin" and previous:
        retained = {f["id"] for f in previous["attachments"]}
        if not retained.issubset(set(map(str, body.attachmentIds))):
            raise ImmError("Saved attachments must be retained.", 403, "mr_order_attachment")


def evidence(actor):
    return {"approvedBy": str(actor.user.id), "approvedAt": utcnow().isoformat()}


def preserve(actor, kind, data, previous):
    data["approval"] = previous.get("approval") if previous else None
    # Lupin already has an Approved status. Record only a real new transition.
    if kind == "lupin" and data["status"] == "Approved" and (not previous or previous["status"] != "Approved"):
        data["approval"] = evidence(actor)


def approve(db, actor, identity, body, kind):
    from app.services import kits, spt, lupin
    from app.services.capability_policy import is_super_admin
    from app.db.models import AuditEvent
    service = {"kits": kits, "spt": spt, "lupin": lupin}[kind]
    def work(current, keys):
        if current.role == "mr" or (kind == "kits" and not is_super_admin(current)):
            raise ImmError("Admin approval access is required.", 403, "access_denied")
        def write():
            row = service.find(db, identity)
            previous = service.project(keys, row)
            if row.version != body.expected_version:
                raise ImmError("Order changed. Reopen the saved order before approving.", 409, "order_stale")
            if not editable(kind, previous) or (kind == "spt" and row.status != "Saved"):
                raise ImmError("Only a complete submitted pending order can be approved.", 409, "order_approval")
            # Validate the complete saved submission, not Admin-supplied replacements.
            if kind == "spt":
                from app.schemas.spt import SptInput
                SptInput.model_validate({key: previous[key] for key in ("doctorId", "mrId", "patients", "remarks", "status")}
                    | {"patients": [{k: p[k] for k in ("id", "source", "amount")} for p in previous["patients"]]})
            else:
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
            snapshot["approval"] = evidence(current)
            if kind == "lupin":
                snapshot["status"] = row.status = "Approved"
            row.version += 1
            row.updated_by, row.updated_at = current.user.id, utcnow()
            row.snapshot_ciphertext = service.seal(keys, "orders", row.id, snapshot)
            db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                action=f"{kind}_approved", resource_type=f"{kind}_order", resource_id=row.id,
                outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
            db.flush()
            return service.project(keys, row)
        return service.idempotent(db, current, keys, body.idempotencyKey,
            {"operation": "approve", "id": str(identity), "body": body.model_dump(mode="json")}, write)
    return service.transaction(db, actor, work, action="edit")
