import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.api.v1.locations import read_file, UPLOAD
from app.api.v1.product_categories import DOWNLOAD
from app.db.session import get_db
from app.schemas.opening_balances import (
    OpeningBalanceFields, OpeningBalanceEdit, OpeningBalanceVersion, OpeningBalanceStatus,
    OpeningBalanceResponse, OpeningBalancePage, OpeningBalanceDoctorPage, OpeningBalanceReview, OpeningBalanceImportResult,
)
from app.services.auth import Identity
from app.services import opening_balances as balances, opening_balance_transfer as transfer
from app.services.locations import LocationError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/opening-balances", tags=["Opening Balance Master"])
manager = require_permissions("admin.access")


@router.get("", response_model=OpeningBalancePage, operation_id="listOpeningBalances")
def listing(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
            cursor: uuid.UUID | None = None,
            limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.listing(db, actor, query, status, limit, offset, cursor)


@router.get("/references", response_model=OpeningBalanceDoctorPage, operation_id="openingBalanceDoctorChoices")
def references(query: str = Query("", max_length=200), limit: int = Query(50, ge=1, le=100),
               cursor: uuid.UUID | None = None,
               offset: int = Query(0, ge=0, le=1000000), balance_id: uuid.UUID | None = None,
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.choices(db, actor, query, limit, offset, balance_id, cursor)


@router.post("", response_model=OpeningBalanceResponse, status_code=201, operation_id="createOpeningBalance")
def create(body: OpeningBalanceFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.create(db, actor, body)


def release(db, actor, initiation_id, format, operation, data):
    evidence = server_record(db, actor, initiation_id, "opening_balance", operation, format.upper())
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="evexia-opening-balances-{operation}.{format}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/export", operation_id="exportOpeningBalances", responses=DOWNLOAD)
def export(query: str = Query("", max_length=200), status: Literal["all", "active", "inactive"] = "all",
           format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return release(db, actor, initiation_id, format, "export", transfer.export(db, actor, query, status, format))


@router.get("/sample", operation_id="downloadOpeningBalanceSample", responses=DOWNLOAD)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    balances.transaction(db, lambda: balances.authorize(db, actor))
    return release(db, actor, initiation_id, format, "template", transfer.sample(format))


async def upload(request):
    try:
        return await read_file(request)
    except LocationError as exc:
        raise balances.OpeningBalanceError(exc.message, exc.status, exc.code.replace("location_", "opening_balance_")) from None


@router.post("/import/review", response_model=OpeningBalanceReview, operation_id="reviewOpeningBalanceImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return transfer.transfer(db, actor, await upload(request), filename)


@router.post("/import/commit", response_model=OpeningBalanceImportResult, operation_id="commitOpeningBalanceImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200), digest: str = Query(pattern=r"^[0-9a-f]{64}$"),
                 confirm: bool = Query(), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise balances.OpeningBalanceError("Explicit confirmation required.", 422, "opening_balance_confirmation_required")
    return transfer.transfer(db, actor, await upload(request), filename, confirm, digest)


@router.get("/{balance_id}", response_model=OpeningBalanceResponse, operation_id="getOpeningBalance")
def detail(balance_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.detail(db, actor, balance_id)


@router.post("/{balance_id}/edit", response_model=OpeningBalanceResponse, operation_id="editOpeningBalance")
def edit(balance_id: uuid.UUID, body: OpeningBalanceEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.mutate(db, actor, balance_id, body, "edit")


@router.post("/{balance_id}/status", response_model=OpeningBalanceResponse, operation_id="setOpeningBalanceStatus")
def status(balance_id: uuid.UUID, body: OpeningBalanceStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.mutate(db, actor, balance_id, body, "status")


@router.post("/{balance_id}/delete", response_model=OpeningBalanceResponse, operation_id="deleteOpeningBalance")
def delete(balance_id: uuid.UUID, body: OpeningBalanceVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return balances.mutate(db, actor, balance_id, body, "delete")
