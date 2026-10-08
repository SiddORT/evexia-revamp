import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import require_permissions, master_router, require_master
from app.api.v1.designations import read_file as read_master_file, UPLOAD
from app.db.session import get_db
from app.schemas.mrs import (
    MRCreate, MREdit, MRVersion, MRStatus, MRContact, MRDirectoryResponse, MRCreated, MRPage,
    MRChoices, MRUsername, MRReview, MRImportResult, PostalResponse,
    MRDoctorPage,
)
from app.services import mrs, mr_transfer, mr_postal
from app.services.designations import DesignationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/mrs", tags=["MR Master"])
manager = master_router("mr")
provisioner = require_permissions("admin.access", "domain.provision")


@router.get("", response_model=MRPage, operation_id="listMRDirectory")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            zone_id: uuid.UUID | None = None, hq_id: uuid.UUID | None = None,
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.listing(db, actor, query, status, zone_id, hq_id, limit, offset)


@router.post("", response_model=MRCreated, status_code=201, operation_id="createMRDirectory")
def create(body: MRCreate, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.create(db, actor, body)


@router.get("/references", response_model=MRChoices, operation_id="listMRReferenceChoices")
def references(kind: Literal["zones", "headquarters", "managers", "designations"],
               query: str = Query("", max_length=200), limit: int = Query(100, ge=1, le=100),
               offset: int = Query(0, ge=0, le=1000000), include_saved: uuid.UUID | None = None,
               actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.references(db, actor, kind, query, limit, offset, include_saved)


@router.get("/username", response_model=MRUsername, operation_id="generateMRUsername")
def username(actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.username(db, actor)


@router.get("/postal/{pin}", response_model=PostalResponse, operation_id="lookupMRPincode")
def postal(pin: str, action: Literal["add", "edit"] = "add",
           actor=Depends(require_master("mr")), db: Session = Depends(get_db)):
    return mr_postal.lookup(db, actor, pin, resource="mr", action=action)


BINARY = {200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}},
}}}


def file_response(db, actor, data, format, initiation_id, sample=False):
    evidence = server_record(db, actor, initiation_id, "mr", "template" if sample else "export", format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-mr-{"template" if sample else "master"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/sample", operation_id="downloadMRSample", responses=BINARY)
def sample(format: Literal["csv", "xlsx"] = "csv", actor=Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    def check():
        mrs.authorize(db, actor, action="import")
        db.commit()
    mrs.transaction(db, check)
    return file_response(db, actor, mr_transfer.sample(format), format, initiation_id, True)


@router.get("/export", operation_id="exportMRDirectory", responses=BINARY)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           zone_id: uuid.UUID | None = None, hq_id: uuid.UUID | None = None,
           format: Literal["csv", "xlsx"] = "csv", actor=Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    data = mr_transfer.export(db, actor, query, status, zone_id, hq_id, format)
    return file_response(db, actor, data, format, initiation_id)


async def read_file(request):
    try:
        return await read_master_file(request)
    except DesignationError as exc:
        raise mrs.MRError(exc.message, exc.status, "mr_invalid_file") from None


@router.post("/import/review", response_model=MRReview, operation_id="reviewMRImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    data = await read_file(request)
    return await run_in_threadpool(mr_transfer.transfer, db, actor, data, filename)


@router.post("/import/commit", response_model=MRImportResult, operation_id="commitMRImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise mrs.MRError("Explicit confirmation is required.", 422, "mr_confirmation_required")
    data = await read_file(request)
    return await run_in_threadpool(mr_transfer.transfer, db, actor, data, filename, True, digest)


@router.get("/{mr_id}", response_model=MRDirectoryResponse, operation_id="getMRDirectory")
def detail(mr_id: uuid.UUID, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.detail(db, actor, mr_id)


@router.get("/{mr_id}/doctors", response_model=MRDoctorPage, operation_id="listMRAssociatedDoctorChoices")
def associated_doctors(mr_id: uuid.UUID, limit: int = Query(10, ge=1, le=100),
                       offset: int = Query(0, ge=0, le=1000000),
                       actor=Depends(require_master("mr")), db: Session = Depends(get_db)):
    return mrs.associated_doctors(db, actor, mr_id, limit, offset)


@router.get("/account/{username}", response_model=MRDirectoryResponse, operation_id="resolveMRAccount")
def resolve_account(username: str = Path(pattern=r"^[a-z][a-z0-9._-]{2,31}$"),
                    actor=Depends(require_master("mr", "add")), db: Session = Depends(get_db)):
    return mrs.resolve_account(db, actor, username)


@router.post("/{mr_id}/edit", response_model=MRDirectoryResponse, operation_id="editMRDirectory")
def edit(mr_id: uuid.UUID, body: MREdit, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.mutate(db, actor, mr_id, body, "edit")


@router.post("/{mr_id}/status", response_model=MRDirectoryResponse, operation_id="setMRDirectoryStatus")
def status(mr_id: uuid.UUID, body: MRStatus, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.mutate(db, actor, mr_id, body, "status")


@router.post("/{mr_id}/contact", response_model=MRDirectoryResponse, operation_id="setMRContactRequirement")
def contact(mr_id: uuid.UUID, body: MRContact, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.mutate(db, actor, mr_id, body, "contact")


@router.post("/{mr_id}/delete", response_model=MRDirectoryResponse, operation_id="deleteMRDirectory")
def delete(mr_id: uuid.UUID, body: MRVersion, actor=Depends(manager), db: Session = Depends(get_db)):
    return mrs.mutate(db, actor, mr_id, body, "delete")


@router.post("/{mr_id}/reset", response_model=MRCreated, operation_id="resetMRPassword")
def reset(mr_id: uuid.UUID, body: MRVersion, actor=Depends(provisioner), db: Session = Depends(get_db)):
    return mrs.mutate(db, actor, mr_id, body, "reset")
