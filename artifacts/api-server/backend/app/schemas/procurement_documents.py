"""Client presentation only. Business values and attribution are server-owned."""
from typing import Literal, Any
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, ConfigDict, Field, model_validator


class DocumentPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dateFormat: Literal["dd-mmm-yyyy", "mm-dd-yyyy", "dd-mm-yyyy", "yyyy-mm-dd"]
    clock: Literal["12", "24"]
    timeZone: str = Field(min_length=1, max_length=80)
    resolvedTimeZone: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def zone(self):
        try:
            ZoneInfo(self.resolvedTimeZone)
            if self.timeZone != "browser" and self.timeZone != self.resolvedTimeZone:
                raise ValueError("Time zone snapshot does not match.")
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("A resolved IANA time zone is required.") from None
        return self


class DocumentContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    templateId: Literal["classic", "modern", "compact"]
    schemaVersion: Literal[1] = 1
    rendererVersion: Literal[1] = 1
    presentation: DocumentPresentation


class SavedDocument(DocumentContext):
    model: dict[str, Any]
    actor: str
    generatedAt: str
    revision: int = Field(ge=1)
    latestRevision: int = Field(ge=1)
    current: bool
    eventId: uuid.UUID


class DocumentChange(BaseModel):
    id: uuid.UUID
    at: str
    actor: str
    action: str
    summary: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    revision: int | None
    previousRevision: int | None


class DocumentHistory(BaseModel):
    items: list[DocumentChange]
    total: int
    limit: int
    offset: int
