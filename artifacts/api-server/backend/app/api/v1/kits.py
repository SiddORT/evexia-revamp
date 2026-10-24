"""Shared Kits orders: protected Super Admin or mandatory authenticated MR scope.

MR scope includes references, transfers and private uploads, not Staff grants,
Doctor-portal access, attachment replacement or generic master administration.
"""
import asyncio
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.deps import current_identity, operation_router
from app.db.session import get_db
from app.schemas.kits import KitsWrite, KitsUpdate, KitsImport, KitsRecord, KitsPage, KitsImportResult, Payment
from app.schemas.immunotherapy import Status, ImmReferencePage, ImmUploadPolicy, ImmImportReview
from app.services import kits as service, files as file_service
from app.core.config import get_settings
from app.schemas.files import UploadRequest, FileResponse
from app.services.file_policy import FileError
from app.api.v1.files import storage_dependency, order_upload_operation
from app.api.v1.immunotherapy import MULTIPART
from app.schemas.order_approval import OrderApproval
from app.services.order_approval import approve as approve_order

router = APIRouter(prefix="/admin/kits-orders", tags=["kits"],
    dependencies=[Depends(operation_router("kits", {
        "listing": None, "detail": None, "references": None, "export": "export",
        "review": "import", "commit": "import", "create": "add",
        "policy": "upload_attachment", "upload": "upload_attachment",
    }, allow_mr=True))])


def filters(search: str = Query("", max_length=200), status: Status | None = None,
            payment_status: Payment | None = None, order_for: Literal["doctor", "mr"] | None = None,
            doctor_id: uuid.UUID | None = None, mr_id: uuid.UUID | None = None, patient_id: uuid.UUID | None = None,
            from_date: date | None = None, to_date: date | None = None):
    return dict(search=search, status=status, payment_status=payment_status, order_for=order_for,
        doctor_id=doctor_id, mr_id=mr_id, patient_id=patient_id, from_date=from_date, to_date=to_date)


@router.post("/{record_id}/approve", response_model=KitsRecord, response_model_exclude_unset=True, operation_id="approveKitsOrder")
def approve(record_id: uuid.UUID, body: OrderApproval, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return approve_order(db, actor, record_id, body, "kits")


@router.get("", response_model=KitsPage, response_model_exclude_unset=True, operation_id="listKitsOrders")
def listing(values=Depends(filters), cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, cursor=cursor, limit=limit)


@router.get("/export", response_model=KitsPage, response_model_exclude_unset=True, operation_id="exportKitsOrders")
def export(values=Depends(filters), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, complete=True)


@router.get("/references/{kind}", response_model=ImmReferencePage, operation_id="kitsReferences")
def references(kind: Literal["patients", "doctors", "mrs"], search: str = Query("", max_length=200),
               cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100), selected: uuid.UUID | None = None,
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search, cursor, limit, selected)


@router.get("/policy", response_model=ImmUploadPolicy, operation_id="kitsUploadPolicy")
def policy(actor=Depends(current_identity), db: Session = Depends(get_db), settings=Depends(get_settings)):
    service.authorize(db, actor, "upload_attachment")
    return dict(maxFiles=10, maxBytes=min(settings.max_upload_bytes, 10485760),
                types=["application/pdf", "image/jpeg", "image/png", "image/webp"])


@router.post("/attachments", response_model=FileResponse, operation_id="uploadKitsAttachment", openapi_extra=MULTIPART)
async def upload(request: Request, actor=Depends(current_identity), db: Session = Depends(get_db),
                 settings=Depends(get_settings), storage_factory=Depends(storage_dependency)):
    # Authentication and current authorization precede multipart parsing and storage.
    await run_in_threadpool(service.authorize, db, actor, "upload_attachment")
    await run_in_threadpool(file_service.quota, db, actor, settings)
    db.rollback()
    maximum = min(settings.max_upload_bytes, 10485760)
    try:
        async with asyncio.timeout(settings.file_request_timeout_seconds), request.form(max_files=1, max_fields=0, max_part_size=maximum) as form:
            file = form.get("file")
            if len(form) != 1 or not file or not hasattr(file, "file") or not file.size or file.size > maximum:
                raise FileError(422, "kits_attachment", "Supply one nonempty PDF/image within the upload limit")
            try:
                body = UploadRequest(kits_owner_id=actor.user.id, category="documents", filename=file.filename)
            except ValidationError:
                # This model is constructed inside the route, not parsed by
                # FastAPI: invalid multipart filenames otherwise escape as 500s.
                raise FileError(422, "kits_attachment_metadata",
                                "Use a nonempty PDF/image filename of at most 255 characters.") from None
            file_id = await run_in_threadpool(file_service.reserve, db, actor, body, file.content_type, settings, request.state.request_id)
            request.state.file_id = str(file_id)
            async with order_upload_operation(db, settings, file_id, actor, request.state.request_id):
                result = await run_in_threadpool(file_service.complete_upload, db, actor, file_id, file.file,
                    settings.model_copy(update={"max_upload_bytes": maximum}), storage_factory, request.state.request_id)
                return file_service.require_verified_upload(result)
    except TimeoutError:
        raise FileError(408, "kits_upload_timeout", "Upload timed out; it is not attached. Retry explicitly.") from None


@router.post("/import/review", response_model=ImmImportReview, operation_id="reviewKitsImport")
def review(body: KitsImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body)


@router.post("/import/commit", response_model=KitsImportResult, response_model_exclude_unset=True, operation_id="commitKitsImport")
def commit(body: KitsImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body, True)


@router.post("", response_model=KitsRecord, response_model_exclude_unset=True, operation_id="createKitsOrder")
def create(body: KitsWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.post("/{record_id}/edit", response_model=KitsRecord, response_model_exclude_unset=True, operation_id="updateKitsOrder")
def edit(record_id: uuid.UUID, body: KitsUpdate, actor=Depends(current_identity), db: Session = Depends(get_db)):
    # Unlisted operation is protected at the router; service revalidates again,
    # including MR callers admitted to the ownership-scoped router.
    return service.update(db, actor, record_id, body)


@router.get("/{record_id}", response_model=KitsRecord, response_model_exclude_unset=True, operation_id="getKitsOrder")
def detail(record_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)
