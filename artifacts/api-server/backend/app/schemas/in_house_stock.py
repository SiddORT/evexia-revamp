"""Independent descriptive concentration and explicit, non-convertible quantities."""
import re
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReserveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allergenId: uuid.UUID
    concentration: str = Field(min_length=1, max_length=200)
    quantity: str = Field(min_length=1, max_length=11)
    # New entry forms omit units; retain historical unit descriptions unchanged.
    unit: str = Field(default="", max_length=40)
    expiryDate: date
    locationId: uuid.UUID
    batch: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)

    @field_validator("expiryDate", mode="before")
    @classmethod
    def calendar_expiry(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Enter an expiry calendar date in YYYY-MM-DD format.")
        return value

    @field_validator("concentration", "unit", "batch", "notes")
    @classmethod
    def clean_text(cls, value, info):
        value = value.strip()
        if info.field_name == "concentration" and not value:
            raise ValueError("This field is required.")
        if any(ord(c) < 32 and c not in "\n\r\t" for c in value):
            raise ValueError("Control characters are not supported.")
        return value

    @field_validator("quantity")
    @classmethod
    def exact_quantity(cls, value):
        value = value.strip()
        if not re.fullmatch(r"(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?", value):
            raise ValueError("Use a plain positive decimal with at most three fractional digits.")
        if not 0 < Decimal(value) <= Decimal("1000000"):
            raise ValueError("Quantity must be positive and no more than 1000000.")
        return format(Decimal(value), ".3f")


class ReserveCreate(ReserveInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class ReserveSnapshot(ReserveInput):
    allergenName: str
    categoryId: uuid.UUID
    categoryName: str
    locationName: str
    allergenVersion: int
    categoryVersion: int
    locationVersion: int
    reserveOnly: Literal[True] = True
    expired: bool


class ReserveSaved(ReserveSnapshot):
    id: uuid.UUID
    actorId: uuid.UUID
    actor: str
    createdAt: str


class ReserveReview(BaseModel):
    record: ReserveSnapshot
    reviewToken: str


class ReservePage(BaseModel):
    items: list[ReserveSaved]
    filtered: int
    total: int
    offset: int
    limit: int


class ReserveReference(BaseModel):
    id: uuid.UUID
    name: str
    version: int
    categoryId: uuid.UUID | None = None
    categoryName: str | None = None


class ReserveReferences(BaseModel):
    items: list[ReserveReference]
    filtered: int
    offset: int
    limit: int


class ReserveReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    result: ReserveSaved | None
