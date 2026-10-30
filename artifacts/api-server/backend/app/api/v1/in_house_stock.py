"""Dedicated protected reserve endpoints; no ordinary inventory source type."""
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.services.auth import Identity
from app.services import in_house_stock as service
from app.schemas.in_house_stock import (
    ReserveInput, ReserveCreate, ReserveReview, ReserveSaved, ReservePage,
    ReserveReferences, ReserveReconciliation,
)

router = APIRouter(prefix="/admin/in-house-stock", tags=["In-house Stock"])
manager = require_permissions("admin.access")


@router.get("/references/{kind}", response_model=ReserveReferences, operation_id="getInHouseStockReferences")
def references(kind: Literal["allergens", "locations"], query: str = Query("", max_length=200),
               offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
               include_inactive: bool = False,
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, offset, limit, include_inactive)


@router.post("/preview", response_model=ReserveReview, operation_id="previewInHouseStock")
def preview(body: ReserveInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("", response_model=ReserveSaved, status_code=201, operation_id="createInHouseStock")
def create(body: ReserveCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.create(db, actor, body)


@router.get("/requests/{key}", response_model=ReserveReconciliation, operation_id="reconcileInHouseStock")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.get("", response_model=ReservePage, operation_id="listInHouseStock")
def listing(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
            limit: int = Query(25, ge=1, le=100), allergen_id: uuid.UUID | None = None,
            from_date: date | None = None, to_date: date | None = None,
            date_field: Literal["recorded", "expiry"] = "recorded",
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, query, offset, limit, allergen_id, from_date, to_date, date_field)


@router.get("/export", response_model=ReservePage, operation_id="exportInHouseStock")
def export(query: str = Query("", max_length=200), allergen_id: uuid.UUID | None = None,
           from_date: date | None = None, to_date: date | None = None,
           date_field: Literal["recorded", "expiry"] = "recorded",
           actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    # Same finite encrypted scan and protected authorization as the listing.
    from app.services.inventory import LIMIT
    return service.listing(db, actor, query, 0, LIMIT, allergen_id, from_date, to_date, date_field)


@router.get("/{record_id}", response_model=ReserveSaved, operation_id="getInHouseStock")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)
