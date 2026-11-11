"""No issuance, payment or ordinary-admin access is exposed by these routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.invoice_settings import (
    InvoiceSettingsWrite, InvoiceSettingsView, InvoiceHistoryView,
    InvoiceQRView, InvoiceReconcileInput, InvoiceReconcileView,
)
from app.services.invoice_settings import operation

router = APIRouter(prefix="/admin/invoice-settings", tags=["Invoice Details"])


def private(response: Response):
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"


@router.get("", response_model=InvoiceSettingsView, operation_id="getInvoiceSettings")
def read(response: Response, actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor)


@router.post("", response_model=InvoiceSettingsView, operation_id="saveInvoiceSettings")
def write(body: InvoiceSettingsWrite, response: Response,
          actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, body=body, action="save")


@router.get("/history", response_model=InvoiceHistoryView, operation_id="listInvoiceSettingsHistory")
def history(response: Response, before_version: int | None = Query(None, ge=1, le=2147483647),
            limit: int = Query(10, ge=1, le=20),
            actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, action="history", before_version=before_version, limit=limit)


@router.get("/qr/{version}", response_model=InvoiceQRView, operation_id="getInvoiceSettingsQR")
def qr(response: Response, version: int = Path(ge=1, le=2147483647),
       actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, action="qr", version=version)


@router.post("/requests/{request_id}/reconcile", response_model=InvoiceReconcileView,
             operation_id="reconcileInvoiceSettings")
def reconcile(request_id: UUID, body: InvoiceReconcileInput, response: Response,
              actor=Depends(current_identity), db: Session = Depends(get_db)):
    private(response)
    return operation(db, actor, action="reconcile", request_id=request_id)
