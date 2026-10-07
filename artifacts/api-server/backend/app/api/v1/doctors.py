import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import require_permissions
from app.api.v1.designations import read_file, UPLOAD
from app.api.v1.mrs import BINARY
from app.db.session import get_db
from app.schemas.doctors import (
    DoctorFields, DoctorEdit, DoctorStatus, DoctorContact, DoctorBulk, DoctorResponse,
    DoctorPage, DoctorChoices, DoctorFilters, DoctorReview, DoctorImportResult,
)
from app.services import doctors, doctor_transfer, mrs
from app.services.designations import DesignationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/doctors", tags=["Doctor Master"])
manager = require_permissions("admin.access")
Reference = str


def reference(value):
    if not value or value == "missing":
        return value
    try:
        return uuid.UUID(value)
    except ValueError:
        raise doctors.DoctorError("Choose a valid server assignment filter.", 422, "doctor_filter") from None


@router.get("", response_model=DoctorPage, operation_id="listDoctorDirectory")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            zone_id: str = Query("", max_length=36), mr_id: str = Query("", max_length=36), state: str = Query("", max_length=100),
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.listing(db, actor, query, status, reference(zone_id), reference(mr_id), state, limit, offset)


@router.post("", response_model=DoctorResponse, status_code=201, operation_id="createDoctorDirectory")
def create(body: DoctorFields, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.create(db, actor, body)


@router.get("/references", response_model=DoctorChoices, operation_id="listDoctorMRChoices")
def references(query: str = Query("", max_length=200), limit: int = Query(100, ge=1, le=100),
               offset: int = Query(0, ge=0, le=1000000), include_saved: uuid.UUID | None = None,
               actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.choices(db, actor, query, limit, offset, include_saved)


@router.get("/filters", response_model=DoctorFilters, operation_id="getDoctorFilterChoices")
def filters(actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.filters(db, actor)


@router.post("/bulk", response_model=list[DoctorResponse], operation_id="bulkDoctorDirectory")
def bulk(body: DoctorBulk, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.bulk(db, actor, body)


def file_response(db, actor, data, format, initiation_id, sample=False):
    evidence = server_record(db, actor, initiation_id, "doctor", "template" if sample else "export", format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-doctor-{"sample" if sample else "master"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/sample", operation_id="downloadDoctorSample", responses=BINARY)
def sample(format: Literal["csv", "xlsx"] = "csv", initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation"),
           actor=Depends(manager), db: Session = Depends(get_db)):
    def check():
        mrs.authorize(db, actor)
        db.commit()
    doctors.transaction(db, check)
    return file_response(db, actor, doctor_transfer.sample(format), format, initiation_id, True)


@router.get("/export", operation_id="exportDoctorDirectory", responses=BINARY)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           zone_id: str = Query("", max_length=36), mr_id: str = Query("", max_length=36), state: str = Query("", max_length=100),
           format: Literal["csv", "xlsx"] = "csv", initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation"),
           actor=Depends(manager), db: Session = Depends(get_db)):
    data = doctor_transfer.export(db, actor, query, status, reference(zone_id), reference(mr_id), state, format)
    return file_response(db, actor, data, format, initiation_id)


async def upload(request):
    try:
        return await read_file(request)
    except DesignationError as exc:
        raise doctors.DoctorError(exc.message, exc.status, "doctor_invalid_file") from None


@router.post("/import/review", response_model=DoctorReview, operation_id="reviewDoctorImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    data = await upload(request)
    return await run_in_threadpool(doctor_transfer.transfer, db, actor, data, filename)


@router.post("/import/commit", response_model=DoctorImportResult, operation_id="commitDoctorImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise doctors.DoctorError("Explicit confirmation is required.", 422, "doctor_confirmation_required")
    data = await upload(request)
    return await run_in_threadpool(doctor_transfer.transfer, db, actor, data, filename, True, digest)


@router.get("/{doctor_id}", response_model=DoctorResponse, operation_id="getDoctorDirectory")
def detail(doctor_id: uuid.UUID, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.detail(db, actor, doctor_id)


@router.post("/{doctor_id}/edit", response_model=DoctorResponse, operation_id="editDoctorDirectory")
def edit(doctor_id: uuid.UUID, body: DoctorEdit, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.mutate(db, actor, doctor_id, body, "edit")


@router.post("/{doctor_id}/status", response_model=DoctorResponse, operation_id="setDoctorDirectoryStatus")
def status(doctor_id: uuid.UUID, body: DoctorStatus, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.mutate(db, actor, doctor_id, body, "status")


@router.post("/{doctor_id}/contact", response_model=DoctorResponse, operation_id="setDoctorContactRequirement")
def contact(doctor_id: uuid.UUID, body: DoctorContact, actor=Depends(manager), db: Session = Depends(get_db)):
    return doctors.mutate(db, actor, doctor_id, body, "contact")
