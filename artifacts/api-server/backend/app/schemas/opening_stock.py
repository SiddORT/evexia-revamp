"""Opening quantities and rates never cross JSON binary floating point."""
import uuid
import re
from datetime import date, datetime
from decimal import Decimal
from typing import ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.rates import rate
from app.schemas.quantities import quantity_string
from app.schemas.inventory import MovementLocation, MovementActivity


class OpeningRow(BaseModel):
    read_snapshot: ClassVar[bool] = False
    model_config = ConfigDict(extra="forbid")
    sourceId: uuid.UUID
    rowId: uuid.UUID
    itemKind: Literal["allergen", "combo"]
    itemId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$", max_length=14)
    unitRate: str = Field(max_length=64)
    locationId: uuid.UUID | None = None
    expiryDate: date | None = None

    @field_validator("expiryDate", mode="before")
    @classmethod
    def expiry_date(cls, value):
        if value is None:
            return None
        if isinstance(value, datetime) or not (
            isinstance(value, date) or isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)
        ):
            raise ValueError("Use a real expiry date in YYYY-MM-DD format, or null for unknown.")
        return value

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
        if not self.read_snapshot:
            self.quantity = quantity_string(self.quantity, whole=self.itemKind == "combo")
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
    version: int = 1
    updatedAt: datetime | None = None
    updatedBy: str | None = None
    revisions: list[dict] = Field(default_factory=list)


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


class OpeningEditInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedVersion: int = Field(ge=1)
    itemKind: Literal["allergen", "combo"]
    itemId: uuid.UUID
    quantity: str
    unitRate: str
    locationId: uuid.UUID | None = None
    recordedDate: date
    expiryDate: date | None = None

    _recorded = field_validator("recordedDate", mode="before")(OpeningInput.recorded_date.__func__)
    _expiry = field_validator("expiryDate", mode="before")(OpeningRow.expiry_date.__func__)

    @model_validator(mode="after")
    def valid_business_fields(self):
        # Reuse exactly the create decimal contract, without accepting editable IDs.
        fields = self.model_dump(include={"itemKind", "itemId", "quantity", "unitRate", "locationId", "expiryDate"})
        fields["unitRate"] = self.unitRate.strip() or "0"
        row = OpeningRow(sourceId=uuid.UUID(int=0), rowId=uuid.UUID(int=0), **fields)
        if Decimal(row.quantity) <= 0:
            raise ValueError("Opening corrections require a positive quantity.")
        self.quantity, self.unitRate = row.quantity, row.unitRate
        return self


class OpeningEditCreate(OpeningEditInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class OpeningEditReview(BaseModel):
    before: OpeningSaved
    after: OpeningReviewedRow
    recordedDate: date
    expectedVersion: int
    reviewToken: str
    inventoryEffect: str
