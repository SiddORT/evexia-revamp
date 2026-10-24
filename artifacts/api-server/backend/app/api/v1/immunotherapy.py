"""Shared saved orders; MRs are restricted to their verified saved assignment.

The existing Admin API paths remain stable. MR listings, exports, references,
direct reads/edits and reviewed imports enforce ownership in the service before
search/decryption. Patient registration/language assistance is workflow-specific.
"""
import uuid
import asyncio
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from app.api.deps import current_identity, operation_router
from app.db.session import get_db
from app.schemas.immunotherapy import ImmWrite, ImmImport, ImmRecord, ImmPage, Status, ImmReferencePage, ImmUploadPolicy, ImmImportReview, ImmImportResult
from app.services import immunotherapy as service
from app.core.config import get_settings
from app.schemas.files import UploadRequest, FileResponse
from app.services import files as file_service
from app.services.file_policy import FileError
from app.api.v1.files import storage_dependency, order_upload_operation
from app.schemas.patients import PatientFields, PatientDirectoryResponse, PatientLanguageChoices
from app.services import patients as patient_service

router = APIRouter(prefix="/admin/immunotherapy-orders", tags=["immunotherapy"],
    dependencies=[Depends(operation_router("immunotherapy", {
        "listing": None, "detail": None, "references": None, "export": "export",
        "review": "import", "commit": "import", "create": "add", "edit": "edit",
        "policy": "upload_attachment", "prescription": "upload_attachment",
    }, allow_mr=True))])
MULTIPART = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {"file": {"type": "string", "format": "binary"}},
                }
            }
        },
    }
}


@router.post("/patient-registration", response_model=PatientDirectoryResponse, operation_id="registerMrOrderPatient")
def register_patient(body: PatientFields, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return patient_service.create_for_order(db, actor, body)


@router.get("/patient-languages", response_model=PatientLanguageChoices, operation_id="mrOrderPatientLanguages")
def patient_languages(query: str = Query("", max_length=200), limit: int = Query(25, ge=1, le=100),
                      cursor: uuid.UUID | None = None, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return patient_service.language_choices(db, actor, query, limit, cursor, order_workflow=True)


@router.get("/policy", response_model=ImmUploadPolicy, operation_id="immunotherapyUploadPolicy")
def policy(actor=Depends(current_identity), db: Session = Depends(get_db), settings=Depends(get_settings)):
    service.authorize(db, actor, "upload_attachment")
    return dict(maxFiles=10, maxBytes=min(settings.max_upload_bytes, 10 * 1024 * 1024),
                types=["application/pdf", "image/jpeg", "image/png", "image/webp"])


@router.post("/prescriptions/{patient_id}", response_model=FileResponse, operation_id="uploadImmunotherapyPrescription",
             openapi_extra=MULTIPART)
async def prescription(patient_id: uuid.UUID, request: Request, actor=Depends(current_identity),
                       db: Session = Depends(get_db), settings=Depends(get_settings),
                       storage_factory=Depends(storage_dependency)):
    try:
        return await prescription_body(patient_id, request, actor, db, settings, storage_factory)
    except TimeoutError:
        raise FileError(408, "prescription_timeout", "Prescription upload timed out. The file is not attached; retry explicitly.") from None


async def prescription_body(patient_id, request, actor, db, settings, storage_factory):
    # Authorize before parsing the multipart body or constructing storage.
    await run_in_threadpool(service.authorize, db, actor, "upload_attachment")
    await run_in_threadpool(file_service.quota, db, actor, settings)
    db.rollback()  # No row lock is retained while receiving a request body.
    maximum = min(settings.max_upload_bytes, 10 * 1024 * 1024)
    async with asyncio.timeout(settings.file_request_timeout_seconds), request.form(max_files=1, max_fields=0, max_part_size=maximum) as form:
        upload = form.get("file")
        # Starlette's UploadFile is the concrete parsed instance.
        if not upload or not hasattr(upload, "file") or len(form) != 1:
            raise FileError(422, "prescription_file", "Supply exactly one prescription file")
        if upload.size is None:
            raise FileError(422, "prescription_size", f"Prescription byte size is unreadable. Enforced limit: {maximum} bytes.")
        if upload.size == 0:
            raise FileError(422, "prescription_empty", f"Prescription is empty (0 bytes). Enforced limit: {maximum} bytes.")
        if upload.size > maximum:
            raise FileError(413, "prescription_size", f"Prescription is {upload.size} bytes and exceeds the enforced limit of {maximum} bytes.")
        await run_in_threadpool(service.authorize, db, actor, "upload_attachment")
        await run_in_threadpool(service.eligible, db, "patients", patient_id)
        try:
            body = UploadRequest(patient_id=patient_id, category="documents", filename=upload.filename)
        except ValidationError:
            raise FileError(422, "prescription_metadata", "Use a nonempty PDF/image filename of at most 255 characters.") from None
        file_id = await run_in_threadpool(file_service.reserve, db, actor, body, upload.content_type, settings, request.state.request_id)
        request.state.file_id = str(file_id)
        async with order_upload_operation(db, settings, file_id, actor, request.state.request_id):
            result = await run_in_threadpool(file_service.complete_upload, db, actor, file_id, upload.file,
                settings.model_copy(update={"max_upload_bytes": maximum}), storage_factory, request.state.request_id)
            return file_service.require_verified_upload(result)


@router.get("", response_model=ImmPage, operation_id="listImmunotherapyOrders")
def listing(search: str = Query("", max_length=200), status: Status | None = None,
            from_date: date | None = None, to_date: date | None = None,
            cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, search=search, status=status or "", from_date=from_date, to_date=to_date, cursor=cursor, limit=limit)


@router.get("/export", response_model=ImmPage, operation_id="exportImmunotherapyOrders")
def export(search: str = Query("", max_length=200), status: Status | None = None,
           from_date: date | None = None, to_date: date | None = None,
           actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, search=search, status=status or "", from_date=from_date, to_date=to_date, complete=True)


@router.get("/references/{kind}", response_model=ImmReferencePage, operation_id="immunotherapyReferences")
def references(kind: Literal["patients", "doctors", "mrs", "allergens"], search: str = Query("", max_length=200),
               cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
               selected: uuid.UUID | None = None,
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search, cursor, limit, selected)


@router.post("/import/review", response_model=ImmImportReview, operation_id="reviewImmunotherapyImport")
def review(body: ImmImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body)


@router.post("/import/commit", response_model=ImmImportResult, operation_id="commitImmunotherapyImport")
def commit(body: ImmImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body, True)


@router.post("", response_model=ImmRecord, operation_id="createImmunotherapyOrder")
def create(body: ImmWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.get("/{record_id}", response_model=ImmRecord, operation_id="getImmunotherapyOrder")
def detail(record_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)


@router.post("/{record_id}/edit", response_model=ImmRecord, operation_id="editImmunotherapyOrder")
def edit(record_id: uuid.UUID, body: ImmWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body, record_id)
