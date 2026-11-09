"""Operational configuration is never exposed through MR order capabilities."""
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.immunotherapy_extract import Dosage, ImmExtractWrite, ImmExtractView, ImmExtractCategories
from app.services import immunotherapy_extract as service

router = APIRouter(prefix="/admin/immunotherapy-extract-settings", tags=["Immunotherapy Extract Settings"])


@router.get("/categories", response_model=ImmExtractCategories, operation_id="listImmunotherapyExtractCategories")
def categories(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(50, ge=1, le=100), actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.categories(db, actor, query, offset, limit)


@router.get("/{category_id}", response_model=ImmExtractView, operation_id="getImmunotherapyExtractSettings")
def read(category_id: uuid.UUID, dosage: Dosage, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.read(db, actor, category_id, dosage)


@router.post("/{category_id}", response_model=ImmExtractView, operation_id="saveImmunotherapyExtractSettings")
def write(category_id: uuid.UUID, body: ImmExtractWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return service.write(db, actor, category_id, body)
