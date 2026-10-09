"""Vendor-only schemas: attribution is always server owned."""
import re
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.vendor_phone import VENDOR_COUNTRIES, normalize_vendor_phone

VendorCountry = Literal[*VENDOR_COUNTRIES]

BUSINESS_FIELDS = ("vendorName", "gstNo", "registeredAddress", "contactPersonName",
                   "emailId", "phoneNo", "dialCountry", "status")


class VendorFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    vendorName: str = Field(min_length=1, max_length=200)
    gstNo: str = Field(min_length=15, max_length=15)
    registeredAddress: str = Field(min_length=1, max_length=2000)
    contactPersonName: str = Field(min_length=1, max_length=200)
    emailId: str = Field(min_length=3, max_length=320)
    dialCountry: VendorCountry = "IN"
    phoneNo: str = Field(min_length=1, max_length=30)
    status: Literal["active", "inactive"] = "active"

    @field_validator("vendorName", "contactPersonName", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("gstNo", mode="before")
    @classmethod
    def uppercase_gst(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("gstNo")
    @classmethod
    def gst(cls, value):
        if not re.fullmatch(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]", value):
            raise ValueError("Enter a valid 15-character GST number.")
        return value

    @field_validator("emailId")
    @classmethod
    def email(cls, value):
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("vendorName", "registeredAddress", "contactPersonName", "emailId")
    @classmethod
    def printable(cls, value, info):
        allowed = "\n\r\t" if info.field_name == "registeredAddress" else ""
        if any((ord(c) < 32 and c not in allowed) or ord(c) == 127 or
               0xD800 <= ord(c) <= 0xDFFF or c in "\ufffe\uffff" for c in value):
            raise ValueError("Unsupported characters.")
        return value

    @field_validator("phoneNo")
    @classmethod
    def phone(cls, value, info):
        return normalize_vendor_phone(value, info.data.get("dialCountry"))


class VendorEdit(VendorFields):
    expected_version: int = Field(ge=1, strict=True)


class VendorVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class VendorStatus(VendorVersion):
    status: Literal["active", "inactive"]


class VendorResponse(VendorFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class VendorPage(BaseModel):
    items: list[VendorResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class VendorImportRow(BaseModel):
    row: int
    values: dict[str, str]
    errors: list[str]


class VendorReview(BaseModel):
    rows: list[VendorImportRow]
    valid: bool
    digest: str
    validCount: int
    invalidCount: int


class VendorImportResult(BaseModel):
    imported: int
