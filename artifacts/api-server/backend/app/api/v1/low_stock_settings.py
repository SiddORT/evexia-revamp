from uuid import UUID
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.low_stock import LowStockSettingsWrite, LowStockSettingsView, LowStockSaveOutcome
from app.services.low_stock_settings import operation

router = APIRouter(prefix="/admin/low-stock-settings", tags=["Low Stock Settings"])


def private(response):
    response.headers["Cache-Control"] = "no-store, private"


@router.get("", response_model=LowStockSettingsView, operation_id="getLowStockSettings")
def read(response: Response, actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor)


@router.post("", response_model=LowStockSaveOutcome, operation_id="saveLowStockSettings")
def write(body: LowStockSettingsWrite, response: Response, actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, body=body)


@router.post("/requests/{key}/reconcile", response_model=LowStockSaveOutcome, operation_id="reconcileLowStockSettings")
def reconcile(key: UUID, response: Response, actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, request_id=key)
