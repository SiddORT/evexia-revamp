import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.purchase_orders import (
    POInput, POCreate, POEdit, PODelete, POResponse, POReview, POPage,
    POOverview, POActivityPage, POAnalytics, POReferencePage,
)
from app.services.auth import Identity
from app.services import purchase_orders as service
from app.services import procurement_documents as documents
from app.schemas.procurement_documents import SavedDocument, DocumentHistory

router = APIRouter(prefix="/admin/purchase-orders", tags=["Purchase Orders"])
manager = require_permissions("admin.access")


@router.get("", response_model=POPage, operation_id="listPurchaseOrders")
def listing(query: str = Query("", max_length=200), status: Literal["open", "deleted", "all"] = "open",
            vendor_id: uuid.UUID | None = None, product_id: uuid.UUID | None = None,
            from_date: date | None = None, to_date: date | None = None,
            sort: Literal["recent", "oldest"] = "recent", limit: int = Query(10, ge=1, le=100),
            offset: int = Query(0, ge=0, le=1000000), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, query, status, vendor_id, product_id, from_date, to_date, sort, limit, offset)


@router.get("/overview", response_model=POOverview, operation_id="getPurchaseOrderOverview")
def overview(actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.transaction(db, actor, lambda _: service.overview_data(db))


@router.get("/activity", response_model=POActivityPage, operation_id="listPurchaseOrderActivity")
def activity(query: str = Query("", max_length=200), limit: int = Query(10, ge=1, le=100),
             offset: int = Query(0, ge=0, le=1000000), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.activity(db, actor, query, limit, offset)


@router.get("/analytics", response_model=POAnalytics, operation_id="getPurchaseOrderAnalytics")
def analytics(actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.analytics(db, actor)


@router.get("/references/{kind}", response_model=POReferencePage, operation_id="listPurchaseOrderReferences")
def references(kind: Literal["vendors", "locations", "products"], query: str = Query("", max_length=200),
               limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
               selected_id: uuid.UUID | None = None, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, limit, offset, selected_id)


@router.get("/filter-options/{kind}", response_model=POReferencePage, operation_id="listPurchaseOrderFilterOptions")
def filters(kind: Literal["vendors", "products"], query: str = Query("", max_length=200),
            limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            selected_id: uuid.UUID | None = None, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, limit, offset, selected_id, historical=True)


@router.post("/preview", response_model=POReview, operation_id="previewPurchaseOrder")
def preview(body: POInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("", response_model=POResponse, status_code=201, operation_id="createPurchaseOrder")
def create(body: POCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body)


@router.get("/{record_id}", response_model=POResponse, operation_id="getPurchaseOrder")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.transaction(db, actor, lambda _: service.projection(db, service.find(db, record_id)))


@router.get("/{record_id}/documents", response_model=SavedDocument, operation_id="getPurchaseOrderDocument")
def document(record_id: uuid.UUID, revision: int | None = Query(None, ge=1),
             actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    def work(_):
        service.find(db, record_id)
        return documents.document_data(db, "po", record_id, revision)
    return service.transaction(db, actor, work)


@router.get("/{record_id}/history", response_model=DocumentHistory, operation_id="getPurchaseOrderChanges")
def history(record_id: uuid.UUID, limit: int = Query(10, ge=1, le=50), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    def work(_):
        service.find(db, record_id)
        return documents.history_data(db, "po", record_id, limit, offset)
    return service.transaction(db, actor, work)


@router.post("/{record_id}/preview", response_model=POReview, operation_id="previewPurchaseOrderEdit")
def edit_preview(record_id: uuid.UUID, body: POInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body, record_id)


@router.post("/{record_id}/edit", response_model=POResponse, operation_id="editPurchaseOrder")
def edit(record_id: uuid.UUID, body: POEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body, record_id, "updated")


@router.post("/{record_id}/delete", response_model=POResponse, operation_id="deletePurchaseOrder")
def delete(record_id: uuid.UUID, body: PODelete, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body, record_id, "deleted")
