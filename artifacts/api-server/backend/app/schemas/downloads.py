import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.reporting import ReportUser


class DownloadInitiation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initiation_id: uuid.UUID
    source: str = Field(min_length=1, max_length=40)
    kind: str = Field(min_length=1, max_length=20)
    format: Literal["PDF", "CSV", "XLSX"]


class DownloadEvidence(BaseModel):
    id: uuid.UUID
    provenance: Literal["browser_reported", "server_prepared"]


class DownloadItem(BaseModel):
    id: uuid.UUID
    user: ReportUser | None
    created_at: datetime
    label: str
    module: str
    format: Literal["PDF", "CSV", "XLSX"]
    provenance: Literal["browser_reported", "server_prepared"]


class DownloadPage(BaseModel):
    items: list[DownloadItem]
    total: int
    limit: int
    offset: int
    has_more: bool
