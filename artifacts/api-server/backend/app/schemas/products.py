"""Whole-combo recipe quantities use the existing exact stock precision."""
import uuid
from datetime import date, datetime
from typing import Literal
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.rates import rate
from app.schemas.inventory import MoveLine, MovementLocation, MovementActivity


class ProductMemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allergenId: uuid.UUID
    quantity: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$", max_length=11)

    @field_validator("quantity")
    @classmethod
    def positive(cls, value):
        if not 0 < Decimal(value) <= 1000000:
            raise ValueError("Member quantity must be positive and at most 1000000.")
        return value


class ProductFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    mrp: str
    sellingPrice: str
    status: Literal["active", "inactive"] = "active"
    members: list[ProductMemberInput] = Field(min_length=2, max_length=100)

    @field_validator("name")
    @classmethod
    def name_trim(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("Enter a product name.")
        return value

    @field_validator("mrp", "sellingPrice")
    @classmethod
    def price(cls, value):
        return rate(value)

    @model_validator(mode="after")
    def valid(self):
        if len({m.allergenId for m in self.members}) != len(self.members):
            raise ValueError("Choose at least two distinct allergens, each only once.")
        if Decimal(self.sellingPrice) > Decimal(self.mrp):
            raise ValueError("Selling price must not exceed MRP. Both are independent combo-level values.")
        return self


class ProductCreate(ProductFields):
    idempotencyKey: uuid.UUID


class ProductEdit(ProductCreate):
    expected_version: int = Field(ge=1)


class ProductDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: uuid.UUID
    expected_version: int = Field(ge=1)


class ProductStatus(ProductDelete):
    status: Literal["active", "inactive"]


class ProductMemberView(ProductMemberInput):
    name: str
    unit: str
    available: bool


class ProductView(BaseModel):
    id: uuid.UUID
    name: str
    mrp: str
    sellingPrice: str
    status: Literal["active", "inactive"]
    version: int
    members: list[ProductMemberView]
    createdAt: datetime
    updatedAt: datetime
    createdBy: str
    updatedBy: str
    deletedAt: datetime | None


class ProductQuantitySummary(BaseModel):
    productId: uuid.UUID
    productName: str
    unit: str
    quantity: str
    locationId: uuid.UUID | None = None
    locationName: str | None = None


class ProductSummary(BaseModel):
    products: int
    assemblies: int
    assembled: list[ProductQuantitySummary]
    remaining: list[ProductQuantitySummary]
    scope: str


class ProductPage(BaseModel):
    items: list[ProductView]
    filtered: int
    total: int
    offset: int
    limit: int
    summary: ProductSummary


class ProductReference(BaseModel):
    id: uuid.UUID
    name: str
    version: int
    unit: str


class ProductReferencePage(BaseModel):
    items: list[ProductReference]
    filtered: int
    offset: int
    limit: int


class ProductHistoryItem(BaseModel):
    id: uuid.UUID
    action: str
    at: datetime
    actor: str
    version: int
    before: ProductView | None
    after: ProductView


class ProductHistoryPage(BaseModel):
    items: list[ProductHistoryItem]
    filtered: int
    offset: int
    limit: int


class AssemblyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    productId: uuid.UUID
    expected_version: int = Field(ge=1)
    locationId: uuid.UUID
    quantity: int = Field(ge=1, le=1000000, strict=True)
    allocations: list[MoveLine] = Field(min_length=2, max_length=100)
    batchNo: str = Field(min_length=1, max_length=80)
    expiryDate: date

    @field_validator("batchNo")
    @classmethod
    def batch_trim(cls, value):
        if not value.strip():
            raise ValueError("An explicit output batch is required; source batches remain separate.")
        return value.strip()


class AssemblyCreate(AssemblyInput):
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(pattern=r"^[0-9a-f]{64}$")


class AssemblyComponent(BaseModel):
    lotId: uuid.UUID
    receiptId: uuid.UUID | None
    receiptNumber: str | None
    lineId: uuid.UUID | None
    productId: uuid.UUID
    productName: str
    batchNo: str | None
    expiryDate: date | None
    receivedDate: date | None
    unit: str
    quantity: str
    before: str
    after: str
    productVersion: int


class AssemblySnapshot(BaseModel):
    productId: uuid.UUID
    productName: str
    version: int
    mrp: str
    sellingPrice: str
    members: list[ProductMemberView]
    location: MovementLocation
    quantity: int
    unit: str
    batchNo: str
    expiryDate: date
    components: list[AssemblyComponent]


class AssemblyReview(BaseModel):
    assembly: AssemblySnapshot
    reviewToken: str


class AssemblySaved(AssemblySnapshot):
    id: uuid.UUID
    lotId: uuid.UUID
    createdAt: datetime
    actor: str
    actorId: uuid.UUID
    outputBefore: str
    outputAfter: str
    activity: list[MovementActivity]


class AssemblyPage(BaseModel):
    items: list[AssemblySaved]
    filtered: int
    offset: int
    limit: int


class ProductReconciliation(BaseModel):
    state: Literal["committed", "not_committed"]
    result: ProductView | AssemblySaved | None
