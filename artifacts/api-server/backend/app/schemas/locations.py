import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocationFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=2000)
    status: Literal["active", "inactive"]

    @field_validator("name", "address", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name", "address")
    @classmethod
    def printable(cls, value):
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value


class LocationEdit(LocationFields):
    expected_version: int = Field(ge=1, strict=True)


class LocationVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class LocationStatus(LocationVersion):
    status: Literal["active", "inactive"]


class LocationResponse(LocationFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class LocationPage(BaseModel):
    items: list[LocationResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class LocationImportRow(BaseModel):
    row: int
    name: str
    address: str
    status: str
    errors: list[str]


class LocationReview(BaseModel):
    rows: list[LocationImportRow]
    valid: bool
    digest: str


class LocationImportResult(BaseModel):
    imported: int
