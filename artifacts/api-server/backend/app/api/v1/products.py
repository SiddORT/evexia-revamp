import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.products import (
    ProductCreate, ProductEdit, ProductDelete, ProductStatus, ProductView, ProductPage,
    ProductHistoryPage, ProductSummary, ProductReferencePage, ProductReconciliation,
    AssemblyInput, AssemblyCreate, AssemblyReview, AssemblySaved, AssemblyPage,
    ProductImportReview, ProductImportResult,
)
from app.services.auth import Identity
from app.services import products as service
from app.services import product_transfer
from app.api.v1.locations import read_file, UPLOAD
from app.api.v1.product_categories import DOWNLOAD
from app.services.downloads import server_record
from app.services.purchase_received_crypto import PRError
from app.services.allergens import authorize
from app.services.locations import LocationError

router = APIRouter(prefix="/admin/products", tags=["Products"])
manager = require_permissions("admin.access")


def release(db, actor, initiation_id, format, operation, data):
    evidence = server_record(db, actor, initiation_id, "product", operation, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-product-{"master" if operation == "export" else "template"}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store",
                             "X-Content-Type-Options": "nosniff"})


@router.get("/sample", operation_id="downloadStockProductSample", responses=DOWNLOAD)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    authorize(db, actor)
    return release(db, actor, initiation_id, format, "template", product_transfer.sample(format))


@router.get("/export", operation_id="exportStockProducts", responses=DOWNLOAD)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           category_id: uuid.UUID | None = Query(None),
           allergen_ids: list[uuid.UUID] | None = Query(None, max_length=100),
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return release(db, actor, initiation_id, format, "export",
                   product_transfer.export(db, actor, query, status, format, category_id, allergen_ids))


@router.post("/import/review", response_model=ProductImportReview, operation_id="reviewStockProductImport", openapi_extra=UPLOAD)
async def review_import(request: Request, filename: str = Query(min_length=1, max_length=200),
                        actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return product_transfer.transfer(db, actor, await read_product_file(request), filename)


@router.post("/import/commit", response_model=ProductImportResult, operation_id="commitStockProductImport", openapi_extra=UPLOAD)
async def commit_import(request: Request, filename: str = Query(min_length=1, max_length=200),
                        digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                        idempotency_key: uuid.UUID = Query(),
                        actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise PRError("Explicit all-or-nothing confirmation is required.", 422, "product_confirmation_required")
    return product_transfer.transfer(db, actor, await read_product_file(request), filename, True, digest, idempotency_key)


async def read_product_file(request):
    try:
        return await read_file(request)
    except LocationError as exc:
        raise PRError(exc.message, exc.status, exc.code.replace("location_", "product_")) from None


@router.get("", response_model=ProductPage, operation_id="listStockProducts")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            category_id: uuid.UUID | None = Query(None),
            allergen_ids: list[uuid.UUID] | None = Query(None, max_length=100),
            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, query, status, offset, limit, category_id, allergen_ids)


@router.get("/references", response_model=ProductReferencePage, operation_id="getStockProductReferences")
def references(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, query, offset, limit)


@router.get("/requests/{key}", response_model=ProductReconciliation, operation_id="reconcileStockProductRequest")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.get("/filter-references/{kind}", response_model=ProductReferencePage, operation_id="getStockProductFilterReferences")
def filter_references(kind: Literal["categories", "allergens"], query: str = Query("", max_length=200),
                      offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
                      actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.filter_references(db, actor, kind, query, offset, limit)


@router.post("/assemblies/preview", response_model=AssemblyReview, operation_id="previewProductAssembly")
def preview(body: AssemblyInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("/assemblies", response_model=AssemblySaved, status_code=201, operation_id="assembleStockProduct")
def assemble(body: AssemblyCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.assemble(db, actor, body)


@router.get("/assemblies/{record_id}", response_model=AssemblySaved, operation_id="getProductAssembly")
def assembly(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.assembly_detail(db, actor, record_id)


@router.post("", response_model=ProductView, status_code=201, operation_id="createStockProduct")
def create(body: ProductCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body)


@router.get("/{record_id}", response_model=ProductView, operation_id="getStockProduct")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)


@router.put("/{record_id}", response_model=ProductView, operation_id="editStockProduct")
def edit(record_id: uuid.UUID, body: ProductEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body, record_id, "edit")


@router.patch("/{record_id}/status", response_model=ProductView, operation_id="setStockProductStatus")
def status(record_id: uuid.UUID, body: ProductStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body, record_id, "status")


@router.delete("/{record_id}", response_model=ProductView, operation_id="deleteStockProduct")
def delete(record_id: uuid.UUID, body: ProductDelete, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutate(db, actor, body, record_id, "delete")


@router.get("/{record_id}/activity", response_model=ProductHistoryPage, operation_id="getStockProductActivity")
def activity(record_id: uuid.UUID, offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
             actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id, "activity", offset, limit)


@router.get("/{record_id}/analytics", response_model=ProductSummary, operation_id="getStockProductAnalytics")
def analytics(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id, "analytics")


@router.get("/{record_id}/assemblies", response_model=AssemblyPage, operation_id="getStockProductAssemblies")
def assemblies(record_id: uuid.UUID, offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id, "assemblies", offset, limit)
