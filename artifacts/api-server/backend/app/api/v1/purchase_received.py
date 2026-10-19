import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.purchase_received import (
    PRInput, PRCreate, PREdit, PRDelete, PRSaved, PRReview, PRPage, PRSource,
    PRActivityPage, PRAnalytics, PRFilters, PRReconciliation, PRReferencePage,
)
from app.services.auth import Identity
from app.services import purchase_received as service
from app.services import pr_batches
from app.schemas.pr_batches import PRBatchSettingsWrite, PRBatchSettingsView, PRBatchAllocationInput, PRBatchAllocationView

router = APIRouter(prefix="/admin/purchase-received", tags=["Purchase Received"])
manager = require_permissions("admin.access")


@router.get("/batch-settings", response_model=PRBatchSettingsView, operation_id="getPRBatchSettings")
def batch_settings(actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return pr_batches.read_settings(db, actor)


@router.post("/batch-settings", response_model=PRBatchSettingsView, operation_id="savePRBatchSettings")
def save_batch_settings(body: PRBatchSettingsWrite, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return pr_batches.write_settings(db, actor, body)


@router.post("/batch-allocations", response_model=PRBatchAllocationView, operation_id="allocatePRBatches")
def allocate_batches(body: PRBatchAllocationInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return pr_batches.allocate(db, actor, body)


def filters(query: str = Query("", max_length=200), status: Literal["active", "deleted", "all"] = "active",
            po_id: uuid.UUID | None = None, vendor_id: uuid.UUID | None = None, receipt_id: uuid.UUID | None = None,
            receiver: str = Query("", max_length=50), fulfillment: Literal["", "Open", "Partially Received", "Closed"] = "",
            from_date: date | None = None, to_date: date | None = None,
            sort: Literal["recent", "oldest", "number"] = "recent",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            activity_query: str = Query("", max_length=200)):
    if from_date and to_date and from_date > to_date:
        raise service.PRError("From date must not be after To date.", 422, "pr_date_range")
    return locals()


@router.get("", response_model=PRPage, operation_id="listPurchaseReceived")
def listing(params=Depends(filters), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, params)


@router.get("/export", response_model=PRPage, operation_id="exportPurchaseReceived")
def export(params=Depends(filters), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, params, export=True)


@router.get("/filter-options", response_model=PRFilters, operation_id="getPurchaseReceivedFilters")
def options(params=Depends(filters), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    def work(_, crypto):
        data, _, _ = service.query_data(db, crypto, {**params, "status": "all"})
        vendors, staff = {}, {}
        for r in data:
            vendors.setdefault(r["vendorId"], set()).add(r["vendorName"])
            if r["staffId"]:
                staff.setdefault(r["staffId"], set()).add(r["receivedBy"])
        return dict(vendors=[dict(id=k, name=" / ".join(sorted(v))) for k, v in sorted(vendors.items())],
                    receivers=[dict(id="staff:" + k, name=" / ".join(sorted(v))) for k, v in sorted(staff.items())]
                    + ([dict(id="other", name="Others (recorded names)")] if any(r["receiverMode"] == "other" for r in data) else []))
    return service.transaction(db, actor, work)


@router.get("/activity", response_model=PRActivityPage, operation_id="listPurchaseReceivedActivity")
def activity(params=Depends(filters), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reporting(db, actor, params)


@router.get("/analytics", response_model=PRAnalytics, operation_id="getPurchaseReceivedAnalytics")
def analytics(params=Depends(filters), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reporting(db, actor, params, analytics=True)


@router.get("/references/{kind}", response_model=PRReferencePage, operation_id="listPurchaseReceivedReferences")
def references(kind: Literal["staff", "orders"], query: str = Query("", max_length=200),
               selected_id: uuid.UUID | None = None, offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, selected_id, offset, limit)


@router.get("/sources/{po_id}", response_model=PRSource, operation_id="getPurchaseReceivedSource")
def source(po_id: uuid.UUID, exclude_id: uuid.UUID | None = None,
           actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.transaction(db, actor, lambda _, c: service.source(db, po_id, c, str(exclude_id) if exclude_id else None))


@router.get("/requests/{key}", response_model=PRReconciliation, operation_id="reconcilePurchaseReceived")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.post("/preview", response_model=PRReview, operation_id="previewPurchaseReceived")
def preview(body: PRInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("", response_model=PRSaved, status_code=201, operation_id="createPurchaseReceived")
def create(body: PRCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body)


@router.get("/{record_id}", response_model=PRSaved, operation_id="getPurchaseReceived")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.transaction(db, actor, lambda _, c: service.projection(service.get_row(db, record_id), c))


@router.post("/{record_id}/preview", response_model=PRReview, operation_id="previewPurchaseReceivedEdit")
def edit_preview(record_id: uuid.UUID, body: PRInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body, record_id)


@router.post("/{record_id}/edit", response_model=PRSaved, operation_id="editPurchaseReceived")
def edit(record_id: uuid.UUID, body: PREdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body, record_id, "updated")


@router.post("/{record_id}/delete", response_model=PRSaved, operation_id="deletePurchaseReceived")
def delete(record_id: uuid.UUID, body: PRDelete, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.mutation(db, actor, body, record_id, "deleted")
