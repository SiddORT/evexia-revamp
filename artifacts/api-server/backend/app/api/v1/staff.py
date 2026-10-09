import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.staff import StaffCreated, StaffEdit, StaffFields, StaffPage, StaffResponse, StaffStatus, StaffSearch, StaffSearchPage, StaffAccess, StaffDeletion
from app.services.auth import Identity
from app.services import staff as service

router = APIRouter(prefix="/admin/staff", tags=["staff management"])
manager = require_permissions("staff.manage")


@router.get("", response_model=StaffPage)
def list_staff(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=10000),
               actor: Identity = Depends(manager), db: Session = Depends(get_db),
               settings: Settings = Depends(get_settings)):
    return service.listing(db, actor, settings, limit, offset)


@router.post("", response_model=StaffCreated, status_code=201)
def create_staff(body: StaffFields, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.create(db, actor, body, settings)


@router.get("/{staff_id}", response_model=StaffResponse)
def get_staff(staff_id: uuid.UUID, actor: Identity = Depends(manager),
              db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.detail(db, actor, settings, staff_id)


@router.post("/search", response_model=StaffSearchPage)
def search_staff(body: StaffSearch, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Bounded directory scan. Search terms belong in the body, never a URL."""
    return service.search(db, actor, settings, body)


@router.post("/{staff_id}/edit", response_model=StaffResponse)
def edit_staff(staff_id: uuid.UUID, body: StaffEdit, actor: Identity = Depends(manager),
               db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.edit(db, actor, settings, staff_id, body)


@router.post("/{staff_id}/status", response_model=StaffResponse)
def status_staff(staff_id: uuid.UUID, body: StaffStatus, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.edit(db, actor, settings, staff_id, body, status_only=True)


@router.post("/{staff_id}/access", response_model=StaffResponse, operation_id="setStaffWorkspaceAccess")
def access_staff(staff_id: uuid.UUID, body: StaffAccess, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.access(db, actor, settings, staff_id, body)


@router.post("/{staff_id}/delete", response_model=StaffResponse, operation_id="deleteStaff")
def delete_staff(staff_id: uuid.UUID, body: StaffDeletion, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.delete(db, actor, settings, staff_id, body)
