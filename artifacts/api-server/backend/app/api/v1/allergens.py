import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.api.v1.locations import read_file as read_master_file, UPLOAD
from app.api.v1.product_categories import DOWNLOAD
from app.db.session import get_db
from app.schemas.allergens import (
    AllergenFields, AllergenEdit, AllergenVersion, AllergenStatus, AllergenResponse,
    AllergenPage, AllergenReferencePage, AllergenReview, AllergenImportResult,
)
from app.services.auth import Identity
from app.services import allergens, allergen_transfer
from app.services.locations import LocationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/allergens", tags=["Allergen Master"])
manager = require_permissions("admin.access")


@router.get("", response_model=AllergenPage, operation_id="listAllergens")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            category_id: uuid.UUID | None = None, storage_location_id: uuid.UUID | None = None,
            mix: Literal["all", "mix", "no_mix"] = "all",
            min_price: str | None = Query(None, max_length=64), max_price: str | None = Query(None, max_length=64),
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.listing(db, actor, query, status, limit, offset, min_price=min_price, max_price=max_price,
                             category_id=category_id, storage_location_id=storage_location_id, mix=mix)


@router.post("", response_model=AllergenResponse, status_code=201, operation_id="createAllergen")
def create(body: AllergenFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.create(db, actor, body)


@router.get("/references/{kind}", response_model=AllergenReferencePage, operation_id="listAllergenReferences")
def references(kind: Literal["categories", "locations"], query: str = Query("", max_length=200),
               limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
               include_unusable: bool = False, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.references(db, actor, kind, query, limit, offset, include_unusable)


def release(db, actor, initiation_id, format, operation, data):
    evidence = server_record(db, actor, initiation_id, "allergen", operation, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-allergen-{"master" if operation == "export" else "template"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store",
                             "X-Content-Type-Options": "nosniff"})


@router.get("/export", operation_id="exportAllergens", responses=DOWNLOAD)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           category_id: uuid.UUID | None = None, storage_location_id: uuid.UUID | None = None,
           mix: Literal["all", "mix", "no_mix"] = "all",
           min_price: str | None = Query(None, max_length=64), max_price: str | None = Query(None, max_length=64),
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return release(db, actor, initiation_id, format, "export", allergen_transfer.export(
        db, actor, query, status, format, min_price=min_price, max_price=max_price,
        category_id=category_id, storage_location_id=storage_location_id, mix=mix))


@router.get("/sample", operation_id="downloadAllergenSample", responses=DOWNLOAD)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    allergens.transaction(db, lambda: allergens.authorize(db, actor))
    return release(db, actor, initiation_id, format, "template", allergen_transfer.sample(format))


async def read_file(request):
    try:
        return await read_master_file(request)
    except LocationError as exc:
        raise allergens.AllergenError(exc.message, exc.status, exc.code.replace("location_", "allergen_")) from None


@router.post("/import/review", response_model=AllergenReview, operation_id="reviewAllergenImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergen_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=AllergenImportResult, operation_id="commitAllergenImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise allergens.AllergenError("Explicit confirmation is required.", 422, "allergen_confirmation_required")
    return allergen_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{allergen_id}", response_model=AllergenResponse, operation_id="getAllergen")
def detail(allergen_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.detail(db, actor, allergen_id)


@router.post("/{allergen_id}/edit", response_model=AllergenResponse, operation_id="editAllergen")
def edit(allergen_id: uuid.UUID, body: AllergenEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.mutate(db, actor, allergen_id, body, "edit")


@router.post("/{allergen_id}/status", response_model=AllergenResponse, operation_id="setAllergenStatus")
def status(allergen_id: uuid.UUID, body: AllergenStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.mutate(db, actor, allergen_id, body, "status")


@router.post("/{allergen_id}/delete", response_model=AllergenResponse, operation_id="deleteAllergen")
def delete(allergen_id: uuid.UUID, body: AllergenVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return allergens.mutate(db, actor, allergen_id, body, "delete")
