"""Settings-only invoice source. No legal, banking or tax defaults."""
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class InvoiceDetails(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=200, strict=True)
    company_name: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=2000)
    email: str = Field(default="", max_length=200)
    website: str = Field(default="", max_length=200)
    customer_care: str = Field(default="", max_length=200)
    drug_licenses: str = Field(default="", max_length=1000)
    gstin: str = Field(default="", max_length=200)
    pan: str = Field(default="", max_length=200)
    bank_name: str = Field(default="", max_length=200)
    account_holder: str = Field(default="", max_length=200)
    account_number: str = Field(default="", max_length=200)
    branch: str = Field(default="", max_length=200)
    ifsc: str = Field(default="", max_length=200)
    payment_on: str = Field(default="", max_length=200)
    upi_id: str = Field(default="", max_length=200)
    declaration: str = Field(default="", max_length=4000)
    terms: str = Field(default="", max_length=12000)


class InvoiceQRInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    content_type: Literal["image/png", "image/jpeg"]
    base64: str = Field(min_length=1, max_length=699052)


class InvoiceSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_version: int = Field(strict=True, ge=0, le=2147483646)
    details: InvoiceDetails
    qr_action: Literal["keep", "remove", "replace"]
    qr_data: InvoiceQRInput | None = None


class InvoiceQRMetadata(BaseModel):
    version: int
    content_type: Literal["image/png", "image/jpeg"]
    size: int
    sha256: str


class InvoiceSettingsView(BaseModel):
    configured: bool
    version: int
    details: InvoiceDetails
    qr: InvoiceQRMetadata | None
    updated_at: datetime | None


class InvoiceChange(BaseModel):
    field: str
    before: str
    after: str


class InvoiceActor(BaseModel):
    id: UUID
    label: str


class InvoiceRevisionView(BaseModel):
    version: int
    changed_at: datetime
    actor: InvoiceActor
    changes: list[InvoiceChange]
    qr_before: InvoiceQRMetadata | None
    qr_after: InvoiceQRMetadata | None


class InvoiceHistoryView(BaseModel):
    items: list[InvoiceRevisionView]
    next_before_version: int | None


class InvoiceReconcileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvoiceReconcileView(BaseModel):
    outcome: Literal["committed", "cancelled"]
    saved: InvoiceSettingsView
    committed_version: int | None


class InvoiceQRView(InvoiceQRInput):
    version: int
