from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

Purpose = Literal["password_recovery", "account_invitation", "template_test"]
MailStatus = Literal["pending", "sending", "smtp_accepted", "failed", "unknown"]


class InvitationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class InvitationResult(BaseModel):
    id: UUID
    status: MailStatus
    message: str


class EmailLogFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: datetime | None = None
    end: datetime | None = None
    purpose: Purpose | None = None
    status: MailStatus | None = None
    recipient: str = Field(default="", max_length=320)
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10000)


class EmailLogRecord(BaseModel):
    id: UUID
    created_at: datetime
    recipient: str | None
    purpose: Purpose
    portal: Literal["admin", "mr"]
    template_id: UUID | None
    template_version: int | None
    origin: str
    actor_id: UUID | None
    status: MailStatus
    failure_category: str | None


class EmailLogPage(BaseModel):
    items: list[EmailLogRecord]
    total: int
    counts: dict[str, int]
    limit: int
    offset: int
