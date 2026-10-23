"""Authorized immutable document snapshots. No reads create revisions."""
import logging
import uuid
from sqlalchemy import select, func
from app.core.config import get_settings
from app.db.models import AuditEvent
from app.db.procurement_document_models import ProcurementDocument as Document
from app.db.purchase_order_models import PurchaseOrderAudit
from app.db.purchase_received_models import ReceiptHistory
from app.services.purchase_received_crypto import ReceiptCrypto, PRError

COMPANY = dict(name="EVEXIA LIFE SCIENCES PVT. LTD.",
    address="2nd floor, Laud Mansion, Mumbai - 400 004",
    email="info@evexialifesciences.com", website="www.evexialifesciences.com")


def crypto_for(db):
    engine = db.get_bind().engine
    if engine.echo or any(logging.getLogger(name).isEnabledFor(logging.INFO)
        for name in ("sqlalchemy.engine", "sqlalchemy.engine.Engine")):
        raise PRError("Document storage requires SQL parameter logging to be disabled.")
    return ReceiptCrypto(get_settings())


def context(body):
    value = body.documentContext
    if value is None:
        raise PRError("Document preferences are required. Keep your draft and review again.", 422, "document_context_required")
    return value.model_dump(mode="json")


def po_supplement(db, order, previous=None):
    """Retain historical supplementary details; only new choices use masters."""
    from app.db.vendor_models import Vendor
    old = previous or {}
    vendor = db.get(Vendor, uuid.UUID(order["vendorId"]))
    previous_vendor = old.get("vendor") if old.get("vendorId") == order["vendorId"] else None
    vendor_data = previous_vendor or dict(name=order["vendorName"],
        address=vendor.registeredAddress or "" if vendor else "",
        gstNo=order["taxBasis"]["supplierGstin"])
    retained = {line["productId"]: line for line in old.get("lines", [])}
    lines = []
    for line in order["lines"]:
        # This server catalogue has no authoritative HSN field. Do not invent it
        # from the unrelated browser-local catalogue.
        hsn = retained.get(line["productId"], {}).get("hsnCode", "")
        lines.append({**line, "hsnCode": hsn})
    return {**order, "company": dict(COMPANY), "vendor": vendor_data, "lines": lines}


def latest_row(db, kind, record_id):
    column = Document.po_id if kind == "po" else Document.pr_id
    return db.scalar(select(Document).where(column == record_id).order_by(Document.record_version.desc()).limit(1))


def previous_model(db, kind, record_id, crypto):
    row = latest_row(db, kind, record_id)
    return crypto.open(row.event_id, "document", row.payload_ciphertext)["model"] if row else None


def archive(db, kind, row, event, model, generation, crypto):
    from app.services.zones import label
    payload = dict(**generation, model=model, actor=label(db, event.actor_id),
        generatedAt=event.created_at.isoformat())
    db.add(Document(event_id=event.id, po_id=row.id if kind == "po" else None,
        pr_id=row.id if kind == "pr" else None, record_version=row.version,
        generated_at=event.created_at.isoformat(),
        payload_ciphertext=crypto.seal(event.id, "document", payload)))


def document_data(db, kind, record_id, revision=None):
    crypto = crypto_for(db)
    latest = latest_row(db, kind, record_id)
    column = Document.po_id if kind == "po" else Document.pr_id
    row = latest if revision is None else db.scalar(select(Document).where(column == record_id, Document.record_version == revision))
    if not row:
        raise PRError("No reliable saved document exists for this revision. Legacy layouts were not archived.", 404, "document_unavailable")
    payload = crypto.open(row.event_id, "document", row.payload_ciphertext)
    payload.pop("before", None)
    payload.pop("after", None)
    return {**payload, "revision": row.record_version, "latestRevision": latest.record_version,
        "current": row.event_id == latest.event_id, "generatedAt": row.generated_at, "eventId": str(row.event_id)}


def history_data(db, kind, record_id, limit, offset):
    crypto = crypto_for(db)
    meta = PurchaseOrderAudit if kind == "po" else ReceiptHistory
    column = meta.order_id if kind == "po" else meta.receipt_id
    statement = select(meta, AuditEvent, Document).join(AuditEvent, AuditEvent.id == meta.event_id).outerjoin(
        Document, Document.event_id == meta.event_id).where(column == record_id)
    total = db.scalar(select(func.count()).select_from(meta).where(column == record_id))
    rows = db.execute(statement.order_by(AuditEvent.created_at, AuditEvent.id).limit(limit).offset(offset)).all()
    items = []
    for entry, event, doc in rows:
        if kind == "pr":
            history = crypto.open(event.id, "history", entry.payload_ciphertext)
            before, after = history.get("before"), history.get("receipt")
            # Older PR events have trustworthy preceding snapshots, not templates.
            if before is None and history["action"] != "created":
                previous = db.scalar(select(ReceiptHistory).join(AuditEvent, AuditEvent.id == ReceiptHistory.event_id)
                    .where(ReceiptHistory.receipt_id == record_id, AuditEvent.created_at < event.created_at)
                    .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(1))
                if previous:
                    before = crypto.open(previous.event_id, "history", previous.payload_ciphertext).get("receipt")
            actor, action, summary = history["actor"], history["action"], history["summary"]
        else:
            evidence = crypto.open(event.id, "po-history", entry.payload_ciphertext) if entry.payload_ciphertext else {}
            before, after = evidence.get("before"), evidence.get("after")
            actor, action, summary = entry.actor, entry.action, entry.summary
        preceding = db.scalar(select(Document).where(
            (Document.po_id if kind == "po" else Document.pr_id) == record_id,
            Document.record_version < (doc.record_version if doc else (after or {}).get("version", 1)))
            .order_by(Document.record_version.desc()).limit(1))
        items.append(dict(id=str(event.id), at=event.created_at.isoformat(), actor=actor, action=action,
            summary=summary, before=before, after=after,
            revision=doc.record_version if doc else None,
            previousRevision=preceding.record_version if preceding else None))
    return dict(items=items, total=total, limit=limit, offset=offset)
