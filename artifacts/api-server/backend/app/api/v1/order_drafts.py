"""Shared creator-private draft endpoints; SPT retains its existing contract."""
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.order_drafts import DraftKind, DraftWrite, DraftSubmit, DraftRecord, DraftPage
from app.schemas.immunotherapy import ImmRecord
from app.schemas.kits import KitsRecord
from app.schemas.lupin import LupinRecord
from app.services import order_drafts as service

router = APIRouter(prefix="/admin/order-drafts", tags=["order-drafts"])


@router.get("/{kind}", response_model=DraftPage, operation_id="listOrderDrafts")
def listing(kind: DraftKind, cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=50),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.read(db, actor, kind, cursor=cursor, limit=limit)


@router.get("/{kind}/{identity}", response_model=DraftRecord, operation_id="getOrderDraft")
def detail(kind: DraftKind, identity: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.read(db, actor, kind, identity)


@router.post("/{kind}/{identity}", response_model=DraftRecord, operation_id="saveOrderDraft")
def save(kind: DraftKind, identity: uuid.UUID, body: DraftWrite,
         actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, kind, identity, body)


@router.post("/{kind}/{identity}/submit", response_model=ImmRecord | KitsRecord | LupinRecord, operation_id="submitOrderDraft")
def submit(kind: DraftKind, identity: uuid.UUID, body: DraftSubmit,
           actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.submit(db, actor, kind, identity, body)
