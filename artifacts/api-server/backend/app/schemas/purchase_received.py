"""Receipt wire inputs. Labels and derived quantities are never client-authored."""
import uuid
from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.purchase_orders import POResponse


class PRLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lineId: uuid.UUID
    receivedQty: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)
    acceptedQty: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)
    batchNo: str = Field(min_length=1, max_length=120)
    expiryDate: date


class PRInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    poId: uuid.UUID
    receivedDate: date
    receiverMode: Literal["staff", "other"]
    staffId: uuid.UUID | None = None
    otherName: str | None = Field(default=None, max_length=120)
    lines: list[PRLineInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def receiver(self):
        if self.receiverMode == "staff":
            if not self.staffId or self.otherName is not None:
                raise ValueError("Select staff; Other name must be absent.")
        elif self.staffId is not None or not self.otherName or not self.otherName.strip():
            raise ValueError("Others requires a person's name and no staff reference.")
        return self


class PRCreate(PRInput):
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotencyKey: uuid.UUID


class PREdit(PRCreate):
    expected_version: int = Field(ge=1)


class PRDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    idempotencyKey: uuid.UUID


class PRLineSnapshot(BaseModel):
    lineId: uuid.UUID
    productId: uuid.UUID
    productName: str
    orderedQty: str
    receivedQty: str
    acceptedQty: str
    rejectedQty: str
    batchNo: str
    expiryDate: date
    balanceAfterQty: str | None


class PRSnapshot(BaseModel):
    poId: uuid.UUID
    poNumber: str
    poDate: date
    vendorId: uuid.UUID
    vendorName: str
    vendorPhone: str
    vendorAddress: str
    vendorGstNo: str
    locationId: uuid.UUID
    locationName: str
    receivedDate: date
    receiverMode: Literal["staff", "other"]
    staffId: uuid.UUID | None
    receivedBy: str
    lines: list[PRLineSnapshot]


class PRSaved(PRSnapshot):
    id: uuid.UUID
    number: str
    version: int
    status: Literal["active", "deleted"]
    source: Literal["server"]
    createdAt: str
    updatedAt: str
    deletedAt: str | None
    fulfillment: Literal["Open", "Partially Received", "Closed"] | None = None


class PRReview(BaseModel):
    receipt: PRSnapshot
    reviewToken: str


class PRPage(BaseModel):
    items: list[PRSaved]
    filtered: int
    total: int
    limit: int
    offset: int


class PRSource(POResponse):
    balances: dict[str, str]
    fulfillment: Literal["Open", "Partially Received", "Closed"]
    receipts: list[PRSaved]


class PRActivityEvent(BaseModel):
    id: uuid.UUID
    receiptId: uuid.UUID
    number: str
    action: Literal["created", "updated", "deleted"]
    at: str
    actor: str
    summary: str


class PRActivityPage(BaseModel):
    items: list[PRActivityEvent]
    total: int
    filtered: int
    limit: int
    offset: int


class PRAnalytics(BaseModel):
    scope: str
    counts: dict[str, int]
    fulfillment: dict[str, int]
    receipts: int
    active: int
    deleted: int
    lines: int
    acceptedAny: int
    fullyAccepted: int
    anyRejected: int
    allRejected: int


class PRFilterChoice(BaseModel):
    id: str
    name: str


class PRFilters(BaseModel):
    vendors: list[PRFilterChoice]
    receivers: list[PRFilterChoice]


class PRReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    receipt: PRSaved | None


class PRReference(BaseModel):
    id: uuid.UUID
    name: str


class PRReferencePage(BaseModel):
    items: list[PRReference]
    total: int
    filtered: int
    limit: int
    offset: int
