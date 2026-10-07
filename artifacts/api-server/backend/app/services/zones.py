from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.security import utcnow
from app.db.models import AuditEvent, User
from app.db.zone_models import Zone
from app.services.auth import revalidate_identity
from app.services.zone_policy import zone_allowed, lock_policy


class ZoneError(Exception):
    def __init__(self, message="Zone persistence is unavailable. Retry later.", status=503, code="zone_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError:
        db.rollback()
        raise ZoneError("A non-deleted zone already uses this name. Review current records.", 409, "zone_duplicate") from None
    except SQLAlchemyError:
        db.rollback()
        raise ZoneError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, action=None, protected=False):
    lock_policy(db)
    current = revalidate_identity(db, actor, lock=True)
    if zone_allowed(current, action, protected):
        return current
    raise ZoneError("Zone access denied. Ask your administrator for the required Zone permission.", 403, "access_denied")


def label(db, user_id):
    user = db.get(User, user_id)
    # Only the verified system identity can author zones. Never expose email,
    # credentials, staff ciphertext or other directory data.
    return "Super Admin" if user and user.is_protected_system_admin else "Backend user"


def projection(db, row):
    return dict(id=row.id, name=row.name, status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all", deleted=False):
    result = [Zone.deleted_at.is_not(None) if deleted else Zone.deleted_at.is_(None)]
    if query.strip():
        result.append(Zone.name.ilike("%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", escape="\\"))
    if status != "all":
        result.append(Zone.status == status)
    return result


def listing(db, actor, query, status, limit, offset, deleted=False):
    def work():
        authorize(db, actor, protected=deleted)
        filters = predicates(query, status, deleted)
        total = db.scalar(select(func.count()).select_from(Zone).where(*predicates(deleted=deleted)))
        filtered = db.scalar(select(func.count()).select_from(Zone).where(*filters))
        order = Zone.deleted_at if deleted else Zone.created_at
        rows = db.scalars(select(Zone).where(*filters).order_by(order.desc(), Zone.id.desc()).limit(limit).offset(offset))
        items = []
        for row in rows:
            item = projection(db, row)
            if deleted:
                item.update(deletedBy=label(db, row.deleted_by), deletedAt=row.deleted_at)
            items.append(item)
        result = dict(items=items, total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, action):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action=action,
                      resource_type="zone", resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Zone(name=body.name, status=body.status, created_by=actor.user.id, updated_by=actor.user.id,
               created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "zone_create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "zone.add")
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, zone_id):
    row = db.scalar(select(Zone).where(Zone.id == zone_id, Zone.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise ZoneError("Zone not found. It may have been deleted.", 404, "not_found")
    return row


def detail(db, actor, zone_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, zone_id))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, zone_id, body, operation):
    def work():
        current = authorize(db, actor, "zone.delete" if operation == "delete" else "zone.edit")
        row = find(db, zone_id)
        if row.version != body.expected_version:
            raise ZoneError("Zone changed. Your draft is not saved. Refresh and review current details before retrying.", 409, "zone_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                row.name = body.name
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, "zone_" + operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def restore(db, actor, zone_id, body):
    def work():
        current = authorize(db, actor, protected=True)
        row = db.scalar(select(Zone).where(Zone.id == zone_id)
                        .execution_options(populate_existing=True).with_for_update())
        if not row:
            raise ZoneError("Deleted zone not found.", 404, "not_found")
        if row.version != body.expected_version or row.deleted_at is None:
            raise ZoneError("Zone changed or was already restored. Cancel and refresh deleted zones before retrying.",
                            409, "zone_stale")
        # Clearing the tombstone re-enters the existing partial unique index.
        # It arbitrates concurrent create/restore races for active AND inactive names.
        row.deleted_at, row.deleted_by = None, None
        row.version += 1
        row.updated_at, row.updated_by = utcnow(), current.user.id
        audit(db, current, row, "zone_restore")
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
