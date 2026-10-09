from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.role_models import CustomRole
from app.services.auth import revalidate_identity
from app.db.staff_models import StaffProfile
from app.services.zone_policy import lock_policy


class RoleError(Exception):
    def __init__(self, message="Role service unavailable", status=503, code="roles_unavailable"):
        self.message, self.status, self.code = message, status, code


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if "roles.manage" not in current.permissions:
        raise RoleError("Access denied", 403, "access_denied")
    return current


def projection(row):
    return dict(id=row.id, name=row.name, description=row.description, version=row.version,
                created_at=row.created_at, updated_at=row.updated_at, permissions=sorted(row.permissions),
                created_by=row.created_by, updated_by=row.updated_by,
                deleted_at=row.deleted_at, deleted_by=row.deleted_by)


def transaction(db, work):
    try:
        return work()
    except IntegrityError as error:
        db.rollback()
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_custom_roles_name":
            raise RoleError("A role with this name already exists", 409, "role_duplicate") from None
        raise RoleError() from None
    except SQLAlchemyError:
        db.rollback()
        raise RoleError() from None
    except Exception:
        db.rollback()
        raise


def listing(db, actor, limit, cursor):
    def work():
        authorize(db, actor)
        query = select(CustomRole).where(CustomRole.deleted_at.is_(None)).order_by(CustomRole.id).limit(limit + 1)
        if cursor is not None:
            query = query.where(CustomRole.id > cursor)
        rows = list(db.scalars(query))
        result = dict(items=[projection(row) for row in rows[:limit]], limit=limit,
                      has_more=len(rows) > limit,
                      next_cursor=rows[limit - 1].id if len(rows) > limit else None)
        db.commit()
        return result
    return transaction(db, work)


def detail(db, actor, role_id):
    def work():
        authorize(db, actor)
        row = db.get(CustomRole, role_id, populate_existing=True)
        if not row or row.deleted_at is not None:
            raise RoleError("Role is unavailable. Choose a current role or explicitly unassign it.", 404, "role_deleted")
        result = projection(row)
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, body, role_id=None, deleting=False, permissions=False):
    def work():
        if deleting or permissions:
            lock_policy(db)
        current = authorize(db, actor)
        if role_id is None:
            row = CustomRole(name=body.name, description=body.description,
                             created_by=current.user.id, updated_by=current.user.id)
            db.add(row)
            action = "role_create"
        else:
            row = db.scalar(select(CustomRole).where(CustomRole.id == role_id)
                            .execution_options(populate_existing=True).with_for_update())
            if not row or row.deleted_at is not None:
                raise RoleError("Role is unavailable. Choose a current role or explicitly unassign it.", 404, "role_deleted")
            if row.version != body.expected_version:
                raise RoleError("Role changed; review current details", 409, "role_stale")
            action = "role_delete" if deleting else "role_permissions" if permissions else "role_update"
            if deleting and db.scalar(select(StaffProfile.id).where(StaffProfile.custom_role_id == row.id).limit(1)):
                raise RoleError("This role is assigned to staff, including retained deleted staff. Explicitly unassign or reassign editable staff; retained deleted-staff links require operator resolution.",
                                409, "role_assigned")
            if not deleting:
                if permissions:
                    row.permissions = list(body.permissions)
                else:
                    row.name, row.description = body.name, body.description
            row.version += 1
            row.updated_at, row.updated_by = utcnow(), current.user.id
            if deleting:
                row.deleted_at, row.deleted_by = row.updated_at, current.user.id
        db.flush()
        result = projection(row)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action=action, resource_type="custom_role", resource_id=row.id,
                         outcome="success", request_id=db.info.get("request_id")))
        try:
            db.commit()
        except IntegrityError:
            raise
        except SQLAlchemyError:
            # A connection can fail after PostgreSQL accepted COMMIT. A retry
            # is not safe until the caller explicitly checks authoritative state.
            raise RoleError("Change outcome could not be confirmed; refresh roles before retrying",
                            503, "role_outcome_unknown") from None
        return result
    return transaction(db, work)
