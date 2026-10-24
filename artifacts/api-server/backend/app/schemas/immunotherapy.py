"""Untrusted writes contain references and clinical values, never identity snapshots."""
import uuid
from datetime import date
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Result = Annotated[str, Field(pattern=r"^\d{1,6}(?:\.\d{1,2})?$")]
Amount = Annotated[str, Field(pattern=r"^\d{1,10}(?:\.\d{1,2})?$")]
Status = Literal["Confirmed", "Approved", "In process", "Shipped", "Delivered", "Rejected", "Returned"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ImmItem(Strict):
    allergenId: uuid.UUID
    result: Result
    rate: Amount | None = None
    suborderId: str | None = Field(default=None, pattern=r"^SUB-[0-9]{6,12}$")


class ImmBottle(Strict):
    id: str = Field(min_length=1, max_length=100)
    mrp: Amount | None = None
    items: list[ImmItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique(self):
        if len({i.allergenId for i in self.items}) != len(self.items):
            raise ValueError("Duplicate allergens in a bottle")
        return self


class ImmInput(Strict):
    pricingBasis: Literal["allergen_rates", "legacy_bottle_mrp"] | None = None
    orderDate: date | None = None
    patientId: uuid.UUID
    doctorId: uuid.UUID
    mrId: uuid.UUID
    dosage: Literal["PD", "DD", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]
    histamine: Result
    saline: Result
    groups: list[ImmBottle] = Field(min_length=1, max_length=100)
    remarks: str = Field(default="", max_length=4000)
    shipping: Literal["patient", "doctor"]
    status: Status = "Confirmed"
    poNumber: str | None = Field(default=None, min_length=1, max_length=100)
    attachmentIds: list[uuid.UUID] = Field(default_factory=list, max_length=10)

    @field_validator("poNumber", mode="before")
    @classmethod
    def optional_po(cls, value):
        # Direct writes and both import stages share the same normalization.
        # Keep nonblank values intact, including their original length bounds.
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def unique(self):
        if len({g.id for g in self.groups}) != len(self.groups):
            raise ValueError("Bottle IDs must be unique")
        if len(set(self.attachmentIds)) != len(self.attachmentIds):
            raise ValueError("Duplicate attachments")
        if sum(len(g.items) for g in self.groups) > 1000:
            raise ValueError("An order supports at most 1,000 allergen items across all bottles")
        return self


class ImmWrite(ImmInput):
    idempotencyKey: uuid.UUID
    expected_version: int | None = Field(default=None, ge=1, strict=True)


class ImmImportEntry(Strict):
    id: uuid.UUID | None = None
    expected_version: int | None = Field(default=None, ge=1, strict=True)
    values: ImmInput


class ImmImport(Strict):
    entries: list[ImmImportEntry] = Field(min_length=1, max_length=500)
    idempotencyKey: uuid.UUID
    reviewToken: str = ""
    confirmUpdates: bool = False


class ImmRecord(BaseModel):
    """Encrypted document projected only after protected authorization."""
    id: uuid.UUID
    number: str
    date: str
    version: int
    patientId: uuid.UUID
    doctorId: uuid.UUID
    mrId: uuid.UUID
    status: Status
    dosage: str
    histamine: str
    saline: str
    remarks: str
    shipping: str
    patient: dict
    doctor: dict
    mr: dict
    recipient: dict
    groups: list[dict]
    attachments: list[dict]
    totalMinor: int | None
    pricingBasis: Literal["allergen_rates", "legacy_bottle_mrp"] = "legacy_bottle_mrp"
    audit: dict | None = None
    poNumber: str | None = None
    reviewDecision: Literal["Approved", "Rejected"] | None = None


class ImmPage(BaseModel):
    items: list[ImmRecord]
    total: int
    filtered: int | None
    nextCursor: uuid.UUID | None
    counts: dict[str, int]


class ImmReferencePage(BaseModel):
    items: list[dict]
    nextCursor: uuid.UUID | None
    limit: int


class ImmUploadPolicy(BaseModel):
    maxFiles: int
    maxBytes: int
    types: list[str]


class ImmImportReview(BaseModel):
    valid: bool
    entries: list[dict]
    reviewToken: str
    additions: int
    updates: int
    unchanged: int
    rejected: int
    patientAdditions: int


class ImmImportResult(BaseModel):
    imported: int
    orders: list[ImmRecord]
