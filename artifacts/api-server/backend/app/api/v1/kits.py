"""Super Admin Kits API. No staff grants or MR/Doctor portal access."""
import asyncio
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.kits import KitsWrite, KitsImport, KitsRecord, KitsPage, KitsImportResult, Payment
from app.schemas.immunotherapy import Status, ImmReferencePage, ImmUploadPolicy, ImmImportReview
from app.services import kits as service, files as file_service
from app.core.config import get_settings
from app.schemas.files import UploadRequest, FileResponse
from app.services.file_policy import FileError
from app.services.file_locks import operation
from app.api.v1.files import storage_dependency
from app.api.v1.immunotherapy import MULTIPART

router = APIRouter(prefix="/admin/kits-orders", tags=["kits"])


def filters(search: str = Query("", max_length=200), status: Status | None = None,
            payment_status: Payment | None = None, order_for: Literal["doctor", "mr"] | None = None,
            doctor_id: uuid.UUID | None = None, mr_id: uuid.UUID | None = None, patient_id: uuid.UUID | None = None,
            from_date: date | None = None, to_date: date | None = None):
    return dict(search=search, status=status, payment_status=payment_status, order_for=order_for,
        doctor_id=doctor_id, mr_id=mr_id, patient_id=patient_id, from_date=from_date, to_date=to_date)


@router.get("", response_model=KitsPage, operation_id="listKitsOrders")
def listing(values=Depends(filters), cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, cursor=cursor, limit=limit)


@router.get("/export", response_model=KitsPage, operation_id="exportKitsOrders")
def export(values=Depends(filters), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, complete=True)


@router.get("/references/{kind}", response_model=ImmReferencePage, operation_id="kitsReferences")
def references(kind: Literal["patients", "doctors", "mrs"], search: str = Query("", max_length=200),
               cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100), selected: uuid.UUID | None = None,
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search, cursor, limit, selected)


@router.get("/policy", response_model=ImmUploadPolicy, operation_id="kitsUploadPolicy")
def policy(actor=Depends(current_identity), db: Session = Depends(get_db), settings=Depends(get_settings)):
    service.authorize(db, actor)
    return dict(maxFiles=10, maxBytes=min(settings.max_upload_bytes, 10485760),
                types=["application/pdf", "image/jpeg", "image/png", "image/webp"])


@router.post("/attachments", response_model=FileResponse, operation_id="uploadKitsAttachment", openapi_extra=MULTIPART)
async def upload(request: Request, actor=Depends(current_identity), db: Session = Depends(get_db),
                 settings=Depends(get_settings), storage_factory=Depends(storage_dependency)):
    # Authentication and current authorization precede multipart parsing and storage.
    await run_in_threadpool(service.authorize, db, actor)
    await run_in_threadpool(file_service.quota, db, actor, settings)
    db.rollback()
    maximum = min(settings.max_upload_bytes, 10485760)
    try:
        async with asyncio.timeout(settings.file_request_timeout_seconds), request.form(max_files=1, max_fields=0, max_part_size=maximum) as form:
            file = form.get("file")
            if len(form) != 1 or not file or not hasattr(file, "file") or not file.size or file.size > maximum:
                raise FileError(422, "kits_attachment", "Supply one nonempty PDF/image within the upload limit")
            body = UploadRequest(kits_owner_id=actor.user.id, category="documents", filename=file.filename)
            file_id = await run_in_threadpool(file_service.reserve, db, actor, body, file.content_type, settings, request.state.request_id)
            request.state.file_id = str(file_id)
            lease = operation(db, settings, file_id)
            await run_in_threadpool(lease.__enter__)
            try:
                return await run_in_threadpool(file_service.complete_upload, db, actor, file_id, file.file,
                    settings.model_copy(update={"max_upload_bytes": maximum}), storage_factory, request.state.request_id)
            except BaseException:
                await run_in_threadpool(file_service.interrupted, db, file_id, actor, request.state.request_id)
                raise
            finally:
                await run_in_threadpool(lease.__exit__, None, None, None)
    except TimeoutError:
        raise FileError(408, "kits_upload_timeout", "Upload timed out; it is not attached. Retry explicitly.") from None


@router.post("/import/review", response_model=ImmImportReview, operation_id="reviewKitsImport")
def review(body: KitsImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body)


@router.post("/import/commit", response_model=KitsImportResult, operation_id="commitKitsImport")
def commit(body: KitsImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body, True)


@router.post("", response_model=KitsRecord, operation_id="createKitsOrder")
def create(body: KitsWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.get("/{record_id}", response_model=KitsRecord, operation_id="getKitsOrder")
def detail(record_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)
