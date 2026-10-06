"""Explicit, credential-free reporting projections."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ReportUser(BaseModel):
    id: uuid.UUID
    label: str
    role: str | None
    account_state: Literal["enabled", "disabled", "unmapped", "ineligible"]


class ReportSession(BaseModel):
    id: str
    user: ReportUser | None
    state: Literal["ACTIVE", "EXPIRED", "REVOKED", "INVALIDATED"]
    created_at: datetime
    last_refreshed_at: datetime | None
    expires_at: datetime
    revoked_at: datetime | None
    persistent: bool
    is_current: bool


class ReportEvent(BaseModel):
    id: uuid.UUID
    user: ReportUser | None
    actor_id: uuid.UUID | None
    action: str
    outcome: str
    reason: str | None
    resource_type: str | None
    resource_id: uuid.UUID | None
    session_id: str | None
    request_id: str | None
    created_at: datetime


class ReportSummary(BaseModel):
    total_users: int
    active_users: int
    refreshed_at: datetime
    current_session: ReportSession


class UserPage(BaseModel):
    items: list[ReportUser]
    limit: int
    offset: int
    has_more: bool


class SessionPage(BaseModel):
    items: list[ReportSession]
    limit: int
    offset: int
    has_more: bool


class EventPage(BaseModel):
    items: list[ReportEvent]
    limit: int
    offset: int
    has_more: bool
