"""Owning MR posting and narrowly protected Super Admin verification."""
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.settlements import (
    SettlementKind, SettlementInput, SettlementPage, SettlementRecord,
    SettlementReferences, SettlementBatchResult, SettlementReconciliation,
)
from app.services import settlements as service

router = APIRouter(prefix="/admin/settlements", tags=["settlements"])


@router.get("", response_model=SettlementPage, operation_id="listSettlements")
def listing(kind: Literal["All", "IT", "Kit", "SPT", "Lupin"] = "All",
            order_from: date | None = None, order_to: date | None = None,
            payment_from: date | None = None, payment_to: date | None = None,
            doctor_id: uuid.UUID | None = None, mr_id: uuid.UUID | None = None,
            patient_id: uuid.UUID | None = None,
            verification: Literal["All", "No transactions", "Not verified", "Verified"] = "All",
            search: str = Query("", max_length=100),
            order_status: Literal["All", "Confirmed", "Saved", "Approved", "In process", "Shipped",
                                  "Delivered", "Returned", "Rejected", "Cancelled"] = "All",
            payment_status: Literal["All", "Unpaid", "Part paid", "Paid", "Unavailable"] = "All",
            payable_only: bool = False,
            offset: int = Query(0, ge=0, le=20000), limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, kind=kind, order_from=order_from, order_to=order_to,
                           payment_from=payment_from, payment_to=payment_to, doctor_id=doctor_id,
                           mr_id=mr_id, patient_id=patient_id, verification=verification,
                           search=search, order_status=order_status, payment_status=payment_status,
                           payable_only=payable_only,
                           offset=offset, limit=limit)


@router.get("/references/{kind}", response_model=SettlementReferences, operation_id="settlementReferences")
def references(kind: Literal["doctors", "mrs", "patients"],
               search: str = Query("", max_length=100),
               offset: int = Query(0, ge=0, le=20000), limit: int = Query(25, ge=1, le=100),
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search=search, offset=offset, limit=limit)


@router.get("/history/{kind}/{identity}", response_model=SettlementRecord, operation_id="settlementOrderHistory")
def order_history(kind: SettlementKind, identity: uuid.UUID,
                  actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.order_history(db, actor, kind, identity)


@router.get("/requests/{key}", response_model=SettlementReconciliation, operation_id="reconcileSettlement")
def reconcile(key: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.post("/transactions", response_model=SettlementBatchResult, operation_id="recordSettlement")
def post(body: SettlementInput, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.post(db, actor, body)


@router.post("/transactions/{entry_id}/verify", response_model=SettlementRecord,
             operation_id="verifySettlementTransaction")
def verify(entry_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.verify(db, actor, entry_id)
