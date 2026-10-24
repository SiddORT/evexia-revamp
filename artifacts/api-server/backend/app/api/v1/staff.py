import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_permissions, require_capability
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.staff import StaffCreated, StaffCreate, StaffEdit, StaffFields, StaffPage, StaffResponse, StaffStatus, StaffSearch, StaffSearchPage, StaffAccess, StaffDeletion
from app.schemas.staff import StaffBusinessRole, StaffBusinessStatus, StaffDirectoryFilters, StaffDesignationChoices, StaffRoleChoices
from app.schemas.staff import StaffAccessPage, StaffAccessSearch, StaffAccessSearchPage, StaffDesignationReferencePage
from app.services.auth import Identity
from app.services import staff as service

router = APIRouter(prefix="/admin/staff", tags=["staff management"])
manager = require_capability("staff")


@router.get("/access-directory", response_model=StaffAccessPage, operation_id="listStaffAccess")
def access_directory(offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100),
                     status: StaffBusinessStatus | None = None, workspace_login_enabled: bool | None = None,
                     actor: Identity = Depends(require_capability("staff_access", "view")),
                     db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.access_directory(db, actor, settings, offset, limit, status, workspace_login_enabled)


@router.post("/access-directory/search", response_model=StaffAccessSearchPage, operation_id="searchStaffAccessDirectory")
def search_access_directory(body: StaffAccessSearch,
                            actor: Identity = Depends(require_capability("staff_access", "view")),
                            db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Read-only bounded search; personal search terms never belong in URLs."""
    return service.search_access_directory(db, actor, settings, body)


@router.get("/designation-references", response_model=StaffDesignationReferencePage, operation_id="getStaffDesignationReferences")
def designation_references(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=10000),
                           actor: Identity = Depends(require_capability("staff", ("add", "edit"))),
                           db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.designation_references(db, actor, settings, query, offset)


@router.get("", response_model=StaffPage)
def list_staff(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=10000),
               status: StaffBusinessStatus | None = None, designation_id: uuid.UUID | None = None,
               role: StaffBusinessRole | None = None,
               actor: Identity = Depends(manager), db: Session = Depends(get_db),
               settings: Settings = Depends(get_settings)):
    return service.listing(db, actor, settings, limit, offset,
                           StaffDirectoryFilters(status=status, designation_id=designation_id, role=role))


@router.get("/filter-designations", response_model=StaffDesignationChoices, operation_id="listStaffFilterDesignations")
def filter_designations(cursor: uuid.UUID | None = None,
                        actor: Identity = Depends(manager), db: Session = Depends(get_db),
                        settings: Settings = Depends(get_settings)):
    return service.filter_designations(db, actor, settings, cursor)


@router.post("", response_model=StaffCreated, status_code=201)
def create_staff(body: StaffCreate, actor: Identity = Depends(require_capability("staff", "add")),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.create(db, actor, body, settings)


@router.get("/role-choices", response_model=StaffRoleChoices, operation_id="listStaffBusinessRoleChoices")
def role_choices(query: str = Query("", max_length=100), offset: int = Query(0, ge=0),
                 include_retained: bool = False, actor: Identity = Depends(manager),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.role_choices(db, actor, settings, query, offset, include_retained)


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
def edit_staff(staff_id: uuid.UUID, body: StaffEdit, actor: Identity = Depends(require_capability("staff", "edit")),
               db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.edit(db, actor, settings, staff_id, body)


@router.post("/{staff_id}/status", response_model=StaffResponse)
def status_staff(staff_id: uuid.UUID, body: StaffStatus, actor: Identity = Depends(require_capability("staff", "status")),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.edit(db, actor, settings, staff_id, body, status_only=True)


@router.post("/{staff_id}/access", response_model=StaffResponse, operation_id="setStaffWorkspaceAccess")
def access_staff(staff_id: uuid.UUID, body: StaffAccess, actor: Identity = Depends(require_permissions("staff.manage")),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.access(db, actor, settings, staff_id, body)


@router.post("/{staff_id}/delete", response_model=StaffResponse, operation_id="deleteStaff")
def delete_staff(staff_id: uuid.UUID, body: StaffDeletion, actor: Identity = Depends(require_capability("staff", "delete")),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return service.delete(db, actor, settings, staff_id, body)
