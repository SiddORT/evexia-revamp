"""Strict untrusted Kits inputs. Historical people are server-owned."""
import uuid
import re
from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import Field, model_validator
from app.schemas.immunotherapy import Strict, Status, ImmReferencePage, ImmImportReview, ImmUploadPolicy

Payment = Literal["Unpaid", "Paid", "Partial"]


class KitsAddress(Strict):
    line1: str = Field(default="", max_length=1000)
    line2: str = Field(default="", max_length=1000)
    landmark: str = Field(default="", max_length=1000)
    country: str = Field(default="", max_length=200)
    state: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=200)
    pincode: str = Field(default="", max_length=32)


class KitsRecipient(Strict):
    name: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=25)
    address: KitsAddress = Field(default_factory=KitsAddress)


class KitsConfiguration(Strict):
    product: Literal["", "200", "250", "100", "85", "70", "58", "Customized"] = ""
    custom: str = Field(default="", max_length=32)
    volume: str = Field(default="", max_length=32)
    quantity: str = Field(default="", max_length=12)


def positive(value, whole=False):
    return bool(re.fullmatch(r"\d{1,9}" if whole else r"(?:\d{1,9}(?:\.\d{1,6})?|\.\d{1,6})", value)) and Decimal(value) > 0


class KitsInput(Strict):
    orderDate: date | None = None
    orderFor: Literal["doctor", "mr"] = "doctor"
    doctorId: uuid.UUID
    mrId: uuid.UUID | None = None
    patientId: uuid.UUID | None = None
    kit: KitsConfiguration = Field(default_factory=KitsConfiguration)
    lancets: str = Field(default="", max_length=12)
    applicators: str = Field(default="", max_length=12)
    tray: str = Field(default="", max_length=12)
    shipping: Literal["doctor", "mr", "other"] = "doctor"
    other: KitsRecipient = Field(default_factory=KitsRecipient)
    remarks: str = Field(default="", max_length=4000)
    status: Status = "Confirmed"
    paymentStatus: Payment = "Unpaid"
    attachmentIds: list[uuid.UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def configuration(self):
        if (self.orderFor == "mr" or self.shipping == "mr") and not self.mrId:
            raise ValueError("Select an MR for MR orders or MR shipping")
        kit = self.kit
        has_kit = any(kit.model_dump().values())
        if has_kit:
            if not kit.product or not positive(kit.volume) or not positive(kit.quantity, True):
                raise ValueError("Kit product, positive volume and whole quantity are required")
            if kit.product == "Customized" and not positive(kit.custom):
                raise ValueError("Enter a positive customized product value")
            if kit.product != "Customized" and kit.custom:
                raise ValueError("Custom value is only supported for Customized kits")
        counts = [self.lancets, self.applicators, self.tray]
        if any(v and not positive(v, True) for v in counts):
            raise ValueError("Consumable quantities must be positive whole counts")
        if not has_kit and not any(counts):
            raise ValueError("Include at least one kit or consumable")
        if self.shipping == "other":
            other = self.other
            if not other.name.strip() or not re.fullmatch(r"[0-9 ()+\-]{5,25}", other.phone) or len(re.sub(r"\D", "", other.phone)) < 5:
                raise ValueError("Other shipping requires a name and valid phone")
            if any(not getattr(other.address, k).strip() for k in ("line1", "country", "state", "city", "pincode")):
                raise ValueError("Complete the Other shipping address")
        if len(set(self.attachmentIds)) != len(self.attachmentIds):
            raise ValueError("Duplicate attachments")
        return self


class KitsWrite(KitsInput):
    idempotencyKey: uuid.UUID


class KitsImportEntry(Strict):
    id: uuid.UUID | None = None
    number: str = Field(default="", max_length=48)
    expected_version: int | None = Field(default=None, ge=1, strict=True)
    values: KitsInput


class KitsImport(Strict):
    entries: list[KitsImportEntry] = Field(min_length=1, max_length=500)
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(default="", max_length=256)
    confirmUpdates: bool = False


class KitsRecord(KitsInput):
    id: uuid.UUID
    number: str
    date: str
    version: int
    doctor: dict
    mr: dict | None
    patient: dict | None
    billing: dict
    recipient: dict
    attachments: list[dict]


class KitsPage(Strict):
    items: list[KitsRecord]
    total: int
    filtered: int | None
    nextCursor: uuid.UUID | None
    counts: dict[str, int]


class KitsImportResult(Strict):
    imported: int
    orders: list[KitsRecord]
