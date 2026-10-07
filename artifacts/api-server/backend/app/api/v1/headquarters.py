import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.api.v1.locations import read_file as read_master_file, UPLOAD
from app.db.session import get_db
from app.schemas.headquarters import (
    HeadquarterFields, HeadquarterEdit, HeadquarterVersion, HeadquarterStatus,
    HeadquarterResponse, HeadquarterPage, HeadquarterReview, HeadquarterImportResult,
)
from app.services.auth import Identity
from app.services import headquarters, headquarter_transfer
from app.services.locations import LocationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/headquarters", tags=["Headquarter Master"])
manager = require_permissions("admin.access")
DOWNLOAD = {200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}}


@router.get("", response_model=HeadquarterPage, operation_id="listHeadquarters")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=HeadquarterResponse, status_code=201, operation_id="createHeadquarter")
def create(body: HeadquarterFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.create(db, actor, body)


def release(db, actor, initiation_id, format, operation, data):
    evidence = server_record(db, actor, initiation_id, "headquarter", operation, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-headquarter-{"master" if operation == "export" else "template"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store",
                             "X-Content-Type-Options": "nosniff"})


@router.get("/export", operation_id="exportHeadquarters", responses=DOWNLOAD)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return release(db, actor, initiation_id, format, "export", headquarter_transfer.export(db, actor, query, status, format))


@router.get("/sample", operation_id="downloadHeadquarterSample", responses=DOWNLOAD)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    headquarters.transaction(db, lambda: headquarters.authorize(db, actor))
    return release(db, actor, initiation_id, format, "template", headquarter_transfer.sample(format))


async def read_file(request):
    # Same 2 MiB extraction / 64 KiB multipart / 15-second streaming policy.
    try:
        return await read_master_file(request)
    except LocationError as exc:
        raise headquarters.HeadquarterError(exc.message, exc.status, exc.code.replace("location_", "headquarter_")) from None


@router.post("/import/review", response_model=HeadquarterReview, operation_id="reviewHeadquarterImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarter_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=HeadquarterImportResult, operation_id="commitHeadquarterImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise headquarters.HeadquarterError("Explicit confirmation is required.", 422, "headquarter_confirmation_required")
    return headquarter_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{headquarter_id}", response_model=HeadquarterResponse, operation_id="getHeadquarter")
def detail(headquarter_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.detail(db, actor, headquarter_id)


@router.post("/{headquarter_id}/edit", response_model=HeadquarterResponse, operation_id="editHeadquarter")
def edit(headquarter_id: uuid.UUID, body: HeadquarterEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.mutate(db, actor, headquarter_id, body, "edit")


@router.post("/{headquarter_id}/status", response_model=HeadquarterResponse, operation_id="setHeadquarterStatus")
def status(headquarter_id: uuid.UUID, body: HeadquarterStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.mutate(db, actor, headquarter_id, body, "status")


@router.post("/{headquarter_id}/delete", response_model=HeadquarterResponse, operation_id="deleteHeadquarter")
def delete(headquarter_id: uuid.UUID, body: HeadquarterVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return headquarters.mutate(db, actor, headquarter_id, body, "delete")
