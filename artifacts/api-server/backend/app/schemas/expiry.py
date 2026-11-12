import uuid
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from decimal import Decimal
from app.schemas.rates import rate

RATE = r"^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$"


class ActualCost(BaseModel):
    actualUnitCost: str | None = Field(default=None, pattern=RATE, max_length=16)
    costProvenance: str | None = Field(default=None, min_length=3, max_length=1000)

    @field_validator("actualUnitCost")
    @classmethod
    def normalized_cost(cls, value):
        return None if value is None else rate(value, Decimal("999999999.99"))

    @model_validator(mode="after")
    def cost_pair(self):
        if (self.actualUnitCost is None) != (self.costProvenance is None):
            raise ValueError("Actual cost and its provenance/reason must be provided together.")
        if self.costProvenance is not None and len(self.costProvenance.strip()) < 3:
            raise ValueError("Record the actual cost source and reason.")
        return self


class BatchIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceKind: Literal["lot", "reserve"]
    batchId: uuid.UUID


class CostInput(BatchIdentity):
    unitCost: str = Field(pattern=RATE, max_length=16)
    provenance: str = Field(min_length=3, max_length=1000)
    idempotencyKey: uuid.UUID

    @field_validator("unitCost")
    @classmethod
    def normalized_cost(cls, value):
        return rate(value, Decimal("999999999.99"))


class DisposalInput(BatchIdentity):
    locationId: uuid.UUID | None
    quantity: str = Field(pattern=r"^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$", max_length=14)
    reason: str = Field(min_length=3, max_length=1000)


class DisposalCreate(DisposalInput):
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotencyKey: uuid.UUID


class ExpiryCostEvidence(BaseModel):
    @field_validator("unitCost", check_fields=False)
    @classmethod
    def display_cost(cls, value):
        from app.schemas.quantities import display_quantity
        return None if value is None else display_quantity(value)
    id: uuid.UUID
    sourceKind: Literal["lot", "reserve"]
    batchId: uuid.UUID
    unitCost: str
    provenance: str
    basis: str
    currency: Literal["INR"]
    origin: str
    actorId: uuid.UUID
    actor: str
    at: str


class InventoryExpiryRow(BaseModel):
    @field_validator("quantity", "unitCost", "expiredValue", check_fields=False)
    @classmethod
    def display_business_values(cls, value):
        from app.schemas.quantities import display_quantity
        return None if value is None else display_quantity(value)
    sourceKind: Literal["lot", "reserve"]
    batchId: uuid.UUID
    locationId: uuid.UUID | None
    locationName: str
    productName: str
    category: str
    batchNo: str
    expiryDate: str | None
    status: Literal["expired", "today", "next15", "future", "unknown"]
    quantity: str
    unit: str
    unitCost: str | None
    expiredValue: str | None
    costProvenance: str | None
    costTargetKind: Literal["lot", "reserve"]
    costTargetId: uuid.UUID
    costTargetUnit: str
    costSnapshot: ExpiryCostEvidence | None
    id: uuid.UUID | None = None
    actor: str | None = None
    actorId: uuid.UUID | None = None
    at: str | None = None
    reason: str | None = None
    appendOnly: bool | None = None


class ExpiryQuantityGroup(BaseModel):
    unit: str
    quantity: str


class InventoryExpirySummary(BaseModel):
    pendingValue: str
    disposedValue: str
    uncostedBatches: int
    uncostedQuantities: list[ExpiryQuantityGroup]
    disposedUncostedBatches: int
    disposedUncostedQuantities: list[ExpiryQuantityGroup]
    unknownExpiryBatches: int
    scope: str


class ExpiryDigestState(BaseModel):
    day: str
    status: Literal["preparing", "sending", "blocked", "failed", "unknown", "accepted"]
    category: str | None


class InventoryExpiryPage(BaseModel):
    items: list[InventoryExpiryRow]
    filtered: int
    offset: int
    limit: int
    summary: InventoryExpirySummary
    digest: ExpiryDigestState | None
    asOf: str


class ExpiryDisposalReview(BaseModel):
    batch: InventoryExpiryRow
    reviewToken: str


class ExpiryReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    result: InventoryExpiryRow | ExpiryCostEvidence | None
