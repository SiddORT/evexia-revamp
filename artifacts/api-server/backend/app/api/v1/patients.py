import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import master_router, require_master
from app.api.v1.doctors import reference, upload
from app.api.v1.designations import UPLOAD
from app.api.v1.mrs import BINARY
from app.db.session import get_db
from app.schemas.patients import (
    PatientFields, PatientEdit, PatientStatus, PatientDirectoryResponse, PatientPage, PatientDeletion,
    PatientChoices, PatientReview, PatientImportResult, PatientFilterChoices,
)
from app.services import patients, patient_transfer, mrs
from app.services.downloads import server_record
from app.schemas.mrs import PostalResponse
from app.services import mr_postal

router = APIRouter(prefix="/admin/patients", tags=["Patient Master"])
manager = master_router("patient")


@router.get("/postal/{pin}", response_model=PostalResponse, operation_id="lookupPatientPincode")
def postal(pin: str, action: Literal["add", "edit"] = "add",
           actor=Depends(require_master("patient")), db: Session = Depends(get_db)):
    return mr_postal.lookup(db, actor, pin, resource="patient", action=action)


@router.get("", response_model=PatientPage, operation_id="listPatientDirectory")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            zone_id: str = Query("", max_length=36), mr_id: str = Query("", max_length=36),
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            cursor: uuid.UUID | None = None,
            actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.listing(db, actor, query, status, reference(zone_id), reference(mr_id), limit, offset, cursor)


@router.post("", response_model=PatientDirectoryResponse, status_code=201, operation_id="createPatientDirectory")
def create(body: PatientFields, actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.create(db, actor, body)


@router.get("/references", response_model=PatientChoices, operation_id="listPatientDoctorChoices")
def references(query: str = Query("", max_length=200), limit: int = Query(100, ge=1, le=100),
               offset: int = Query(0, ge=0, le=1000000), include_saved: uuid.UUID | None = None,
               cursor: uuid.UUID | None = None,
               actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.choices(db, actor, query, limit, offset, include_saved, cursor)


@router.get("/filters", response_model=PatientFilterChoices, operation_id="getPatientFilterChoices")
def filters(actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.filters(db, actor)


def file_response(db, actor, data, format, initiation_id, sample=False):
    evidence = server_record(db, actor, initiation_id, "patient", "template" if sample else "export", format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-patient-{"sample" if sample else "master"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/sample", operation_id="downloadPatientSample", responses=BINARY)
def sample(format: Literal["csv", "xlsx"] = "csv", initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation"),
           actor=Depends(manager), db: Session = Depends(get_db)):
    def check():
        patients.authorize(db, actor, "import")
        db.commit()
    patients.transaction(db, check)
    return file_response(db, actor, patient_transfer.sample(format), format, initiation_id, True)


@router.get("/export", operation_id="exportPatientDirectory", responses=BINARY)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           zone_id: str = Query("", max_length=36), mr_id: str = Query("", max_length=36),
           format: Literal["csv", "xlsx"] = "csv", initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation"),
           actor=Depends(manager), db: Session = Depends(get_db)):
    data = patient_transfer.export(db, actor, query, status, reference(zone_id), reference(mr_id), format)
    return file_response(db, actor, data, format, initiation_id)


@router.post("/import/review", response_model=PatientReview, operation_id="reviewPatientImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    data = await upload(request)
    return await run_in_threadpool(patient_transfer.transfer, db, actor, data, filename)


@router.post("/import/commit", response_model=PatientImportResult, operation_id="commitPatientImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor=Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise patients.PatientError("Explicit confirmation is required.", 422, "patient_confirmation_required")
    data = await upload(request)
    return await run_in_threadpool(patient_transfer.transfer, db, actor, data, filename, True, digest)


@router.get("/{patient_id}", response_model=PatientDirectoryResponse, operation_id="getPatientDirectory")
def detail(patient_id: uuid.UUID, actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.detail(db, actor, patient_id)


@router.post("/{patient_id}/edit", response_model=PatientDirectoryResponse, operation_id="editPatientDirectory")
def edit(patient_id: uuid.UUID, body: PatientEdit, actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.mutate(db, actor, patient_id, body, "edit")


@router.post("/{patient_id}/status", response_model=PatientDirectoryResponse, operation_id="setPatientDirectoryStatus")
def status(patient_id: uuid.UUID, body: PatientStatus, actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.mutate(db, actor, patient_id, body, "status")


@router.post("/{patient_id}/delete", response_model=PatientDirectoryResponse, operation_id="deletePatientDirectory")
def delete(patient_id: uuid.UUID, body: PatientDeletion, actor=Depends(manager), db: Session = Depends(get_db)):
    return patients.mutate(db, actor, patient_id, body, "delete")
