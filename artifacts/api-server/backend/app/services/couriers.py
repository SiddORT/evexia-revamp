from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.courier_models import CourierPartner, normalized_name
from app.services.zones import label
from app.services.master_policy import authorize_master


class CourierError(Exception):
    def __init__(self, message="Courier persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="courier_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_courier_live_name":
            raise CourierError("A non-deleted courier partner already uses this name. Review current records.",
                               409, "courier_duplicate") from None
        raise CourierError() from None
    except SQLAlchemyError:
        db.rollback()
        raise CourierError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, action=None):
    return authorize_master(db, actor, "courier", action, error=CourierError)


def projection(db, row):
    return dict(id=row.id, name=row.name, status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all"):
    result = [CourierPartner.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(CourierPartner.name.ilike("%" + term + "%", escape="\\"))
    if status != "all":
        result.append(CourierPartner.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(CourierPartner).where(CourierPartner.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(CourierPartner).where(*filters))
        rows = db.scalars(select(CourierPartner).where(*filters).order_by(
            CourierPartner.created_at.desc(), CourierPartner.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="courier_" + operation,
                      resource_type="courier_partner", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = CourierPartner(name=body.name, status=body.status, created_by=actor.user.id, updated_by=actor.user.id,
                         created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "add")
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(CourierPartner).where(CourierPartner.id == record_id, CourierPartner.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise CourierError("Courier partner not found. It may have been deleted.", 404, "not_found")
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
        current = authorize(db, actor, "delete" if operation == "delete" else "edit")
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise CourierError("Courier partner changed. Your draft is not saved. Review current details before retrying.",
                               409, "courier_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                row.name = body.name
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
