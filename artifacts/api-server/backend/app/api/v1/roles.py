import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.roles import RoleEdit, RoleFields, RolePage, RoleResponse, RoleVersion, RolePermissions
from app.services.auth import Identity
from app.services import roles as service

router = APIRouter(prefix="/admin/roles", tags=["custom roles and master permissions"])
manager = require_permissions("roles.manage")


@router.get("", response_model=RolePage, operation_id="listCustomRoles")
def list_roles(limit: int = Query(50, ge=1, le=100), cursor: uuid.UUID | None = None,
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, limit, cursor)


@router.get("/{role_id}", response_model=RoleResponse, operation_id="getCustomRole")
def get_role(role_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, role_id)


@router.post("", response_model=RoleResponse, status_code=201, operation_id="createCustomRole")
def create_role(body: RoleFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body)


@router.post("/{role_id}/edit", response_model=RoleResponse, operation_id="editCustomRole")
def edit_role(role_id: uuid.UUID, body: RoleEdit,
              actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body, role_id)


@router.post("/{role_id}/delete", response_model=RoleResponse, operation_id="deleteCustomRole")
def delete_role(role_id: uuid.UUID, body: RoleVersion,
                actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    """Version-checked deletion; response contains the removed metadata."""
    return service.mutate(db, actor, body, role_id, deleting=True)


@router.post("/{role_id}/permissions", response_model=RoleResponse, operation_id="saveCustomRolePermissions")
def permissions_role(role_id: uuid.UUID, body: RolePermissions,
                     actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body, role_id, permissions=True)
