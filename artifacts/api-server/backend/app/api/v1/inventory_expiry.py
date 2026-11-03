import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.services.auth import Identity
from app.schemas.expiry import (
    CostInput, DisposalInput, DisposalCreate, InventoryExpiryPage,
    ExpiryDisposalReview, InventoryExpiryRow, ExpiryCostEvidence, ExpiryReconciliation,
)
from app.services import inventory_expiry as service

router = APIRouter(prefix="/admin/inventory/expiry", tags=["Inventory expiry"])


@router.get("", response_model=InventoryExpiryPage, operation_id="listInventoryExpiry")
@router.get("/reconcile", response_model=InventoryExpiryPage, operation_id="refreshInventoryExpiry")
def listing(view: Literal["soon", "expired", "history"] = "expired",
            group: Literal["all", "today", "next15"] = "all",
            query: str = Query("", max_length=200),
            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, view, group, query, offset, limit)


@router.post("/review", response_model=ExpiryDisposalReview, operation_id="reviewExpiryDisposal")
def review(body: DisposalInput, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("/disposals", response_model=InventoryExpiryRow, operation_id="disposeExpiredInventory")
def dispose(body: DisposalCreate, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.dispose(db, actor, body)


@router.post("/costs", response_model=ExpiryCostEvidence, operation_id="recordActualBatchCost")
def cost(body: CostInput, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.supply_cost(db, actor, body)


@router.get("/requests/{key}", response_model=ExpiryReconciliation, operation_id="reconcileExpiryRequest")
def reconcile(key: uuid.UUID, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)
