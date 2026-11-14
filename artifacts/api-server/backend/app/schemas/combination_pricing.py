"""Configuration only. No clinical quantity or order quotation contract."""
import re
import uuid
from datetime import date, datetime
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.immunotherapy_extract import Dosage
from app.schemas.pricing_rules import ItPricingReference

MAX_MEMBERS = 500
MAX_ROWS = 1000
CombinationMoney = Annotated[str, Field(pattern=r"^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$", max_length=15)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CombinationScope(Strict):
    categoryId: uuid.UUID
    dosage: Dosage
    size: int = Field(strict=True, ge=1, le=3)
    # null means all eligible saved allergens, never the visible search results.
    allergenIds: list[uuid.UUID] | None = Field(default=None, max_length=MAX_MEMBERS)

    @field_validator("allergenIds")
    @classmethod
    def unique_selection(cls, value):
        if value is not None and value != sorted(set(value)):
            raise ValueError("Allergen selection must be unique and sorted")
        return value


class CombinationGenerate(CombinationScope):
    query: str = Field(default="", max_length=100)
    offset: int = Field(default=0, ge=0, le=1000, strict=True)
    limit: int = Field(default=25, ge=1, le=100, strict=True)


def exact_money(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,11})\.[0-9]{2}", value):
        raise ValueError("Enter an explicit nonnegative INR amount with exactly two decimal places")
    return value


class CombinationEdit(Strict):
    memberIds: list[uuid.UUID] = Field(min_length=1, max_length=3)
    totalMrp: CombinationMoney

    @field_validator("totalMrp", mode="before")
    @classmethod
    def money(cls, value):
        return exact_money(value)

    @model_validator(mode="after")
    def ordered(self):
        if self.memberIds != sorted(set(self.memberIds)):
            raise ValueError("Members must be distinct and sorted")
        return self


class CombinationSave(CombinationScope):
    eligibilityVersion: str = Field(pattern=r"^[a-f0-9]{64}$")
    scopeVersion: str = Field(pattern=r"^[a-f0-9]{64}$")
    effectiveFrom: date
    copyRate: CombinationMoney | None = None
    edits: list[CombinationEdit] = Field(default_factory=list, max_length=MAX_ROWS)
    idempotencyKey: uuid.UUID

    @field_validator("copyRate", mode="before")
    @classmethod
    def copy_money(cls, value):
        return None if value is None else exact_money(value)

    @field_validator("effectiveFrom", mode="before")
    @classmethod
    def explicit_date(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Enter an explicit YYYY-MM-DD date")
        return value


class CombinationMember(Strict):
    id: uuid.UUID
    name: str
    mix: bool
    version: int


class CombinationRevision(Strict):
    id: uuid.UUID
    categoryId: uuid.UUID
    categoryName: str
    dosage: Dosage
    memberIds: list[uuid.UUID]
    members: list[CombinationMember]
    totalMrp: CombinationMoney
    effectiveFrom: date
    version: int
    actorId: uuid.UUID
    recordedAt: datetime


class CombinationRow(Strict):
    key: str
    members: list[CombinationMember]
    latest: CombinationRevision | None


class CombinationPage(Strict):
    categoryId: uuid.UUID
    dosage: Dosage
    size: int
    eligibilityVersion: str
    scopeVersion: str
    scopeTotal: int
    scopeKeys: list[str]
    rowVersions: dict[str, int]
    total: int
    offset: int
    limit: int
    items: list[CombinationRow]


class CombinationResult(Strict):
    requestId: uuid.UUID
    categoryId: uuid.UUID
    dosage: Dosage
    effectiveFrom: date
    eligibilityVersion: str
    scopeVersion: str
    saved: list[CombinationRevision]


class CombinationHistory(Strict):
    items: list[CombinationRevision]
    nextOffset: int | None


class CombinationAllergenPage(Strict):
    items: list[CombinationMember]
    total: int
    offset: int
    limit: int


class CombinationCategoryPage(Strict):
    items: list[ItPricingReference]
    nextOffset: int | None
