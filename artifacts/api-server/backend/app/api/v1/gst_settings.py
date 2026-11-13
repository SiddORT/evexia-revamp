"""Independent protected settings endpoints; not order capabilities."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.gst_settings import GSTSettingsWrite, GSTSettingsView, GSTHistoryPage
from app.services.gst_settings import transaction

router = APIRouter(prefix="/admin/gst-settings", tags=["GST Settings"])


@router.get("", response_model=GSTSettingsView, operation_id="getGSTSettings")
def read(actor=Depends(current_identity), db: Session = Depends(get_db)):
    return transaction(db, actor)


@router.post("", response_model=GSTSettingsView, operation_id="saveGSTSettings")
def write(body: GSTSettingsWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return transaction(db, actor, body)


@router.get("/history", response_model=GSTHistoryPage, operation_id="getGSTHistory")
def history(before_version: int | None = Query(None, ge=1), limit: int = Query(10, ge=1, le=25),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    return transaction(db, actor, history_read=True, before_version=before_version, limit=limit)
