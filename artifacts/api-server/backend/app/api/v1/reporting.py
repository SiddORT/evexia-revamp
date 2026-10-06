"""Protected global reporting; owner-only auth endpoints remain unchanged."""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.security import utcnow
from app.db.session import get_db
from app.repositories import reporting
from app.schemas.reporting import EventPage, ReportSummary, SessionPage, UserPage
from app.services.auth import Identity
from app.schemas.activity import BrowserActivityBatch
from app.services.activity import record_activity
from app.api.deps import require_cookie_origin

router = APIRouter(prefix="/admin/reporting", tags=["admin-reporting"])
Admin = Annotated[Identity, Depends(require_permissions("admin.access"))]
Database = Annotated[Session, Depends(get_db)]


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
def sessions(identity: Admin, db: Database, pagination=Depends(page), selection=Depends(filters)):
    """Creation-time range [start,end), timezone required. Newest timestamp then ID descending."""
    return reporting.sessions(db, utcnow(), identity.session_id, *pagination, *selection)


@router.get("/events", response_model=EventPage, operation_id="listReportingEvents")
def events(identity: Admin, db: Database, pagination=Depends(page), selection=Depends(filters)):
    """Occurrence-time range [start,end). All recorded categories; missing actors are retained."""
    return reporting.events(db, *pagination, *selection)
