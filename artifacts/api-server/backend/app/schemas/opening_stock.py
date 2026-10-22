"""Opening quantities and rates never cross JSON binary floating point."""
import uuid
import re
from datetime import date, datetime
from decimal import Decimal
from typing import ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.rates import rate
from app.schemas.inventory import MovementLocation, MovementActivity


class OpeningRow(BaseModel):
    read_snapshot: ClassVar[bool] = False
    model_config = ConfigDict(extra="forbid")
    sourceId: uuid.UUID
    rowId: uuid.UUID
    itemKind: Literal["allergen", "combo"]
    itemId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)
    unitRate: str = Field(max_length=64)
    locationId: uuid.UUID | None = None

    @field_validator("unitRate")
    @classmethod
    def normalize_rate(cls, value):
        return rate(value)

    @model_validator(mode="after")
    def valid(self):
        if not self.read_snapshot and not self.quantity.isascii():
            raise ValueError("Use ASCII digits and a decimal point for quantity.")
        amount = Decimal(self.quantity)
        if amount > 1000000:
            raise ValueError("Quantity cannot exceed 1000000.")
        if self.itemKind == "combo" and amount != amount.to_integral_value():
            raise ValueError("Finished products require whole quantities.")
        return self


class OpeningInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[OpeningRow] = Field(min_length=1, max_length=1000)
    recordedDate: date
    mode: Literal["manual", "import"]

    @field_validator("recordedDate", mode="before")
    @classmethod
    def recorded_date(cls, value):
        if isinstance(value, datetime) or not (
            isinstance(value, date) or isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)
        ):
            raise ValueError("Use a real recorded date in YYYY-MM-DD format, not a timestamp or number.")
        return value

    @model_validator(mode="after")
    def unique_rows(self):
        if len({(r.sourceId, r.rowId) for r in self.rows}) != len(self.rows):
            raise ValueError("Repeated source/row identity within the operation.")
        if self.mode == "manual" and any(Decimal(row.quantity) <= 0 for row in self.rows):
            raise ValueError("Manual opening requires positive quantities.")
        return self


class OpeningCreate(OpeningInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class OpeningReviewedRow(OpeningRow):
    read_snapshot = True
    productName: str
    unit: str
    location: MovementLocation
    itemVersion: int
    openingValue: str
    state: Literal["ready", "skipped", "already_imported"]


class OpeningBreakdown(BaseModel):
    itemId: uuid.UUID
    itemKind: Literal["allergen", "combo"]
    productName: str
    unit: str
    locationId: uuid.UUID | None
    locationName: str
    quantity: str
    openingValue: str


class OpeningSummary(BaseModel):
    records: int
    imports: int
    breakdown: list[OpeningBreakdown]
    scope: str


class OpeningReview(BaseModel):
    rows: list[OpeningReviewedRow]
    reviewToken: str
    summary: OpeningSummary


class OpeningSaved(OpeningReviewedRow):
    id: uuid.UUID
    lotId: uuid.UUID
    recordedDate: date
    createdAt: datetime
    actor: str
    actorId: uuid.UUID
    appendOnly: bool
    source: Literal["opening"]
    mode: Literal["manual", "import"]
    before: str
    after: str
    historicalData: str
    activity: list[MovementActivity]


class OpeningResult(BaseModel):
    records: list[OpeningSaved]
    summary: OpeningSummary
    alreadyImportedCount: int
    postedCount: int


class OpeningPage(BaseModel):
    items: list[OpeningSaved]
    filtered: int
    total: int
    offset: int
    limit: int
    summary: OpeningSummary


class OpeningReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    result: OpeningResult | None


class OpeningReference(BaseModel):
    id: uuid.UUID
    itemKind: Literal["allergen", "combo"]
    name: str
    unit: str
    version: int


class OpeningReferencePage(BaseModel):
    items: list[OpeningReference]
    filtered: int
    offset: int
    limit: int


class OpeningImportRow(BaseModel):
    row: int
    values: OpeningRow | None
    errors: list[str]
    state: Literal["ready", "skipped", "already_imported"]


class OpeningActivityPage(BaseModel):
    items: list[MovementActivity]
    filtered: int


class OpeningImportReview(BaseModel):
    rows: list[OpeningImportRow]
    valid: bool
    validCount: int
    invalidCount: int
    skippedCount: int
    alreadyImportedCount: int
    reviewToken: str | None
    summary: OpeningSummary
    command: OpeningInput | None
