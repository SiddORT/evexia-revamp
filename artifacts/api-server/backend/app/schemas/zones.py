import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ZoneFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    status: Literal["active", "inactive"]

    @field_validator("name", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def printable(cls, value):
        if any((ord(char) < 32 and char not in "\t\n\r") or 0xD800 <= ord(char) <= 0xDFFF
               or char in "\ufffe\uffff" for char in value):
            raise ValueError("Name contains unsupported control characters")
        return value


class ZoneEdit(ZoneFields):
    expected_version: int = Field(ge=1, strict=True)


class ZoneVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class ZoneStatus(ZoneVersion):
    status: Literal["active", "inactive"]


class ZoneResponse(ZoneFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class ZonePage(BaseModel):
    items: list[ZoneResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class ZoneDeletedResponse(ZoneResponse):
    deletedBy: str
    deletedAt: datetime


class ZoneDeletedPage(ZonePage):
    items: list[ZoneDeletedResponse]


class ZoneImportRow(BaseModel):
    row: int
    name: str
    status: str
    errors: list[str]


class ZoneReview(BaseModel):
    rows: list[ZoneImportRow]
    valid: bool
    digest: str


class ZoneImportResult(BaseModel):
    imported: int
