import asyncio
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.zones import ZoneFields, ZoneEdit, ZoneStatus, ZoneVersion, ZoneResponse, ZonePage, ZoneReview, ZoneImportResult
from app.services.auth import Identity
from app.services import zones, zone_transfer

router = APIRouter(prefix="/admin/zones", tags=["Zone Master"])
manager = require_permissions("admin.access")


@router.get("", response_model=ZonePage, operation_id="listZones")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=ZoneResponse, status_code=201, operation_id="createZone")
def create(body: ZoneFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.create(db, actor, body)


@router.get("/export", operation_id="exportZones", responses={200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}})
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    data = zone_transfer.export(db, actor, query, status, format)
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-zone-master.{format}"'})


async def read_file(request):
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > zone_transfer.MAX_BYTES:
                    raise zones.ZoneError("File exceeds 2 MiB.", 413, "zone_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise zones.ZoneError("Upload timed out. Retry with your local file.", 408, "zone_upload_timeout") from None
    return b"".join(chunks)


UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}}


@router.post("/import/review", response_model=ZoneReview, operation_id="reviewZoneImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zone_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=ZoneImportResult, operation_id="commitZoneImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise zones.ZoneError("Explicit confirmation is required.", 422, "zone_confirmation_required")
    return zone_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{zone_id}", response_model=ZoneResponse, operation_id="getZone")
def detail(zone_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.detail(db, actor, zone_id)


@router.post("/{zone_id}/edit", response_model=ZoneResponse, operation_id="editZone")
def edit(zone_id: uuid.UUID, body: ZoneEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.mutate(db, actor, zone_id, body, "edit")


@router.post("/{zone_id}/status", response_model=ZoneResponse, operation_id="setZoneStatus")
def status(zone_id: uuid.UUID, body: ZoneStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.mutate(db, actor, zone_id, body, "status")


@router.post("/{zone_id}/delete", response_model=ZoneResponse, operation_id="deleteZone")
def delete(zone_id: uuid.UUID, body: ZoneVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return zones.mutate(db, actor, zone_id, body, "delete")
