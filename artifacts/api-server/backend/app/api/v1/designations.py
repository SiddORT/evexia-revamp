import asyncio
import uuid
from email.parser import BytesParser
from email.policy import default
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.designations import (
    DesignationFields, DesignationEdit, DesignationStatus, DesignationVersion, DesignationResponse,
    DesignationPage, DesignationReview, DesignationImportResult,
)
from app.services.auth import Identity
from app.services import designations, designation_transfer
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/designations", tags=["Designation Master"])
manager = require_permissions("admin.access")
OVERHEAD = 64 * 1024


@router.get("", response_model=DesignationPage, operation_id="listDesignations")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=DesignationResponse, status_code=201, operation_id="createDesignation")
def create(body: DesignationFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.create(db, actor, body)


@router.get("/export", operation_id="exportDesignations", responses={200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}})
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    data = designation_transfer.export(db, actor, query, status, format)
    evidence = server_record(db, actor, initiation_id, "designation", "export", format.upper())
    return Response(data,
                    media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-designation-master.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})

@router.get("/sample", operation_id="downloadDesignationSample", responses={200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}})
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    designations.transaction(db, lambda: designations.authorize(db, actor))
    data = designation_transfer.sample(format)
    evidence = server_record(db, actor, initiation_id, "designation", "template", format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-designation-template.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


async def read_file(request):
    media = request.headers.get("content-type", "")
    multipart = media.lower().startswith("multipart/form-data;")
    if not multipart and media.split(";")[0].lower() != "application/octet-stream":
        raise designations.DesignationError("Send a raw file or multipart form with one file field.", 415, "designation_media_type")
    if len(media) > 1000 or "\r" in media or "\n" in media:
        designation_transfer.invalid("Invalid content type.")
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > designation_transfer.MAX_BYTES + (OVERHEAD if multipart else 0):
                    raise designations.DesignationError("File exceeds 2 MiB plus 64 KiB multipart overhead.", 413, "designation_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise designations.DesignationError("Upload timed out. Retry with your local file.", 408, "designation_upload_timeout") from None
    data = b"".join(chunks)
    if multipart:
        try:
            message = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + media + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
            parts = list(message.iter_parts())
            if message.defects or len(parts) != 1 or parts[0].is_multipart() or parts[0].defects:
                designation_transfer.invalid("Use exactly one multipart file field.")
            part = parts[0]
            if (part.get_content_disposition() != "form-data" or part.get_param("name", header="content-disposition") != "file"
                    or not part.get_filename() or part.get("Content-Transfer-Encoding")):
                designation_transfer.invalid("Unsupported multipart fields or encoding.")
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or len(data) - len(payload) > OVERHEAD:
                designation_transfer.invalid("Multipart overhead exceeds 64 KiB.")
            data = payload
        except designations.DesignationError:
            raise
        except Exception:
            designation_transfer.invalid("Malformed multipart body.")
    if len(data) > designation_transfer.MAX_BYTES:
        raise designations.DesignationError("File exceeds 2 MiB.", 413, "designation_file_limit")
    return data


UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
    "multipart/form-data": {"schema": {"type": "object", "required": ["file"], "additionalProperties": False,
                                     "properties": {"file": {"type": "string", "format": "binary"}}}},
}}}


@router.post("/import/review", response_model=DesignationReview, operation_id="reviewDesignationImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designation_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=DesignationImportResult, operation_id="commitDesignationImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise designations.DesignationError("Explicit confirmation is required.", 422, "designation_confirmation_required")
    return designation_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{designation_id}", response_model=DesignationResponse, operation_id="getDesignation")
def detail(designation_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.detail(db, actor, designation_id)


@router.post("/{designation_id}/edit", response_model=DesignationResponse, operation_id="editDesignation")
def edit(designation_id: uuid.UUID, body: DesignationEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.mutate(db, actor, designation_id, body, "edit")


@router.post("/{designation_id}/status", response_model=DesignationResponse, operation_id="setDesignationStatus")
def status(designation_id: uuid.UUID, body: DesignationStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.mutate(db, actor, designation_id, body, "status")


@router.post("/{designation_id}/delete", response_model=DesignationResponse, operation_id="deleteDesignation")
def delete(designation_id: uuid.UUID, body: DesignationVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return designations.mutate(db, actor, designation_id, body, "delete")
