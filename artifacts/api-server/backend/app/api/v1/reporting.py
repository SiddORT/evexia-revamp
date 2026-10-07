"""Protected global reporting; owner-only auth endpoints remain unchanged."""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.security import utcnow
from app.db.session import get_db
from app.repositories import reporting, report_exports
from app.schemas.reporting import EventPage, ReportExport, ReportSummary, SessionPage, UserPage
from app.services.auth import Identity
from app.schemas.activity import BrowserActivityBatch
from app.services.activity import record_activity
from app.api.deps import require_cookie_origin

router = APIRouter(prefix="/admin/reporting", tags=["admin-reporting"])
Admin = Annotated[Identity, Depends(require_permissions("admin.access"))]
Database = Annotated[Session, Depends(get_db)]

from app.schemas.downloads import DownloadInitiation, DownloadEvidence, DownloadPage
from app.services import downloads as download_service
from app.repositories import downloads as download_reporting


@router.post("/downloads/initiate", response_model=DownloadEvidence, operation_id="recordDownloadInitiation",
             dependencies=[Depends(require_cookie_origin)])
def initiate_download(body: DownloadInitiation, identity: Admin, db: Database):
    return download_service.record(db, identity, body.initiation_id, body.source, body.kind,
                                   body.format, "browser_reported")


@router.post("/activity", status_code=204, operation_id="recordBrowserActivity",
             dependencies=[Depends(require_cookie_origin)])
def activity(body: BrowserActivityBatch, request: Request, identity: Admin, db: Database):
    """Bounded browser-reported metadata; actor/session are server-derived."""
    record_activity(db, identity, body, request.state.request_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def page(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
    return limit, offset


def filters(user_id: uuid.UUID | None = None, start: datetime | None = None,
            end: datetime | None = None):
    for value in (start, end):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise HTTPException(422, "Dates require a timezone")
        if value is not None and not 1970 <= value.year <= 2100:
            raise HTTPException(422, "Dates must be between 1970 and 2100")
    if start is not None:
        start = start.astimezone(timezone.utc)
    if end is not None:
        end = end.astimezone(timezone.utc)
    if start is not None and end is not None and start >= end:
        raise HTTPException(422, "Start must precede exclusive end")
    return user_id, start, end


@router.get("/downloads", response_model=DownloadPage, operation_id="listDownloadLogs")
def download_logs(identity: Admin, db: Database, selection=Depends(filters),
                  limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
                  q: str = Query("", max_length=100), format: Literal["PDF", "CSV", "XLSX"] | None = None):
    return download_reporting.listing(db, limit, offset, *selection, q, format)


@router.get("/summary", response_model=ReportSummary, operation_id="getReportingSummary")
def summary(identity: Admin, db: Database):
    """Global persisted accounts and distinct eligible session owners, unaffected by filters."""
    return reporting.summary(db, utcnow(), identity.session_id)


@router.get("/users", response_model=UserPage, operation_id="listReportingUsers")
def users(identity: Admin, db: Database, pagination=Depends(page),
          q: str = Query("", max_length=100)):
    """Bounded search of registered backend accounts, including disabled/unmapped accounts."""
    return reporting.users(db, *pagination, q)


@router.get("/sessions", response_model=SessionPage, operation_id="listReportingSessions")
def sessions(identity: Admin, db: Database, pagination=Depends(page), selection=Depends(filters),
             q: str = Query("", max_length=100),
             state: Literal["ACTIVE", "EXPIRED", "REVOKED", "INVALIDATED"] | None = None):
    """Creation-time range [start,end), timezone required. Newest timestamp then ID descending."""
    return reporting.sessions(db, utcnow(), identity.session_id, *pagination, *selection, q, state)


@router.get("/events", response_model=EventPage, operation_id="listReportingEvents")
def events(identity: Admin, db: Database, pagination=Depends(page), selection=Depends(filters),
           q: str = Query("", max_length=100)):
    """Occurrence-time range [start,end). All recorded categories; missing actors are retained."""
    return reporting.events(db, *pagination, *selection, q)

@router.get("/sessions/export", response_model=ReportExport, operation_id="exportReportingSessions")
def export_sessions(identity: Admin, db: Database, selection=Depends(filters),
                    q: str = Query("", max_length=100),
                    state: Literal["ACTIVE", "EXPIRED", "REVOKED", "INVALIDATED"] | None = None):
    """Fresh bounded snapshot; rejects overflow. No raw session or record identifiers."""
    return report_exports.export_report(db, "sessions", utcnow(), identity.session_id, selection, q, state)

@router.get("/events/export", response_model=ReportExport, operation_id="exportReportingEvents")
def export_events(identity: Admin, db: Database, selection=Depends(filters),
                  q: str = Query("", max_length=100)):
    """Fresh bounded snapshot of safe metadata, preserving observation provenance."""
    return report_exports.export_report(db, "events", utcnow(), identity.session_id, selection, q)
