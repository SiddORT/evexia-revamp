import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.products import (
    ProductCreate, ProductEdit, ProductDelete, ProductStatus, ProductView, ProductPage,
    ProductHistoryPage, ProductSummary, ProductReferencePage, ProductReconciliation,
    AssemblyInput, AssemblyCreate, AssemblyReview, AssemblySaved, AssemblyPage,
)
from app.services.auth import Identity
from app.services import products as service

router = APIRouter(prefix="/admin/products", tags=["Products"])
manager = require_permissions("admin.access")


@router.get("", response_model=ProductPage, operation_id="listStockProducts")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, query, status, offset, limit)


@router.get("/references", response_model=ProductReferencePage, operation_id="getStockProductReferences")
def references(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, query, offset, limit)


@router.get("/requests/{key}", response_model=ProductReconciliation, operation_id="reconcileStockProductRequest")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


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
