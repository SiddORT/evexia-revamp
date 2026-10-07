import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DECIMAL_FIELDS = ("basicDa", "hra", "medicalAllowance", "travellingAllowance", "specialAllowance", "professionalTax")
BUSINESS_FIELDS = ("name", "shortName", "level", "status", *DECIMAL_FIELDS)


class DesignationFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    shortName: str = Field(min_length=1, max_length=50)
    level: int = Field(ge=1, le=2147483647, strict=True)
    status: Literal["active", "inactive"]
    basicDa: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)
    hra: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)
    medicalAllowance: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)
    travellingAllowance: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)
    specialAllowance: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)
    professionalTax: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2, allow_inf_nan=False)

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

    @field_validator(*DECIMAL_FIELDS, mode="before")
    @classmethod
    def decimal_input(cls, value):
        if isinstance(value, bool):
            raise ValueError("Use a decimal, not a boolean")
        return "0" if isinstance(value, str) and not value.strip() else value


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
