"""Exact signed money: JSON numbers are intentionally not accepted."""
import re
import uuid
from app.schemas.directory_search import SearchSection
from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def exact_amount(value):
    if not isinstance(value, str) or len(value) > 64 or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})", value.strip()):
        raise ValueError("Use a signed plain decimal string with at most two decimal places")
    amount = Decimal(value.strip())
    if abs(amount) > Decimal("9999999999999.99"):
        raise ValueError("Amount outside ±9999999999999.99")
    return format(amount if amount else Decimal(0), ".2f")


class OpeningBalanceFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    startYear: int = Field(ge=1900, le=9998, strict=True)
    endYear: int = Field(ge=1901, le=9999, strict=True)
    doctorId: uuid.UUID
    amount: str = Field(description="Exact signed plain decimal; -9999999999999.99 to 9999999999999.99, at most two fractional digits; never rounded.")
    status: Literal["active", "inactive"]

    @field_validator("amount", mode="before")
    @classmethod
    def money(cls, value):
        return exact_amount(value)

    @model_validator(mode="after")
    def adjacent(self):
        if self.endYear != self.startYear + 1:
            raise ValueError("Financial end year must immediately follow start year")
        return self


class OpeningBalanceVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class OpeningBalanceEdit(OpeningBalanceFields, OpeningBalanceVersion):
    pass


class OpeningBalanceStatus(OpeningBalanceVersion):
    status: Literal["active", "inactive"]


class OpeningBalanceResponse(OpeningBalanceFields):
    id: uuid.UUID
    version: int
    doctorName: str
    registrationNumber: str
    doctorUsable: bool
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class OpeningBalancePage(SearchSection):
    items: list[OpeningBalanceResponse]
    total: int
    filtered: int | None
    limit: int
    offset: int


class OpeningBalanceDoctorChoice(BaseModel):
    id: uuid.UUID
    name: str
    registrationNumber: str
    usable: bool


class OpeningBalanceDoctorPage(SearchSection):
    items: list[OpeningBalanceDoctorChoice]
    total: int | None
    limit: int
    offset: int


class OpeningBalanceImportRow(BaseModel):
    row: int
    startYear: str
    endYear: str
    registrationNumber: str
    amount: str
    status: str
    errors: list[str]


class OpeningBalanceReview(BaseModel):
    rows: list[OpeningBalanceImportRow]
    valid: bool
    digest: str


class OpeningBalanceImportResult(BaseModel):
    imported: int
