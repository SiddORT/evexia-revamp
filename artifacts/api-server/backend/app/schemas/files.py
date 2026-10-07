import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UploadRequest(BaseModel):
    """Query fields accompanying a raw binary request body."""
    model_config = ConfigDict(extra="forbid")
    patient_id: uuid.UUID | None = None
    mr_id: uuid.UUID | None = None
    category: Literal["profile", "documents"]
    filename: str = Field(min_length=1, max_length=255)

    @model_validator(mode="after")
    def exclusive_owner(self):
        if (self.patient_id is None) == (self.mr_id is None):
            raise ValueError("Specify exactly one owner")
        return self


class ReplacementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    expected_version: int = Field(ge=1)


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    patient_id: uuid.UUID | None
    mr_id: uuid.UUID | None
    category: Literal["profile", "documents"]
    display_name: str
    content_type: str
    size: int
    checksum: str | None
    state: Literal["uploading", "quarantined", "verified", "rejected", "pending_delete", "deleted"]
    scanner_status: Literal["pending", "clean", "infected", "unavailable", "error"]
    version: int
    created_at: datetime
    updated_at: datetime


class DownloadURLResponse(BaseModel):
    # Local grants have no initiation evidence until redemption.
    download_log: "DownloadEvidence | None" = None
    url: str
    expires_at: datetime
    bearer_capability: bool


from app.schemas.downloads import DownloadEvidence
DownloadURLResponse.model_rebuild()