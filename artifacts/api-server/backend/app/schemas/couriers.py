import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class CourierFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    status: Literal["active", "inactive"]

    @field_validator("name", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def printable(cls, value):
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value


class CourierEdit(CourierFields):
    expected_version: int = Field(ge=1, strict=True)


class CourierVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class CourierStatus(CourierVersion):
    status: Literal["active", "inactive"]


class CourierResponse(CourierFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class CourierPage(BaseModel):
    items: list[CourierResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class CourierImportRow(BaseModel):
    row: int
    name: str
    status: str
    errors: list[str]


class CourierReview(BaseModel):
    rows: list[CourierImportRow]
    valid: bool
    digest: str


class CourierImportResult(BaseModel):
    imported: int
