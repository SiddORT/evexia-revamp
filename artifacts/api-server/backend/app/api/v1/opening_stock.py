"""Protected physical stock initialization and authenticated bounded transfers."""
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import operation_router
from app.db.session import get_db
from app.services.auth import Identity
from app.schemas.opening_stock import (
    OpeningInput, OpeningCreate, OpeningReview, OpeningResult, OpeningPage,
    OpeningSaved, OpeningSummary, OpeningActivityPage, OpeningReferencePage,
    OpeningReconciliation, OpeningImportReview,
)
from app.services import opening_stock as service, opening_stock_transfer as transfer
from app.services.downloads import server_record
from app.services.purchase_received_crypto import PRError
# Same inert bounded raw/multipart reader used by the existing master transfers.
from app.api.v1.languages import read_file, FILE_RESPONSES, UPLOAD
from app.services.languages import LanguageError

router = APIRouter(prefix="/admin/opening-stock", tags=["Opening Stock"])
manager = operation_router("opening_stock", {
    "sample": "import", "export": "export", "import_review": "import", "listing": None,
    "detail": None, "references": None, "reconcile": ("add", "import"),
    "preview": ("add", "import"), "create": ("add", "import"),
})


def download_response(db, actor, data, format, initiation_id, kind):
    evidence = server_record(db, actor, initiation_id, "opening_stock", kind, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="evexia-opening-stock-{kind}.{format}"',
                 "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/sample", operation_id="downloadOpeningStockSample", responses=FILE_RESPONSES, response_class=Response)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager),
           db: Session = Depends(get_db), initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return download_response(db, actor, transfer.sample(db, actor, format), format, initiation_id, "template")


@router.get("/export", operation_id="exportOpeningStock", responses=FILE_RESPONSES, response_class=Response)
def export(query: str = Query("", max_length=200), format: Literal["csv", "xlsx"] = "csv",
           actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return download_response(db, actor, transfer.export(db, actor, query, format), format, initiation_id, "export")


@router.post("/import/review", operation_id="reviewOpeningStockImport", response_model=OpeningImportReview, openapi_extra=UPLOAD)
async def import_review(request: Request, filename: str = Query(min_length=1, max_length=200),
                        actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    try:
        data = await read_file(request)
    except LanguageError as exc:
        raise PRError(exc.message, exc.status, "opening_upload") from None
    return transfer.review(db, actor, data, filename)


@router.get("/references/items", response_model=OpeningReferencePage, operation_id="getOpeningStockItems")
def references(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, query, offset, limit)


@router.get("/requests/{key}", response_model=OpeningReconciliation, operation_id="reconcileOpeningStockRequest")
def reconcile(key: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.reconcile(db, actor, key)


@router.post("/preview", response_model=OpeningReview, operation_id="previewOpeningStock")
def preview(body: OpeningInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.preview(db, actor, body)


@router.post("", response_model=OpeningResult, status_code=201, operation_id="createOpeningStock")
def create(body: OpeningCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.create(db, actor, body)


@router.get("", response_model=OpeningPage, operation_id="listOpeningStock")
def listing(query: str = Query("", max_length=200), offset: int = Query(0, ge=0, le=1000000),
            limit: int = Query(25, ge=1, le=100), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, query, offset, limit)


@router.get("/{record_id}", response_model=OpeningSaved, operation_id="getOpeningStock")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)


@router.get("/{record_id}/activity", response_model=OpeningActivityPage, operation_id="getOpeningStockActivity")
def activity(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id, "activity")


@router.get("/{record_id}/analytics", response_model=OpeningSummary, operation_id="getOpeningStockAnalytics")
def analytics(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id, "analytics")
