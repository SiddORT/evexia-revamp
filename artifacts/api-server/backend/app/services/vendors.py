from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.vendor_models import Vendor
from app.services.zones import label
from app.services.auth import revalidate_identity
from app.schemas.vendors import BUSINESS_FIELDS


class VendorError(Exception):
    def __init__(self, message="Vendor persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="vendor_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint in ("uq_vendor_live_name", "uq_vendor_live_gst"):
            field = "name" if constraint.endswith("name") else "GST number"
            raise VendorError(f"A non-deleted vendor already uses this {field}. Review current records.",
                              409, "vendor_duplicate") from None
        raise VendorError() from None
    except SQLAlchemyError:
        db.rollback()
        raise VendorError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if not current.user.is_protected_system_admin or current.role != "super_admin" or "admin.access" not in current.permissions:
        raise VendorError("Access denied", 403, "access_denied")
    return current


def projection(db, row):
    return dict(id=row.id, **{field: getattr(row, field) for field in BUSINESS_FIELDS}, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all"):
    result = [Vendor.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(*(getattr(Vendor, field).ilike("%" + term + "%", escape="\\")
                            for field in BUSINESS_FIELDS[:6])))
    if status != "all":
        result.append(Vendor.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(Vendor).where(Vendor.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(Vendor).where(*filters))
        rows = db.scalars(select(Vendor).where(*filters).order_by(
            Vendor.created_at.desc(), Vendor.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="vendor_" + operation,
                      resource_type="vendor", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Vendor(**{field: getattr(body, field) for field in BUSINESS_FIELDS},
                 created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor)
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(Vendor).where(Vendor.id == record_id, Vendor.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise VendorError("Vendor not found. It may have been deleted.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor)
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise VendorError("Vendor changed. Your draft is not saved. Reload current details or discard explicitly.",
                              409, "vendor_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                for field in BUSINESS_FIELDS:
                    setattr(row, field, getattr(body, field))
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
