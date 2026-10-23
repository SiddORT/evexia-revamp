"""Lupin count-based pricing; patient membership is independent context."""
import re
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import Field, model_validator
from app.schemas.immunotherapy import Strict

LupinStatus = Literal["Confirmed", "Approved", "Shipped", "Delivered", "Rejected", "Returned"]
LupinPayment = Literal["Unpaid", "Paid", "Partial"]


class LupinInput(Strict):
    orderDate: date | None = None
    doctorId: uuid.UUID
    mrId: uuid.UUID
    patientIds: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    patientCount: int = Field(ge=1, le=1000000, strict=True)
    price: str = Field(max_length=32)
    remarks: str = Field(default="", max_length=4000)
    attachmentIds: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    status: LupinStatus = "Confirmed"
    paymentStatus: LupinPayment = "Unpaid"

    @model_validator(mode="after")
    def values(self):
        if not re.fullmatch(r"\d{1,9}(?:\.\d{1,2})?", self.price) or Decimal(self.price) <= 0:
            raise ValueError("Enter a positive exact INR price with at most two decimal places")
        if len(set(self.patientIds)) != len(self.patientIds) or len(set(self.attachmentIds)) != len(self.attachmentIds):
            raise ValueError("Duplicate Patient or attachment references")
        return self


class LupinWrite(LupinInput):
    idempotencyKey: uuid.UUID


class LupinImportEntry(Strict):
    id: uuid.UUID | None = None
    number: str = Field(default="", max_length=48)
    expected_version: int | None = Field(default=None, ge=1, strict=True)
    values: LupinInput


class LupinImport(Strict):
    entries: list[LupinImportEntry] = Field(min_length=1, max_length=500)
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(default="", max_length=256)
    confirmUpdates: bool = False


class LupinRecord(LupinInput):
    id: uuid.UUID
    number: str
    date: str
    version: int
    doctor: dict
    mr: dict
    patients: list[dict]
    total: str
    attachments: list[dict]


class LupinPage(Strict):
    items: list[LupinRecord]
    total: int
    filtered: int | None
    nextCursor: uuid.UUID | None
    counts: dict[str, int]


class LupinImportResult(Strict):
    imported: int
    orders: list[LupinRecord]


class LupinUploadCancellation(Strict):
    id: uuid.UUID
    cancelled: bool
