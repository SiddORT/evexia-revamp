"""Record-once metadata in each family's encrypted snapshot and retry journal."""
import uuid
from app.core.security import utcnow
from app.services.capability_policy import allowed, is_super_admin


def permitted(actor, kind):
    return actor.role != "mr" and (
        is_super_admin(actor) if kind in {"kits", "lupin"} else allowed(actor, kind, "edit"))


def eligible(row, saved):
    """Require genuine approval evidence AND a compatible saved lifecycle."""
    from app.services.order_lifecycle import status
    approval = saved.get("approval")
    if not isinstance(approval, dict) or saved.get("rejection") or saved.get("reviewDecision") == "Rejected":
        return False
    try:
        from datetime import datetime
        uuid.UUID(approval["approvedBy"])
        stamp = datetime.fromisoformat(approval["approvedAt"].replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return False
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
    stages = {"In process", "Shipped", "Delivered"}
    return status(row.status) in stages and status(saved.get("status")) == status(row.status)


def projection(row, saved):
    # Internal projection only. Authorization is re-evaluated before transport.
    return {"irnCanRecord": eligible(row, saved) and "irn" not in saved}


def expose(actor, kind, value):
    """No IRN, attribution or capability leaks to MR/non-approving staff."""
    if isinstance(value, list):
        return [expose(actor, kind, child) for child in value]
    if not isinstance(value, dict):
        return value
    result = {key: expose(actor, kind, child) for key, child in value.items()
              if key not in {"irn", "irnCanRecord"}}
    if {"id", "number", "version", "status"}.issubset(value) and permitted(actor, kind):
        result["irnCanRecord"] = value.get("irnCanRecord", False)
        if value.get("irn"):
            result["irn"] = {key: value["irn"][key]
                             for key in ("number", "recordedAt", "recordedBy", "recordVersion")}
    return result


def record(db, actor, identity, body, kind):
    from app.db.models import AuditEvent
    from app.services import kits, spt, lupin, immunotherapy
    from app.services.immunotherapy import ImmError
    source = {"kits": kits, "spt": spt, "lupin": lupin, "immunotherapy": immunotherapy}[kind]

    def work(current, keys):
        # Revalidated under the same policy/identity locks as approval. This
        # precedes retry recovery too; a removed grant cannot recover metadata.
        if not permitted(current, kind):
            raise ImmError("Order approval access is required.", 403, "access_denied")

        def write():
            row = source.find(db, identity)  # SELECT FOR UPDATE
            saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            if row.version != body.expected_version:
                raise ImmError("The saved order changed. Refresh before recording an IRN.", 409, "order_irn_stale")
            if "irn" in saved:
                raise ImmError("An IRN is already recorded. Replacement and clearing are not supported.", 409, "order_irn_recorded")
            if not eligible(row, saved):
                raise ImmError("Only a currently approved, valid order accepts an IRN.", 409, "order_irn_ineligible")
            now = utcnow()
            saved["irn"] = dict(number=body.number, recordedBy=str(current.user.id),
                                recordedAt=now.isoformat(), recordVersion=row.version + 1)
            row.version += 1
            row.updated_by, row.updated_at = current.user.id, now
            row.snapshot_ciphertext = source.seal(keys, "orders", row.id, saved)
            db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                action=f"{kind}_irn_recorded", resource_type=f"{kind}_order", resource_id=row.id,
                outcome="success", request_id=db.info.get("request_id"), created_at=now))
            db.flush()
            return source.project(keys, row)

        # Exact retries recover before checking a now-stale expected version.
        # Existing actor/payload-bound encrypted journals return current saved
        # projections and never run write() twice, emit events or bump versions.
        return source.idempotent(db, current, keys, body.idempotencyKey,
            {"operation": "record_irn", "id": str(identity), "body": body.model_dump(mode="json")}, write)

    return source.transaction(db, actor, work, action=None if kind in {"kits", "lupin"} else "edit")
