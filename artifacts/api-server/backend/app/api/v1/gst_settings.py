"""Independent protected settings endpoints; not order capabilities."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.gst_settings import GSTSettingsWrite, GSTSettingsView
from app.services.gst_settings import transaction

router = APIRouter(prefix="/admin/gst-settings", tags=["GST Settings"])


@router.get("", response_model=GSTSettingsView, operation_id="getGSTSettings")
def read(actor=Depends(current_identity), db: Session = Depends(get_db)):
    return transaction(db, actor)


@router.post("", response_model=GSTSettingsView, operation_id="saveGSTSettings")
def write(body: GSTSettingsWrite, actor=Depends(current_identity), db: Session = Depends(get_db)):
    return transaction(db, actor, body)
