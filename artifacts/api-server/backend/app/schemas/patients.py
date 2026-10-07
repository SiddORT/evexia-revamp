"""Patient business input; identity, ownership and attribution are server owned."""
import re
import uuid
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.doctors import DoctorFields, DoctorVersion


class PatientFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    gender: Literal["male", "female", "other", "prefer not to say"]
    phone: str = Field(min_length=1, max_length=20)
    dialCountry: Literal["IN", "US", "GB", "AE"] = "IN"
    email: str = Field(default="", max_length=320)
    dateOfBirth: date
    doctorId: uuid.UUID
    instructionsLanguage: str = Field(min_length=1, max_length=100)
    status: Literal["active", "inactive"] = "active"
    addressLine1: str = Field(min_length=1, max_length=300)
    addressLine2: str = Field(default="", max_length=300)
    landmark: str = Field(min_length=1, max_length=200)
    pincode: str = Field(min_length=2, max_length=12)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    country: str = Field(min_length=1, max_length=100)

    _trim = field_validator("*", mode="before")(DoctorFields.trim.__func__)
    _email = field_validator("email")(DoctorFields.mail.__func__)

    @field_validator("dateOfBirth", mode="before")
    @classmethod
    def calendar(cls, value):
        if not isinstance(value, date) and (not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)):
            raise ValueError("Use an ISO calendar date")
        if isinstance(value, datetime):
            raise ValueError("Use a date, not a timestamp")
        return value

    @field_validator("dateOfBirth")
    @classmethod
    def nonfuture(cls, value):
        if value > datetime.now(ZoneInfo("Asia/Kolkata")).date():
            raise ValueError("Date of birth cannot be in the future")
        return value

    @model_validator(mode="after")
    def business(self):
        digits = {"IN": 10, "US": 10, "GB": 10, "AE": 9}[self.dialCountry]
        if not re.fullmatch(r"[0-9 ()-]+", self.phone) or len(re.sub(r"\D", "", self.phone)) != digits:
            raise ValueError(f"Phone requires {digits} national digits")
        self.phone = re.sub(r"[\s()-]", "", self.phone)
        if not re.fullmatch(r"\d{6}" if self.country.lower() == "india" else r"[a-zA-Z0-9][a-zA-Z0-9 -]{1,11}", self.pincode):
            raise ValueError("Invalid postal code")
        return self


class PatientEdit(PatientFields):
    expected_version: int = Field(ge=1, strict=True)


class PatientStatus(DoctorVersion):
    status: Literal["active", "inactive"]


class PatientDirectoryResponse(PatientFields):
    id: uuid.UUID
    code: str
    version: int
    doctorName: str
    doctorRegistrationNumber: str
    mrId: uuid.UUID | None
    mrName: str
    zoneId: uuid.UUID | None
    zoneName: str
    assignmentWarnings: list[str]
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class PatientPage(BaseModel):
    items: list[PatientDirectoryResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class PatientChoice(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    usable: bool
    mrName: str
    zoneName: str


class PatientChoices(BaseModel):
    items: list[PatientChoice]
    total: int
    limit: int
    offset: int


class PatientImportRow(BaseModel):
    row: int
    name: str
    code: str
    errors: list[str]


class PatientReview(BaseModel):
    rows: list[PatientImportRow]
    valid: bool
    digest: str


class PatientImportResult(BaseModel):
    imported: int
