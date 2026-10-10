"""Doctor business records: no credentials, writable Zone or client audit fields."""
import re
import uuid
from app.schemas.directory_search import SearchSection
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from email_validator import validate_email, EmailNotValidError
from app.schemas.phone import DialCountry, normalize_phone


class DoctorFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=20)
    dialCountry: DialCountry = "IN"
    alternatePhone: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=320)
    contactRequirement: Literal["required", "optional"] = "optional"
    dateOfJoining: date | None = None
    registrationNumber: str = Field(min_length=1, max_length=100)
    qualification: str = Field(min_length=1, max_length=200)
    clinicName: str = Field(default="", max_length=200)
    mrId: uuid.UUID
    invoiceType: Literal["normal", "gst"] = "normal"
    gstNumber: str = Field(default="", max_length=20)
    drugLicenceNumber: str = Field(default="", max_length=100)
    orderDiscount: Decimal = Field(default=Decimal("0.00"), ge=0, le=100, decimal_places=2)
    daysLimit: int = Field(default=0, ge=0, le=2147483647, strict=True)
    paymentLimit: Decimal = Field(default=Decimal("0.00"), ge=0, le=Decimal("9999999999999.99"), max_digits=15, decimal_places=2)
    status: Literal["active", "inactive"] = "active"
    pincode: str = Field(min_length=2, max_length=12)
    addressLine1: str = Field(min_length=1, max_length=300)
    addressLine2: str = Field(default="", max_length=300)
    landmark: str = Field(min_length=1, max_length=200)
    country: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=100)

    @field_validator("*", mode="before")
    @classmethod
    def trim(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(unicodedata.category(c).startswith("C") or c in "\ufffe\uffff" for c in value):
                raise ValueError("Unsupported characters")
        return value

    @field_validator("dateOfJoining", mode="before")
    @classmethod
    def joining(cls, value):
        if value == "":
            return None
        if isinstance(value, str) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Use an ISO calendar date")
        return value

    @field_validator("dateOfJoining")
    @classmethod
    def nonfuture(cls, value):
        if value and value > datetime.now(ZoneInfo("Asia/Kolkata")).date():
            raise ValueError("Joining date cannot be in the future")
        return value

    @field_validator("orderDiscount", "paymentLimit", mode="before", json_schema_input_type=str | int | None)
    @classmethod
    def exact(cls, value):
        if isinstance(value, (float, bool)):
            raise ValueError("Send monetary values as exact decimal strings, not floating-point numbers")
        value = "0" if value is None or value == "" else str(value)
        if not re.fullmatch(r"\d{1,13}(?:\.\d{1,2})?", value):
            raise ValueError("Use a nonnegative exact decimal with at most two places")
        return Decimal(value).quantize(Decimal("0.01"))

    @field_validator("email")
    @classmethod
    def mail(cls, value):
        if value:
            try:
                return validate_email(value, check_deliverability=False).normalized
            except EmailNotValidError:
                raise ValueError("Invalid email") from None
        return value

    @model_validator(mode="after")
    def business(self):
        for key in ("phone", "alternatePhone"):
            value = getattr(self, key)
            if value:
                setattr(self, key, normalize_phone(value, self.dialCountry))
        if self.contactRequirement == "required" and (not self.phone or not self.email):
            raise ValueError("Both phone and email are required")
        indian = self.country.lower() == "india"
        if not re.fullmatch(r"\d{6}" if indian else r"[a-zA-Z0-9][a-zA-Z0-9 -]{1,11}", self.pincode):
            raise ValueError("Invalid postal code")
        if self.invoiceType == "gst" and not self.gstNumber:
            raise ValueError("GST number is required for GST invoices")
        if self.gstNumber and not re.fullmatch(r"[0-9A-Z]{15}" if indian else r"[A-Za-z0-9 -]{5,20}", self.gstNumber.upper()):
            raise ValueError("Invalid GST number")
        self.gstNumber = self.gstNumber.upper()
        return self


class DoctorVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class DoctorEdit(DoctorFields):
    expected_version: int = Field(ge=1, strict=True)


class DoctorStatus(DoctorVersion):
    status: Literal["active", "inactive"]

class DoctorDeletion(DoctorVersion):
    """Only the concurrency version is client-owned."""


class DoctorContact(DoctorVersion):
    contactRequirement: Literal["required", "optional"]


class DoctorSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    expected_version: int = Field(ge=1, strict=True)


class DoctorBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selected: list[DoctorSelection] = Field(min_length=1, max_length=100)
    operation: Literal["shift", "verification"]
    mrId: uuid.UUID | None = None
    verification: Literal["verified", "unverified"] | None = None

    @model_validator(mode="after")
    def selection(self):
        if len({s.id for s in self.selected}) != len(self.selected):
            raise ValueError("Duplicate selected doctors")
        if self.operation == "shift" and (not self.mrId or self.verification is not None):
            raise ValueError("Shift requires only an MR")
        if self.operation == "verification" and (not self.verification or self.mrId is not None):
            raise ValueError("Verification requires only a verification value")
        return self


class DoctorResponse(DoctorFields):
    id: uuid.UUID
    version: int
    verification: Literal["verified", "unverified"]
    mrName: str
    zoneId: uuid.UUID | None
    zoneName: str
    assignmentWarnings: list[str]
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class DoctorPage(SearchSection):
    items: list[DoctorResponse]
    total: int
    filtered: int | None
    limit: int
    offset: int


class DoctorChoice(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    zoneId: uuid.UUID | None
    zoneName: str
    zoneStatus: Literal["active", "inactive"] | None
    usable: bool
    deleted: bool


class DoctorChoices(SearchSection):
    items: list[DoctorChoice]
    total: int | None
    limit: int
    offset: int


class DoctorFilters(BaseModel):
    zones: list[dict[str, str]]
    states: list[str]
    missingMR: bool
    missingZone: bool


class DoctorImportRow(BaseModel):
    row: int
    name: str
    registrationNumber: str
    errors: list[str]


class DoctorReview(BaseModel):
    rows: list[DoctorImportRow]
    valid: bool
    digest: str


class DoctorImportResult(BaseModel):
    imported: int
