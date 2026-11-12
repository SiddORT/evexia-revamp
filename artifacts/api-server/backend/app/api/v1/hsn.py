import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import master_router
from app.db.session import get_db
from app.schemas.hsn import HsnFields, HsnEdit, HsnStatus, HsnResponse, HsnPage
from app.services import hsn
from app.services.auth import Identity

router = APIRouter(prefix="/admin/hsn", tags=["HSN Master"])
manager = master_router("hsn")


@router.get("", response_model=HsnPage, operation_id="listHsnMappings")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return hsn.listing(db, actor, query, status, limit, offset)


@router.post("", response_model=HsnResponse, status_code=201, operation_id="createHsnMapping")
def create(body: HsnFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return hsn.save(db, actor, body)


@router.post("/{record_id}/edit", response_model=HsnResponse, operation_id="editHsnMapping")
def edit(record_id: uuid.UUID, body: HsnEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return hsn.save(db, actor, body, record_id)


@router.post("/{record_id}/status", response_model=HsnResponse, operation_id="statusHsnMapping")
def status(record_id: uuid.UUID, body: HsnStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return hsn.save(db, actor, body, record_id, status_only=True)
