import uuid
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.inventory import (
    MoveInput, MoveCreate, InventoryStockPage, InventoryHistoryPage,
    InventoryReferencePage, InventoryInitializationPage, MovementPage,
    MovementReview, MovementSaved, MovementActivity, MovementSummary, MovementReconciliation,
)
from app.services.auth import Identity
from app.services import inventory as service

router = APIRouter(prefix="/admin/inventory", tags=["Inventory"])
manager = require_permissions("admin.access")


@router.get("/stock", response_model=InventoryStockPage, operation_id="listInventoryStock")
def stock(query: str = Query("", max_length=200), category_id: uuid.UUID | None = None,
          product_ids: str = Query("", max_length=4000), snapshot: bool = False,
          stock_status: Literal["all", "in_stock", "out_of_stock", "stock_alert"] = "all",
          offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
          actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.stock(db, actor, dict(query=query, category_id=category_id, product_ids=product_ids,
        stock_status=stock_status, snapshot=snapshot, offset=offset, limit=limit))


@router.get("/stock/{product_id}/history", response_model=InventoryHistoryPage, operation_id="getInventoryStockHistory")
def history(product_id: uuid.UUID, from_date: datetime | None = None, to_date: datetime | None = None,
            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if from_date and to_date and from_date >= to_date:
        raise service.PRError("Choose an increasing history period.", 422, "inventory_period")
    return service.stock_history(db, actor, product_id, from_date, to_date, offset, limit)


@router.get("/initialization", response_model=InventoryInitializationPage, response_model_exclude_none=True, operation_id="reviewInventoryInitialization")
def initialization(offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
                   actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.initialization_report(db, actor, offset, limit)


@router.get("/references/{kind}", response_model=InventoryReferencePage, response_model_exclude_none=True, operation_id="getInventoryReferences")
def references(kind: Literal["locations", "staff", "lots", "movement-sources", "movement-destinations", "movement-allergens"], query: str = Query("", max_length=200),
               source_id: uuid.UUID | None = None, offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100), unallocated: bool = False,
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, offset, limit, source_id, unallocated)


@router.get("/movements", response_model=MovementPage, operation_id="listInventoryMovements")
def listing(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
            limit: int = Query(10, ge=1, le=100), source_id: uuid.UUID | None = None,
            destination_id: uuid.UUID | None = None, unallocated: bool = False,
            allergen_ids: str = Query("", max_length=4000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if source_id and unallocated:
        raise service.PRError("Choose a real source or Unallocated, not both.", 422, "inventory_source")
    try:
        selected = {str(uuid.UUID(key)) for key in allergen_ids.split(",")} if allergen_ids else set()
        if len(selected) > 100:
            raise ValueError()
    except ValueError:
        raise service.PRError("Choose up to 100 valid allergen identifiers.", 422, "inventory_filter") from None
    return service.movements(db, actor, query, offset, limit, source_id=source_id,
        destination_id=destination_id, unallocated=unallocated, allergen_ids=selected)


@router.get("/requests/{key}", response_model=MovementReconciliation, operation_id="reconcileInventoryMovement")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.post("/movements/preview", response_model=MovementReview, operation_id="previewInventoryMovement")
def preview(body: MoveInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("/movements", response_model=MovementSaved, status_code=201, operation_id="createInventoryMovement")
def create(body: MoveCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.create(db, actor, body)


@router.get("/movements/{record_id}", response_model=MovementSaved, operation_id="getInventoryMovement")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.movements(db, actor, record_id=record_id)


@router.get("/movements/{record_id}/activity", response_model=list[MovementActivity], operation_id="getInventoryMovementActivity")
def activity(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.movements(db, actor, record_id=record_id, section="activity")


@router.get("/movements/{record_id}/analytics", response_model=MovementSummary, operation_id="getInventoryMovementAnalytics")
def analytics(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.movements(db, actor, record_id=record_id, section="summary")
