"""Allowlisted initiation evidence; no filenames, record references or content."""
import uuid
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import func, select
from app.core.security import utcnow
from app.db.download_models import DownloadLog
from app.services.auth import revalidate_identity, AuthError
from app.services.zone_policy import lock_policy
from app.services.master_policy import MASTERS, master_allowed

MODULES = {
    "zone": "Zone Master", "courier": "Courier Partner Master",
    "storage_location": "Storage Location Master", "mr": "MR Master",
    "doctor": "Doctor Master", "patient": "Patient Master",
    "designation": "Designation Master", "vendor": "Vendor Master",
    "allergen": "Allergen Master", "opening_balance": "Opening Balance Master",
    "headquarter": "Headquarter Master", "product_category": "Product Category Master",
    "sales_target": "Sales Target Master", "staff": "Staff Management",
    "stock_status": "Stock Status", "purchase_received": "Purchase Received",
    "po_invoice": "Purchase Orders", "pr_receipt": "Purchase Received",
    "sessions": "Sessions", "activity": "Activity Logs", "private_attachment": "Private Files",
}
# Metadata combinations represent actual supported actions, not arbitrary extensions.
BROWSER = {
    **{s: {"export": {"CSV"}, "template": {"CSV"}} for s in (
        "designation", "vendor", "allergen", "opening_balance", "headquarter",
        "product_category", "sales_target")},
    "mr": {"export": {"CSV"}, "sample": {"XLSX"}},
    "doctor": {"export": {"CSV"}, "sample": {"XLSX"}},
    "patient": {"export": {"CSV"}, "template": {"CSV"}},
    "zone": {"sample": {"CSV", "XLSX"}},
    "courier": {"sample": {"CSV", "XLSX"}},
    "storage_location": {"template": {"CSV", "XLSX"}},
    "staff": {"export": {"CSV"}},
    "stock_status": {"export": {"CSV"}},
    "purchase_received": {"export": {"CSV"}},
    "po_invoice": {"invoice": {"PDF"}},
    "pr_receipt": {"searchable": {"PDF"}, "image": {"PDF"}},
    "sessions": {"export": {"CSV"}}, "activity": {"export": {"CSV"}},
}
SERVER = {s: {"export": {"CSV", "XLSX"}} for s in ("zone", "courier", "storage_location", "designation", "headquarter", "product_category")}
SERVER["designation"]["template"] = {"CSV", "XLSX"}
SERVER["vendor"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["sales_target"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["headquarter"]["template"] = {"CSV", "XLSX"}
SERVER["mr"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["doctor"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["patient"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["product_category"]["template"] = {"CSV", "XLSX"}
SERVER["allergen"] = {"export": {"CSV", "XLSX"}, "template": {"CSV", "XLSX"}}
SERVER["private_attachment"] = {"attachment": {"PDF"}, "issuance": {"PDF"}}


def label(source, kind):
    if source == "po_invoice":
        return "PO invoice template" if kind == "template" else "PO invoice"
    if source == "pr_receipt":
        return {"searchable": "PR receipt (searchable)", "image": "PR receipt (image-only)",
                "template": "PR receipt template"}[kind]
    if source == "private_attachment":
        return "Private PDF issuance" if kind == "issuance" else "Private PDF attachment"
    return f"{MODULES[source]} {kind}"


def record(db, identity, initiation_id, source, kind, format, provenance="server_prepared"):
    allowed = BROWSER if provenance == "browser_reported" else SERVER
    if format not in allowed.get(source, {}).get(kind, set()):
        raise HTTPException(422, "Unsupported download metadata")
    # Serialize against logout/replacement and across retry requests/tabs.
    resource = "location" if source == "storage_location" else source
    if resource in MASTERS:
        lock_policy(db)
    try:
        verified = revalidate_identity(db, identity, lock=True)
    except AuthError:
        db.rollback()
        raise HTTPException(401, "Authentication required") from None
    # Existing MR private-file flows separately authorize the specific owner
    # object before calling server_record; their evidence policy is unchanged.
    mr_private = (verified.role == "mr" and verified.mr is not None
                  and source == "private_attachment" and provenance == "server_prepared")
    if "admin.access" not in verified.permissions and not mr_private:
        action = ("import" if kind in ("sample", "template")
                  else "export" if kind == "export" and provenance == "server_prepared" else None)
        if (resource not in MASTERS or action is None
                or not master_allowed(verified, resource, action)):
            db.rollback()
            raise HTTPException(403, "Download access denied")
    user = verified.user
    session_id = verified.session_id
    existing = db.scalar(select(DownloadLog).where(
        DownloadLog.session_id == session_id, DownloadLog.initiation_id == initiation_id))
    if existing:
        if (existing.source, existing.kind, existing.format, existing.provenance) != (source, kind, format, provenance):
            db.rollback()
            raise HTTPException(409, "Initiation already used for another download")
        db.commit()
        return {"id": existing.id, "provenance": provenance}
    recent = db.scalar(select(func.count()).select_from(DownloadLog).where(
        DownloadLog.session_id == session_id, DownloadLog.created_at >= utcnow() - timedelta(minutes=1)))
    if recent >= 120:
        db.rollback()
        raise HTTPException(429, "Download limit reached. Retry later; no file was released.")
    row = DownloadLog(actor_id=user.id, session_id=session_id, initiation_id=initiation_id,
                      source=source, kind=kind, format=format, provenance=provenance)
    db.add(row)
    db.commit()  # Acceptance must be durable before any release.
    return {"id": row.id, "provenance": provenance}


def server_record(db, identity, initiation_id, source, kind, format):
    return record(db, identity, initiation_id or uuid.uuid4(), source, kind, format)
