import asyncio
import uuid
from email.parser import BytesParser
from email.policy import default
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.vendors import (VendorFields, VendorEdit, VendorStatus, VendorVersion,
                                VendorResponse, VendorPage, VendorReview, VendorImportResult)
from app.services.auth import Identity
from app.services import vendors, vendor_transfer
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/vendors", tags=["Vendor Master"])
manager = require_permissions("admin.access")
OVERHEAD = 64 * 1024
BINARY_RESPONSES = {200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        {"schema": {"type": "string", "format": "binary"}}}}}


@router.get("", response_model=VendorPage, operation_id="listVendors")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=VendorResponse, status_code=201, operation_id="createVendor")
def create(body: VendorFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.create(db, actor, body)


def release(data, format, evidence, filename):
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{filename}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/export", operation_id="exportVendors", responses=BINARY_RESPONSES)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    data = vendor_transfer.export(db, actor, query, status, format)
    evidence = server_record(db, actor, initiation_id, "vendor", "export", format.upper())
    return release(data, format, evidence, "evexia-vendor-master")


@router.get("/sample", operation_id="downloadVendorSample", responses=BINARY_RESPONSES)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    vendors.transaction(db, lambda: vendors.authorize(db, actor))
    data = vendor_transfer.sample(format)
    evidence = server_record(db, actor, initiation_id, "vendor", "template", format.upper())
    return release(data, format, evidence, "evexia-vendor-template")


async def read_file(request):
    media = request.headers.get("content-type", "")
    multipart = media.lower().startswith("multipart/form-data;")
    if not multipart and media.split(";")[0].lower() != "application/octet-stream":
        raise vendors.VendorError("Send a raw file or multipart form with one file field.", 415, "vendor_media_type")
    if len(media) > 1000 or "\r" in media or "\n" in media:
        vendor_transfer.invalid("Invalid content type.")
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > vendor_transfer.MAX_BYTES + (OVERHEAD if multipart else 0):
                    raise vendors.VendorError("File exceeds 2 MiB plus 64 KiB multipart overhead.", 413, "vendor_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise vendors.VendorError("Upload timed out. Retry with your local file.", 408, "vendor_upload_timeout") from None
    data = b"".join(chunks)
    if multipart:
        try:
            message = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + media + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
            parts = list(message.iter_parts())
            if message.defects or len(parts) != 1 or parts[0].is_multipart() or parts[0].defects:
                vendor_transfer.invalid("Use exactly one multipart file field.")
            part = parts[0]
            if (part.get_content_disposition() != "form-data" or part.get_param("name", header="content-disposition") != "file"
                    or not part.get_filename() or part.get("Content-Transfer-Encoding")):
                vendor_transfer.invalid("Unsupported multipart fields or encoding.")
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or len(data) - len(payload) > OVERHEAD:
                vendor_transfer.invalid("Multipart overhead exceeds 64 KiB.")
            data = payload
        except vendors.VendorError:
            raise
        except Exception:
            vendor_transfer.invalid("Malformed multipart body.")
    if len(data) > vendor_transfer.MAX_BYTES:
        raise vendors.VendorError("File exceeds 2 MiB.", 413, "vendor_file_limit")
    return data


UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
    "multipart/form-data": {"schema": {"type": "object", "required": ["file"], "additionalProperties": False,
                                     "properties": {"file": {"type": "string", "format": "binary"}}}},
}}}


@router.post("/import/review", response_model=VendorReview, operation_id="reviewVendorImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendor_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=VendorImportResult, operation_id="commitVendorImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise vendors.VendorError("Explicit confirmation is required.", 422, "vendor_confirmation_required")
    return vendor_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{vendor_id}", response_model=VendorResponse, operation_id="getVendor")
def detail(vendor_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.detail(db, actor, vendor_id)


@router.post("/{vendor_id}/edit", response_model=VendorResponse, operation_id="editVendor")
def edit(vendor_id: uuid.UUID, body: VendorEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.mutate(db, actor, vendor_id, body, "edit")


@router.post("/{vendor_id}/status", response_model=VendorResponse, operation_id="setVendorStatus")
def status(vendor_id: uuid.UUID, body: VendorStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.mutate(db, actor, vendor_id, body, "status")


@router.post("/{vendor_id}/delete", response_model=VendorResponse, operation_id="deleteVendor")
def delete(vendor_id: uuid.UUID, body: VendorVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return vendors.mutate(db, actor, vendor_id, body, "delete")
