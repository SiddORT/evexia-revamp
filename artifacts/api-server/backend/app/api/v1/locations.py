import asyncio
import uuid
from email.parser import BytesParser
from email.policy import default
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.locations import (
    LocationFields, LocationEdit, LocationStatus, LocationVersion, LocationResponse,
    LocationPage, LocationReview, LocationImportResult,
)
from app.services.auth import Identity
from app.services import locations, location_transfer

router = APIRouter(prefix="/admin/storage-locations", tags=["Storage Location Master"])
manager = require_permissions("admin.access")
OVERHEAD = 64 * 1024


@router.get("", response_model=LocationPage, operation_id="listStorageLocations")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=LocationResponse, status_code=201, operation_id="createStorageLocation")
def create(body: LocationFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.create(db, actor, body)


@router.get("/export", operation_id="exportStorageLocations", responses={200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}})
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return Response(location_transfer.export(db, actor, query, status, format),
                    media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-storage-location-master.{format}"'})


async def read_file(request):
    media = request.headers.get("content-type", "")
    multipart = media.lower().startswith("multipart/form-data;")
    if not multipart and media.split(";")[0].lower() != "application/octet-stream":
        raise locations.LocationError("Send a raw file or multipart form with one file field.", 415, "location_media_type")
    if len(media) > 1000 or "\r" in media or "\n" in media:
        location_transfer.invalid("Invalid content type.")
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > location_transfer.MAX_BYTES + (OVERHEAD if multipart else 0):
                    raise locations.LocationError("File exceeds 2 MiB plus 64 KiB multipart overhead.", 413, "location_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise locations.LocationError("Upload timed out. Retry with your local file.", 408, "location_upload_timeout") from None
    data = b"".join(chunks)
    if multipart:
        try:
            message = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + media + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
            parts = list(message.iter_parts())
            if message.defects or len(parts) != 1 or parts[0].is_multipart() or parts[0].defects:
                location_transfer.invalid("Use exactly one multipart file field.")
            part = parts[0]
            if (part.get_content_disposition() != "form-data" or part.get_param("name", header="content-disposition") != "file"
                    or not part.get_filename() or part.get("Content-Transfer-Encoding")):
                location_transfer.invalid("Unsupported multipart fields or encoding.")
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or len(data) - len(payload) > OVERHEAD:
                location_transfer.invalid("Multipart overhead exceeds 64 KiB.")
            data = payload
        except locations.LocationError:
            raise
        except Exception:
            location_transfer.invalid("Malformed multipart body.")
    if len(data) > location_transfer.MAX_BYTES:
        raise locations.LocationError("File exceeds 2 MiB.", 413, "location_file_limit")
    return data


UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
    "multipart/form-data": {"schema": {"type": "object", "required": ["file"], "additionalProperties": False,
                                     "properties": {"file": {"type": "string", "format": "binary"}}}},
}}}


@router.post("/import/review", response_model=LocationReview, operation_id="reviewLocationImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return location_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=LocationImportResult, operation_id="commitLocationImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise locations.LocationError("Explicit confirmation is required.", 422, "location_confirmation_required")
    return location_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{location_id}", response_model=LocationResponse, operation_id="getStorageLocation")
def detail(location_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.detail(db, actor, location_id)


@router.post("/{location_id}/edit", response_model=LocationResponse, operation_id="editStorageLocation")
def edit(location_id: uuid.UUID, body: LocationEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.mutate(db, actor, location_id, body, "edit")


@router.post("/{location_id}/status", response_model=LocationResponse, operation_id="setStorageLocationStatus")
def status(location_id: uuid.UUID, body: LocationStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.mutate(db, actor, location_id, body, "status")


@router.post("/{location_id}/delete", response_model=LocationResponse, operation_id="deleteStorageLocation")
def delete(location_id: uuid.UUID, body: LocationVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return locations.mutate(db, actor, location_id, body, "delete")
