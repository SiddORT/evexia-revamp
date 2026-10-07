from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.location_models import StorageLocation, normalized_name
from app.services.zones import label
from app.services.auth import revalidate_identity


class LocationError(Exception):
    def __init__(self, message="Location persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="location_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_location_live_name":
            raise LocationError("A non-deleted storage location already uses this name. Review current records.",
                               409, "location_duplicate") from None
        raise LocationError() from None
    except SQLAlchemyError:
        db.rollback()
        raise LocationError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if "admin.access" not in current.permissions:
        raise LocationError("Access denied", 403, "access_denied")
    return current


def projection(db, row):
    return dict(id=row.id, name=row.name, address=row.address, status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all"):
    result = [StorageLocation.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(StorageLocation.name.ilike("%" + term + "%", escape="\\"),
                          StorageLocation.address.ilike("%" + term + "%", escape="\\")))
    if status != "all":
        result.append(StorageLocation.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(StorageLocation).where(StorageLocation.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(StorageLocation).where(*filters))
        rows = db.scalars(select(StorageLocation).where(*filters).order_by(
            StorageLocation.created_at.desc(), StorageLocation.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="location_" + operation,
                      resource_type="storage_location", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = StorageLocation(name=body.name, address=body.address, status=body.status, created_by=actor.user.id, updated_by=actor.user.id,
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
    row = db.scalar(select(StorageLocation).where(StorageLocation.id == record_id, StorageLocation.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise LocationError("Storage location not found. It may have been deleted.", 404, "not_found")
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
            raise LocationError("Storage location changed. Your draft is not saved. Review current details before retrying.",
                               409, "location_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                row.name = body.name
                row.address = body.address
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
