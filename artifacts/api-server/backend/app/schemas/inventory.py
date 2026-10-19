"""Inventory uses exact procurement quantity strings, never JSON floating point."""
import uuid
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class MoveLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lotId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)


class MoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceId: uuid.UUID
    destinationId: uuid.UUID
    date: date
    deliveryMode: Literal["staff", "other"]
    staffId: uuid.UUID | None = None
    otherName: str | None = Field(default=None, max_length=120)
    lines: list[MoveLine] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def valid(self):
        if self.sourceId == self.destinationId:
            raise ValueError("Source and destination must differ.")
        if self.deliveryMode == "staff":
            if not self.staffId or self.otherName is not None:
                raise ValueError("Choose staff without a custom name.")
        elif self.staffId is not None or not self.otherName or not self.otherName.strip():
            raise ValueError("Enter a delivery name without a staff reference.")
        return self


class MoveCreate(MoveInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class InitializationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    receiptId: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class InventoryCoverage(BaseModel):
    complete: bool
    pendingReceipts: int
    contract: str
    sales: str
    openings: str


class InventoryLotView(BaseModel):
    receiptId: uuid.UUID
    receiptNumber: str
    lineId: uuid.UUID
    productId: uuid.UUID
    productName: str
    batchNo: str
    expiryDate: date
    receivedDate: date
    originalCreatedAt: str
    unit: str
    lotId: uuid.UUID
    locationId: uuid.UUID
    locationName: str
    quantity: str


class InventoryStockRow(BaseModel):
    productId: uuid.UUID
    name: str
    category: str
    categoryId: uuid.UUID
    concentration: str
    sellingPrice: str | None
    quantity: str
    unit: str
    lots: list[InventoryLotView]
    state: str


class InventoryStockPage(BaseModel):
    items: list[InventoryStockRow]
    snapshot: list[InventoryStockRow] | None = None
    filtered: int
    total: int
    limit: int
    offset: int
    asOf: datetime
    coverage: InventoryCoverage


class MovementLocation(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    pincode: str
    countryCode: str
    state: str
    city: str
    version: int


class MovementLineView(BaseModel):
    receiptId: uuid.UUID
    receiptNumber: str
    lineId: uuid.UUID
    productId: uuid.UUID
    productName: str
    batchNo: str
    expiryDate: date
    receivedDate: date
    originalCreatedAt: str
    unit: str
    lotId: uuid.UUID
    quantity: str
    sourceBefore: str
    sourceAfter: str
    destinationBefore: str
    destinationAfter: str
    productVersion: int


class MovementSnapshot(BaseModel):
    source: MovementLocation
    destination: MovementLocation
    date: date
    deliveryMode: Literal["staff", "other"]
    staffId: uuid.UUID | None
    deliveredBy: str
    staffVersion: int | None
    lines: list[MovementLineView]


class MovementReview(BaseModel):
    movement: MovementSnapshot
    reviewToken: str


class MovementActivity(BaseModel):
    action: str
    at: datetime
    actor: str
    requestId: str | None


class MovementSummary(BaseModel):
    movements: int
    lots: int
    scope: str


class MovementSaved(MovementSnapshot):
    id: uuid.UUID
    createdAt: datetime
    actor: str
    actorId: uuid.UUID
    appendOnly: bool
    activity: list[MovementActivity]
    summary: MovementSummary


class MovementPage(BaseModel):
    items: list[MovementSaved]
    filtered: int
    total: int
    limit: int
    offset: int
    summary: MovementSummary


class MovementReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    movement: MovementSaved | None


class InventoryReference(BaseModel):
    id: uuid.UUID
    name: str
    available: str | None = None
    productId: uuid.UUID | None = None
    productName: str | None = None
    batchNo: str | None = None
    expiryDate: date | None = None
    receiptId: uuid.UUID | None = None
    receiptNumber: str | None = None
    unit: str | None = None


class InventoryReferencePage(BaseModel):
    items: list[InventoryReference]
    filtered: int
    offset: int
    limit: int


class InventoryHistoryItem(BaseModel):
    id: uuid.UUID
    at: datetime
    lotId: uuid.UUID
    locationId: uuid.UUID
    movementId: uuid.UUID | None
    delta: str
    before: str
    after: str
    actor: str
    source: str


class InventoryHistoryPage(BaseModel):
    items: list[InventoryHistoryItem]
    filtered: int
    offset: int
    limit: int
    scope: str


class InventoryInitializationItem(BaseModel):
    receiptId: uuid.UUID
    state: Literal["eligible", "current", "unavailable"]
    version: int | None = None
    reviewToken: str | None
    historicalLocationGeography: str | None = None
    reconciliation: list[dict[str, str | bool]] | None = None
    originalCreatedAt: str | None = None
    initializedAt: str | None = None


class InventoryInitializationPage(BaseModel):
    items: list[InventoryInitializationItem]
    offset: int
    limit: int
    coverage: InventoryCoverage
