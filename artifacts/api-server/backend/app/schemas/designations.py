import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BUSINESS_FIELDS = ("name", "shortName", "status")


class DesignationFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    shortName: str = Field(min_length=1, max_length=50)
    status: Literal["active", "inactive"]

    @field_validator("name", "shortName", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name", "shortName")
    @classmethod
    def printable(cls, value):
        if any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF or c in "\ufffe\uffff" for c in value):
            raise ValueError("Unsupported characters")
        return value

class DesignationEdit(DesignationFields):
    expected_version: int = Field(ge=1, strict=True)


class DesignationVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class DesignationStatus(DesignationVersion):
    status: Literal["active", "inactive"]


class DesignationResponse(DesignationFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class DesignationPage(BaseModel):
    items: list[DesignationResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class DesignationImportRow(BaseModel):
    row: int
    values: dict[str, str | int]
    errors: list[str]


class DesignationReview(BaseModel):
    rows: list[DesignationImportRow]
    valid: bool
    digest: str
    validCount: int
    invalidCount: int


class DesignationImportResult(BaseModel):
    imported: int
