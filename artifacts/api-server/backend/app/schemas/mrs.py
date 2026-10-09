"""Business directory input; identifiers are server relationships, never local IDs."""
import re
import uuid
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from email_validator import validate_email, EmailNotValidError


class MRFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=20)
    userId: str = Field(min_length=3, max_length=32, pattern=r"^[a-z][a-z0-9._-]{2,31}$")
    email: str = Field(default="", max_length=320)
    contactRequirement: Literal["required", "optional"] = "required"
    hq: uuid.UUID
    zoneId: uuid.UUID
    employeeCode: str = Field(min_length=1, max_length=64)
    dateOfJoining: date
    designation_id: uuid.UUID
    reportingManagerId: uuid.UUID | None = None
    paymentLimit: Decimal = Field(default=Decimal("0.00"), ge=0, le=Decimal("999999999.99"), max_digits=11, decimal_places=2)
    doctorDaysLimit: int = Field(default=0, ge=0, le=3650, strict=True)
    status: Literal["active", "inactive"]
    pincode: str = Field(pattern=r"^[1-9][0-9]{5}$")
    addressLine1: str = Field(min_length=1, max_length=300)
    addressLine2: str = Field(default="", max_length=300)
    landmark: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    country: str = Field(min_length=1, max_length=100)

    @field_validator("*", mode="before")
    @classmethod
    def trim(cls, value, info):
        if info.field_name == "initialPassword":
            return value
        if isinstance(value, str):
            value = value.strip()
            if any(unicodedata.category(c).startswith("C") or c in "\ufffe\uffff" for c in value):
                raise ValueError("Unsupported characters")
        return value

    @field_validator("userId", "email", mode="before")
    @classmethod
    def identifier(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("phone", mode="before")
    @classmethod
    def telephone(cls, value):
        if not isinstance(value, str):
            return value
        value = re.sub(r"[\s()-]", "", value)
        if value.startswith("+91"):
            value = value[3:]
        if value and not re.fullmatch(r"[0-9]{10}", value):
            raise ValueError("Use a ten-digit Indian phone")
        return value

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        if value:
            try:
                value = validate_email(value, check_deliverability=False).normalized.lower()
            except EmailNotValidError:
                raise ValueError("Invalid email") from None
        return value

    @field_validator("dateOfJoining", mode="before")
    @classmethod
    def joining_date(cls, value):
        if isinstance(value, str) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Use a real ISO calendar date")
        return value

    @field_validator("dateOfJoining")
    @classmethod
    def nonfuture(cls, value):
        if value > datetime.now(ZoneInfo("Asia/Kolkata")).date():
            raise ValueError("Joining date cannot be future in Asia/Kolkata")
        return value

    @field_validator("paymentLimit", mode="before")
    @classmethod
    def exact_amount(cls, value):
        if value is None or value == "":
            return Decimal("0.00")
        if isinstance(value, bool) or not re.fullmatch(r"\d{1,9}(?:\.\d{1,2})?", str(value)):
            raise ValueError("Use a nonnegative exact amount with at most two places")
        return Decimal(str(value)).quantize(Decimal("0.01"))

    @field_validator("doctorDaysLimit", mode="before")
    @classmethod
    def default_days(cls, value):
        return 0 if value is None or value == "" else value

    @model_validator(mode="after")
    def contact_rule(self):
        if self.contactRequirement == "required" and (not self.phone or not self.email):
            raise ValueError("Both phone and email are required")
        return self


class MRCreate(MRFields):
    initialPassword: str | None = Field(default=None, min_length=12, max_length=128)

    @field_validator("initialPassword", mode="before")
    @classmethod
    def password_unchanged(cls, value):
        # Passwords are opaque, not trimmed business text.
        return value


class MRVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class MREdit(MRFields):
    expected_version: int = Field(ge=1, strict=True)


class MRStatus(MRVersion):
    status: Literal["active", "inactive"]


class MRContact(MRVersion):
    contactRequirement: Literal["required", "optional"]


class MRDirectoryResponse(MRFields):
    designationName: str = Field(json_schema_extra={"readOnly": True})
    id: uuid.UUID
    version: int
    hqName: str
    zoneName: str
    reportingManagerName: str
    assignmentWarnings: list[str]
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class MRCredentials(BaseModel):
    userId: str
    password: str


class MRCreated(BaseModel):
    record: MRDirectoryResponse
    credentials: MRCredentials


class MRPage(BaseModel):
    items: list[MRDirectoryResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class MRChoice(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    deleted: bool = False


class MRDoctorChoice(BaseModel):
    id: uuid.UUID
    name: str
    registrationNumber: str
    status: Literal["active", "inactive"]
    zoneName: str


class MRDoctorPage(BaseModel):
    items: list[MRDoctorChoice]
    total: int
    filtered: int
    limit: int
    offset: int


class MRChoices(BaseModel):
    items: list[MRChoice]
    total: int
    limit: int
    offset: int


class MRUsername(BaseModel):
    userId: str


class MRImportRow(BaseModel):
    row: int
    name: str
    userId: str
    errors: list[str]


class MRReview(BaseModel):
    rows: list[MRImportRow]
    valid: bool
    digest: str


class MRImportResult(BaseModel):
    imported: int
    credentials: list[MRCredentials]


class PostalChoice(BaseModel):
    city: str
    state: str
    country: str


class PostalResponse(BaseModel):
    pincode: str
    choices: list[PostalChoice]
    message: str
