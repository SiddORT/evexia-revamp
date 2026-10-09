"""Exact string money and existing consecutive April–March period."""
import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

QUARTERS = ("q1", "q2", "q3", "q4")
BUSINESS_FIELDS = ("mrId", "startYear", "endYear", *QUARTERS, "status")


class SalesTargetFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    mrId: uuid.UUID
    startYear: int = Field(ge=1, le=9998, strict=True)
    endYear: int = Field(ge=2, le=9999, strict=True)
    q1: str
    q2: str
    q3: str
    q4: str
    status: Literal["active", "inactive"] = "active"

    @field_validator(*QUARTERS)
    @classmethod
    def money(cls, value):
        if not re.fullmatch(r"(?:[0-9]{1,12})(?:\.[0-9]{1,2})?", value):
            raise ValueError("Use a nonnegative plain rupee amount with up to 12 integer and two fractional digits.")
        return format(Decimal(value), ".2f")

    @model_validator(mode="after")
    def consecutive(self):
        if self.endYear != self.startYear + 1:
            raise ValueError("Financial end year must be the consecutive year after financial start year.")
        return self


class SalesTargetEdit(SalesTargetFields):
    expected_version: int = Field(ge=1, strict=True)


class SalesTargetVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class SalesTargetStatus(SalesTargetVersion):
    status: Literal["active", "inactive"]


class SalesTargetResponse(SalesTargetFields):
    id: uuid.UUID
    version: int
    mrName: str
    employeeCode: str
    zoneId: uuid.UUID
    zoneName: str
    headquarterId: uuid.UUID
    headquarterName: str
    annualTotal: str
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class SalesTargetTotals(BaseModel):
    q1: str
    q2: str
    q3: str
    q4: str
    total: str


class SalesTargetPage(BaseModel):
    items: list[SalesTargetResponse]
    total: int
    filtered: int
    limit: int
    offset: int
    totals: SalesTargetTotals


class SalesTargetMRChoice(BaseModel):
    id: uuid.UUID
    name: str
    employeeCode: str
    zoneId: uuid.UUID
    zoneName: str
    headquarterId: uuid.UUID
    headquarterName: str


class SalesTargetZoneChoice(BaseModel):
    id: uuid.UUID
    name: str


class SalesTargetChoices(BaseModel):
    mrs: list[SalesTargetMRChoice]
    zones: list[SalesTargetZoneChoice]
    years: list[int]
    total: int
    limit: int
    offset: int
    zonesTotal: int
    zoneOffset: int


class SalesTargetImportRow(BaseModel):
    row: int
    values: dict[str, str]
    errors: list[str]


class SalesTargetReview(BaseModel):
    rows: list[SalesTargetImportRow]
    valid: bool
    digest: str
    validCount: int
    invalidCount: int


class SalesTargetImportResult(BaseModel):
    imported: int
