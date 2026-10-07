import asyncio
import uuid
from email.parser import BytesParser
from email.policy import default
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.couriers import (
    CourierFields, CourierEdit, CourierStatus, CourierVersion, CourierResponse,
    CourierPage, CourierReview, CourierImportResult,
)
from app.services.auth import Identity
from app.services import couriers, courier_transfer

router = APIRouter(prefix="/admin/courier-partners", tags=["Courier Partner Master"])
manager = require_permissions("admin.access")
OVERHEAD = 64 * 1024


@router.get("", response_model=CourierPage, operation_id="listCourierPartners")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=CourierResponse, status_code=201, operation_id="createCourierPartner")
def create(body: CourierFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.create(db, actor, body)


@router.get("/export", operation_id="exportCourierPartners", responses={200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}})
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return Response(courier_transfer.export(db, actor, query, status, format),
                    media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-courier-partner-master.{format}"'})


async def read_file(request):
    media = request.headers.get("content-type", "")
    multipart = media.lower().startswith("multipart/form-data;")
    if not multipart and media.split(";")[0].lower() != "application/octet-stream":
        raise couriers.CourierError("Send a raw file or multipart form with one file field.", 415, "courier_media_type")
    if len(media) > 1000 or "\r" in media or "\n" in media:
        courier_transfer.invalid("Invalid content type.")
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > courier_transfer.MAX_BYTES + (OVERHEAD if multipart else 0):
                    raise couriers.CourierError("File exceeds 2 MiB plus 64 KiB multipart overhead.", 413, "courier_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise couriers.CourierError("Upload timed out. Retry with your local file.", 408, "courier_upload_timeout") from None
    data = b"".join(chunks)
    if multipart:
        try:
            message = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + media + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
            parts = list(message.iter_parts())
            if message.defects or len(parts) != 1 or parts[0].is_multipart() or parts[0].defects:
                courier_transfer.invalid("Use exactly one multipart file field.")
            part = parts[0]
            if (part.get_content_disposition() != "form-data" or part.get_param("name", header="content-disposition") != "file"
                    or not part.get_filename() or part.get("Content-Transfer-Encoding")):
                courier_transfer.invalid("Unsupported multipart fields or encoding.")
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or len(data) - len(payload) > OVERHEAD:
                courier_transfer.invalid("Multipart overhead exceeds 64 KiB.")
            data = payload
        except couriers.CourierError:
            raise
        except Exception:
            courier_transfer.invalid("Malformed multipart body.")
    if len(data) > courier_transfer.MAX_BYTES:
        raise couriers.CourierError("File exceeds 2 MiB.", 413, "courier_file_limit")
    return data


UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
    "multipart/form-data": {"schema": {"type": "object", "required": ["file"], "additionalProperties": False,
                                     "properties": {"file": {"type": "string", "format": "binary"}}}},
}}}


@router.post("/import/review", response_model=CourierReview, operation_id="reviewCourierImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return courier_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=CourierImportResult, operation_id="commitCourierImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise couriers.CourierError("Explicit confirmation is required.", 422, "courier_confirmation_required")
    return courier_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{courier_id}", response_model=CourierResponse, operation_id="getCourierPartner")
def detail(courier_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.detail(db, actor, courier_id)


@router.post("/{courier_id}/edit", response_model=CourierResponse, operation_id="editCourierPartner")
def edit(courier_id: uuid.UUID, body: CourierEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.mutate(db, actor, courier_id, body, "edit")


@router.post("/{courier_id}/status", response_model=CourierResponse, operation_id="setCourierPartnerStatus")
def status(courier_id: uuid.UUID, body: CourierStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.mutate(db, actor, courier_id, body, "status")


@router.post("/{courier_id}/delete", response_model=CourierResponse, operation_id="deleteCourierPartner")
def delete(courier_id: uuid.UUID, body: CourierVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return couriers.mutate(db, actor, courier_id, body, "delete")
