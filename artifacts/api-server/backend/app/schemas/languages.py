import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.master_validation import MasterWriteFields


class LanguageFields(MasterWriteFields):
    master_names = {"name": ("language name", False)}
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def trim(cls, value):
        return value  # MasterWriteFields normalizes explicit writes only.

    @field_validator("name")
    @classmethod
    def printable(cls, value):
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Name contains unsupported control characters")
        return value


class LanguageVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class LanguageEdit(LanguageFields, LanguageVersion):
    pass


class LanguageResponse(LanguageFields):
    master_read = True
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime
    deletedBy: str | None
    deletedAt: datetime | None


class LanguagePage(BaseModel):
    items: list[LanguageResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class LanguageChangeResponse(BaseModel):
    id: uuid.UUID
    action: Literal["create", "edit", "delete"]
    version: int
    actor: str
    at: datetime
    beforeName: str | None
    afterName: str


class LanguageSummary(BaseModel):
    scope: str
    creates: int
    edits: int
    deletes: int
    total: int
    latestChange: datetime | None


class LanguageHistory(BaseModel):
    record: LanguageResponse
    items: list[LanguageChangeResponse]
    total: int
    limit: int
    offset: int
    summary: LanguageSummary


class LanguageReviewValues(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str


class LanguageReviewRow(BaseModel):
    row: int
    # Invalid names must remain displayable in the review, not fail response validation.
    values: LanguageReviewValues
    errors: list[str]


class LanguageReview(BaseModel):
    rows: list[LanguageReviewRow]
    valid: bool
    digest: str
    validCount: int
    invalidCount: int


class LanguageImportResult(BaseModel):
    imported: int
