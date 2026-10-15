import uuid
from datetime import date
from pydantic import BaseModel, ConfigDict, Field, model_validator


class POLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    productId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)


class POInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    poDate: date
    expectedDate: date
    vendorId: uuid.UUID
    locationId: uuid.UUID
    lines: list[POLineInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def dates(self):
        if self.expectedDate < self.poDate:
            raise ValueError("Expected delivery must be on or after PO date.")
        return self


class POCreate(POInput):
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotencyKey: uuid.UUID


class POEdit(POCreate):
    expected_version: int = Field(ge=1)


class PODelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    idempotencyKey: uuid.UUID


class POLineResponse(BaseModel):
    id: uuid.UUID | None = None
    productId: uuid.UUID
    productName: str
    quantity: str
    unitPrice: str
    gst: str
    subtotal: int
    gstAmount: int
    total: int


class POReviewOrder(BaseModel):
    poDate: date
    expectedDate: date
    vendorId: uuid.UUID
    vendorName: str
    locationId: uuid.UUID
    locationName: str
    lines: list[POLineResponse]
    subtotal: int
    gstAmount: int
    total: int


class POResponse(POReviewOrder):
    id: uuid.UUID
    number: str
    version: int
    status: str
    createdAt: str
    updatedAt: str
    deletedAt: str | None


class POReview(BaseModel):
    order: POReviewOrder
    reviewToken: str


class POPage(BaseModel):
    items: list[POResponse]
    filtered: int
    total: int
    limit: int
    offset: int


class POOverview(BaseModel):
    openValue: int
    openCount: int
    vendorCount: int
    lineCount: int
    changes: int


class POActivityEvent(BaseModel):
    id: uuid.UUID
    orderId: uuid.UUID
    number: str
    action: str
    summary: str
    actor: str
    at: str


class POActivityPage(BaseModel):
    items: list[POActivityEvent]
    filtered: int
    total: int
    limit: int
    offset: int


class POMutationCounts(BaseModel):
    created: int
    updated: int
    deleted: int


class POVendorValue(BaseModel):
    id: str
    name: str
    count: int
    amount: int


class POAnalytics(BaseModel):
    counts: POMutationCounts
    vendors: list[POVendorValue]


class POReference(BaseModel):
    id: uuid.UUID
    name: str
    version: int | None = None
    unitPrice: str | None = None
    gst: str | None = None


class POReferencePage(BaseModel):
    items: list[POReference]
    filtered: int
    total: int
    limit: int
    offset: int
