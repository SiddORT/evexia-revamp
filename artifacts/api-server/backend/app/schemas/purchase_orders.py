import uuid
from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.procurement_documents import DocumentContext
from app.schemas.quantities import quantity_string


class POLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    productId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$", max_length=14)

    @field_validator("quantity")
    @classmethod
    def canonical_quantity(cls, value):
        return quantity_string(value, positive=True)
    # Optional only for exact reconciliation of pre-rate retry payloads.
    # New reviews and uncommitted saves require both explicit decimal strings.
    unitPrice: str | None = Field(default=None, max_length=64, pattern=r"^[0-9]+(?:\.[0-9]{1,6})?$")
    gst: str | None = Field(default=None, max_length=64, pattern=r"^[0-9]+(?:\.[0-9]{1,6})?$")
    lineId: uuid.UUID | None = None
    # Omission preserves legacy requests and missing historical metadata.
    concentration: str = Field(default=None, min_length=1, max_length=200,
                               json_schema_extra=lambda schema: schema.pop("default", None))

    @field_validator("concentration", mode="before")
    @classmethod
    def concentration_text(cls, value):
        if not isinstance(value, str):
            raise ValueError("Concentration must be text.")
        value = value.strip()
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Concentration contains unsupported characters.")
        return value


class POInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    documentContext: DocumentContext | None = None
    poDate: date
    expectedDate: date
    vendorId: uuid.UUID
    locationId: uuid.UUID
    # Optional on the wire ONLY to reconcile pre-upgrade durable retry identities.
    # New previews/saves require a supported value in the authoritative service.
    placeOfSupplyCode: str | None = Field(default=None, pattern=r"^\d{2}$")
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


class POTaxBasis(BaseModel):
    supplierGstin: str
    supplierStateCode: str
    supplierStateName: str
    placeOfSupplyCode: str
    placeOfSupplyName: str
    treatment: Literal["igst", "cgst_sgst", "cgst_utgst"]


class POTaxAmounts(BaseModel):
    cgst: int
    sgst: int
    utgst: int
    igst: int


class POTaxRates(BaseModel):
    cgst: str
    sgst: str
    utgst: str
    igst: str


class POLineResponse(BaseModel):
    id: uuid.UUID | None = None
    productId: uuid.UUID
    productName: str
    concentration: str | None = None
    quantity: str
    unitPrice: str
    gst: str
    subtotal: int
    gstAmount: int
    total: int
    taxComponents: POTaxAmounts | None = None
    componentRates: POTaxRates | None = None


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
    taxBasis: POTaxBasis | None = None
    taxComponents: POTaxAmounts | None = None


class POResponse(POReviewOrder):
    id: uuid.UUID
    number: str
    version: int
    status: str
    createdAt: str
    updatedAt: str
    deletedAt: str | None
    activeReceiptCount: int = 0
    documentRevision: int | None = None


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
    gstin: str | None = None
    registrationStateCode: str | None = None
    registrationStateName: str | None = None
    countryCode: str | None = None
    state: str | None = None
    stateCode: str | None = None
    city: str | None = None
    pincode: str | None = None


class POReferencePage(BaseModel):
    items: list[POReference]
    filtered: int
    total: int
    limit: int
    offset: int
