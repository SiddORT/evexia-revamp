from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.designation_models import Designation, normalized_name
from app.services.zones import label
from app.services.auth import revalidate_identity
from app.schemas.designations import BUSINESS_FIELDS


class DesignationError(Exception):
    def __init__(self, message="Designation persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="designation_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_designation_live_name":
            raise DesignationError("A non-deleted designation already uses this name. Review current records.",
                               409, "designation_duplicate") from None
        raise DesignationError() from None
    except SQLAlchemyError:
        db.rollback()
        raise DesignationError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if not current.user.is_protected_system_admin or current.role != "super_admin" or "admin.access" not in current.permissions:
        raise DesignationError("Access denied", 403, "access_denied")
    return current


def projection(db, row):
    return dict(id=row.id, **{field: getattr(row, field) for field in BUSINESS_FIELDS}, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all"):
    result = [Designation.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(Designation.name.ilike("%" + term + "%", escape="\\"),
                          Designation.shortName.ilike("%" + term + "%", escape="\\")))
    if status != "all":
        result.append(Designation.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(Designation).where(Designation.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(Designation).where(*filters))
        rows = db.scalars(select(Designation).where(*filters).order_by(
            Designation.created_at.desc(), Designation.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="designation_" + operation,
                      resource_type="designation", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Designation(**{field: getattr(body, field) for field in BUSINESS_FIELDS}, created_by=actor.user.id, updated_by=actor.user.id,
                         created_at=now, updated_at=now)
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
    row = db.scalar(select(Designation).where(Designation.id == record_id, Designation.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise DesignationError("Designation not found. It may have been deleted.", 404, "not_found")
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
            raise DesignationError("Designation changed. Your draft is not saved. Review current details before retrying.",
                               409, "designation_stale")
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
