"""Exact adjustment inputs; server owns actor, clock and before/after."""
import uuid
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class AdjustmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    productId: uuid.UUID
    direction: Literal["add", "reduce"]
    quantity: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)
    reason: str = Field(min_length=1, max_length=2000)
    locationId: uuid.UUID | None
    lotId: uuid.UUID | None = None
    batchNo: str | None = Field(None, max_length=120)
    expiryDate: date | None = None
    correctionOf: uuid.UUID | None = None

    @model_validator(mode="after")
    def valid(self):
        if not self.reason.strip():
            raise ValueError("A reason is required.")
        if self.direction == "add" and (self.locationId is None or self.lotId is not None):
            raise ValueError("Add requires a real active location and a new lot.")
        if self.direction == "reduce" and (self.lotId is None or self.batchNo is not None or self.expiryDate is not None):
            raise ValueError("Reduce requires an existing lot; batch/expiry belong only to new lots.")
        return self


class AdjustmentCreate(AdjustmentInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class LedgerProduct(BaseModel):
    productId: uuid.UUID
    name: str
    concentration: str
    unit: str


class LedgerLocation(BaseModel):
    id: uuid.UUID
    name: str


class AdjustmentLotChoice(BaseModel):
    lotId: uuid.UUID
    locationId: uuid.UUID | None
    locationName: str
    available: str
    batchNo: str | None
    source: str


class AdjustmentChoices(BaseModel):
    product: LedgerProduct
    locations: list[LedgerLocation]
    lots: list[AdjustmentLotChoice]
    asOf: datetime


class AdjustmentSnapshot(AdjustmentInput):
    productName: str
    concentration: str
    productVersion: int
    locationVersion: int | None
    locationName: str
    before: str
    delta: str
    after: str
    unit: str
    scope: str


class AdjustmentReview(BaseModel):
    adjustment: AdjustmentSnapshot
    reviewToken: str


class AdjustmentSaved(AdjustmentSnapshot):
    id: uuid.UUID
    createdAt: datetime
    actor: str
    actorId: uuid.UUID
    appendOnly: bool


class AdjustmentReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    adjustment: AdjustmentSaved | None


class LedgerLeg(BaseModel):
    location: str
    delta: str
    lotId: uuid.UUID


class LedgerEntry(BaseModel):
    id: str
    at: datetime
    businessDate: date | None
    type: str
    reference: str
    lotId: uuid.UUID | None
    batchNo: str | None
    location: str
    quantityIn: str
    quantityOut: str
    balance: str
    actor: str
    reason: str
    sourceKind: str | None
    sourceId: uuid.UUID | None
    sourceAvailable: bool
    legs: list[LedgerLeg]


class LedgerCoverage(BaseModel):
    complete: bool
    contract: str
    earliestRecordedAt: datetime | None
    limitations: list[str]


class LedgerSummary(BaseModel):
    opening: str
    additions: str
    reductions: str
    closing: str
    current: str
    scope: str


class ProcurementEntry(BaseModel):
    kind: Literal["po", "pr"]
    id: str
    sourceId: uuid.UUID | None = None
    number: str
    date: date | None
    status: str
    ordered: str
    received: str
    accepted: str
    rejected: str
    stockEffect: str
    sourceAvailable: bool


class LedgerProcurement(BaseModel):
    items: list[ProcurementEntry]
    scope: str


class LedgerPage(BaseModel):
    product: LedgerProduct
    asOf: datetime
    coverage: LedgerCoverage
    summary: LedgerSummary
    items: list[LedgerEntry]
    filtered: int
    offset: int
    limit: int
    locations: list[LedgerLocation]
    procurement: LedgerProcurement
