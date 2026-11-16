"""Server-owned reference authority, inside each order's authenticated snapshot.

No invoice counter, document, tax event or original historical issuance is implied.
Writers hold the existing financial/identity locks and source order row lock.
"""
import re
import uuid
from datetime import date, datetime

KINDS = {"immunotherapy": "IT", "kits": "Kit", "spt": "SPT", "lupin": "Lupin"}
PREFIXES = {"IT": "IT", "Kit": "kit", "SPT": "spt", "Lupin": "lup"}
KEY = "invoiceAuthority"
APPROVED_STAGES = {"Approved", "In process", "Shipped", "Delivered", "Returned"}


def reference(kind, number, order_date):
    """Use the complete saved numeric lexeme, never int formatting or a sequence."""
    if kind not in PREFIXES or not isinstance(number, str) or type(order_date) is not date:
        raise ValueError("Unsupported saved invoice identity")
    match = re.fullmatch(re.escape(PREFIXES[kind]) + r"-([0-9]{1,20})", number)
    if not match or not any(char != "0" for char in match[1]):
        raise ValueError("Malformed saved order number; explicit review required")
    start = order_date.year if order_date.month >= 4 else order_date.year - 1
    if not 1000 <= start <= 9998:
        raise ValueError("Unsupported saved financial year")
    return f"{start:04d}-{(start + 1) % 100:02d}/{match[1]}"


def _stamp(value):
    if not isinstance(value, str):
        raise ValueError("Unreadable reference timestamp")
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Reference timestamp requires a timezone")
    return parsed


def validate(kind, row, saved):
    """Authenticate linkage and derivation; absence is not issuance authority."""
    from app.services.free_kits import is_free
    if kind == "Kit" and is_free(saved):
        raise ValueError("Free kits have no financial invoice reference")
    authority = saved.get(KEY)
    if not isinstance(authority, dict) or set(authority) != {
        "schema", "kind", "orderId", "orderNumber", "orderDate", "reference",
        "provenance", "recordedAt", "approvalVersion",
    }:
        raise ValueError("Saved invoice reference is unavailable")
    if (authority["schema"] != "order_invoice_reference_v1"
            or authority["kind"] != kind or authority["orderId"] != str(row.id)
            or authority["orderNumber"] != row.number
            or authority["orderDate"] != row.date.isoformat()
            or authority["reference"] != reference(kind, row.number, row.date)):
        raise ValueError("Saved invoice reference conflicts with its order")
    _stamp(authority["recordedAt"])
    if authority["provenance"] == "approval":
        version = authority["approvalVersion"]
        if type(version) is not int or not 2 <= version <= row.version:
            raise ValueError("Unreadable reference approval version")
    elif authority["provenance"] == "historical_adoption":
        if authority["approvalVersion"] is not None:
            raise ValueError("Historical adoption cannot invent an approval version")
    else:
        raise ValueError("Unsupported reference provenance")
    return authority["reference"]


def saved_reference(kind, row, saved):
    """Accounts remain readable/revertible when new-credit authority is absent."""
    try:
        return validate(kind, row, saved)
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _authority(kind, row, *, provenance, recorded_at, approval_version):
    return dict(schema="order_invoice_reference_v1", kind=kind, orderId=str(row.id),
                orderNumber=row.number, orderDate=row.date.isoformat(),
                reference=reference(kind, row.number, row.date), provenance=provenance,
                recordedAt=recorded_at, approvalVersion=approval_version)


def assign(kind, row, snapshot, *, recorded_at):
    """Only the successful explicit approval calls this, before its commit."""
    from app.services.free_kits import is_free
    if kind == "Kit" and is_free(snapshot):
        return
    from app.services.immunotherapy import ImmError
    try:
        if KEY in snapshot:
            # Never replace even malformed existing authority with a new value.
            validate(kind, row, snapshot)
            return
        snapshot[KEY] = _authority(kind, row, provenance="approval",
                                   recorded_at=recorded_at, approval_version=row.version + 1)
    except (ValueError, KeyError, TypeError, AttributeError):
        raise ImmError("The saved order date/number or invoice reference requires review before approval.",
                       409, "order_invoice_unavailable") from None


def public_snapshot(saved):
    """Internal evidence is not an ordinary order field or transfer input."""
    return {key: value for key, value in saved.items() if key != KEY}


def preserve(data, saved):
    # Do not normalize/repair unreadable authority during unrelated order edits.
    data.pop(KEY, None)
    if saved is not None and KEY in saved:
        data[KEY] = saved[KEY]


def historical_basis(row, saved):
    """Supported legacy status/evidence only; never fabricate a decision event."""
    from app.services.free_kits import is_free
    if is_free(saved):
        return None
    from app.services.order_lifecycle import status
    if not isinstance(saved, dict):
        raise ValueError("Unreadable saved order")
    state = saved.get("status")
    approval = saved.get("approval")
    if saved.get("rejection") or saved.get("reviewDecision") == "Rejected":
        if row.status in APPROVED_STAGES or approval:
            raise ValueError("Conflicting approval and rejection evidence")
        return None
    if approval is not None:
        if not isinstance(approval, dict):
            raise ValueError("Unreadable approval evidence")
        uuid.UUID(approval["approvedBy"])
        _stamp(approval["approvedAt"])
    if row.status in APPROVED_STAGES:
        if status(state) != status(row.status):
            raise ValueError("Conflicting saved and relational lifecycle states")
        return "saved_approved_stage"
    # Existing lifecycle compatibility explicitly recognizes this old combination.
    if row.status in {"Confirmed", "Saved"} and approval:
        if state not in {row.status, "Approved", "In process"}:
            raise ValueError("Conflicting legacy approved state")
        return "legacy_saved_approval"
    if approval or saved.get("reviewDecision") == "Approved":
        raise ValueError("Unsupported legacy approval evidence")
    return None


def backfill_page(db, actor, kind, *, after=None, limit=100, apply=False):
    """Explicit operator entry point; NOT registered as startup, route or migration.

    One transaction/page, deterministic UUID cursor, at most 500 rows. Default is
    read-only inspection. Repeating any page preserves existing authority. Review
    failures are returned per kind/UUID and never repaired automatically.
    """
    from sqlalchemy import select
    from app.core.security import utcnow
    from app.db.models import AuditEvent
    from app.services import settlements
    from app.services.capability_policy import is_super_admin
    from app.services.directory_inventory import DirectoryCryptoError
    from app.services.shipments import SOURCES

    if kind not in SOURCES or type(limit) is not int or not 1 <= limit <= 500 or type(apply) is not bool:
        raise ValueError("Choose one supported order kind and a page limit from 1 to 500")
    cursor = uuid.UUID(str(after)) if after is not None else None

    def work(current, keys):
        if not is_super_admin(current):
            settlements.fail("Only the protected Super Admin may adopt order invoice references.",
                             403, "access_denied")
        source = SOURCES[kind]
        query = select(source.Order).order_by(source.Order.id)
        if cursor is not None:
            query = query.where(source.Order.id > cursor)
        rows = list(db.scalars(query.limit(limit + 1).with_for_update()))
        results = []
        for row in rows[:limit]:
            item = dict(kind=kind, id=str(row.id))
            adoption = None
            try:
                saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                basis = historical_basis(row, saved)
                if KEY in saved:
                    validate(kind, row, saved)
                    if not basis:
                        raise ValueError("Reference exists without supported approved-state evidence")
                    item["outcome"] = "preserved"
                elif not basis:
                    item["outcome"] = "not_approved"
                else:
                    now = utcnow()
                    authority = _authority(kind, row, provenance="historical_adoption",
                                           recorded_at=now.isoformat(), approval_version=None)
                    item.update(outcome="adopted" if apply else "would_adopt", basis=basis)
                    adoption = (authority, now)
            except (ValueError, KeyError, TypeError, AttributeError, DirectoryCryptoError):
                # Never log decrypted snapshots, names, amounts or arbitrary errors.
                item.update(outcome="review_required",
                            reason="Unreadable or conflicting saved identity, reference or approval evidence.")
            if apply and adoption is not None:
                # Once writing begins, any failure aborts the whole page. Never
                # report review_required after partially mutating an ORM row.
                authority, now = adoption
                saved[KEY] = authority
                row.snapshot_ciphertext = source.seal(keys, "orders", row.id, saved)
                row.version += 1
                row.updated_at, row.updated_by = now, current.user.id
                db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                    action="order_invoice_reference_adopted", resource_type=f"{source.Order.__tablename__}",
                    resource_id=row.id, outcome="success",
                    request_id=db.info.get("request_id"), created_at=now))
            results.append(item)
        if apply:
            db.flush()
        return dict(kind=kind, applied=apply, items=results,
                    nextCursor=str(rows[limit - 1].id) if len(rows) > limit else None)

    return settlements.transaction(db, actor, work)
