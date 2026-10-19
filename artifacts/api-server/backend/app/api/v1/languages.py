import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_zone
from app.db.session import get_db
from app.schemas.languages import LanguageFields, LanguageEdit, LanguageVersion, LanguageResponse, LanguagePage, LanguageHistory
from app.services.auth import Identity
from app.services import languages

router = APIRouter(prefix="/admin/languages", tags=["Language Master"])
# Reuse the protected singleton gate, never the assignable Zone grants.
manager = require_zone(protected=True)


@router.get("", response_model=LanguagePage, operation_id="listLanguages")
def listing(query: str = Query("", max_length=200), limit: int = Query(10, ge=1, le=100),
            offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.listing(db, actor, query, limit, offset)


@router.post("", response_model=LanguageResponse, status_code=201, operation_id="createLanguage")
def create(body: LanguageFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.create(db, actor, body)


@router.get("/{language_id}", response_model=LanguageResponse, operation_id="getLanguage")
def detail(language_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.detail(db, actor, language_id)


@router.post("/{language_id}/edit", response_model=LanguageResponse, operation_id="editLanguage")
def edit(language_id: uuid.UUID, body: LanguageEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.mutate(db, actor, language_id, body, "edit")


@router.post("/{language_id}/delete", response_model=LanguageResponse, operation_id="deleteLanguage")
def delete(language_id: uuid.UUID, body: LanguageVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.mutate(db, actor, language_id, body, "delete")


@router.get("/{language_id}/history", response_model=LanguageHistory, operation_id="getLanguageHistory")
def history(language_id: uuid.UUID, limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.history(db, actor, language_id, limit, offset)
