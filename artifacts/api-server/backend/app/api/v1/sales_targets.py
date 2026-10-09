import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.api.v1.vendors import BINARY_RESPONSES, UPLOAD, release
from app.api.v1.vendors import read_file as read_vendor_file
from app.db.session import get_db
from app.schemas.sales_targets import (SalesTargetFields, SalesTargetEdit, SalesTargetStatus, SalesTargetVersion,
                                      SalesTargetResponse, SalesTargetPage, SalesTargetReview,
                                      SalesTargetImportResult, SalesTargetChoices)
from app.services.auth import Identity
from app.services import sales_targets, sales_target_transfer
from app.services.vendors import VendorError
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/sales-targets", tags=["Sales Target Master"])
manager = require_permissions("admin.access")


def filters(query: str = Query("", max_length=100), status: Literal["all", "active", "inactive"] = "all",
            zoneId: uuid.UUID | None = None, mrId: uuid.UUID | None = None,
            startYear: int | None = Query(None, ge=1, le=9998), endYear: int | None = Query(None, ge=2, le=9999)):
    return dict(query=query, status=status, zoneId=zoneId, mrId=mrId, startYear=startYear, endYear=endYear)


@router.get("", response_model=SalesTargetPage, operation_id="listSalesTargets")
def listing(filters: dict = Depends(filters), limit: int = Query(10, ge=1, le=100),
            offset: int = Query(0, ge=0, le=1000000), actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.listing(db, actor, filters, limit, offset)


@router.post("", response_model=SalesTargetResponse, status_code=201, operation_id="createSalesTarget")
def create(body: SalesTargetFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.create(db, actor, body)


@router.get("/choices", response_model=SalesTargetChoices, operation_id="getSalesTargetChoices")
def choices(query: str = Query("", max_length=100), zoneId: uuid.UUID | None = None,
            limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            zoneQuery: str = Query("", max_length=100), zoneOffset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.choices(db, actor, query, zoneId, limit, offset, zoneQuery, zoneOffset)


@router.get("/export", operation_id="exportSalesTargets", responses=BINARY_RESPONSES)
def export(filters: dict = Depends(filters), format: Literal["csv", "xlsx"] = "csv",
           actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    data = sales_target_transfer.export(db, actor, filters, format)
    evidence = server_record(db, actor, initiation_id, "sales_target", "export", format.upper())
    return release(data, format, evidence, "evexia-sales-target-master")


@router.get("/sample", operation_id="downloadSalesTargetSample", responses=BINARY_RESPONSES)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    sales_targets.transaction(db, lambda: sales_targets.authorize(db, actor))
    data = sales_target_transfer.sample(format)
    evidence = server_record(db, actor, initiation_id, "sales_target", "template", format.upper())
    return release(data, format, evidence, "evexia-sales-target-template")


async def read_file(request):
    # Reuse the strict bounded raw/multipart parser without leaking Vendor errors.
    try:
        return await read_vendor_file(request)
    except VendorError as exc:
        raise sales_targets.SalesTargetError(exc.message, exc.status, exc.code.replace("vendor_", "sales_target_")) from None


@router.post("/import/review", response_model=SalesTargetReview, operation_id="reviewSalesTargetImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_target_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=SalesTargetImportResult, operation_id="commitSalesTargetImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise sales_targets.SalesTargetError("Explicit confirmation is required.", 422, "sales_target_confirmation_required")
    return sales_target_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("/{target_id}", response_model=SalesTargetResponse, operation_id="getSalesTarget")
def detail(target_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.detail(db, actor, target_id)


@router.post("/{target_id}/edit", response_model=SalesTargetResponse, operation_id="editSalesTarget")
def edit(target_id: uuid.UUID, body: SalesTargetEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.mutate(db, actor, target_id, body, "edit")


@router.post("/{target_id}/status", response_model=SalesTargetResponse, operation_id="setSalesTargetStatus")
def status(target_id: uuid.UUID, body: SalesTargetStatus, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.mutate(db, actor, target_id, body, "status")


@router.post("/{target_id}/delete", response_model=SalesTargetResponse, operation_id="deleteSalesTarget")
def delete(target_id: uuid.UUID, body: SalesTargetVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return sales_targets.mutate(db, actor, target_id, body, "delete")
