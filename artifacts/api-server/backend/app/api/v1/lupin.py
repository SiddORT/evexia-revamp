"""Shared Admin/MR Lupin orders; service ownership is mandatory."""
import asyncio
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import current_identity, operation_router
from app.db.session import get_db
from app.schemas.lupin import LupinWrite, LupinImport, LupinRecord, LupinPage, LupinImportResult, LupinStatus, LupinPayment, LupinUploadCancellation
from app.schemas.immunotherapy import ImmReferencePage, ImmUploadPolicy, ImmImportReview
from app.services import lupin as service, files as file_service
from app.core.config import get_settings
from app.schemas.files import UploadRequest, FileResponse
from app.services.file_policy import FileError
from app.services.file_locks import operation
from app.api.v1.files import storage_dependency
from app.api.v1.immunotherapy import MULTIPART
from app.schemas.lupin import LupinUpdate
from app.schemas.order_approval import OrderApproval
from app.services.order_approval import approve as approve_order

router = APIRouter(prefix="/admin/lupin-orders", tags=["lupin"],
    dependencies=[Depends(operation_router("lupin", {
        "listing": None, "detail": None, "references": None, "export": "export",
        "review": "import", "commit": "import", "create": "add", "edit": "edit", "approve": "edit", "reject": "edit",
        "policy": "upload_attachment", "upload": "upload_attachment", "cancel_upload": "upload_attachment",
    }, allow_mr=True))])


def filters(search: str = Query("", max_length=200), status: LupinStatus | None = None,
            payment_status: LupinPayment | None = None,
            doctor_id: uuid.UUID | None = None, mr_id: uuid.UUID | None = None, patient_id: uuid.UUID | None = None,
            from_date: date | None = None, to_date: date | None = None):
    return dict(search=search, status=status, payment_status=payment_status,
        doctor_id=doctor_id, mr_id=mr_id, patient_id=patient_id, from_date=from_date, to_date=to_date)


@router.post("/{record_id}/edit", response_model=LupinRecord, operation_id="updateLupinOrder")
def edit(record_id: uuid.UUID, body: LupinUpdate, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.update(db, actor, record_id, body)


@router.post("/{record_id}/approve", response_model=LupinRecord, operation_id="approveLupinOrder")
def approve(record_id: uuid.UUID, body: OrderApproval, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return approve_order(db, actor, record_id, body, "lupin")


@router.post("/{record_id}/reject", response_model=LupinRecord, operation_id="rejectLupinOrder")
def reject(record_id: uuid.UUID, body: OrderApproval, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return approve_order(db, actor, record_id, body, "lupin", decision="reject")


@router.get("", response_model=LupinPage, operation_id="listLupinOrders")
def listing(values=Depends(filters), cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, cursor=cursor, limit=limit)


@router.get("/export", response_model=LupinPage, operation_id="exportLupinOrders")
def export(values=Depends(filters), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, complete=True)


@router.get("/references/{kind}", response_model=ImmReferencePage, operation_id="lupinReferences")
def references(kind: Literal["patients", "doctors", "mrs"], search: str = Query("", max_length=200),
               cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100), selected: uuid.UUID | None = None,
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search, cursor, limit, selected)


@router.get("/policy", response_model=ImmUploadPolicy, operation_id="lupinUploadPolicy")
def policy(actor=Depends(current_identity), db: Session = Depends(get_db), settings=Depends(get_settings)):
    service.authorize(db, actor, "upload_attachment")
    return dict(maxFiles=10, maxBytes=min(settings.max_upload_bytes, 10485760),
                types=["application/pdf", "image/jpeg", "image/png", "image/webp"])


@router.post("/attachments", response_model=FileResponse, operation_id="uploadLupinAttachment", openapi_extra=MULTIPART)
async def upload(request: Request, upload_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db),
                 settings=Depends(get_settings), storage_factory=Depends(storage_dependency)):
    # Current authorization precedes parsing any personal multipart data.
    await run_in_threadpool(service.authorize, db, actor, "upload_attachment")
    await run_in_threadpool(file_service.quota, db, actor, settings)
    db.rollback()
    maximum = min(settings.max_upload_bytes, 10485760)
    try:
        async with asyncio.timeout(settings.file_request_timeout_seconds), request.form(max_files=1, max_fields=0, max_part_size=maximum) as form:
            file = form.get("file")
            if len(form) != 1 or not file or not hasattr(file, "file") or not file.size or file.size > maximum:
                raise FileError(422, "lupin_attachment", "Supply one nonempty PDF/image within the upload limit")
            body = UploadRequest(lupin_owner_id=actor.user.id, category="documents", filename=file.filename)
            digest, size = await run_in_threadpool(service.upload_digest, file.file, maximum)
            file_id = await run_in_threadpool(service.reserve_upload, db, actor, body, file.content_type,
                settings, request.state.request_id, upload_id, digest, size)
            request.state.file_id = str(file_id)
            lease = operation(db, settings, file_id)
            await run_in_threadpool(lease.__enter__)
            try:
                existing = await run_in_threadpool(file_service.get_record, db, actor, file_id, "read")
                if existing.state == "verified" and existing.scanner_status == "clean":
                    return file_service.response(existing)
                if existing.state != "uploading":
                    raise FileError(409, "lupin_upload_state", "Upload is not available. Remove it explicitly before choosing the file again.")
                return await run_in_threadpool(file_service.complete_upload, db, actor, file_id, file.file,
                    settings.model_copy(update={"max_upload_bytes": maximum}), storage_factory, request.state.request_id)
            except BaseException:
                await run_in_threadpool(file_service.interrupted, db, file_id, actor, request.state.request_id)
                raise
            finally:
                await run_in_threadpool(lease.__exit__, None, None, None)
    except TimeoutError:
        raise FileError(408, "lupin_upload_timeout", "Upload timed out; it is not attached. Retry explicitly.") from None


@router.post("/attachments/{upload_id}/cancel", response_model=LupinUploadCancellation, operation_id="cancelLupinUpload")
def cancel_upload(upload_id: uuid.UUID, request: Request, actor=Depends(current_identity),
                  db: Session = Depends(get_db), settings=Depends(get_settings), storage_factory=Depends(storage_dependency)):
    exists = service.cancel_upload(db, actor, upload_id)
    if exists:
        with operation(db, settings, upload_id):
            file_service.delete_file(db, actor, upload_id, storage_factory(), request.state.request_id,
                                     cancel_lupin_upload=True)
    return dict(id=upload_id, cancelled=True)


@router.post("/import/review", response_model=ImmImportReview, operation_id="reviewLupinImport")
def review(body: LupinImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body)


@router.post("/import/commit", response_model=LupinImportResult, operation_id="commitLupinImport")
def commit(body: LupinImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body, True)


@router.post("", response_model=LupinRecord, operation_id="createLupinOrder")
def create(body: LupinWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.get("/{record_id}", response_model=LupinRecord, operation_id="getLupinOrder")
def detail(record_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)
