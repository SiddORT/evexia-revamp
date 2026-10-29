"""Super Admin-only fulfillment; never grants courier administration."""
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.shipments import (
    ShipmentType, ShipmentDispatch, ShipmentDelivery, ShipmentCommand,
    ShipmentRecord, ShipmentPage, ShipmentCouriers,
)
from app.services import shipments as service

router = APIRouter(prefix="/admin/shipments", tags=["shipments"])


def filters(search: str = Query("", max_length=200),
            status: Literal["All", "In process", "Shipped", "Returned"] = "In process",
            type: Literal["All", "Kit", "IT", "Lupin", "SPT"] = "All",
            from_date: date | None = None, to_date: date | None = None):
    return dict(search=search, status=status, type=type, from_date=from_date, to_date=to_date)


@router.get("", response_model=ShipmentPage, operation_id="listShipments")
def listing(values=Depends(filters), offset: int = Query(0, ge=0, le=20000),
            limit: int = Query(25, ge=1, le=100), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, offset=offset, limit=limit)


@router.get("/export", response_model=ShipmentPage, operation_id="exportShipments")
def export(values=Depends(filters), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, complete=True)


@router.get("/couriers", response_model=ShipmentCouriers, operation_id="shipmentCouriers")
def couriers(search: str = Query("", max_length=100), offset: int = Query(0, ge=0, le=100000),
             limit: int = Query(25, ge=1, le=100), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.couriers(db, actor, search=search, offset=offset, limit=limit)


@router.post("/{kind}/{identity}/ship", response_model=ShipmentRecord, operation_id="dispatchShipment")
def dispatch(kind: ShipmentType, identity: uuid.UUID, body: ShipmentDispatch,
             actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.mutate(db, actor, kind, identity, body, "ship")


@router.post("/{kind}/{identity}/delivery", response_model=ShipmentRecord, operation_id="recordShipmentDelivery")
def delivery(kind: ShipmentType, identity: uuid.UUID, body: ShipmentDelivery,
             actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.mutate(db, actor, kind, identity, body, "delivery")


@router.post("/{kind}/{identity}/return", response_model=ShipmentRecord, operation_id="returnShipment")
def returned(kind: ShipmentType, identity: uuid.UUID, body: ShipmentCommand,
             actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.mutate(db, actor, kind, identity, body, "return")
