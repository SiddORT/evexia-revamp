"""Shared Admin/MR SPT operations; service ownership is mandatory."""
import uuid
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity, operation_router
from app.db.session import get_db
from app.schemas.spt import SptWrite, SptRegistration, SptPatient, SptRecord, SptPage, SptImport, SptImportResult, Status
from app.schemas.immunotherapy import ImmReferencePage, ImmImportReview
from app.services import spt as service
from app.schemas.order_approval import OrderApproval
from app.services.order_approval import approve as approve_order

router = APIRouter(prefix="/admin/spt-orders", tags=["spt"],
    dependencies=[Depends(operation_router("spt", {
        "listing": None, "detail": None, "references": None, "export": "export",
        "review": "import", "commit": "import", "create": "add", "edit": "edit", "approve": "edit",
        "register": ("add", "import"),
    }, allow_mr=True))])


def filters(search: str = Query("", max_length=200), status: Status | None = None,
            doctor_id: uuid.UUID | None = None, mr_id: uuid.UUID | None = None,
            patient_id: uuid.UUID | None = None, from_date: date | None = None, to_date: date | None = None):
    return dict(search=search, status=status, doctor_id=doctor_id, mr_id=mr_id,
        patient_id=patient_id, from_date=from_date, to_date=to_date)


@router.post("/{record_id}/approve", response_model=SptRecord, operation_id="approveSptOrder")
def approve(record_id: uuid.UUID, body: OrderApproval, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return approve_order(db, actor, record_id, body, "spt")


@router.get("", response_model=SptPage, operation_id="listSptOrders")
def listing(values=Depends(filters), cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, cursor=cursor, limit=limit)


@router.get("/export", response_model=SptPage, operation_id="exportSptOrders")
def export(values=Depends(filters), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.listing(db, actor, **values, complete=True)


@router.get("/references/{kind}", response_model=ImmReferencePage, operation_id="sptReferences")
def references(kind: Literal["patients", "doctors", "mrs"], search: str = Query("", max_length=200),
               cursor: uuid.UUID | None = None, limit: int = Query(25, ge=1, le=100), selected: uuid.UUID | None = None,
               actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, search, cursor, limit, selected)


@router.post("/patients", response_model=SptPatient, operation_id="registerSptPatient")
def register(body: SptRegistration, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.register(db, actor, body)


@router.post("/import/review", response_model=ImmImportReview, operation_id="reviewSptImport")
def review(body: SptImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body)


@router.post("/import/commit", response_model=SptImportResult, operation_id="commitSptImport")
def commit(body: SptImport, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.batch(db, actor, body, True)


@router.post("", response_model=SptRecord, operation_id="createSptOrder")
def create(body: SptWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.post("/{record_id}/edit", response_model=SptRecord, operation_id="editSptDraft")
def edit(record_id: uuid.UUID, body: SptWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.save(db, actor, body, record_id)


@router.get("/{record_id}", response_model=SptRecord, operation_id="getSptOrder")
def detail(record_id: uuid.UUID, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)
