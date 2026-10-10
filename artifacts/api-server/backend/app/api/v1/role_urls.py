import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.role_url_models import RoleHostname
from app.db.session import get_db
from app.schemas.role_urls import (
    RoleUrlFields, RoleUrlEdit, RoleUrlVersion, RoleUrlResponse, RoleUrlPage,
    PortalResolution, canonical_hostname,
)
from app.services.auth import Identity, revalidate_identity

router = APIRouter(tags=["portal hostnames"])
manager = require_permissions("admin.access")


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        raise HTTPException(403, "Access denied")
    return current


@router.get("/portal/resolve", response_model=PortalResolution, operation_id="resolvePortalHostname")
def resolve(response: Response, hostname: str = Query(max_length=253), db: Session = Depends(get_db)):
    # Browser supplies location.hostname; proxy headers never decide identity or routing.
    response.headers["Cache-Control"] = "no-store"
    try:
        host = canonical_hostname(hostname)
        if "://" in hostname:
            raise ValueError()
    except ValueError:
        # Local preview hosts are explicitly unmapped, never configurable.
        if hostname in ("localhost", "127.0.0.1", "::1"):
            return {"role": None}
        raise HTTPException(422, "Invalid current hostname") from None
    try:
        role = db.scalar(select(RoleHostname.role).where(RoleHostname.hostname == host, RoleHostname.enabled.is_(True)))
        return {"role": role}
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Portal resolution unavailable") from None


@router.get("/admin/role-urls", response_model=RoleUrlPage, operation_id="listRoleHostnames")
def listing(response: Response, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    try:
        authorize(db, actor)
        result = {"items": [RoleUrlResponse.model_validate(r) for r in db.scalars(select(RoleHostname).order_by(RoleHostname.hostname))]}
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Role URL service unavailable") from None


def mutate(db, actor, body, row_id=None, deleting=False):
    try:
        current = authorize(db, actor)
        if row_id:
            row = db.scalar(select(RoleHostname).where(RoleHostname.id == row_id).execution_options(populate_existing=True).with_for_update())
            if not row:
                raise HTTPException(409, "Mapping was removed; reload and review")
            if row.version != body.version:
                raise HTTPException(409, "Mapping changed; reload and review")
            row.version += 1
            row.updated_at, row.updated_by = utcnow(), current.user.id
            if not deleting:
                row.hostname, row.role, row.enabled = body.hostname, body.role, body.enabled
        else:
            row = RoleHostname(**body.model_dump(), created_by=current.user.id, updated_by=current.user.id)
            db.add(row)
        db.flush()
        result = RoleUrlResponse.model_validate(row)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action="role_url_delete" if deleting else "role_url_update" if row_id else "role_url_create",
                         resource_type="role_hostname", resource_id=row.id, outcome="success",
                         request_id=db.info.get("request_id")))
        if deleting:
            db.delete(row)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Hostname already assigned; reload and review") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Save outcome unconfirmed; reload before retrying") from None
    except Exception:
        db.rollback()
        raise


@router.post("/admin/role-urls", response_model=RoleUrlResponse, status_code=201, operation_id="createRoleHostname")
def create(body: RoleUrlFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body)


@router.post("/admin/role-urls/{row_id}/edit", response_model=RoleUrlResponse, operation_id="editRoleHostname")
def edit(row_id: uuid.UUID, body: RoleUrlEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body, row_id)


@router.post("/admin/role-urls/{row_id}/delete", response_model=RoleUrlResponse, operation_id="deleteRoleHostname")
def remove(row_id: uuid.UUID, body: RoleUrlVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body, row_id, deleting=True)
