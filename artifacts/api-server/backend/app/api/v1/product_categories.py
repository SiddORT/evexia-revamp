import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import master_router
from app.api.v1.locations import read_file as read_master_file, UPLOAD
from app.db.session import get_db
from app.schemas.product_categories import (
    ProductCategoryFields, ProductCategoryEdit, ProductCategoryVersion, ProductCategoryStatus,
    ProductCategoryResponse, ProductCategoryPage, ProductCategoryReview, ProductCategoryImportResult,
)
from app.services.auth import Identity
from app.services import product_categories, product_category_transfer
from app.services.locations import LocationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/product-categories", tags=["Product Category Master"])
manager = master_router("product_category")
DOWNLOAD = {200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}}}}}


@router.get("", response_model=ProductCategoryPage, operation_id="listProductCategories")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            min_price: str | None = Query(None, max_length=64), max_price: str | None = Query(None, max_length=64),
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.listing(db, actor, query, status, limit, offset, min_price, max_price)


@router.post("", response_model=ProductCategoryResponse, status_code=201, operation_id="createProductCategory")
def create(body: ProductCategoryFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.create(db, actor, body)


def release(db, actor, initiation_id, format, operation, data):
    evidence = server_record(db, actor, initiation_id, "product_category", operation, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-product-category-{"master" if operation == "export" else "template"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store",
                             "X-Content-Type-Options": "nosniff"})


@router.get("/export", operation_id="exportProductCategories", responses=DOWNLOAD)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           min_price: str | None = Query(None, max_length=64), max_price: str | None = Query(None, max_length=64),
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return release(db, actor, initiation_id, format, "export", product_category_transfer.export(db, actor, query, status, format, min_price, max_price))


@router.get("/sample", operation_id="downloadProductCategorySample", responses=DOWNLOAD)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    product_categories.transaction(db, lambda: product_categories.authorize(db, actor, "import"))
    return release(db, actor, initiation_id, format, "template", product_category_transfer.sample(format))


async def read_file(request):
    # Same 2 MiB extraction / 64 KiB multipart / 15-second streaming policy.
    try:
        return await read_master_file(request)
    except LocationError as exc:
        raise product_categories.ProductCategoryError(exc.message, exc.status, exc.code.replace("location_", "product_category_")) from None


@router.post("/import/review", response_model=ProductCategoryReview, operation_id="reviewProductCategoryImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_category_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=ProductCategoryImportResult, operation_id="commitProductCategoryImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise product_categories.ProductCategoryError("Explicit confirmation is required.", 422, "product_category_confirmation_required")
    return product_category_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{product_category_id}", response_model=ProductCategoryResponse, operation_id="getProductCategory")
def detail(product_category_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.detail(db, actor, product_category_id)


@router.post("/{product_category_id}/edit", response_model=ProductCategoryResponse, operation_id="editProductCategory")
def edit(product_category_id: uuid.UUID, body: ProductCategoryEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.mutate(db, actor, product_category_id, body, "edit")


@router.post("/{product_category_id}/status", response_model=ProductCategoryResponse, operation_id="setProductCategoryStatus")
def status(product_category_id: uuid.UUID, body: ProductCategoryStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.mutate(db, actor, product_category_id, body, "status")


@router.post("/{product_category_id}/delete", response_model=ProductCategoryResponse, operation_id="deleteProductCategory")
def delete(product_category_id: uuid.UUID, body: ProductCategoryVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_categories.mutate(db, actor, product_category_id, body, "delete")
