from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.headquarter_models import Headquarter, normalized_name
from app.schemas.headquarters import abbreviation
from app.services.zones import label
from app.services.master_policy import authorize_master


class HeadquarterError(Exception):
    def __init__(self, message="Headquarter persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="headquarter_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_headquarter_live_name":
            raise HeadquarterError("A non-deleted headquarter already uses this name. Review current records.",
                                   409, "headquarter_duplicate") from None
        raise HeadquarterError() from None
    except SQLAlchemyError:
        db.rollback()
        raise HeadquarterError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, action=None):
    return authorize_master(db, actor, "headquarter", action, error=HeadquarterError)


def projection(db, row):
    return dict(id=row.id, name=row.name, state_code=row.state_code, status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all"):
    result = [Headquarter.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(Headquarter.name.ilike("%" + term + "%", escape="\\"),
                          Headquarter.state_code.ilike("%" + term + "%", escape="\\")))
    if status != "all":
        result.append(Headquarter.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(Headquarter).where(Headquarter.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(Headquarter).where(*filters))
        rows = db.scalars(select(Headquarter).where(*filters).order_by(
            Headquarter.created_at.desc(), Headquarter.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="headquarter_" + operation,
                      resource_type="headquarter", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Headquarter(name=body.name, state_code=body.state_code or abbreviation(body.name), status=body.status,
                      created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
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
    row = db.scalar(select(Headquarter).where(Headquarter.id == record_id, Headquarter.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise HeadquarterError("Headquarter not found. It may have been deleted.", 404, "not_found")
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
            raise HeadquarterError("Headquarter changed. Your draft is not saved. Review current details before retrying.",
                                   409, "headquarter_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                row.name = body.name
                if body.state_code is not None:
                    row.state_code = body.state_code
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
